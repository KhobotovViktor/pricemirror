"""
Cloud Scraper — serverless replacement for Playwright-based scraper.py.
Calls Supabase Edge Function 'scrape-price' to extract prices from product pages.
Works on Vercel and any environment without Playwright/Chromium.
"""
import asyncio
import os
import httpx
from datetime import datetime
from dotenv import load_dotenv
from pathlib import Path

# Standard path resolution
env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

from ..core.database import supabase
from ..core.notifier import notifier

# Edge Function configuration
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://bxicqqetduknofkqpfli.supabase.co")

# Edge Functions need the JWT format anon key, not the sb_publishable key
SUPABASE_JWT_KEY = os.getenv("SUPABASE_JWT_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4aWNxcWV0ZHVrbm9ma3FwZmxpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMDAxNTUsImV4cCI6MjA4ODg3NjE1NX0.lw7kIruS2YyA4cJsRgfDpNl4Bw6paK0Bmj6JxHPUK7A")
EDGE_FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/scrape-price"


async def scrape_product_details(url: str) -> dict:
    """
    Calls the Supabase Edge Function to scrape price and image from a URL.
    Drop-in replacement for the Playwright-based version.
    """
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            print(f"[Cloud Scraper] Requesting price for: {url}")
            response = await client.post(
                EDGE_FUNCTION_URL,
                json={"url": url},
                headers={
                    "Authorization": f"Bearer {SUPABASE_JWT_KEY}",
                    "Content-Type": "application/json",
                    "apikey": SUPABASE_JWT_KEY,
                }
            )
            
            if response.status_code != 200:
                print(f"[Cloud Scraper] Edge Function error: HTTP {response.status_code} — {response.text[:200]}")
                return {"price": None, "image_url": None}
            
            data = response.json()
            price = data.get("price")
            image_url = data.get("image_url")
            error = data.get("error")
            
            if error:
                print(f"[Cloud Scraper] Edge Function returned error: {error}")
            
            if price:
                print(f"[Cloud Scraper] [SUCCESS] Price found: {price}")
            else:
                print(f"[Cloud Scraper] [FAIL] No price extracted for {url}")
                
            return {"price": price, "image_url": image_url}
            
    except httpx.TimeoutException:
        print(f"[Cloud Scraper] Timeout scraping {url}")
        return {"price": None, "image_url": None}
    except Exception as e:
        print(f"[Cloud Scraper] Error: {e}")
        return {"price": None, "image_url": None}


async def scrape_for_product(product_id: int):
    """Business logic: Update prices and images for our product and its competitors"""
    print(f"[Cloud Scraper] Scraping for product ID: {product_id}")
    
    # Get our product details
    our_prod = supabase.table("our_product").select("*").eq("id", product_id).single().execute().data
    if not our_prod:
        return False

    # 1. Sync OUR product price and image if URL exists
    if our_prod.get('url'):
        print(f"[Cloud Scraper] Syncing our own product: {our_prod['url']}")
        our_details = await scrape_product_details(our_prod['url'])
        
        update_data = {}
        if our_details['price']:
            update_data["current_price"] = our_details['price']
            print(f"[Cloud Scraper] Updated OUR price: {our_details['price']}")
        
        if our_details['image_url'] and not our_prod.get('image_url'):
            update_data["image_url"] = our_details['image_url']
            print(f"[Cloud Scraper] Updated OUR image: {our_details['image_url']}")
            
        if update_data:
            supabase.table("our_product").update(update_data).eq("id", product_id).execute()
            our_prod.update(update_data)

    # 2. Sync Competitors
    resp = supabase.table("competitor_product").select("*").eq("our_product_id", product_id).execute()
    
    for cm in resp.data:
        details = await scrape_product_details(cm['url'])
        
        # Update competitor image if found
        if details['image_url']:
            supabase.table("competitor_product").update({"image_url": details['image_url']}).eq("id", cm['id']).execute()
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
            
            supabase.table("competitor_product").update({
                "last_price": details['price'],
                "last_scrape": datetime.utcnow().isoformat()
            }).eq("id", cm['id']).execute()
            
            if our_prod.get('current_price') and details['price'] < float(our_prod['current_price']):
                notifier.send_price_alert(our_prod['name'], our_prod['current_price'], details['price'], cm['url'])
                
    return True


async def scrape_specific_mapping(mapping_id: int):
    """Business logic: Update a SINGLE competitor mapping and trigger alerts"""
    try:
        mapping = supabase.table("competitor_product").select("*, our_product(*)").eq("id", mapping_id).single().execute().data
        if not mapping:
            print(f"[Cloud Scraper] Mapping {mapping_id} not found")
            return False

        details = await scrape_product_details(mapping['url'])
        if details['price']:
            if details['image_url']:
                supabase.table("competitor_product").update({"image_url": details['image_url']}).eq("id", mapping_id).execute()
            
            supabase.table("price_record").insert({
                "competitor_product_id": mapping_id,
                "price": details['price']
            }).execute()

            supabase.table("competitor_product").update({
                "last_price": details['price'],
                "last_scrape": datetime.utcnow().isoformat()
            }).eq("id", mapping_id).execute()

            our_price = float(mapping['our_product']['current_price']) if mapping['our_product'].get('current_price') else 0
            if our_price > details['price']:
                notifier.send_price_alert(
                    product_name=mapping['our_product']['name'],
                    our_price=our_price,
                    comp_price=details['price'],
                    store_name="Конкурент",
                    url=mapping['url']
                )
        return True
    except Exception as e:
        print(f"[Cloud Scraper] Error scraping mapping {mapping_id}: {e}")
        return False


async def scrape_our_product_price(product_id: int):
    """Scrapes our OWN product price from our website (alleyadoma.ru)"""
    try:
        product = supabase.table("our_product").select("*").eq("id", product_id).single().execute().data
        if not product or not product.get('url'):
            print(f"[Cloud Scraper] No URL for product ID {product_id}")
            return False

        print(f"[Cloud Scraper] Scraping our price: {product['url']}")
        details = await scrape_product_details(product['url'])
        
        if details['price']:
            update_data = {"current_price": details['price']}
            if details['image_url'] and not product.get('image_url'):
                update_data["image_url"] = details['image_url']
            
            supabase.table("our_product").update(update_data).eq("id", product_id).execute()
            print(f"[Cloud Scraper] [SUCCESS] Updated price to {details['price']} for '{product['name']}'")
            return True
        else:
            print(f"[Cloud Scraper] [FAIL] Failed to extract price for '{product['name']}'")
            return False
    except Exception as e:
        print(f"[Cloud Scraper] Error scraping product {product_id}: {e}")
        return False


async def monitor_all():
    """Scrape all products — cloud version"""
    print("[Cloud Scraper] Running monitor_all...")
    resp = supabase.table("our_product").select("id").execute()
    for p in resp.data:
        await scrape_for_product(p['id'])
        await asyncio.sleep(1)  # Throttle to avoid rate limits
    print("[Cloud Scraper] monitor_all complete.")
