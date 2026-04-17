"""
Price Mirror — Local Playwright Worker
======================================
Запускать на локальной машине. Делает две вещи:
  1. Каждые 12 часов автоматически обновляет все цены (monitor_all)
  2. Каждые 30 секунд проверяет очередь в Supabase и выполняет ручные запросы
     на обновление, инициированные через интерфейс Vercel

Запуск: python run_worker.py
"""

import asyncio
import sys
import os
import json
import time
from pathlib import Path
from dotenv import load_dotenv

# Fix asyncio on Windows for Playwright subprocess support
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

# Add app to path so relative imports work
sys.path.insert(0, str(Path(__file__).parent))

from app.core.database import supabase
from app.worker.scraper import scrape_specific_mapping, scrape_for_product, monitor_all

QUEUE_KEY = "scrape_queue"
POLL_INTERVAL = 30   # seconds between queue checks
MONITOR_INTERVAL = 12 * 3600  # 12 hours full re-scan


def get_queue() -> list:
    """Read pending scrape requests from Supabase system_settings.
    Retries once on SSL/network errors (connection may go stale after long scans).
    """
    for attempt in range(2):
        try:
            row = supabase.table("system_settings").select("value").eq("key", QUEUE_KEY).execute()
            if row.data:
                return json.loads(row.data[0]["value"])
            return []
        except Exception as e:
            err_str = str(e)
            is_ssl_err = "EOF" in err_str or "SSL" in err_str or "ssl" in err_str or "protocol" in err_str
            if attempt == 0 and is_ssl_err:
                print(f"[Worker] Queue read SSL error (will retry): {e}")
                time.sleep(3)
                continue
            print(f"[Worker] Queue read error: {e}")
            break
    return []


def clear_queue():
    """Clear the queue after processing."""
    for attempt in range(2):
        try:
            supabase.table("system_settings").upsert(
                {"key": QUEUE_KEY, "value": "[]"}, on_conflict="key"
            ).execute()
            return
        except Exception as e:
            err_str = str(e)
            is_ssl_err = "EOF" in err_str or "SSL" in err_str or "ssl" in err_str or "protocol" in err_str
            if attempt == 0 and is_ssl_err:
                print(f"[Worker] Queue clear SSL error (will retry): {e}")
                time.sleep(3)
                continue
            print(f"[Worker] Queue clear error: {e}")
            break


async def process_queue():
    """Process all pending items in the scrape queue."""
    items = get_queue()
    if not items:
        return

    print(f"[Worker] Processing queue: {items}")
    clear_queue()

    for item in items:
        try:
            if item.get("type") == "mapping":
                print(f"[Worker] Scraping mapping {item['id']}...")
                await scrape_specific_mapping(item["id"])
            elif item.get("type") == "product":
                print(f"[Worker] Scraping product {item['id']}...")
                await scrape_for_product(item["id"])
            elif item.get("type") == "all":
                print("[Worker] Full monitor_all requested...")
                await monitor_all()
                return  # monitor_all covers everything
            await asyncio.sleep(1)
        except Exception as e:
            print(f"[Worker] Error processing {item}: {e}")


async def main():
    print("=" * 50)
    print("  Price Mirror — Local Worker started")
    print(f"  Queue poll: every {POLL_INTERVAL}s")
    print(f"  Full rescan: every {MONITOR_INTERVAL // 3600}h")
    print("=" * 50)

    last_monitor = 0

    while True:
        now = time.time()

        # Full rescan on schedule
        if now - last_monitor >= MONITOR_INTERVAL:
            print("[Worker] Starting scheduled full price scan...")
            try:
                await monitor_all()
                print("[Worker] Full scan complete.")
            except Exception as e:
                print(f"[Worker] Full scan error: {e}")
            last_monitor = time.time()

        # Process manual queue requests from Vercel UI
        try:
            await process_queue()
        except Exception as e:
            print(f"[Worker] Queue processing error: {e}")

        await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
