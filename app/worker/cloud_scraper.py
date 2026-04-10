"""
Cloud scraper — httpx-based fallback for environments where Playwright is unavailable (e.g. Vercel).
Extracts prices via JSON-LD schema.org, meta itemprop, and store-specific regex patterns.
"""
import asyncio
import re
import json
import urllib.parse
import httpx
from datetime import datetime
from dotenv import load_dotenv
from pathlib import Path

env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

from ..core.database import supabase
from ..core.notifier import notifier

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def _extract_price_from_html(html: str, url: str) -> int | None:
    """Try multiple extraction strategies on raw HTML text."""

    # 1. JSON-LD schema.org Product / Offer
    for block in re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.DOTALL):
        try:
            data = json.loads(block)
            # Handle arrays
            if isinstance(data, list):
                data = data[0]
            # Unwrap @graph
            if isinstance(data, dict) and "@graph" in data:
                for item in data["@graph"]:
                    if isinstance(item, dict) and item.get("@type") in ("Product", "Offer"):
                        data = item
                        break
            if isinstance(data, dict):
                offers = data.get("offers") or data if data.get("@type") == "Offer" else None
                if isinstance(offers, list):
                    offers = offers[0]
                if isinstance(offers, dict):
                    price_val = offers.get("price") or offers.get("lowPrice")
                    if price_val:
                        cleaned = re.sub(r'[^\d]', '', str(price_val))
                        if cleaned:
                            return int(cleaned)
        except Exception:
            continue

    # 2. <meta itemprop="price" content="...">
    m = re.search(r'itemprop=["\']price["\'][^>]*content=["\']([^"\']+)["\']', html)
    if not m:
        m = re.search(r'content=["\']([^"\']+)["\'][^>]*itemprop=["\']price["\']', html)
    if m:
        cleaned = re.sub(r'[^\d]', '', m.group(1))
        if cleaned:
            return int(cleaned)

    # 3. Store-specific patterns
    domain = urllib.parse.urlparse(url).netloc.replace("www.", "")

    patterns = {
        "hoff.ru": [
            r'"price"\s*:\s*"?(\d[\d\s]*)"?',
            r'class="[^"]*price[^"]*"[^>]*>\s*(\d[\d\s]{2,})',
        ],
        "divan.ru": [
            r'"price"\s*:\s*"?(\d[\d\s]*)"?',
            r'data-price=["\'](\d+)["\']',
        ],
        "shatura.com": [
            r'"price"\s*:\s*"?(\d[\d\s]*)"?',
            r'class="[^"]*price[^"]*"[^>]*>\s*(\d[\d\s]{2,})',
        ],
        "alleyadoma.ru": [
            r'"price"\s*:\s*"?(\d[\d\s]*)"?',
            r'class="[^"]*fs-32[^"]*"[^>]*>\s*(\d[\d\s]{2,})',
        ],
    }

    for pat in patterns.get(domain, [r'"price"\s*:\s*"?(\d[\d\s]*)"?']):
        m = re.search(pat, html)
        if m:
            cleaned = re.sub(r'[^\d]', '', m.group(1))
            if cleaned and len(cleaned) >= 3:
                return int(cleaned)

    return None


async def scrape_product_price(url: str) -> dict:
    """Fetch a product page and extract price. Returns {"price": int|None, "image_url": None}."""
    try:
        async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=30) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            html = resp.text

        price = _extract_price_from_html(html, url)
        if price:
            print(f"[cloud] Extracted price {price} from {url}")
        else:
            print(f"[cloud] Could not extract price from {url}")

        return {"price": price, "image_url": None}
    except Exception as e:
        print(f"[cloud] Error fetching {url}: {e}")
        return {"price": None, "image_url": None}


async def scrape_specific_mapping(mapping_id: int):
    """Update a single competitor mapping using HTTP scraping."""
    print(f"[cloud] Scraping mapping ID: {mapping_id}")

    mapping = supabase.table("competitor_product").select("*, our_product(*)").eq("id", mapping_id).single().execute().data
    if not mapping:
        print(f"[cloud] Mapping {mapping_id} not found")
        return False

    our_prod = mapping.get("our_product")
    details = await scrape_product_price(mapping["url"])

    if details["price"]:
        supabase.table("price_record").insert({
            "competitor_product_id": mapping["id"],
            "price": details["price"],
            "created_at": datetime.utcnow().isoformat()
        }).execute()

        if our_prod and our_prod.get("current_price"):
            if details["price"] < float(our_prod["current_price"]):
                notifier.send_price_alert(
                    our_prod["name"], our_prod["current_price"], details["price"], mapping["url"]
                )

    return True


async def scrape_for_product(product_id: int):
    """Update all competitor mappings for a product using HTTP scraping."""
    mappings = supabase.table("competitor_product").select("*, our_product(*)").eq("our_product_id", product_id).execute().data
    for m in mappings:
        await scrape_specific_mapping(m["id"])
        await asyncio.sleep(0.5)
    return True


async def monitor_all():
    products = supabase.table("our_product").select("id").execute().data
    for p in products:
        await scrape_for_product(p["id"])
