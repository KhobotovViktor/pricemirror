import asyncio
import re
import urllib.parse
import numpy as np
import cv2
import easyocr
from playwright.async_api import async_playwright
from datetime import datetime
from dotenv import load_dotenv
from pathlib import Path
import os

# Standard path resolution for Phase 9 scraper environment
env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

from ..core.database import supabase
from ..core.notifier import notifier

# Initialize OCR reader globally to avoid slow re-initialization on every request
try:
    ocr_reader = easyocr.Reader(['ru', 'en'], gpu=False)
except Exception as e:
    print(f"OCR init error: {e}")
    ocr_reader = None

# Selectors for known stores (extended for robustness)
STORE_SELECTORS = {
    "hoff.ru": {
        "price": [".price-current", "div.product-buy__price-new", "span.price", ".product-price", "ins.price-new"],
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
        "image": [".unit-slider-top-inside-tovar.slick-current", "a.unit-slider-top-inside-tovar", ".main-image"]
    }
}

async def scrape_product_details(url: str):
    """Scrapes both price and image URL from a product page"""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, channel="chrome")
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={'width': 1920, 'height': 1080}
        )
        page = await context.new_page()
        
        try:
            await page.set_extra_http_headers({
                "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
            })
            print(f"Scraping: {url}")
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
            await asyncio.sleep(2)
            
            domain = urllib.parse.urlparse(url).netloc.replace("www.", "")
            selectors = STORE_SELECTORS.get(domain, {"price": [], "image": []})
            
            price = None
            image_url = None
            
            print(f"[{domain}] Checking selectors...")
            
            # 1. Price Extraction
            for s in selectors["price"]:
                try:
                    el = await page.wait_for_selector(s, timeout=3000)
                    if el:
                        text = await el.inner_text()
                        # Extract only digits, ignoring any whitespace/symbols/currency
                        clean_text = re.sub(r'[^\d]', '', text)
                        if clean_text:
                            price = int(clean_text)
                            print(f"[{domain}] Found price via selector '{s}': {price}")
                            break
                except Exception: continue
                
            # 2. Image Extraction
            for s in selectors["image"]:
                try:
                    el = await page.wait_for_selector(s, timeout=3000)
                    if el:
                        src = await el.get_attribute("src")
                        if src:
                            image_url = urllib.parse.urljoin(url, src)
                            break
                except Exception: continue
            
                if ocr_reader:
                    screenshot_bytes = await page.screenshot(full_page=False)
                    nparr = np.frombuffer(screenshot_bytes, np.uint8)
                    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    results = ocr_reader.readtext(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
                    prices = [int(re.search(r'(\d{3,})', res[1].replace(" ","")).group(1)) 
                              for res in results if re.search(r'(\d{3,})', res[1].replace(" ",""))]
                    if prices: 
                        price = min([p for p in prices if p > 500])
                        print(f"[{domain}] Found price via OCR: {price}")

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
        
        if our_details['image_url'] and not our_prod.get('image_url'):
            update_data["image_url"] = our_details['image_url']
            print(f"Updated OUR image: {our_details['image_url']}")
            
        if update_data:
            supabase.table("our_product").update(update_data).eq("id", product_id).execute()
            # Refresh local object for comparison
            our_prod.update(update_data)

    # 2. Sync Competitors
    resp = supabase.table("competitor_product").select("*").eq("our_product_id", product_id).execute()
    
    for cm in resp.data:
        details = await scrape_product_details(cm['url'])
        
        # Update competitor image if found
        if details['image_url']:
            supabase.table("competitor_product").update({"image_url": details['image_url']}).eq("id", cm['id']).execute()
            # If our product STILL has no image, use the first competitor image found as placeholder
            if not our_prod.get('image_url'):
                supabase.table("our_product").update({"image_url": details['image_url']}).eq("id", product_id).execute()
                our_prod["image_url"] = details['image_url']

        # Handle price
        if details['price']:
            supabase.table("price_record").insert({
                "competitor_product_id": cm['id'],
                "price": details['price'],
                "created_at": datetime.utcnow().isoformat()
            }).execute()
            
            if our_prod.get('current_price') and details['price'] < float(our_prod['current_price']):
                notifier.send_price_alert(our_prod['name'], our_prod['current_price'], details['price'], cm['url'])
                
    return True

async def scrape_specific_mapping(mapping_id: int):
    """Business logic: Update a SINGLE competitor mapping and trigger alerts"""
    print(f"Scraping SPECIFIC mapping ID: {mapping_id}")
    
    # 1. Fetch mapping
    mapping = supabase.table("competitor_product").select("*, our_product(*)").eq("id", mapping_id).single().execute().data
    if not mapping:
        print(f"Mapping {mapping_id} not found")
        return False
        
    our_prod = mapping.get('our_product')
    
    # 2. Scrape details
    details = await scrape_product_details(mapping['url'])
    
    # 3. Update competitor image if found
    if details['image_url']:
        supabase.table("competitor_product").update({"image_url": details['image_url']}).eq("id", mapping['id']).execute()
        # If our product still has no image, use this as a placeholder
        if our_prod and not our_prod.get('image_url'):
            supabase.table("our_product").update({"image_url": details['image_url']}).eq("id", our_prod['id']).execute()

    # 4. Handle price
    if details['price']:
        supabase.table("price_record").insert({
            "competitor_product_id": mapping['id'],
            "price": details['price'],
            "created_at": datetime.utcnow().isoformat()
        }).execute()
        
        # 5. Alerting logic
        if our_prod and our_prod.get('current_price'):
            if details['price'] < float(our_prod['current_price']):
                notifier.send_price_alert(our_prod['name'], our_prod['current_price'], details['price'], mapping['url'])
                
    return True

async def monitor_all():
    resp = supabase.table("our_product").select("id").execute()
    for p in resp.data: await scrape_for_product(p['id'])

if __name__ == "__main__":
    asyncio.run(monitor_all())
