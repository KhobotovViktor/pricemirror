import requests
from .database import supabase

class PriceNotifier:
    """Sends notifications to Telegram using settings from the database"""
    
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
    def send_price_alert(cls, product_name, old_price, new_price, store_name):
        msg = (
            f"📉 <b>Снижение цены!</b>\n"
            f"Товар: <i>{product_name}</i>\n"
            f"Магазин: <b>{store_name}</b>\n"
            f"Старая цена: {old_price} ₽\n"
            f"Новая цена: <b>{new_price} ₽</b>"
        )
        cls.send_telegram(msg)

# Export for use in other modules
notifier = PriceNotifier
