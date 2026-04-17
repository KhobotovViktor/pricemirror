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
    def _send_bitrix24_message(cls, bb_message: str):
        """Forward a BB-code message to Bitrix24 group chat (if configured)."""
        try:
            from .bitrix24 import bitrix24
            bitrix24.send_message(bb_message)
        except Exception as e:
            print(f"BITRIX24 NOTIFY ERROR: {e}")

    @classmethod
    def send_price_alert(cls, product_name, old_price, new_price, store_name):
        """Alert: competitor price is BELOW our price.
        old_price = our current price, new_price = competitor price.
        """
        our_price = old_price
        competitor_price = new_price
        try:
            diff = int(our_price) - int(competitor_price)
            pct = round(diff / int(our_price) * 100, 1) if our_price else 0
            diff_str = f"\nРазница: -{diff} ₽ (-{pct}%)"
        except Exception:
            diff_str = ""

        # 1. Telegram (HTML)
        msg = (
            f"⚠️ <b>Конкурент продаёт дешевле нас!</b>\n"
            f"Товар: <i>{product_name}</i>\n"
            f"Магазин: <b>{store_name}</b>\n"
            f"Наша цена: {our_price} ₽\n"
            f"Цена конкурента: <b>{competitor_price} ₽</b>"
            f"{diff_str}"
        )
        cls.send_telegram(msg)

        # 2. Bitrix24 (BB-code)
        bb = (
            f"[B]Конкурент продаёт дешевле нас![/B]\n"
            f"Товар: [I]{product_name}[/I]\n"
            f"Магазин: [B]{store_name}[/B]\n"
            f"Наша цена: {our_price} руб.\n"
            f"Цена конкурента: [B]{competitor_price} руб.[/B]"
            f"{diff_str}"
        )
        cls._send_bitrix24_message(bb)

    @classmethod
    def send_price_increase_alert(cls, product_name, old_price, new_price, store_name):
        """Alert: competitor raised their price — opportunity to increase margin."""
        pct = round((new_price - old_price) / old_price * 100, 1) if old_price else 0

        # 1. Telegram (HTML)
        msg = (
            "\U0001f4c8 <b>\u0420\u043e\u0441\u0442 \u0446\u0435\u043d\u044b \u043a\u043e\u043d\u043a\u0443\u0440\u0435\u043d\u0442\u0430!</b>\n"
            f"\u0422\u043e\u0432\u0430\u0440: <i>{product_name}</i>\n"
            f"\u041c\u0430\u0433\u0430\u0437\u0438\u043d: <b>{store_name}</b>\n"
            f"\u0411\u044b\u043b\u0430: {old_price} \u20bd \u2192 \u0421\u0442\u0430\u043b\u0430: <b>{new_price} \u20bd</b> (+{pct}%)\n"
            f"\u0412\u043e\u0437\u043c\u043e\u0436\u043d\u043e\u0441\u0442\u044c \u0443\u0432\u0435\u043b\u0438\u0447\u0438\u0442\u044c \u043c\u0430\u0440\u0436\u0443!"
        )
        cls.send_telegram(msg)

        # 2. Bitrix24 (BB-code)
        bb = (
            f"[B]\u0420\u043e\u0441\u0442 \u0446\u0435\u043d\u044b \u043a\u043e\u043d\u043a\u0443\u0440\u0435\u043d\u0442\u0430![/B]\n"
            f"\u0422\u043e\u0432\u0430\u0440: [I]{product_name}[/I]\n"
            f"\u041c\u0430\u0433\u0430\u0437\u0438\u043d: [B]{store_name}[/B]\n"
            f"\u0411\u044b\u043b\u0430: {old_price} \u0440\u0443\u0431. -> \u0421\u0442\u0430\u043b\u0430: [B]{new_price} \u0440\u0443\u0431.[/B] (+{pct}%)\n"
            f"\u0412\u043e\u0437\u043c\u043e\u0436\u043d\u043e\u0441\u0442\u044c \u0443\u0432\u0435\u043b\u0438\u0447\u0438\u0442\u044c \u043c\u0430\u0440\u0436\u0443!"
        )
        cls._send_bitrix24_message(bb)

# Export for use in other modules
notifier = PriceNotifier
