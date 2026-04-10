import sys
import asyncio

# Critical fix for Windows: Use ProactorEventLoop to support subprocesses (like Playwright)
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI, Depends, HTTPException, Request, Form, BackgroundTasks
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from contextlib import asynccontextmanager
import os
import io
import csv
import urllib.parse
import jwt
import time
from datetime import datetime
from starlette.responses import RedirectResponse
from fastapi.security import APIKeyCookie
import traceback
from dotenv import load_dotenv
from pathlib import Path
from .core.database import supabase

# Optional imports for Vercel 'Slim' compatibility
try:
    from xhtml2pdf import pisa
    PISA_AVAILABLE = True
except ImportError:
    PISA_AVAILABLE = False

try:
    from .worker.scraper import scrape_for_product, monitor_all
    SCRAPER_AVAILABLE = True
    SCRAPER_MODE = "playwright"
except ImportError:
    try:
        from .worker.cloud_scraper import scrape_for_product, monitor_all
        SCRAPER_AVAILABLE = True
        SCRAPER_MODE = "cloud"
    except ImportError:
        SCRAPER_AVAILABLE = False
        SCRAPER_MODE = "none"

# Standard path resolution for Phase 9 environment variables
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initializes background tasks and handles startup/shutdown securely"""
    print("DEBUG: [Lifespan] Starting initialization...", flush=True)
    # 1. Verify Event Loop Policy on Windows
    if sys.platform == 'win32':
        loop = asyncio.get_event_loop()
        print(f"DEBUG: [Lifespan] Current Event Loop: {type(loop).__name__}", flush=True)
        if not isinstance(loop, asyncio.WindowsProactorEventLoopPolicy._loop_factory): # type: ignore
             print("WARNING: [Lifespan] Loop is not Proactor! Playwright might fail.", flush=True)

    # 2. Start Scheduler
    if SCRAPER_AVAILABLE:
        try:
            print(f"DEBUG: [Lifespan] Adding scheduler job (monitor_all)...", flush=True)
            scheduler.add_job(monitor_all, 'interval', hours=12)
            print("DEBUG: [Lifespan] Starting APScheduler...", flush=True)
            scheduler.start()
            print("DEBUG: [Lifespan] APScheduler started successfully.", flush=True)
        except Exception as e:
            print(f"CRITICAL LIFESPAN STARTUP ERROR: {e}", flush=True)
    else:
        print("DEBUG: [Lifespan] Scraper not found, skipping scheduler.", flush=True)
    
    yield
    
    # 3. Shutdown
    print("DEBUG: [Lifespan] Shutting down...")
    if scheduler.running:
        scheduler.shutdown()

app = FastAPI(title="Furniture Competitor Monitor", lifespan=lifespan)
SECRET_KEY = os.getenv("SECRET_KEY", "FURNITURE_MONITOR_SECRET_PROD") 
ALGORITHM = "HS256"
COOKIE_NAME = "auth_token"
auth_cookie = APIKeyCookie(name=COOKIE_NAME, auto_error=False)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global debugger for Vercel 500 errors"""
    return JSONResponse(
        status_code=500,
        content={
            "status": "error",
            "message": str(exc),
            "traceback": traceback.format_exc()
        }
    )

def create_access_token(data: dict):
    to_encode = data.copy()
    expires = time.time() + 3600 * 24 # 24 hours
    to_encode.update({"exp": expires})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: str = Depends(auth_cookie)):
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except Exception:
        return None

# Get absolute path to this file's directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "..", "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "..", "templates"))
scheduler = AsyncIOScheduler()

@app.get("/api/report/pdf")
async def get_pdf_report(user_id: str = Depends(get_current_user)):
    """Generates a professional PDF report for stakeholders"""
    if not user_id:
        return RedirectResponse(url="/login")
        
    if not PISA_AVAILABLE:
        raise HTTPException(status_code=501, detail="PDF generation is not available in this environment.")
        
    try:
        # Fetch current state
        products_raw = supabase.table("our_product").select("*, category:product_category(name)").order("name").execute().data
        all_mappings = supabase.table("competitor_product").select("*, price_record(*)").execute().data
        
        products = []
        for p in products_raw:
            our_price = float(p['current_price']) if p.get('current_price') else 0
            p_mappings = [m for m in all_mappings if m['our_product_id'] == p['id']]
            
            latest_prices = []
            for m in p_mappings:
                records = m.get('price_record', [])
                if records:
                    latest = sorted(records, key=lambda x: x['created_at'])[-1]
                    latest_prices.append(float(latest['price']))
            
            min_comp = min(latest_prices) if latest_prices else 0
            diff = our_price - min_comp if min_comp > 0 else 0
            
            # Identify Price Status
            status = "NEUTRAL"
            if min_comp:
                if our_price < min_comp: status = "success"
                elif abs(our_price - min_comp) < 2: status = "warning"
                else: status = "danger"

            p['min_comp'] = min_comp
            p['diff'] = diff
            p['price_status'] = status
            products.append(p)

        return templates.TemplateResponse(
            request,
            "report_pdf.html", 
            {
                "request": request,
                "now": datetime.now().strftime("%d.%m.%Y %H:%M"),
                "products": products
            }
        )

        pdf_output = io.BytesIO()
        pisa_status = pisa.CreatePDF(io.StringIO(html_content), dest=pdf_output)
        
        if pisa_status.err:
            raise HTTPException(status_code=500, detail="Error generating PDF")
            
        pdf_output.seek(0)
        return StreamingResponse(
            iter([pdf_output.getvalue()]), 
            media_type="application/pdf",
            headers={"Content-Disposition": "inline; filename=report.pdf"}
        )
    except Exception as e:
        print(f"PDF ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/login", response_class=HTMLResponse)
async def get_login_page(request: Request):
    """Simple login view"""
    return templates.TemplateResponse(request, "login.html", {"request": request})

@app.post("/api/login")
async def post_login(username: str = Form(...), password: str = Form(...)):
    """Validates username + password and sets JWT cookie"""
    try:
        # Check Username
        if username != "Хоботов Виктор":
            return JSONResponse(status_code=401, content={"status": "error", "message": "Неверный логин или пароль"})

        # Check Password from DB
        resp = supabase.table("system_settings").select("*").eq("key", "admin_password").execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Пароль не настроен в БД")
        
        correct_password = resp.data[0]['value']
        if password != correct_password:
            return JSONResponse(status_code=401, content={"status": "error", "message": "Неверный логин или пароль"})
        
        token = create_access_token({"sub": "admin", "username": username})
        response = JSONResponse(content={"status": "success", "message": f"Добро пожаловать, {username}!"})
        response.set_cookie(key=COOKIE_NAME, value=token, httponly=True, max_age=3600*24)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/logout")
async def logout():
    """Clears the auth cookie"""
    response = RedirectResponse(url="/login")
    response.delete_cookie(COOKIE_NAME)
    return response


# Resolving paths relative to the project root
ROOT_DIR = Path(__file__).parent.parent.resolve()
STATIC_DIR = ROOT_DIR / "static"
TEMPLATES_DIR = ROOT_DIR / "templates"

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

# Utility to detect store from URL
def detect_store(url: str):
    try:
        domain = urllib.parse.urlparse(url).netloc
        if not domain:
            return None
        domain = domain.replace("www.", "")
        
        # Search for domain match in competitor_store via HTTP
        response = supabase.table("competitor_store").select("*").execute()
        for store in response.data:
            if store['domain'] in domain:
                return store
        return None
    except Exception:
        return None

@app.get("/", response_class=HTMLResponse)
async def get_admin_panel(request: Request, user_id: str = Depends(get_current_user)):
    """Main admin dashboard view with login check"""
    if not user_id:
        return RedirectResponse(url="/login")
    
    try:
        categories = supabase.table("product_category").select("*").order("name").execute().data
        products_raw = supabase.table("our_product").select("*, category:product_category(name)").order("name").execute().data
        
        # OPTIMIZED: Fetch only the necessary mapping fields with precomputed last_price
        all_mappings = supabase.table("competitor_product").select("id, our_product_id, last_price").execute().data
        
        products = []
        for p in products_raw:
            p_mappings = [m for m in all_mappings if m['our_product_id'] == p['id']]
            
            # Simple list extraction from precomputed values (no history join!)
            latest_prices = [float(m['last_price']) for m in p_mappings if m.get('last_price')]
            
            min_comp = min(latest_prices) if latest_prices else None
            our_price = float(p['current_price']) if p.get('current_price') else 0
            
            # Identify Price Status
            status = "neutral"
            if min_comp:
                if our_price < min_comp: status = "success"
                elif abs(our_price - min_comp) < 2: status = "warning" # approx equal
                else: status = "danger"
                
            p['price_status'] = status
            products.append(p)

        return templates.TemplateResponse(
            request,
            "admin.html", 
            {
                "request": request, 
                "categories": categories,
                "products": products
            }
        )
    except Exception as e:
        print(f"Error loading admin panel: {e}")
        return HTMLResponse(content=f"Error connecting to database: {e}", status_code=500)

@app.post("/api/products")
async def add_product(
    background_tasks: BackgroundTasks,
    name: str = Form(...), 
    category_id: int = Form(...), 
    url: str = Form(None), 
    price: float = Form(None),
    article_1c: str = Form(None),
    user_id: str = Depends(get_current_user)
):
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

    data = {
        "name": name,
        "category_id": category_id,
        "url": url,
        "current_price": price,
        "article_1c": article_1c
    }
    try:
        result = supabase.table("our_product").insert(data).execute()
        if result.data and url and "alleyadoma.ru" in url and SCRAPER_AVAILABLE:
            # Trigger immediate scrape for our own product if URL is provided
            product_id = result.data[0]['id']
            from .worker.scraper import scrape_our_product_price
            background_tasks.add_task(scrape_our_product_price, product_id)
            
        return result.data[0] if result.data else {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/scrape/preview")
async def preview_price(url: str, user_id: str = Depends(get_current_user)):
    """Live preview of price before adding product"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        from .worker.scraper import scrape_product_details
        details = await scrape_product_details(url)
        return details
    except Exception as e:
        print(f"PREVIEW ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/1c/prices")
async def get_prices_for_1c(user_id: str = Depends(get_current_user)):
    """Special endpoint for 1C:Enterprise synchronization"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
        
    try:
        products = supabase.table("our_product").select("article_1c, current_price, name").execute().data
        # Return object keyed by Article for easy 1C mapping
        return {p['article_1c']: {"price": p['current_price'], "name": p['name']} for p in products if p['article_1c']}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/analytics/{product_id}")
async def get_product_analytics(product_id: int):
    try:
        # 1. Fetch our product
        prod_resp = supabase.table("our_product").select("*").eq("id", product_id).execute()
        if not prod_resp.data:
            raise HTTPException(status_code=404, detail="Product not found")
        product = prod_resp.data[0]
        
        # 2. Fetch competitor mappings with store names and their price records
        mappings_resp = supabase.table("competitor_product").select("*, competitor_store(name), price_record(*)").eq("our_product_id", product_id).execute()
        
        history = []
        latest_prices = []
        
        for mapping in mappings_resp.data:
            store_data = mapping.get('competitor_store') or {}
            store_name = store_data.get('name', 'Конкурент')
            records = mapping.get('price_record', [])
            
            for r in records:
                history.append({
                    "date": r['created_at'],
                    "price": float(r['price']),
                    "store": store_name
                })
            
            if records:
                latest_r = sorted(records, key=lambda x: x['created_at'])[-1]
                latest_prices.append(float(latest_r['price']))
        
        our_price = float(product['current_price']) if product.get('current_price') else 0
        avg_price = sum(latest_prices) / len(latest_prices) if latest_prices else 0
        min_price = min(latest_prices) if latest_prices else 0
        
        # Recommendation
        recommendation = None
        if latest_prices:
            diff = our_price - min_price
            if diff > 0:
                recommendation = {
                    "type": "decrease",
                    "text": "Рекомендуется снизить цену",
                    "details": f"Ваша цена выше конкурента на {diff} ₽. Оптимально: {min_price - 100} ₽"
                }
            else:
                recommendation = {
                    "type": "increase",
                    "text": "Цена конкурентоспособна",
                    "details": f"Ваша цена ниже или в рынке."
                }
        
        return {
            "our_product": product,
            "avg_price": round(avg_price, 2),
            "min_competitor": round(min_price, 2),
            "history": sorted(history, key=lambda x: x['date'], reverse=True),
            "recommendation": recommendation
        }
    except Exception as e:
        print(f"ANALYTICS ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/settings")
async def get_settings():
    """Fetches all system configuration"""
    try:
        resp = supabase.table("system_settings").select("*").execute()
        return {s['key']: s['value'] for s in resp.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/settings")
async def save_settings(request: Request):
    """Saves updated system configuration"""
    try:
        data = await request.json()
        for key, value in data.items():
            supabase.table("system_settings").update({"value": str(value)}).eq("key", key).execute()
        return {"status": "success", "message": "Настройки сохранены"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/mappings")
async def add_mapping(background_tasks: BackgroundTasks, product_id: int = Form(...), competitor_url: str = Form(...)):
    store = detect_store(competitor_url)
    if not store:
        raise HTTPException(status_code=400, detail="Магазин не распознан")
    
    data = {
        "our_product_id": product_id,
        "store_id": store['id'],
        "url": competitor_url
    }
    try:
        supabase.table("competitor_product").insert(data).execute()
        # Trigger immediate scrape for this product
        background_tasks.add_task(scrape_for_product, product_id)
        return {"status": "success", "store_name": store['name']}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/scrape/{product_id}")
async def trigger_scrape(product_id: int, background_tasks: BackgroundTasks):
    """Manual trigger for scraping ALL mappings of a product"""
    if not SCRAPER_AVAILABLE:
        return JSONResponse(status_code=501, content={"status": "error", "message": "Скрапинг недоступен в облачной среде."})
    
    background_tasks.add_task(scrape_for_product, product_id)
    return {"status": "accepted", "message": "Сбор цен по товару запущен"}

@app.post("/api/scrape/mapping/{mapping_id}")
async def trigger_mapping_scrape(mapping_id: int, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    """Manual trigger for a SINGLE competitor mapping"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    if not SCRAPER_AVAILABLE:
        return JSONResponse(status_code=501, content={"status": "error", "message": "⚠️ Скрапинг недоступен на Vercel. Пожалуйста, запустите воркер в локальной среде."})

    from .worker.scraper import scrape_specific_mapping
    background_tasks.add_task(scrape_specific_mapping, mapping_id)
    return {"status": "accepted", "message": "Обновление цены по ссылке запущено"}

@app.post("/api/scrape/our-product/{product_id}")
async def trigger_our_product_scrape(product_id: int, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    """Manual trigger for OUR OWN product price update"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    if not SCRAPER_AVAILABLE:
        return JSONResponse(status_code=501, content={"status": "error", "message": "⚠️ Обновление цен требует локального скрапера."})

    from .worker.scraper import scrape_our_product_price
    background_tasks.add_task(scrape_our_product_price, product_id)
    return {"status": "accepted", "message": "Обновление вашей цены запущено"}

@app.post("/api/scrape/mappings/batch")
async def trigger_batch_scrape(data: dict, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    """Manual trigger for BATCH competitor mappings update"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    if not SCRAPER_AVAILABLE:
        return JSONResponse(status_code=501, content={"status": "error", "message": "⚠️ Массовое обновление цен требует запуска скрапера в локальной среде."})

    mapping_ids = data.get("ids", [])
    if not mapping_ids:
        return {"status": "error", "message": "Список ID пуст"}

    from .worker.scraper import scrape_specific_mapping
    
    async def process_batch(ids):
        for mid in ids:
            try:
                await scrape_specific_mapping(mid)
                await asyncio.sleep(1) # Small throttle
            except Exception as e:
                print(f"Batch Scrape Error for {mid}: {e}")

    background_tasks.add_task(process_batch, mapping_ids)
    return {"status": "accepted", "message": f"Запущено массовое обновление ({len(mapping_ids)} позиций)"}

@app.get("/api/dashboard/stats")
async def get_dashboard_stats():
    """Aggregates global statistics for the overview panel using optimized denormalized data"""
    try:
        products = supabase.table("our_product").select("*").execute().data
        # Optimized: Fetch only necessary fields from competitor_product
        # We use already existing last_price and last_scrape columns for instant response
        all_mappings = supabase.table("competitor_product").select("our_product_id, last_price, last_scrape").execute().data
        
        at_risk = 0
        total_gap = 0
        latest_global_sync = None
        
        # Pre-group mappings by product_id for O(N) lookup
        from collections import defaultdict
        mappings_by_product = defaultdict(list)
        for m in all_mappings:
            mappings_by_product[m['our_product_id']].append(m)
            
        for p in products:
            our_price = float(p['current_price']) if p.get('current_price') else 0
            p_mappings = mappings_by_product[p['id']]
            
            latest_prices = []
            for m in p_mappings:
                if m.get('last_price'):
                    latest_prices.append(float(m['last_price']))
                    
                # Track global last sync
                if m.get('last_scrape'):
                    try:
                        ts = datetime.fromisoformat(m['last_scrape'].replace('Z', '+00:00'))
                        if not latest_global_sync or ts > latest_global_sync:
                            latest_global_sync = ts
                    except Exception:
                        continue
            
            if latest_prices:
                min_comp = min(latest_prices)
                if our_price > min_comp:
                    at_risk += 1
                    total_gap += (our_price - min_comp)
        
        return {
            "total_products": len(products),
            "at_risk": at_risk,
            "avg_gap": round(total_gap / at_risk, 2) if at_risk > 0 else 0,
            "last_sync": latest_global_sync.strftime("%d.%m %H:%M") if latest_global_sync else "—"
        }
    except Exception as e:
        print(f"STATS ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/dashboard/history")
async def get_global_history(user_id: str = Depends(get_current_user)):
    """Computes daily average prices across ALL products for market trend analysis"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    
    try:
        # Fetch all price records
        records = supabase.table("price_record").select("price, created_at").execute().data
        
        # Group by day and average
        daily_sums = {}
        daily_counts = {}
        for r in records:
            day = r['created_at'][:10] # YYYY-MM-DD
            price = float(r['price'])
            daily_sums[day] = daily_sums.get(day, 0) + price
            daily_counts[day] = daily_counts.get(day, 0) + 1
            
        history = []
        for day in sorted(daily_sums.keys()):
            history.append({
                "date": day,
                "avg_price": round(daily_sums[day] / daily_counts[day], 2)
            })
            
        return history[-30:] # Return last 30 days
        
    except Exception as e:
        print(f"DASHBOARD ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/export")
async def export_data():
    """Generates a CSV report of all products and their market status"""
    try:
        # Re-use the logic from dashboard stats for consistency
        products = supabase.table("our_product").select("*").execute().data
        all_mappings = supabase.table("competitor_product").select("*, price_record(*)").execute().data
        
        output = io.StringIO()
        writer = csv.writer(output)
        # Header row
        writer.writerow(["ID", "Артикул 1C", "Название", "Наша цена (₽)", "Мин. цена конкурентов (₽)", "Разница (₽)", "Дата обновления"])
        
        for p in products:
            our_price = float(p['current_price']) if p.get('current_price') else 0
            p_mappings = [m for m in all_mappings if m['our_product_id'] == p['id']]
            
            latest_prices = []
            last_date = "—"
            for m in p_mappings:
                records = m.get('price_record', [])
                if records:
                    latest = sorted(records, key=lambda x: x['created_at'])[-1]
                    latest_prices.append(float(latest['price']))
                    last_date = latest['created_at'][:16].replace('T', ' ')
            
            min_comp = min(latest_prices) if latest_prices else 0
            diff = our_price - min_comp if min_comp > 0 else 0
            
            writer.writerow([
                p['id'], p.get('article_1c', '—'), p['name'], our_price, min_comp or "—", diff, last_date
            ])
            
        output.seek(0)
        headers = {'Content-Disposition': 'attachment; filename="furniture_prices_report.csv"'}
        return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers=headers)
        
    except Exception as e:
        print(f"EXPORT ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/products/batch-delete")
async def batch_delete_products(data: dict, user_id: str = Depends(get_current_user)):
    """Deletes multiple products and their history in one batch"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
        
    ids = data.get("ids", [])
    if not ids:
        return {"status": "error", "message": "Список ID пуст"}
        
    try:
        # 1. Gather mapping IDs for these products
        mappings = supabase.table("competitor_product").select("id").in_("our_product_id", ids).execute().data
        mapping_ids = [m['id'] for m in mappings]
        
        # 2. Delete price records for those mappings
        if mapping_ids:
            supabase.table("price_record").delete().in_("competitor_product_id", mapping_ids).execute()
        
        # 3. Delete mappings
        supabase.table("competitor_product").delete().in_("our_product_id", ids).execute()
        
        # 4. Finally delete the products
        supabase.table("our_product").delete().in_("id", ids).execute()
        
        return {"status": "success", "message": f"Удалено товаров: {len(ids)}"}
    except Exception as e:
        print(f"BATCH DELETE ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/products/{product_id}")
async def delete_single_product(product_id: int, user_id: str = Depends(get_current_user)):
    """Deletes a single product and its history"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
        
    try:
        # 1. Gather mapping IDs
        mappings = supabase.table("competitor_product").select("id").eq("our_product_id", product_id).execute().data
        mapping_ids = [m['id'] for m in mappings]
        
        # 2. Delete price records
        if mapping_ids:
            supabase.table("price_record").delete().in_("competitor_product_id", mapping_ids).execute()
        
        # 3. Delete mappings
        supabase.table("competitor_product").delete().eq("our_product_id", product_id).execute()
        
        # 4. Delete product
        supabase.table("our_product").delete().eq("id", product_id).execute()
        
        return {"status": "success", "message": "Товар удален"}
    except Exception as e:
        print(f"DELETE ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/products/{product_id}")
async def update_product(
    product_id: int, 
    data: dict,
    user_id: str = Depends(get_current_user)
):
    """Universal product update (price, 1c article, etc)"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
        
    try:
        supabase.table("our_product").update(data).eq("id", product_id).execute()
        return {"status": "success", "message": "Товар обновлен"}
    except Exception as e:
        print(f"UPDATE ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/competitor_products/all")
async def get_all_competitor_products(user_id: str = Depends(get_current_user)):
    """Returns all competitor links across all stores with their latest prices"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        # Fetch mappings with store and our product info
        mappings = supabase.table("competitor_product").select("*, competitor_store(name), our_product(name, current_price), price_record(*)").execute().data
        
        result = []
        for m in mappings:
            records = m.get('price_record', [])
            latest_price = None
            if records:
                latest = sorted(records, key=lambda x: x['created_at'])[-1]
                latest_price = float(latest['price'])
            
            result.append({
                "id": m['id'],
                "url": m['url'],
                "store_name": m['competitor_store']['name'] if m.get('competitor_store') else "—",
                "our_product_name": m['our_product']['name'] if m.get('our_product') else "—",
                "our_price": float(m['our_product']['current_price']) if m.get('our_product') and m['our_product'].get('current_price') else 0,
                "competitor_price": latest_price,
                "store_id": m['store_id']
            })
        return result
    except Exception as e:
        print(f"COMPETITORS ALL ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stores")
async def get_stores(user_id: str = Depends(get_current_user)):
    """Returns list of all competitor stores for filtering"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        return supabase.table("competitor_store").select("*").order("name").execute().data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
