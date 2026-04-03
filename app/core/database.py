from supabase import create_client, Client
import os
from dotenv import load_dotenv
from pathlib import Path

# Load .env from the project root (2 levels up from this file)
env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# Initialize Supabase client only if credentials are present
supabase = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("DEBUG: [Database] Supabase client initialized successfully.")
    except Exception as e:
        print(f"CRITICAL: Failed to initialize Supabase client: {e}")
else:
    print("WARNING: [Database] SUPABASE_URL or SUPABASE_KEY missing. App will run in degraded mode.")

# Mocking get_db dependency for FastAPI
def get_db():
    return supabase
