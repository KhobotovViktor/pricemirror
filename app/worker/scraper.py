import asyncio
import sys

# Critical fix for Windows: ProactorEventLoop is required for playwright subprocesses
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
import re
import os
import urllib.parse
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
from datetime import datetime
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
    "shatura.com": {
        "price": ["div.price", ".product-price", ".current-price"],
        "image": ["div.product-full-photo img", ".product-image img", ".main-image img"]
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

async def scrape_product_details(url: str):
    """Scrapes both price and image URL from a product page"""
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
            
            domain = urllib.parse.urlparse(url).netloc.replace("www.", "")
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
            if response and response.status in (403, 404, 429, 500, 502, 503):
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

            # Check for bot protection
            page_text = await page.evaluate("() => document.body.innerText")
            if "403 Error" in page_text or ("Доступ к сайту" in page_text and "запрещен" in page_text):
                print(f"[{domain}] Bot protection detected, aborting.")
                return {'price': None, 'image_url': None}
            
            print(f"[{domain}] Checking selectors...")
            
            # 1. Price Extraction
            for s in selectors["price"]:
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
                            price = int(clean_text)
                            print(f"[{domain}] Found price via selector '{s}': {price}")
                            break
                except Exception as e:
                    print(f"[{domain}] Selector '{s}' failed: {e}")
                    continue
                
            # 2. Image Extraction
            for s in selectors["image"]:
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
                        price = js_price
                        print(f"[{domain}] Found price via JS evaluation: {price}")
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
                    valid = [p for p in prices if p > 500]
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

            supabase.table("competitor_product").update({
                "last_price": details['price'],
                "last_scrape": datetime.utcnow().isoformat()
            }).eq("id", mapping_id).execute()

            # 4. Alert if price changed significantly
            our_price = float(mapping['our_product']['current_price']) if mapping['our_product'].get('current_price') else 0
            if our_price > details['price']:
                notifier.send_price_alert(
                    mapping['our_product']['name'],
                    our_price,
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
            "created_at": datetime.utcnow().isoformat()
        }).execute()
        supabase.table("competitor_product").update({
            "last_price": details['price'],
            "last_scrape": datetime.utcnow().isoformat()
        }).eq("id", cm['id']).execute()

        if our_prod.get('current_price') and details['price'] < float(our_prod['current_price']):
            notifier.send_price_alert(our_prod['name'], our_prod['current_price'], details['price'], cm['url'])


async def monitor_all():
    resp = supabase.table("our_product").select("id").execute()
    # Scrape all products in parallel (semaphore limits concurrency)
    await asyncio.gather(*[scrape_for_product(p['id']) for p in resp.data])

if __name__ == "__main__":
    asyncio.run(monitor_all())
