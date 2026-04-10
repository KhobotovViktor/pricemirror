"""
Cloud Scraper — serverless replacement for Playwright-based scraper.py.
Strategy:
  1. Try Supabase Edge Function 'scrape-price' (handles JS-rendered pages)
  2. Fallback: direct httpx + JSON-LD / meta / regex extraction
Works on Vercel and any environment without Playwright/Chromium.
"""
import asyncio
import re
import json
import urllib.parse
import os
import httpx
from datetime import datetime
from dotenv import load_dotenv
from pathlib import Path

env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

from ..core.database import supabase
from ..core.notifier import notifier

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_JWT_KEY = os.getenv("SUPABASE_JWT_KEY", "")
EDGE_FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/scrape-price" if SUPABASE_URL else ""

HTTP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Cache-Control": "max-age=0",
}


def _extract_price_from_html(html: str, url: str) -> tuple[int | None, str]:
    """
    Extract price from raw HTML. Returns (price, method) or (None, reason).
    Tries: JSON-LD → __NEXT_DATA__ → meta itemprop → store regex.
    """

    # 1. JSON-LD schema.org
    for block in re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html, re.DOTALL
    ):
        try:
            data = json.loads(block)
            if isinstance(data, list):
                data = data[0]
            if isinstance(data, dict) and "@graph" in data:
                for item in data["@graph"]:
                    if isinstance(item, dict) and item.get("@type") in ("Product", "Offer"):
                        data = item
                        break
            if isinstance(data, dict):
                offers = data.get("offers") or (data if data.get("@type") == "Offer" else None)
                if isinstance(offers, list):
                    offers = offers[0]
                if isinstance(offers, dict):
                    price_val = offers.get("price") or offers.get("lowPrice")
                    if price_val:
                        cleaned = re.sub(r'[^\d]', '', str(price_val))
                        if cleaned:
                            return int(cleaned), "json-ld"
        except Exception:
            continue

    # 2. Next.js __NEXT_DATA__ (covers hoff.ru and many modern Russian retail sites)
    m = re.search(r'<script id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', html, re.DOTALL)
    if m:
        try:
            nd = json.loads(m.group(1))
            nd_str = json.dumps(nd)
            # Look for price fields in the SSR data
            for key in ('"price"', '"currentPrice"', '"salePrice"', '"finalPrice"', '"priceValue"'):
                pm = re.search(key + r'\s*:\s*(\d{3,7})', nd_str)
                if pm:
                    return int(pm.group(1)), "__next_data__"
        except Exception:
            pass

    # 3. <meta itemprop="price">
    m = re.search(r'itemprop=["\']price["\'][^>]*content=["\']([^"\']+)["\']', html)
    if not m:
        m = re.search(r'content=["\']([^"\']+)["\'][^>]*itemprop=["\']price["\']', html)
    if m:
        cleaned = re.sub(r'[^\d]', '', m.group(1))
        if cleaned:
            return int(cleaned), "meta-itemprop"

    # 4. Store-specific patterns
    domain = urllib.parse.urlparse(url).netloc.replace("www.", "")
    patterns = {
        "hoff.ru":       [r'"price"\s*:\s*(\d{3,7})', r'data-price=["\'](\d+)["\']', r'"basePrice"\s*:\s*(\d{3,7})'],
        "divan.ru":      [r'"price"\s*:\s*(\d{3,7})', r'data-price=["\'](\d+)["\']'],
        "shatura.com":   [r'"price"\s*:\s*(\d{3,7})'],
        "alleyadoma.ru": [r'"price"\s*:\s*(\d{3,7})'],
        "nonton.ru":     [r'"price"\s*:\s*(\d{3,7})', r'data-price=["\'](\d+)["\']',
                          r'product-item-detail-price-value[^>]*>[\s₽]*(\d[\d\s]{2,})',
                          r'"PRICE"\s*:\s*(\d{3,7})', r'"MIN_PRICE"\s*:\s*(\d{3,7})'],
    }
    for pat in patterns.get(domain, [r'"price"\s*:\s*(\d{3,7})']):
        m = re.search(pat, html)
        if m:
            val = int(m.group(1))
            if val >= 100:
                return val, f"regex:{pat[:30]}"

    return None, "no-match"


async def _scrape_via_httpx(url: str) -> dict:
    """Direct HTTP scraping using httpx. Warms session with homepage first to get cookies."""
    parsed = urllib.parse.urlparse(url)
    domain = parsed.netloc.replace("www.", "")
    origin = f"{parsed.scheme}://{parsed.netloc}"

    headers = {**HTTP_HEADERS, "Referer": origin + "/"}

    try:
        async with httpx.AsyncClient(
            headers=headers,
            follow_redirects=True,
            timeout=30,
            http2=False,
        ) as client:
            # Step 1: warm session — visit homepage to acquire cookies
            try:
                warm = await client.get(origin + "/", timeout=15)
                print(f"[Cloud/httpx] Session warm: HTTP {warm.status_code} from {origin}/")
            except Exception as e:
                print(f"[Cloud/httpx] Session warm failed (non-fatal): {e}")

            # Step 2: fetch product page with cookies set
            headers_product = {
                **headers,
                "Referer": origin + "/",
                "Sec-Fetch-Site": "same-origin",
            }
            resp = await client.get(url, headers=headers_product)
            html = resp.text
            print(f"[Cloud/httpx] HTTP {resp.status_code} for {url} ({len(html)} bytes)")

        price, method = _extract_price_from_html(html, url)
        if price:
            print(f"[Cloud/httpx] Price {price} via '{method}'")
        else:
            snippet = html[:300].replace('\n', ' ')
            print(f"[Cloud/httpx] No price (method='{method}'). Snippet: {snippet}")
        return {"price": price, "image_url": None, "_method": method, "_http_status": resp.status_code}
    except Exception as e:
        print(f"[Cloud/httpx] Error fetching {url}: {e}")
        return {"price": None, "image_url": None, "_method": f"error:{e}"}


async def _try_hoff_api(url: str) -> dict | None:
    """Try hoff.ru internal product API using product ID extracted from URL slug."""
    m = re.search(r'_id(\d+)', url)
    if not m:
        return None
    product_id = m.group(1)
    api_url = f"https://hoff.ru/api/v2/catalog/products/{product_id}/"
    try:
        async with httpx.AsyncClient(headers=HTTP_HEADERS, follow_redirects=True, timeout=15) as client:
            resp = await client.get(api_url)
            print(f"[Cloud/hoff-api] HTTP {resp.status_code} for product {product_id}")
            if resp.status_code == 200:
                data = resp.json()
                # Try common price field paths
                price = (
                    data.get("price")
                    or data.get("salePrice")
                    or data.get("currentPrice")
                    or (data.get("offers") or [{}])[0].get("price")
                )
                if price:
                    return {"price": int(float(str(price).replace(" ", ""))), "image_url": None, "_method": "hoff-api"}
    except Exception as e:
        print(f"[Cloud/hoff-api] Error: {e}")
    return None


async def scrape_product_details(url: str) -> dict:
    """
    Extract price from a product page.
    Tries Edge Function first; falls back to direct httpx if unavailable.
    """
    # 0. Store-specific API shortcuts (bypass bot protection)
    domain = urllib.parse.urlparse(url).netloc.replace("www.", "")
    if "hoff.ru" in domain:
        result = await _try_hoff_api(url)
        if result:
            return result

    # 1. Try Edge Function (handles JS-rendered pages)
    if EDGE_FUNCTION_URL and SUPABASE_JWT_KEY:
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                print(f"[Cloud/EdgeFn] Requesting price for: {url}")
                response = await client.post(
                    EDGE_FUNCTION_URL,
                    json={"url": url},
                    headers={
                        "Authorization": f"Bearer {SUPABASE_JWT_KEY}",
                        "Content-Type": "application/json",
                        "apikey": SUPABASE_JWT_KEY,
                    }
                )
            if response.status_code == 200:
                data = response.json()
                price = data.get("price")
                image_url = data.get("image_url")
                if price:
                    print(f"[Cloud/EdgeFn] Price {price} for {url}")
                    return {"price": price, "image_url": image_url}
                print(f"[Cloud/EdgeFn] No price in response, trying httpx fallback")
            else:
                print(f"[Cloud/EdgeFn] HTTP {response.status_code}, trying httpx fallback")
        except Exception as e:
            print(f"[Cloud/EdgeFn] Error: {e}, trying httpx fallback")

    # 2. Fallback: direct httpx
    return await _scrape_via_httpx(url)


async def scrape_specific_mapping(mapping_id: int) -> dict:
    """Update a SINGLE competitor mapping and return detailed result dict."""
    try:
        mapping = (
            supabase.table("competitor_product")
            .select("*, our_product(*)")
            .eq("id", mapping_id)
            .single()
            .execute()
            .data
        )
        if not mapping:
            print(f"[Cloud] Mapping {mapping_id} not found")
            return {"status": "error", "message": f"Mapping {mapping_id} not found"}

        details = await scrape_product_details(mapping["url"])
        method = details.get("_method", "unknown")

        if details.get("image_url"):
            supabase.table("competitor_product").update(
                {"image_url": details["image_url"]}
            ).eq("id", mapping_id).execute()

        if details["price"]:
            supabase.table("price_record").insert({
                "competitor_product_id": mapping_id,
                "price": details["price"],
                "created_at": datetime.utcnow().isoformat()
            }).execute()

            supabase.table("competitor_product").update({
                "last_price": details["price"],
                "last_scrape": datetime.utcnow().isoformat()
            }).eq("id", mapping_id).execute()

            our_prod = mapping.get("our_product") or {}
            our_price = float(our_prod.get("current_price") or 0)
            if our_price and details["price"] < our_price:
                notifier.send_price_alert(
                    our_prod.get("name", ""),
                    our_price,
                    details["price"],
                    mapping["url"]
                )
            return {"status": "ok", "price": details["price"], "method": method,
                    "message": f"Цена обновлена: {details['price']} ₽"}

        return {"status": "error", "price": None, "method": method,
                "message": f"Не удалось извлечь цену (метод: {method}). Возможно, страница требует JS-рендеринга."}
    except Exception as e:
        print(f"[Cloud] Error scraping mapping {mapping_id}: {e}")
        return {"status": "error", "message": str(e)}


async def scrape_our_product_price(product_id: int) -> bool:
    """Scrapes OUR product price from our own website."""
    try:
        product = (
            supabase.table("our_product")
            .select("*")
            .eq("id", product_id)
            .single()
            .execute()
            .data
        )
        if not product or not product.get("url"):
            print(f"[Cloud] No URL for product ID {product_id}")
            return False

        details = await scrape_product_details(product["url"])

        if details["price"]:
            update_data = {"current_price": details["price"]}
            if details["image_url"] and not product.get("image_url"):
                update_data["image_url"] = details["image_url"]
            supabase.table("our_product").update(update_data).eq("id", product_id).execute()
            print(f"[Cloud] Updated our price to {details['price']} for '{product['name']}'")
            return True

        print(f"[Cloud] Failed to extract price for '{product.get('name')}'")
        return False
    except Exception as e:
        print(f"[Cloud] Error scraping product {product_id}: {e}")
        return False


async def scrape_for_product(product_id: int) -> bool:
    """Update prices for our product and all its competitor mappings."""
    print(f"[Cloud] Scraping product ID: {product_id}")
    our_prod = (
        supabase.table("our_product")
        .select("*")
        .eq("id", product_id)
        .single()
        .execute()
        .data
    )
    if not our_prod:
        return False

    if our_prod.get("url"):
        our_details = await scrape_product_details(our_prod["url"])
        update_data = {}
        if our_details["price"]:
            update_data["current_price"] = our_details["price"]
        if our_details["image_url"] and not our_prod.get("image_url"):
            update_data["image_url"] = our_details["image_url"]
        if update_data:
            supabase.table("our_product").update(update_data).eq("id", product_id).execute()
            our_prod.update(update_data)

    mappings = (
        supabase.table("competitor_product")
        .select("*")
        .eq("our_product_id", product_id)
        .execute()
        .data
    )
    for cm in mappings:
        details = await scrape_product_details(cm["url"])
        if details["image_url"]:
            supabase.table("competitor_product").update(
                {"image_url": details["image_url"]}
            ).eq("id", cm["id"]).execute()
            if not our_prod.get("image_url"):
                supabase.table("our_product").update(
                    {"image_url": details["image_url"]}
                ).eq("id", product_id).execute()
                our_prod["image_url"] = details["image_url"]

        if details["price"]:
            supabase.table("price_record").insert({
                "competitor_product_id": cm["id"],
                "price": details["price"],
                "created_at": datetime.utcnow().isoformat()
            }).execute()
            supabase.table("competitor_product").update({
                "last_price": details["price"],
                "last_scrape": datetime.utcnow().isoformat()
            }).eq("id", cm["id"]).execute()

            if our_prod.get("current_price") and details["price"] < float(our_prod["current_price"]):
                notifier.send_price_alert(
                    our_prod["name"],
                    our_prod["current_price"],
                    details["price"],
                    cm["url"]
                )
    return True


async def monitor_all():
    """Scrape all products — cloud version."""
    print("[Cloud] Running monitor_all...")
    resp = supabase.table("our_product").select("id").execute()
    for p in resp.data:
        await scrape_for_product(p["id"])
        await asyncio.sleep(1)
    print("[Cloud] monitor_all complete.")
