from supabase import create_client, Client
import os
from dotenv import load_dotenv
from pathlib import Path

# Load .env from the project root (2 levels up from this file)
env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("SUPABASE_URL or SUPABASE_KEY not found in environment")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Mocking get_db dependency for FastAPI
def get_db():
    return supabase
