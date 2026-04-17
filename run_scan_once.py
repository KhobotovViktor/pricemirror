"""
Price Mirror — One-Shot Full Scan
==================================
Запускается планировщиком Windows дважды в будний день (9:00 и 16:00).
Выполняет полное сканирование всех цен (monitor_all) и завершается.

Запуск: python run_scan_once.py
"""

import asyncio
import sys
import os
from pathlib import Path
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

# Fix asyncio on Windows for Playwright subprocess support
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

# Add app to path so relative imports work
sys.path.insert(0, str(Path(__file__).parent))

MSK = timezone(timedelta(hours=3))

LOG_FILE = Path(__file__).parent / "scraper_log.txt"


def log(msg: str):
    ts = datetime.now(MSK).strftime("%d.%m.%Y %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


async def main():
    log("=" * 50)
    log("  Price Mirror — Scheduled Full Scan started")
    log("=" * 50)

    try:
        from app.worker.scraper import monitor_all
    except ImportError as e:
        log(f"CRITICAL: Cannot import scraper — {e}")
        sys.exit(1)

    try:
        log("Starting monitor_all()...")
        await monitor_all()
        log("Full scan complete.")
    except Exception as e:
        log(f"Scan error: {e}")
        import traceback
        log(traceback.format_exc())
        sys.exit(1)

    log("=" * 50)


if __name__ == "__main__":
    asyncio.run(main())
