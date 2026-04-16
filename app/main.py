import sys
import asyncio

# Critical fix for Windows: Use ProactorEventLoop to support subprocesses (like Playwright)
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI, Depends, HTTPException, Request, Form, BackgroundTasks, UploadFile, File, Query
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from contextlib import asynccontextmanager
import os
import io
import csv
import json
import urllib.parse
import jwt
import time
from datetime import datetime, timezone, timedelta as _timedelta
MSK = timezone(_timedelta(hours=3))
from starlette.responses import RedirectResponse
from fastapi.security import APIKeyCookie
import traceback
from dotenv import load_dotenv
from pathlib import Path
from .core.database import supabase
from collections import defaultdict
import hashlib
import hmac
import secrets

# bcrypt for password hashing (falls back to plain-text comparison if not installed)
try:
    import bcrypt
    BCRYPT_AVAILABLE = True
except ImportError:
    BCRYPT_AVAILABLE = False
    print("WARNING: bcrypt not installed. Password stored as plain text. Run: pip install bcrypt")

# Rate limiting state for login endpoint (in-memory)
_login_attempts = defaultdict(list)  # IP -> list of timestamps
RATE_LIMIT_WINDOW = 300  # 5 minutes
RATE_LIMIT_MAX = 5  # max attempts per window

# Optional imports for Vercel 'Slim' compatibility
try:
    from xhtml2pdf import pisa
    PISA_AVAILABLE = True
except ImportError:
    PISA_AVAILABLE = False

try:
    from .worker.scraper import scrape_for_product, monitor_all, scrape_specific_mapping, scrape_our_product_price, scrape_product_details
    SCRAPER_AVAILABLE = True
    SCRAPER_MODE = "playwright"
except ImportError:
    try:
        from .worker.cloud_scraper import scrape_for_product, monitor_all, scrape_specific_mapping, scrape_our_product_price, scrape_product_details
        SCRAPER_AVAILABLE = True
        SCRAPER_MODE = "cloud"
    except ImportError:
        SCRAPER_AVAILABLE = False
        SCRAPER_MODE = "none"
        scrape_specific_mapping = None
        scrape_our_product_price = None
        scrape_product_details = None

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
CSRF_HEADER_NAME = "x-csrf-token"
auth_cookie = APIKeyCookie(name=COOKIE_NAME, auto_error=False)

# CSRF protection middleware: validates token on state-changing requests
# Exempt paths: /api/login (no session yet), /api/scrape/* (internal), /api/debug/*
CSRF_EXEMPT_PATHS = {"/api/login"}
CSRF_EXEMPT_PREFIXES = ("/api/scrape/", "/api/debug/")

from starlette.middleware.base import BaseHTTPMiddleware

class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            path = request.url.path
            # Skip CSRF for exempt paths
            if path not in CSRF_EXEMPT_PATHS and not any(path.startswith(p) for p in CSRF_EXEMPT_PREFIXES):
                csrf_token = request.headers.get(CSRF_HEADER_NAME, "")
                if not verify_csrf_token(csrf_token):
                    return JSONResponse(
                        status_code=403,
                        content={"status": "error", "message": "CSRF token invalid or missing"}
                    )
        return await call_next(request)

app.add_middleware(CSRFMiddleware)

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

def generate_csrf_token():
    """Generate a signed CSRF token using HMAC + random nonce."""
    nonce = secrets.token_hex(16)
    sig = hmac.new(SECRET_KEY.encode(), nonce.encode(), hashlib.sha256).hexdigest()[:16]
    return f"{nonce}.{sig}"

def verify_csrf_token(token: str) -> bool:
    """Verify CSRF token signature."""
    if not token or '.' not in token:
        return False
    nonce, sig = token.rsplit('.', 1)
    expected = hmac.new(SECRET_KEY.encode(), nonce.encode(), hashlib.sha256).hexdigest()[:16]
    return hmac.compare_digest(sig, expected)

def _check_rate_limit(ip: str) -> bool:
    """Returns True if the IP is rate-limited (too many login attempts)."""
    now = time.time()
    # Clean up old attempts
    _login_attempts[ip] = [t for t in _login_attempts[ip] if now - t < RATE_LIMIT_WINDOW]
    return len(_login_attempts[ip]) >= RATE_LIMIT_MAX

def _record_login_attempt(ip: str):
    """Record a failed login attempt for rate limiting."""
    _login_attempts[ip].append(time.time())

def _verify_password(plain_password: str, stored_password: str) -> bool:
    """Verify password against stored hash (bcrypt) or plain text (legacy fallback)."""
    if BCRYPT_AVAILABLE and stored_password.startswith("$2b$"):
        return bcrypt.checkpw(plain_password.encode('utf-8'), stored_password.encode('utf-8'))
    # Legacy plain-text fallback
    return plain_password == stored_password

def _hash_password(plain_password: str) -> str:
    """Hash a password with bcrypt. Returns the hash string."""
    if BCRYPT_AVAILABLE:
        return bcrypt.hashpw(plain_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    return plain_password

async def get_current_user(token: str = Depends(auth_cookie)):
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except Exception:
        return None

# Resolving paths relative to the project root
ROOT_DIR = Path(__file__).parent.parent.resolve()
STATIC_DIR = ROOT_DIR / "static"
TEMPLATES_DIR = ROOT_DIR / "templates"

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
scheduler = AsyncIOScheduler()

@app.get("/api/report/pdf")
async def get_pdf_report(request: Request, user_id: str = Depends(get_current_user)):
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
                "now": datetime.now(MSK).strftime("%d.%m.%Y %H:%M"),
                "products": products
            }
        )
    except Exception as e:
        print(f"PDF ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/login", response_class=HTMLResponse)
async def get_login_page(request: Request):
    """Simple login view"""
    return templates.TemplateResponse(request, "login.html", {"request": request})

@app.post("/api/login")
async def post_login(request: Request, username: str = Form(...), password: str = Form(...)):
    """Validates username + password with rate limiting, bcrypt hashing, and sets JWT cookie.
    Supports multi-user via app_user table with fallback to legacy system_settings."""
    client_ip = request.client.host if request.client else "unknown"
    
    # Rate limiting check
    if _check_rate_limit(client_ip):
        return JSONResponse(
            status_code=429,
            content={"status": "error", "message": "Слишком много попыток входа. Попробуйте через 5 минут."}
        )
    
    try:
        # Try app_user table first (multi-user mode)
        user = None
        try:
            resp = supabase.table("app_user").select("*").eq("username", username).eq("is_active", True).execute()
            if resp.data:
                user = resp.data[0]
        except Exception:
            pass  # Table may not exist yet, fall back to legacy

        if user:
            # Multi-user mode: verify against app_user table
            if not _verify_password(password, user['password_hash']):
                _record_login_attempt(client_ip)
                return JSONResponse(status_code=401, content={"status": "error", "message": "Неверный логин или пароль"})
            
            # Auto-migrate plain-text to bcrypt
            if BCRYPT_AVAILABLE and not user['password_hash'].startswith("$2b$"):
                hashed = _hash_password(password)
                supabase.table("app_user").update({"password_hash": hashed}).eq("id", user['id']).execute()
            
            _login_attempts.pop(client_ip, None)
            token = create_access_token({
                "sub": str(user['id']),
                "username": user['display_name'],
                "role": user['role']
            })
            response = JSONResponse(content={"status": "success", "message": f"Добро пожаловать, {user['display_name']}!"})
            response.set_cookie(key=COOKIE_NAME, value=token, httponly=True, max_age=3600*24)
            return response
        
        # Legacy fallback: hardcoded admin via system_settings
        if username != "Хоботов Виктор":
            _record_login_attempt(client_ip)
            return JSONResponse(status_code=401, content={"status": "error", "message": "Неверный логин или пароль"})

        resp = supabase.table("system_settings").select("*").eq("key", "admin_password").execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Пароль не настроен в БД")
        
        stored_password = resp.data[0]['value']
        
        if not _verify_password(password, stored_password):
            _record_login_attempt(client_ip)
            return JSONResponse(status_code=401, content={"status": "error", "message": "Неверный логин или пароль"})
        
        if BCRYPT_AVAILABLE and not stored_password.startswith("$2b$"):
            hashed = _hash_password(password)
            supabase.table("system_settings").update({"value": hashed}).eq("key", "admin_password").execute()
        
        _login_attempts.pop(client_ip, None)
        token = create_access_token({"sub": "admin", "username": username, "role": "admin"})
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

        # Generate CSRF token for this session
        csrf_token = generate_csrf_token()

        return templates.TemplateResponse(
            request,
            "admin.html", 
            {
                "request": request, 
                "categories": categories,
                "products": products,
                "csrf_token": csrf_token
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
            background_tasks.add_task(scrape_our_product_price, product_id)
            
        return result.data[0] if result.data else {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/products/import-xml")
async def import_products_from_xml(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user)
):
    """Import products from YML/XML catalog file (Yandex Market format).
    Extracts name and URL from each <offer>. Price is updated by scraper separately.
    Auto-maps XML categoryId to system product categories."""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    
    import xml.etree.ElementTree as ET
    
    # Mapping: XML categoryId -> system category name
    XML_CAT_MAP = {
        287: "Угловые диваны",
        311: "Прямые диваны", 286: "Прямые диваны",
        670: "Матрасы", 679: "Матрасы", 680: "Матрасы", 673: "Матрасы", 675: "Матрасы", 676: "Матрасы",
        282: "Шкафы распашные", 283: "Шкафы распашные", 320: "Шкафы распашные", 354: "Шкафы распашные",
        364: "Шкафы распашные", 366: "Шкафы распашные", 396: "Шкафы распашные",
        353: "Шкафы-купе", 395: "Шкафы-купе",
        590: "Комоды", 277: "Комоды", 360: "Комоды", 383: "Комоды",
        259: "Столы письменные и компьютерные", 292: "Столы письменные и компьютерные", 319: "Столы письменные и компьютерные",
        313: "Кровати", 356: "Кровати", 306: "Кровати", 321: "Кровати",
        700: "Кухонные гарнитуры",
        332: "Стулья кухонные", 268: "Стулья кухонные",
        331: "Столы кухонные", 267: "Столы кухонные",
        330: "Кухонные диваны", 333: "Кухонные диваны", 449: "Кухонные диваны",
        275: "Стенки",
        347: "Прихожие", 348: "Прихожие",
        281: "ТВ-тумбы", 388: "ТВ-тумбы",
        288: "Кресла для отдыха",
        312: "Кресла компьютерные", 294: "Кресла компьютерные", 269: "Кресла компьютерные",
        447: "Кресла подвесные",
        446: "Кресла-качалки",
        351: "Обувницы", 387: "Обувницы",
        280: "Стеллажи",
        384: "Прикроватные тумбы", 362: "Прикроватные тумбы",
        338: "Табуреты",
        276: "Столы журнальные",
        279: "Полки навесные", 392: "Полки навесные",
        334: "Мойки",
        363: "Туалетные столы",
        385: "Банкетки и пуфы",
    }
    # Note: 259 maps to both "Столы письменные и компьютерные" and "Туалетные столы" in the spec.
    # We use "Столы письменные и компьютерные" as the primary mapping for 259.
    # 363 specifically maps to "Туалетные столы".
    
    try:
        content = await file.read()
        root = ET.fromstring(content)
        
        # Parse categories from XML  
        xml_categories = {}
        for cat_el in root.iter('category'):
            cat_id = cat_el.get('id')
            cat_name = (cat_el.text or '').strip()
            if cat_id and cat_name:
                xml_categories[cat_id] = cat_name
        
        # Load system categories and build name->id lookup
        sys_categories = supabase.table("product_category").select("id, name").execute().data
        sys_cat_by_name = {c['name']: c['id'] for c in sys_categories}
        
        # Ensure all mapped categories exist in the system, create missing ones
        needed_names = set(XML_CAT_MAP.values())
        for cat_name in needed_names:
            if cat_name not in sys_cat_by_name:
                result = supabase.table("product_category").insert({"name": cat_name}).execute()
                if result.data:
                    sys_cat_by_name[cat_name] = result.data[0]['id']
        
        # Parse offers
        offers = []
        for offer in root.iter('offer'):
            name_el = offer.find('name')
            url_el = offer.find('url')
            cat_id_el = offer.find('categoryId')
            
            name = name_el.text.strip() if name_el is not None and name_el.text else None
            url = url_el.text.strip() if url_el is not None and url_el.text else None
            xml_cat_id = cat_id_el.text.strip() if cat_id_el is not None and cat_id_el.text else None
            xml_cat_name = xml_categories.get(xml_cat_id, '') if xml_cat_id else ''
            
            # Resolve system category
            resolved_cat_name = XML_CAT_MAP.get(int(xml_cat_id), None) if xml_cat_id and xml_cat_id.isdigit() else None
            resolved_cat_id = sys_cat_by_name.get(resolved_cat_name) if resolved_cat_name else None
            
            if name and url:
                offers.append({
                    "name": name,
                    "url": url,
                    "xml_category_id": xml_cat_id,
                    "xml_category_name": xml_cat_name,
                    "resolved_category_id": resolved_cat_id,
                    "resolved_category_name": resolved_cat_name or "",
                })
        
        return {"status": "success", "offers": offers, "total": len(offers)}
    except ET.ParseError as e:
        raise HTTPException(status_code=400, detail=f"Ошибка парсинга XML: {str(e)}")
    except Exception as e:
        print(f"XML IMPORT ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/products/import-xml/confirm")
async def confirm_xml_import(
    data: dict,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user)
):
    """Confirm import of selected products from XML preview.
    Expects: { products: [{ name, url, category_id }], skip_duplicates: bool }"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    
    products = data.get("products", [])
    skip_duplicates = data.get("skip_duplicates", True)
    
    if not products:
        raise HTTPException(status_code=400, detail="Нет товаров для импорта")
    
    try:
        # Get existing URLs to check duplicates
        existing = supabase.table("our_product").select("url").execute().data
        existing_urls = set(p['url'] for p in existing if p.get('url'))
        
        imported = 0
        skipped = 0
        
        for p in products:
            url = p.get("url", "").strip()
            name = p.get("name", "").strip()
            category_id = p.get("category_id")
            
            if not name or not url:
                skipped += 1
                continue
                
            if skip_duplicates and url in existing_urls:
                skipped += 1
                continue
            
            insert_data = {
                "name": name,
                "url": url,
                "category_id": category_id,
            }
            
            result = supabase.table("our_product").insert(insert_data).execute()
            if result.data:
                existing_urls.add(url)
                imported += 1
                # Trigger background price scrape for the new product
                if SCRAPER_AVAILABLE and "alleyadoma.ru" in url:
                    product_id = result.data[0]['id']
                    background_tasks.add_task(scrape_our_product_price, product_id)
        
        return {
            "status": "success",
            "imported": imported,
            "skipped": skipped,
            "message": f"Импортировано: {imported}, пропущено: {skipped}"
        }
    except Exception as e:
        print(f"XML IMPORT CONFIRM ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/scrape/preview")
async def preview_price(url: str, user_id: str = Depends(get_current_user)):
    """Live preview of price before adding product"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
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

@app.get("/api/analytics/full")
async def get_analytics_full(user_id: str = Depends(get_current_user)):
    """Returns all data needed for the 5 analytics reports."""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        from collections import defaultdict
        from datetime import datetime, timedelta

        # 1. Categories & Stores
        categories = supabase.table("product_category").select("*").order("name").execute().data
        stores = supabase.table("competitor_store").select("*").order("name").execute().data

        # 1b. Store colors
        _sc_row = supabase.table("system_settings").select("value").eq("key", "store_colors").execute().data
        store_colors = json.loads(_sc_row[0]["value"]) if _sc_row else {}
        _oc_row = supabase.table("system_settings").select("value").eq("key", "our_store_color").execute().data
        our_store_color = _oc_row[0]["value"] if _oc_row else "#6366f1"
        for s in stores:
            s["color"] = store_colors.get(str(s["id"]), "#64748b")

        # 2. All products with category name
        products_raw = supabase.table("our_product").select("*, category:product_category(name)").execute().data

        # 3. All competitor mappings
        mappings = supabase.table("competitor_product").select("*, competitor_store(id, name)").execute().data

        # 4. Price history last 30 days (with store_id via competitor_product)
        cutoff = (datetime.now(MSK) - timedelta(days=30)).isoformat()
        records = supabase.table("price_record").select(
            "price, created_at, competitor_product(store_id, our_product_id)"
        ).gte("created_at", cutoff).order("created_at").execute().data

        # Build mapping_by_product
        mapping_by_product = defaultdict(list)
        for m in mappings:
            store = m.get("competitor_store") or {}
            mapping_by_product[m["our_product_id"]].append({
                "id": m["id"],
                "store_id": m["store_id"],
                "store_name": store.get("name", "—"),
                "last_price": float(m["last_price"]) if m.get("last_price") else None,
                "last_scrape": m.get("last_scrape"),
            })

        # Build products output
        now = datetime.now(MSK)
        products_out = []
        for p in products_raw:
            pmappings = mapping_by_product.get(p["id"], [])
            prices = [m["last_price"] for m in pmappings if m["last_price"]]
            min_comp = min(prices) if prices else None
            our_price = float(p["current_price"]) if p.get("current_price") else None
            # Determine stale: last scrape > 7 days ago
            scrapes = [m["last_scrape"] for m in pmappings if m.get("last_scrape")]
            latest_scrape = max(scrapes) if scrapes else None
            is_stale = False
            if latest_scrape:
                try:
                    ls = datetime.fromisoformat(latest_scrape.replace("Z", "+00:00"))
                    if ls.tzinfo is None:
                        ls = ls.replace(tzinfo=timezone.utc)
                    is_stale = (now - ls).days > 7
                except Exception:
                    pass
            products_out.append({
                "id": p["id"],
                "name": p["name"],
                "category_id": p["category_id"],
                "category_name": p["category"]["name"] if p.get("category") else "—",
                "current_price": our_price,
                "mappings": pmappings,
                "min_comp_price": min_comp,
                "has_mapping": len(pmappings) > 0,
                "has_price": min_comp is not None,
                "is_stale": is_stale,
            })

        # Build trend: store_id -> { store_name, data: {date: avg_price} }
        store_day = defaultdict(lambda: defaultdict(list))
        store_names = {s["id"]: s["name"] for s in stores}
        for r in records:
            cp = r.get("competitor_product")
            if not cp:
                continue
            sid = cp.get("store_id")
            day = r["created_at"][:10]
            if sid and r.get("price"):
                store_day[sid][day].append(float(r["price"]))

        trend = {}
        for sid, days in store_day.items():
            trend[str(sid)] = {
                "store_name": store_names.get(sid, str(sid)),
                "data": {day: round(sum(v) / len(v), 2) for day, v in sorted(days.items())},
            }

        return {
            "categories": categories,
            "stores": stores,
            "products": products_out,
            "trend": trend,
            "store_colors": store_colors,
            "our_store_color": our_store_color,
        }
    except Exception as e:
        import traceback as _tb
        print(f"ANALYTICS FULL ERROR: {e}\n{_tb.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/analytics/trend")
async def get_analytics_trend(
    days: int = Query(None, ge=1, le=3650),
    date_from: str = Query(None),
    date_to: str = Query(None),
    user_id: str = Depends(get_current_user),
):
    """Returns trend data for a configurable time period.
    Pass either ?days=N or ?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD.
    """
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        from collections import defaultdict
        from datetime import datetime, timedelta, date

        # Resolve date range
        now = datetime.now(MSK)
        if date_from and date_to:
            try:
                cutoff = datetime.fromisoformat(date_from).isoformat()
                end_dt = datetime.fromisoformat(date_to) + timedelta(days=1)
                end_iso = end_dt.isoformat()
            except ValueError:
                raise HTTPException(status_code=400, detail="Неверный формат даты. Используйте YYYY-MM-DD.")
        else:
            period_days = days if days else 30
            cutoff = (now - timedelta(days=period_days)).isoformat()
            end_iso = None  # no upper bound

        stores = supabase.table("competitor_store").select("*").order("name").execute().data
        _sc_row = supabase.table("system_settings").select("value").eq("key", "store_colors").execute().data
        store_colors = json.loads(_sc_row[0]["value"]) if _sc_row else {}
        for s in stores:
            s["color"] = store_colors.get(str(s["id"]), "#64748b")

        q = supabase.table("price_record").select(
            "price, created_at, competitor_product(store_id, our_product_id)"
        ).gte("created_at", cutoff)
        if end_iso:
            q = q.lte("created_at", end_iso)
        records = q.order("created_at").execute().data

        store_names = {s["id"]: s["name"] for s in stores}
        store_day = defaultdict(lambda: defaultdict(list))
        for r in records:
            cp = r.get("competitor_product")
            if not cp:
                continue
            sid = cp.get("store_id")
            day = r["created_at"][:10]
            if sid and r.get("price"):
                store_day[sid][day].append(float(r["price"]))

        trend = {}
        for sid, days_data in store_day.items():
            trend[str(sid)] = {
                "store_name": store_names.get(sid, str(sid)),
                "data": {day: round(sum(v) / len(v), 2) for day, v in sorted(days_data.items())},
            }

        return {"trend": trend, "stores": stores}
    except HTTPException:
        raise
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
        mappings_resp = supabase.table("competitor_product").select("*, competitor_store(id, name), price_record(*)").eq("our_product_id", product_id).execute()

        # 2b. Store colors
        _sc2 = supabase.table("system_settings").select("value").eq("key", "store_colors").execute().data
        _sc2_map = json.loads(_sc2[0]["value"]) if _sc2 else {}
        _oc2 = supabase.table("system_settings").select("value").eq("key", "our_store_color").execute().data
        _our_color = _oc2[0]["value"] if _oc2 else "#6366f1"
        
        history = []
        latest_prices = []
        
        for mapping in mappings_resp.data:
            store_data = mapping.get('competitor_store') or {}
            store_name = store_data.get('name', 'Конкурент')
            store_id = store_data.get('id')
            store_color = _sc2_map.get(str(store_id), '#64748b') if store_id else '#64748b'
            records = mapping.get('price_record', [])
            
            for r in records:
                history.append({
                    "date": r['created_at'],
                    "price": float(r['price']),
                    "store": store_name,
                    "color": store_color,
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
        
        # Fetch our price history for this product
        our_price_history = []
        try:
            oph = supabase.table("our_price_history").select("price, created_at").eq("product_id", product_id).order("created_at").execute().data
            our_price_history = [{"date": r["created_at"], "price": float(r["price"])} for r in oph]
        except Exception:
            pass  # Table may not exist yet

        return {
            "our_product": product,
            "avg_price": round(avg_price, 2),
            "min_competitor": round(min_price, 2),
            "history": sorted(history, key=lambda x: x['date'], reverse=True),
            "recommendation": recommendation,
            "our_store_color": _our_color,
            "our_price_history": our_price_history,
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
    """Saves updated system configuration (upsert to handle new keys)"""
    try:
        data = await request.json()
        for key, value in data.items():
            supabase.table("system_settings").upsert(
                {"key": key, "value": str(value)}, on_conflict="key"
            ).execute()
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
        result = supabase.table("competitor_product").upsert(
            data, on_conflict="our_product_id,store_id"
        ).execute()
        # Trigger immediate scrape for this product
        if SCRAPER_MODE == "cloud":
            product_data = result.data[0] if result.data else {}
            mapping_id = product_data.get("id")
            if mapping_id:
                _enqueue([{"type": "mapping", "id": mapping_id}])
        elif SCRAPER_AVAILABLE:
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

def _enqueue(items: list):
    """Add items to the local worker queue stored in Supabase system_settings."""
    import json as _json
    try:
        existing = supabase.table("system_settings").select("value").eq("key", "scrape_queue").execute()
        current = _json.loads(existing.data[0]["value"]) if existing.data else []
        # Deduplicate by (type, id)
        keys = {(_i["type"], _i["id"]) for _i in current}
        for item in items:
            if (item["type"], item["id"]) not in keys:
                current.append(item)
        supabase.table("system_settings").upsert(
            {"key": "scrape_queue", "value": _json.dumps(current)}, on_conflict="key"
        ).execute()
        return True
    except Exception as e:
        print(f"Enqueue error: {e}")
        return False

@app.post("/api/scrape/mapping/{mapping_id}")
async def trigger_mapping_scrape(mapping_id: int, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    """Manual trigger for a SINGLE competitor mapping"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

    if SCRAPER_MODE == "cloud":
        ok = _enqueue([{"type": "mapping", "id": mapping_id}])
        return {"status": "queued" if ok else "error",
                "message": "Задание передано локальному воркеру. Цена обновится в течение минуты." if ok else "Ошибка очереди"}

    background_tasks.add_task(scrape_specific_mapping, mapping_id)
    return {"status": "accepted", "message": "Обновление цены по ссылке запущено"}

@app.post("/api/scrape/our-product/{product_id}")
async def trigger_our_product_scrape(product_id: int, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    """Manual trigger for OUR OWN product price update"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

    if SCRAPER_MODE == "cloud":
        ok = _enqueue([{"type": "product", "id": product_id}])
        return {"status": "queued" if ok else "error",
                "message": "Задание передано локальному воркеру." if ok else "Ошибка очереди"}

    background_tasks.add_task(scrape_our_product_price, product_id)
    return {"status": "accepted", "message": "Обновление вашей цены запущено"}

@app.post("/api/scrape/mappings/batch")
async def trigger_batch_scrape(data: dict, background_tasks: BackgroundTasks, user_id: str = Depends(get_current_user)):
    """Manual trigger for BATCH competitor mappings update"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

    mapping_ids = data.get("ids", [])
    if not mapping_ids:
        return {"status": "error", "message": "Список ID пуст"}

    if SCRAPER_MODE == "cloud":
        items = [{"type": "mapping", "id": mid} for mid in mapping_ids]
        ok = _enqueue(items)
        return {"status": "queued" if ok else "error",
                "message": f"Передано {len(mapping_ids)} заданий локальному воркеру." if ok else "Ошибка очереди"}

    async def process_batch(ids):
        for mid in ids:
            try:
                await scrape_specific_mapping(mid)
                await asyncio.sleep(1)
            except Exception as e:
                print(f"Batch Scrape Error for {mid}: {e}")

    background_tasks.add_task(process_batch, mapping_ids)
    return {"status": "accepted", "message": f"Запущено массовое обновление ({len(mapping_ids)} позиций)"}

@app.get("/api/debug/scrape")
async def debug_scrape(url: str, user_id: str = Depends(get_current_user)):
    """Debug endpoint: test price extraction for any URL. Returns raw details."""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    if not SCRAPER_AVAILABLE:
        return {"scraper_mode": SCRAPER_MODE, "error": "scraper unavailable"}
    try:
        details = await scrape_product_details(url)
        return {"scraper_mode": SCRAPER_MODE, "url": url, "result": details}
    except Exception as e:
        return {"scraper_mode": SCRAPER_MODE, "url": url, "error": str(e)}

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
            "total_mappings": len(all_mappings),
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

@app.delete("/api/mappings/{mapping_id}")
async def delete_mapping(mapping_id: int, user_id: str = Depends(get_current_user)):
    """Delete a single competitor mapping and its price records."""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        # 1. Delete price records
        supabase.table("price_record").delete().eq("competitor_product_id", mapping_id).execute()
        # 2. Delete mapping
        supabase.table("competitor_product").delete().eq("id", mapping_id).execute()
        return {"status": "success", "message": "Сопоставление удалено"}
    except Exception as e:
        print(f"DELETE MAPPING ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/products/{product_id}")
async def update_product(
    product_id: int, 
    data: dict,
    user_id: str = Depends(get_current_user)
):
    """Universal product update (price, 1c article, etc). Records price history."""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
        
    try:
        # Record our price history if current_price is being updated
        if "current_price" in data and data["current_price"] is not None:
            try:
                supabase.table("our_price_history").insert({
                    "product_id": product_id,
                    "price": float(data["current_price"]),
                    "created_at": datetime.now(MSK).isoformat()
                }).execute()
            except Exception as hist_err:
                print(f"[OurPriceHistory] Insert error (table may not exist): {hist_err}")

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
        mappings = supabase.table("competitor_product").select("*, competitor_store(name, location), our_product(name, current_price, category_id), price_record(*)").execute().data

        result = []
        for m in mappings:
            records = m.get('price_record', [])
            latest_price = None
            if records:
                latest = sorted(records, key=lambda x: x['created_at'])[-1]
                latest_price = float(latest['price'])

            store = m.get('competitor_store') or {}
            result.append({
                "id": m['id'],
                "url": m['url'],
                "store_name": store.get('name', '—'),
                "store_location": store.get('location', 'Торговая сеть'),
                "our_product_name": m['our_product']['name'] if m.get('our_product') else "—",
                "our_price": float(m['our_product']['current_price']) if m.get('our_product') and m['our_product'].get('current_price') else 0,
                "competitor_price": latest_price,
                "store_id": m['store_id'],
                "category_id": m['our_product']['category_id'] if m.get('our_product') else None,
            })
        return result
    except Exception as e:
        print(f"COMPETITORS ALL ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stores")
async def get_stores(user_id: str = Depends(get_current_user)):
    """Returns list of all competitor stores with colors"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        stores = supabase.table("competitor_store").select("*").order("name").execute().data
        _c = supabase.table("system_settings").select("value").eq("key", "store_colors").execute().data
        sc = json.loads(_c[0]["value"]) if _c else {}
        for s in stores:
            s["color"] = sc.get(str(s["id"]), "#64748b")
        return stores
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/stores/{store_id}/color")
async def update_store_color(store_id: int, color: str = Form(...), user_id: str = Depends(get_current_user)):
    """Update the display color for a competitor store."""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        _r = supabase.table("system_settings").select("value").eq("key", "store_colors").execute().data
        sc = json.loads(_r[0]["value"]) if _r else {}
        sc[str(store_id)] = color
        supabase.table("system_settings").upsert({"key": "store_colors", "value": json.dumps(sc)}, on_conflict="key").execute()
        return {"status": "ok", "store_id": store_id, "color": color}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/settings/our-color")
async def update_our_store_color(color: str = Form(...), user_id: str = Depends(get_current_user)):
    """Update the display color for our store."""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        supabase.table("system_settings").upsert({"key": "our_store_color", "value": color}, on_conflict="key").execute()
        return {"status": "ok", "color": color}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/stores")
async def create_store(request: Request, user_id: str = Depends(get_current_user)):
    """Create a new competitor store."""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        data = await request.json()
        name = (data.get("name") or "").strip()
        domain = (data.get("domain") or "").strip().lower().removeprefix("www.")
        location = (data.get("location") or "Торговая сеть").strip()
        if not name or not domain:
            raise HTTPException(status_code=400, detail="Название и домен обязательны")
        result = supabase.table("competitor_store").insert({
            "name": name,
            "domain": domain,
            "location": location
        }).execute()
        if result.data:
            return {"status": "success", "store": result.data[0]}
        raise HTTPException(status_code=500, detail="Ошибка создания магазина")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/stores/{store_id}")
async def update_store(store_id: int, request: Request, user_id: str = Depends(get_current_user)):
    """Update name, domain and/or location of a competitor store."""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        data = await request.json()
        update = {}
        if "name" in data and data["name"].strip():
            update["name"] = data["name"].strip()
        if "domain" in data and data["domain"].strip():
            update["domain"] = data["domain"].strip().lower().removeprefix("www.")
        if "location" in data:
            update["location"] = (data["location"] or "Торговая сеть").strip()
        if not update:
            return {"status": "error", "message": "Нет данных для обновления"}
        supabase.table("competitor_store").update(update).eq("id", store_id).execute()
        return {"status": "success", "message": "Магазин обновлён"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/stores/{store_id}")
async def delete_store(store_id: int, user_id: str = Depends(get_current_user)):
    """Delete a competitor store (only if it has no linked products)."""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        linked = supabase.table("competitor_product").select("id").eq("store_id", store_id).limit(1).execute().data
        if linked:
            raise HTTPException(status_code=400, detail="Нельзя удалить магазин: есть привязанные товары")
        supabase.table("competitor_store").delete().eq("id", store_id).execute()
        return {"status": "success", "message": "Магазин удалён"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Bitrix24 Integration ---

@app.post("/api/telegram/test")
async def test_telegram(user_id: str = Depends(get_current_user)):
    """Sends a test message to the configured Telegram chat"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        from .core.notifier import notifier
        settings = notifier.get_settings()
        token = settings.get("telegram_bot_token")
        chat_id = settings.get("telegram_chat_id")

        if not token or not chat_id:
            return {"status": "error", "message": "Telegram Bot Token или Chat ID не настроены"}

        import requests as _req
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": "<b>Price Mirror</b> — тестовое сообщение.\nИнтеграция с Telegram работает!",
            "parse_mode": "HTML"
        }
        resp = _req.post(url, json=payload, timeout=10)
        data = resp.json()
        if resp.status_code == 200 and data.get("ok"):
            return {"status": "success", "message": f"Сообщение отправлено (message_id: {data['result']['message_id']})"}
        else:
            error_desc = data.get("description", str(data))
            return {"status": "error", "message": f"Ошибка Telegram API: {error_desc}"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})

@app.post("/api/bitrix24/test")
async def test_bitrix24(user_id: str = Depends(get_current_user)):
    """Sends a test message to the configured Bitrix24 group chat"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        from .core.bitrix24 import bitrix24
        success, detail = bitrix24.send_test()
        return {"status": "success" if success else "error", "message": detail}
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})

@app.post("/api/settings/bitrix24")
async def save_bitrix24_settings(request: Request, user_id: str = Depends(get_current_user)):
    """Saves Bitrix24 integration settings (webhook URL + chat ID)"""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        data = await request.json()
        for key in ("b24_webhook_url", "b24_chat_id"):
            value = data.get(key, "")
            supabase.table("system_settings").upsert(
                {"key": key, "value": str(value)}, on_conflict="key"
            ).execute()
        return {"status": "success", "message": "Настройки Битрикс24 сохранены"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- User Management (Multi-user) ---

@app.get("/api/users")
async def list_users(user_id: str = Depends(get_current_user)):
    """List all users (admin only)."""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        resp = supabase.table("app_user").select("id, username, display_name, role, is_active, created_at").order("created_at").execute()
        return resp.data
    except Exception as e:
        # Table may not exist yet
        return []

@app.post("/api/users")
async def create_user(request: Request, user_id: str = Depends(get_current_user)):
    """Create a new user (admin only)."""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        data = await request.json()
        username = data.get("username", "").strip()
        display_name = data.get("display_name", "").strip()
        password = data.get("password", "")
        role = data.get("role", "manager")

        if not username or not password or not display_name:
            raise HTTPException(status_code=400, detail="Все поля обязательны")
        if role not in ("admin", "manager"):
            role = "manager"

        password_hash = _hash_password(password)
        result = supabase.table("app_user").insert({
            "username": username,
            "display_name": display_name,
            "password_hash": password_hash,
            "role": role,
            "is_active": True
        }).execute()
        if result.data:
            user = result.data[0]
            return {"status": "success", "message": f"Пользователь '{display_name}' создан", "user": {
                "id": user["id"], "username": user["username"],
                "display_name": user["display_name"], "role": user["role"]
            }}
        raise HTTPException(status_code=500, detail="Ошибка создания пользователя")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.patch("/api/users/{uid}")
async def update_user(uid: int, request: Request, user_id: str = Depends(get_current_user)):
    """Update user fields (admin only). Supports: display_name, role, is_active, password."""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        data = await request.json()
        update = {}
        if "display_name" in data:
            update["display_name"] = data["display_name"]
        if "role" in data and data["role"] in ("admin", "manager"):
            update["role"] = data["role"]
        if "is_active" in data:
            update["is_active"] = bool(data["is_active"])
        if "password" in data and data["password"]:
            update["password_hash"] = _hash_password(data["password"])

        if not update:
            return {"status": "error", "message": "Нет данных для обновления"}

        supabase.table("app_user").update(update).eq("id", uid).execute()
        return {"status": "success", "message": "Пользователь обновлён"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/users/{uid}")
async def delete_user(uid: int, user_id: str = Depends(get_current_user)):
    """Delete a user (admin only)."""
    if not user_id:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    try:
        supabase.table("app_user").delete().eq("id", uid).execute()
        return {"status": "success", "message": "Пользователь удалён"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
