import asyncio
import sys

# Critical fix for Windows: ProactorEventLoop is required for playwright subprocesses
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
import re
import os
import json
import urllib.parse
import httpx
import numpy as np
import cv2
import easyocr
from playwright.async_api import async_playwright
try:
    from playwright_stealth import stealth as _stealth_fn
    _STEALTH_AVAILABLE = callable(_stealth_fn)
except Exception:
    _stealth_fn = None
    _STEALTH_AVAILABLE = False

from datetime import datetime, timezone, timedelta as _timedelta
MSK = timezone(_timedelta(hours=3))
from dotenv import load_dotenv
from pathlib import Path
import os

# Standard path resolution for Phase 9 scraper environment
env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

from ..core.database import supabase
from ..core.notifier import notifier

# Global OCR reader instance (lazy initialized)
_ocr_reader = None

def get_ocr_reader():
    """Lazily initializes the OCR reader to prevent startup lag"""
    global _ocr_reader
    if _ocr_reader is None:
        try:
            print("DEBUG: [OCR] Initializing EasyOCR reader...")
            _ocr_reader = easyocr.Reader(['ru', 'en'], gpu=False)
            print("DEBUG: [OCR] EasyOCR initialization complete.")
        except Exception as e:
            print(f"OCR init error: {e}")
            _ocr_reader = None
    return _ocr_reader

# Selectors for known stores (extended for robustness)
STORE_SELECTORS = {
    "hoff.ru": {
        "price": ["meta[itemprop='price']", "[data-testid='product-price']", ".price-current", "[itemprop='price']"],
        "image": [".slider-main img", "img.slider-main__image", ".product-image img", "[data-testid='product-image']"]
    },
    "divan.ru": {
        "price": [".product-price", "span.price", "div.price-val", ".ui-price", ".js-price-value"],
        "image": ["img.product-page__photo", ".js-product-photo", ".product-main-photo img", ".main-photo img"]
    },
    "alleyadoma.ru": {
        "price": [".actual-cost-inside .fs-32.font-weight-700.manrope", ".actual-cost-inside", "meta[itemprop='price']", ".product-price"],
        "image": [
            ".unit-slider-top-inside-tovar.slick-current img",
            ".unit-slider-top-inside-tovar img",
            ".main-image img",
            "img[itemprop='image']",
        ]
    },
    "nonton.ru": {
        "price": [
            "meta[itemprop='price']",
            "[itemprop='price']",
            ".product-item-detail-price-value",
            ".price-new",
            ".current-price",
            ".catalog-element-offer-price",
            ".item-price-current",
            "[data-entity='price']",
            ".product-price",
        ],
        "image": [
            ".product-slider__main img",
            ".product-image img",
            ".detail-gallery img",
        ]
    }
}


def _resolve_store_domain(domain: str) -> str:
    """Resolve regional subdomains to base store domain.
    
    E.g. 'vologda.nonton.ru' -> 'nonton.ru'
    """
    for store_domain in STORE_SELECTORS:
        if domain == store_domain or domain.endswith("." + store_domain):
            return store_domain
    return domain


# Domains where CSS selector probing consistently fails (SPA/React sites that
# block automated selectors). For these, skip straight to JS eval + og:image.
JS_EVAL_ONLY_DOMAINS = {"divan.ru"}

# Phone number patterns to reject as false-positive prices
_PHONE_PATTERNS = [
    re.compile(r'^[78]\d{10}$'),           # 7XXXXXXXXXX or 8XXXXXXXXXX (11 digits)
    re.compile(r'^[78]00\d{7}$'),           # 8-800-XXX-XX-XX without separators
    re.compile(r'^[78]80\d{7}$'),           # 7-800/880
    re.compile(r'^[78]\d{9}$'),             # 10 digits starting with 7/8
    re.compile(r'^[78]800\d{2,7}$'),        # Partial toll-free: 7800555, 78005550665
    re.compile(r'^8800\d{2,7}$'),           # 8800XXXXX
]


def _is_phone_number(value: int) -> bool:
    """Check if a numeric value looks like a Russian phone number, not a price."""
    s = str(value)
    # Full phone numbers (10-11 digits starting with 7 or 8)
    if len(s) >= 10 and s[0] in ('7', '8'):
        return True
    # Pattern-based detection for partial numbers
    for pat in _PHONE_PATTERNS:
        if pat.match(s):
            return True
    return False


def _validate_price(value: int, domain: str = "") -> bool:
    """Validate that extracted number is a plausible product price."""
    if value is None or value <= 0:
        return False
    if _is_phone_number(value):
        print(f"[{domain}] Rejected phone number as price: {value}")
        return False
    # Furniture prices are typically 500 - 9,999,999 RUB
    if value < 500 or value > 9_999_999:
        return False
    return True


async def _try_hoff_api(url: str) -> dict | None:
    """Bypass hoff.ru bot protection via internal product API (same as cloud_scraper)."""
    m = re.search(r'_id(\d+)', url)
    if not m:
        return None
    product_id = m.group(1)
    api_url = f"https://hoff.ru/api/v2/catalog/products/{product_id}/"
    try:
        async with httpx.AsyncClient(
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            follow_redirects=True, timeout=15
        ) as client:
            resp = await client.get(api_url)
            if resp.status_code == 404:
                print(f"[hoff.ru/api] Product {product_id} not found (404) — URL may be outdated")
                return None
            print(f"[hoff.ru/api] HTTP {resp.status_code} for product {product_id}")
            if resp.status_code == 200:
                data = resp.json()
                price = (
                    data.get("price")
                    or data.get("salePrice")
                    or data.get("currentPrice")
                    or (data.get("offers") or [{}])[0].get("price")
                )
                if price and _validate_price(int(float(str(price).replace(" ", "")))):
                    return {"price": int(float(str(price).replace(" ", ""))), "image_url": None}
    except Exception as e:
        print(f"[hoff.ru/api] Error: {e}")
    return None


_HOFF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Cache-Control": "max-age=0",
}


def _extract_price_from_hoff_html(html: str) -> tuple[int | None, str | None]:
    """Parse price and image from hoff.ru product page HTML.
    Returns (price, image_url) or (None, None).
    """
    price = None
    image_url = None

    # 1. __NEXT_DATA__ (Next.js SSR — most reliable)
    nd_m = re.search(r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', html, re.DOTALL)
    if nd_m:
        try:
            nd = json.loads(nd_m.group(1))
            nd_str = json.dumps(nd)
            for key in ('"price"', '"currentPrice"', '"salePrice"', '"finalPrice"', '"basePrice"'):
                pm = re.search(key + r'\s*:\s*(\d{3,7})', nd_str)
                if pm:
                    candidate = int(pm.group(1))
                    if _validate_price(candidate, "hoff.ru"):
                        price = candidate
                        print(f"[hoff.ru] Price {candidate} via __NEXT_DATA__ ({key})")
                        break
        except Exception as e:
            print(f"[hoff.ru] __NEXT_DATA__ parse error: {e}")

    # 2. JSON-LD schema.org
    if not price:
        for block in re.findall(
            r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.DOTALL
        ):
            try:
                data = json.loads(block)
                if isinstance(data, list): data = data[0]
                offers = data.get("offers")
                if isinstance(offers, list): offers = offers[0]
                if isinstance(offers, dict):
                    p = offers.get("price") or offers.get("lowPrice")
                    if p:
                        candidate = int(round(float(str(p).replace(",", ".").replace(" ", ""))))
                        if _validate_price(candidate, "hoff.ru"):
                            price = candidate
                            print(f"[hoff.ru] Price {candidate} via JSON-LD")
                            break
            except Exception:
                continue

    # 3. meta itemprop="price"
    if not price:
        mp = (re.search(r'itemprop=["\']price["\'][^>]*content=["\']([^"\']+)["\']', html) or
              re.search(r'content=["\']([^"\']+)["\'][^>]*itemprop=["\']price["\']', html))
        if mp:
            cleaned = re.sub(r'[^\d]', '', mp.group(1))
            if cleaned and _validate_price(int(cleaned), "hoff.ru"):
                price = int(cleaned)
                print(f"[hoff.ru] Price {price} via meta itemprop")

    # og:image
    img_m = (re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', html) or
             re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']', html))
    if img_m:
        image_url = img_m.group(1)

    return price, image_url




async def _scrape_hoff_playwright(url: str) -> dict:
    """Scrape hoff.ru via Playwright.
    Qrator bot protection returns 401 on first load, then runs a JS challenge
    that auto-refreshes the page. We let the browser handle it and wait.
    """
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled"]
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            viewport={"width": 1920, "height": 1080}
        )
        page = await context.new_page()
        if _STEALTH_AVAILABLE:
            try:
                await _stealth_fn(page)
            except Exception:
                pass
        try:
            await page.set_extra_http_headers({
                "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            })
            # Navigate — Qrator sends 401 + JS challenge page; browser auto-solves it
            await page.goto(url, wait_until="load", timeout=60000)
            # Wait for Qrator JS challenge to complete and page to reload
            await asyncio.sleep(10)

            title = await page.title()
            print(f"[hoff.ru/playwright] Loaded: '{title[:60]}'")

            price = None
            image_url = None

            # Price: meta[itemprop='price'] is reliable on hoff.ru after challenge
            try:
                el = await page.wait_for_selector("meta[itemprop='price']", state="attached", timeout=5000)
                if el:
                    val = await el.get_attribute("content")
                    if val:
                        candidate = int(re.sub(r'[^\d]', '', val))
                        if _validate_price(candidate, "hoff.ru"):
                            price = candidate
                            print(f"[hoff.ru/playwright] Price {price} via meta itemprop")
            except Exception:
                pass

            # Fallback: JSON-LD / itemprop via JS eval
            if not price:
                try:
                    js_price = await page.evaluate('''() => {
                        const meta = document.querySelector("meta[itemprop='price']");
                        if (meta && meta.content) return meta.content;
                        for (const s of document.querySelectorAll("script[type='application/ld+json']")) {
                            try {
                                const d = JSON.parse(s.textContent);
                                const items = Array.isArray(d) ? d : [d];
                                for (const i of items) {
                                    const o = i.offers || (i["@type"]==="Offer" ? i : null);
                                    const ol = Array.isArray(o) ? o : (o ? [o] : []);
                                    for (const off of ol) { if (off.price) return String(off.price); }
                                }
                            } catch(e) {}
                        }
                        return null;
                    }''')
                    if js_price:
                        candidate = int(re.sub(r'[^\d]', '', str(js_price)))
                        if _validate_price(candidate, "hoff.ru"):
                            price = candidate
                            print(f"[hoff.ru/playwright] Price {price} via JS eval")
                except Exception as e:
                    print(f"[hoff.ru/playwright] JS eval error: {e}")

            # Image via og:image
            try:
                og = await page.evaluate('''() => {
                    const og = document.querySelector("meta[property='og:image']");
                    return og ? og.content : null;
                }''')
                if og:
                    image_url = og
            except Exception:
                pass

            if not price:
                print(f"[hoff.ru/playwright] Failed to extract price from {url}")

            return {"price": price, "image_url": image_url}
        except Exception as e:
            print(f"[hoff.ru/playwright] Error: {e}")
            return {"price": None, "image_url": None}
        finally:
            await browser.close()


async def scrape_product_details(url: str):
    """Scrapes both price and image URL from a product page"""
    raw_domain = urllib.parse.urlparse(url).netloc.replace("www.", "")
    domain = _resolve_store_domain(raw_domain)

    # hoff.ru uses Qrator bot protection (returns 401 on first load, then JS challenge
    # auto-solves in a real browser). Strategy: try fast API first, then Playwright
    # with extended wait so Qrator challenge can complete.
    if domain == "hoff.ru":
        # 1. Internal product API (instant, no browser needed)
        result = await _try_hoff_api(url)
        if result:
            return result
        # 2. Playwright — Qrator challenge solves automatically in real Chromium.
        #    We must NOT abort on 401 status and wait ~8s for the page to refresh.
        print("[hoff.ru] API failed, trying Playwright with Qrator wait...")
        return await _scrape_hoff_playwright(url)

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True, 
            args=["--disable-blink-features=AutomationControlled"]
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={'width': 1920, 'height': 1080}
        )
        
        page = await context.new_page()
        if _STEALTH_AVAILABLE:
            try:
                await _stealth_fn(page)
            except Exception as e:
                print(f"[stealth] skipped: {e}")
        
        try:
            await page.set_extra_http_headers({
                "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
            })
            print(f"Scraping: {url}")
            
            parsed = urllib.parse.urlparse(url)
            origin = f"{parsed.scheme}://{parsed.netloc}"

            # Sites that block direct navigation — pre-warm session via homepage
            NEEDS_WARMUP = {"nonton.ru"}
            if domain in NEEDS_WARMUP:
                try:
                    await page.goto(origin + "/", wait_until="load", timeout=30000)
                    await asyncio.sleep(2)
                    # After warmup, set Referer to simulate organic navigation
                    await page.set_extra_http_headers({
                        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                        "Referer": origin + "/",
                    })
                    # Navigate to category page (one level up) before product
                    parts = url.split("?")[0].rstrip("/").split("/")
                    if len(parts) >= 2:
                        category_url = "/".join(parts[:-1]) + "/"
                        await page.goto(category_url, wait_until="load", timeout=30000)
                        await asyncio.sleep(1)
                        await page.set_extra_http_headers({"Referer": category_url})
                    print(f"[{domain}] Session warmed via homepage + category")
                except Exception as e:
                    print(f"[{domain}] Warmup failed (non-fatal): {e}")

            # Use 'load' for all sites — networkidle hangs on pages with
            # continuous background requests (analytics, ads, chat widgets)
            response = await page.goto(url, wait_until="load", timeout=60000)
            wait_time = 2
            await asyncio.sleep(wait_time)

            # Prevent scraping a captcha or forbidden page
            if response and response.status in (401, 403, 404, 429, 500, 502, 503):
                print(f"[{domain}] HTTP Error {response.status}, aborting scrape.")
                return {'price': None, 'image_url': None}

            selectors = STORE_SELECTORS.get(domain, {"price": [], "image": []})

            price = None
            image_url = None

            try:
                page_title = await page.title()
            except Exception:
                page_title = "unknown"
            print(f"[{domain}] Loaded: '{page_title[:60]}'")

            # Check for bot protection / captcha
            page_text = await page.evaluate("() => document.body.innerText")
            if "403 Error" in page_text or ("Доступ к сайту" in page_text and "запрещен" in page_text):
                print(f"[{domain}] Bot protection detected, aborting.")
                return {'price': None, 'image_url': None}
            if "подозрительн" in page_text.lower():
                print(f"[{domain}] Captcha/suspicious activity page, waiting 10s...")
                await asyncio.sleep(10)
                # Re-check after wait (some captchas auto-solve)
                page_text = await page.evaluate("() => document.body.innerText")
                if "подозрительн" in page_text.lower():
                    print(f"[{domain}] Still captcha, aborting.")
                    return {'price': None, 'image_url': None}
            
            print(f"[{domain}] Checking selectors...")

            # For SPA/React sites where CSS selectors consistently fail,
            # skip straight to JS eval to avoid 15+ seconds of selector timeouts.
            skip_css = domain in JS_EVAL_ONLY_DOMAINS

            # 1. Price Extraction
            for s in ([] if skip_css else selectors["price"]):
                try:
                    # meta tags are never "visible" — use state='attached'
                    state = 'attached' if s.startswith('meta') else 'visible'
                    el = await page.wait_for_selector(s, timeout=3000, state=state)
                    if el:
                        tag_name = await el.evaluate('e => e.tagName.toLowerCase()')
                        # meta tags store price in 'content' attribute, not innerText
                        if tag_name == 'meta':
                            text = await el.get_attribute('content') or ''
                        else:
                            text = await el.inner_text()
                        clean_text = re.sub(r'[^\d]', '', text)
                        if clean_text:
                            candidate = int(clean_text)
                            if _validate_price(candidate, domain):
                                price = candidate
                                print(f"[{domain}] Found price via selector '{s}': {price}")
                                break
                            else:
                                print(f"[{domain}] Selector '{s}' value {candidate} rejected by validation")
                except Exception as e:
                    print(f"[{domain}] Selector '{s}' failed: {e}")
                    continue
                
            # 2. Image Extraction
            for s in ([] if skip_css else selectors["image"]):
                try:
                    el = await page.wait_for_selector(s, timeout=3000)
                    if el:
                        tag = await el.evaluate('e => e.tagName.toLowerCase()')
                        if tag == 'img':
                            src = await el.get_attribute("src") or await el.get_attribute("data-src")
                        else:
                            # Container element — find img inside it
                            src = await el.evaluate(
                                'e => { const img = e.querySelector("img"); return img ? (img.src || img.dataset.src || null) : null; }'
                            )
                        if src:
                            image_url = urllib.parse.urljoin(url, src)
                            print(f"[{domain}] Found image via selector '{s}'")
                            break
                except Exception:
                    continue

            # 2b. Image JS fallback — og:image (universal, works on every e-commerce site)
            if not image_url:
                try:
                    og_image = await page.evaluate('''() => {
                        const og = document.querySelector('meta[property="og:image"]');
                        if (og && og.content) return og.content;
                        const twimg = document.querySelector('meta[name="twitter:image"]');
                        if (twimg && twimg.content) return twimg.content;
                        const itemprop = document.querySelector('img[itemprop="image"]');
                        if (itemprop && itemprop.src) return itemprop.src;
                        return null;
                    }''')
                    if og_image:
                        image_url = urllib.parse.urljoin(url, og_image)
                        print(f"[{domain}] Found image via og:image fallback")
                except Exception as e:
                    print(f"[{domain}] OG image fallback error: {e}")
            
            # 3. JavaScript price extraction fallback (for SPA sites)
            if not price:
                try:
                    js_price = await page.evaluate('''() => {
                        // Helper: parse price string preserving decimals, then round
                        function parsePrice(val) {
                            const s = String(val).trim();
                            // If value looks like a float (e.g. "3392.00"), parse as float
                            const f = parseFloat(s.replace(/[^0-9.]/g, '').replace(/\.(?=.*\.)/g, ''));
                            return isNaN(f) ? null : Math.round(f);
                        }

                        // Method 1: Schema.org meta tag
                        const meta = document.querySelector('meta[itemprop="price"]');
                        if (meta && meta.content) { const p = parsePrice(meta.content); if (p) return p; }

                        // Method 2: JSON-LD structured data
                        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                        for (const s of scripts) {
                            try {
                                const data = JSON.parse(s.textContent);
                                const items = Array.isArray(data) ? data : [data];
                                for (const item of items) {
                                    const offer = item.offers || (item['@type'] === 'Offer' ? item : null);
                                    const offerList = Array.isArray(offer) ? offer : (offer ? [offer] : []);
                                    for (const o of offerList) {
                                        const p = parsePrice(o.price || o.lowPrice);
                                        if (p && p > 100) return p;
                                    }
                                    const p = parsePrice(item.price);
                                    if (p && p > 100) return p;
                                }
                            } catch(e) {}
                        }

                        // Method 3: itemprop="price" on any element
                        const priceEl = document.querySelector('[itemprop="price"]');
                        if (priceEl) {
                            const p = parsePrice(priceEl.content || priceEl.textContent);
                            if (p) return p;
                        }
                        
                        return null;
                    }''')
                    if js_price and js_price > 100:
                        if _validate_price(js_price, domain):
                            price = js_price
                            print(f"[{domain}] Found price via JS evaluation: {price}")
                        else:
                            print(f"[{domain}] JS price {js_price} rejected by validation")
                except Exception as e:
                    print(f"[{domain}] JS price extraction error: {e}")

            # 4. OCR Fallback — ONLY if all other methods failed
            if not price:
                reader = get_ocr_reader()
                if reader:
                    print(f"[{domain}] Trying OCR fallback...")
                    screenshot_bytes = await page.screenshot(full_page=False)
                    nparr = np.frombuffer(screenshot_bytes, np.uint8)
                    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    results = reader.readtext(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
                    prices = [int(re.search(r'(\d{3,})', res[1].replace(" ","")).group(1))
                              for res in results if re.search(r'(\d{3,})', res[1].replace(" ",""))]
                    valid = [p for p in prices if _validate_price(p, domain)]
                    if valid:
                        price = min(valid)
                        print(f"[{domain}] OCR price: {price}")

            if not price:
                print(f"[{domain}] Failed to find price on {url}")
                
            return {"price": price, "image_url": image_url}
            
        except Exception as e:
            print(f"Error scraping {url}: {e}")
            return {"price": None, "image_url": None}
        finally:
            await browser.close()

async def scrape_for_product(product_id: int):
    """Business logic: Update prices and images for our product and its competitors"""
    print(f"Scraping visuals for product ID: {product_id}")
    
    # Get our product details
    our_prod = supabase.table("our_product").select("*").eq("id", product_id).single().execute().data
    if not our_prod: return False

    # 1. Sync OUR product price and image if URL exists
    if our_prod.get('url'):
        print(f"Syncing our own product details: {our_prod['url']}")
        our_details = await scrape_product_details(our_prod['url'])
        
        update_data = {}
        if our_details['price']:
            update_data["current_price"] = our_details['price']
            print(f"Updated OUR price: {our_details['price']}")
            # Record our price history
            try:
                supabase.table("our_price_history").insert({
                    "product_id": product_id,
                    "price": our_details['price'],
                    "created_at": datetime.now(MSK).isoformat()
                }).execute()
            except Exception as hist_err:
                print(f"[OurPriceHistory] Insert error: {hist_err}")
        
        if our_details['image_url']:
            update_data["image_url"] = our_details['image_url']
            print(f"Updated OUR image: {our_details['image_url']}")
            
        if update_data:
            supabase.table("our_product").update(update_data).eq("id", product_id).execute()
            # Refresh local object for comparison
            our_prod.update(update_data)

    # 2. Sync Competitors — in parallel
    resp = supabase.table("competitor_product").select("*").eq("our_product_id", product_id).execute()
    if resp.data:
        await asyncio.gather(*[_scrape_mapping_safe(cm, our_prod) for cm in resp.data])

    return True

async def scrape_specific_mapping(mapping_id: int):
    """Business logic: Update a SINGLE competitor mapping and trigger alerts"""
    try:
        # 1. Fetch mapping with our_product price for alerting
        mapping = supabase.table("competitor_product").select("*, our_product(*)").eq("id", mapping_id).single().execute().data
        if not mapping:
            print(f"Mapping {mapping_id} not found")
            return False

        details = await scrape_product_details(mapping['url'])
        if details['price']:
            # 2. Update image if needed
            if details['image_url']:
                supabase.table("competitor_product").update({"image_url": details['image_url']}).eq("id", mapping_id).execute()
            
            # 3. Create price record & Update last_price
            supabase.table("price_record").insert({
                "competitor_product_id": mapping_id,
                "price": details['price']
            }).execute()

            old_last_price = float(mapping.get('last_price')) if mapping.get('last_price') else None

            supabase.table("competitor_product").update({
                "last_price": details['price'],
                "last_scrape": datetime.now(MSK).isoformat()
            }).eq("id", mapping_id).execute()

            # 4. Alert on significant price changes
            our_price = float(mapping['our_product']['current_price']) if mapping['our_product'].get('current_price') else 0
            if our_price > details['price']:
                notifier.send_price_alert(
                    mapping['our_product']['name'],
                    our_price,
                    details['price'],
                    mapping['url']
                )
            # 4b. Alert on competitor price INCREASE (>5% rise = margin opportunity)
            if old_last_price and details['price'] > old_last_price:
                increase_pct = (details['price'] - old_last_price) / old_last_price * 100
                if increase_pct >= 5:
                    notifier.send_price_increase_alert(
                        mapping['our_product']['name'],
                        old_last_price,
                        details['price'],
                        mapping['url']
                    )
        return True
    except Exception as e:
        print(f"Error scraping mapping {mapping_id}: {e}")
        return False

async def scrape_our_product_price(product_id: int):
    """Scrapes our OWN product price from our website (alleyadoma.ru)"""
    try:
        # 1. Fetch our product details
        product = supabase.table("our_product").select("*").eq("id", product_id).single().execute().data
        if not product or not product.get('url'):
            print(f"[Our Product] No URL for product ID {product_id}")
            return False

        print(f"[Our Product] Scraping our price: {product['url']}")
        details = await scrape_product_details(product['url'])
        
        if details['price']:
            update_data = {"current_price": details['price']}
            # 2. Always update image if scraper found one
            if details['image_url']:
                update_data["image_url"] = details['image_url']
            
            supabase.table("our_product").update(update_data).eq("id", product_id).execute()
            # Record our price history
            try:
                supabase.table("our_price_history").insert({
                    "product_id": product_id,
                    "price": details['price'],
                    "created_at": datetime.now(MSK).isoformat()
                }).execute()
            except Exception as hist_err:
                print(f"[OurPriceHistory] Insert error: {hist_err}")
            print(f"[Our Product] Successfully updated price to {details['price']} for '{product['name']}'")
            return True
        else:
            print(f"[Our Product] Failed to extract price for '{product['name']}'")
            return False
    except Exception as e:
        print(f"[Our Product] Error scraping product {product_id}: {e}")
        return False

# Limit concurrent browser instances to avoid overload / rate limiting
_SCRAPE_SEMAPHORE = asyncio.Semaphore(2)

async def _scrape_mapping_safe(cm: dict, our_prod: dict):
    """Scrape a single competitor mapping with semaphore guard."""
    async with _SCRAPE_SEMAPHORE:
        details = await scrape_product_details(cm['url'])

    if details['image_url']:
        supabase.table("competitor_product").update({"image_url": details['image_url']}).eq("id", cm['id']).execute()
        # Also fill our product image if it's missing
        if not our_prod.get('image_url'):
            supabase.table("our_product").update({"image_url": details['image_url']}).eq("id", our_prod['id']).execute()
            our_prod["image_url"] = details['image_url']

    if details['price']:
        supabase.table("price_record").insert({
            "competitor_product_id": cm['id'],
            "price": details['price'],
            "created_at": datetime.now(MSK).isoformat()
        }).execute()

        old_last_price = float(cm['last_price']) if cm.get('last_price') else None

        supabase.table("competitor_product").update({
            "last_price": details['price'],
            "last_scrape": datetime.now(MSK).isoformat()
        }).eq("id", cm['id']).execute()

        if our_prod.get('current_price') and details['price'] < float(our_prod['current_price']):
            notifier.send_price_alert(our_prod['name'], our_prod['current_price'], details['price'], cm['url'])

        # Alert on competitor price INCREASE (>5% rise = margin opportunity)
        if old_last_price and details['price'] > old_last_price:
            increase_pct = (details['price'] - old_last_price) / old_last_price * 100
            if increase_pct >= 5:
                notifier.send_price_increase_alert(our_prod['name'], old_last_price, details['price'], cm['url'])


async def monitor_all():
    resp = supabase.table("our_product").select("id").execute()
    # Scrape all products in parallel (semaphore limits concurrency)
    await asyncio.gather(*[scrape_for_product(p['id']) for p in resp.data])

if __name__ == "__main__":
    asyncio.run(monitor_all())
