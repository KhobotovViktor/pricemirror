import requests
from .database import supabase

class PriceNotifier:
    """Sends notifications to Telegram and Bitrix24 using settings from the database"""
    
    @staticmethod
    def get_settings():
        try:
            resp = supabase.table("system_settings").select("*").execute()
            return {s['key']: s['value'] for s in resp.data}
        except Exception as e:
            print(f"FAILED TO FETCH SETTINGS: {e}")
            return {}

    @classmethod
    def send_telegram(cls, message: str):
        settings = cls.get_settings()
        token = settings.get("telegram_bot_token")
        chat_id = settings.get("telegram_chat_id")
        
        if not token or not chat_id:
            print("TELEGRAM NOTIFY SKIPPED: Bot token or Chat ID not configured in Settings.")
            return

        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "HTML"
        }
        
        try:
            response = requests.post(url, json=payload, timeout=10)
            if response.status_code != 200:
                print(f"TELEGRAM ERROR: {response.text}")
        except Exception as e:
            print(f"TELEGRAM EXCEPTION: {e}")

    @classmethod
    def send_bitrix24(cls, product_name: str, old_price, new_price, store_name: str):
        """Forward price alert to Bitrix24 group chat (if configured)."""
        try:
            from .bitrix24 import bitrix24
            bitrix24.send_price_alert(product_name, old_price, new_price, store_name)
        except Exception as e:
            print(f"BITRIX24 NOTIFY ERROR: {e}")

    @classmethod
    def send_price_alert(cls, product_name, old_price, new_price, store_name):
        # 1. Telegram notification (HTML)
        msg = (
            "\U0001f4c9 <b>\u0421\u043d\u0438\u0436\u0435\u043d\u0438\u0435 \u0446\u0435\u043d\u044b!</b>\n"
            f"\u0422\u043e\u0432\u0430\u0440: <i>{product_name}</i>\n"
            f"\u041c\u0430\u0433\u0430\u0437\u0438\u043d: <b>{store_name}</b>\n"
            f"\u0421\u0442\u0430\u0440\u0430\u044f \u0446\u0435\u043d\u0430: {old_price} \u20bd\n"
            f"\u041d\u043e\u0432\u0430\u044f \u0446\u0435\u043d\u0430: <b>{new_price} \u20bd</b>"
        )
        cls.send_telegram(msg)

        # 2. Bitrix24 notification (BB-code) — runs independently
        cls.send_bitrix24(product_name, old_price, new_price, store_name)

# Export for use in other modules
notifier = PriceNotifier
