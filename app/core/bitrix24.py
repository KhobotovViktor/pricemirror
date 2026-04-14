"""
Bitrix24 integration — send messages to group chat via Incoming Webhook.

Webhook URL format: https://DOMAIN.bitrix24.ru/rest/USER_ID/WEBHOOK_CODE/
API method: im.message.add
Docs: https://github.com/bitrix-tools/b24-rest-docs/blob/main/api-reference/chats/messages/im-message-add.md
"""

import requests
from .database import supabase


class Bitrix24Notifier:
    """Sends messages to a Bitrix24 group chat via incoming webhook."""

    @staticmethod
    def get_settings() -> dict:
        try:
            resp = supabase.table("system_settings").select("*").execute()
            return {s["key"]: s["value"] for s in resp.data}
        except Exception as e:
            print(f"[Bitrix24] Failed to fetch settings: {e}")
            return {}

    @classmethod
    def is_configured(cls) -> bool:
        settings = cls.get_settings()
        return bool(settings.get("b24_webhook_url") and settings.get("b24_chat_id"))

    @classmethod
    def send_message(cls, message: str) -> bool:
        """Send a message to the configured Bitrix24 group chat.

        Uses im.message.add with DIALOG_ID = chatXXX.
        BB-code formatting is supported: [B], [I], [U], [S], [URL=...], newlines.
        """
        settings = cls.get_settings()
        webhook_url = settings.get("b24_webhook_url", "").rstrip("/")
        chat_id = settings.get("b24_chat_id", "")

        if not webhook_url or not chat_id:
            print("[Bitrix24] Skipped: webhook URL or chat ID not configured.")
            return False

        # Ensure DIALOG_ID has the "chat" prefix for group chats
        dialog_id = f"chat{chat_id}" if not chat_id.startswith("chat") else chat_id

        url = f"{webhook_url}/im.message.add.json"
        payload = {
            "DIALOG_ID": dialog_id,
            "MESSAGE": message,
            "SYSTEM": "N",
            "URL_PREVIEW": "Y",
        }

        try:
            response = requests.post(url, json=payload, timeout=15)
            data = response.json()
            if "result" in data:
                print(f"[Bitrix24] Message sent, ID: {data['result']}")
                return True
            else:
                error = data.get("error_description", data.get("error", str(data)))
                print(f"[Bitrix24] API error: {error}")
                return False
        except Exception as e:
            print(f"[Bitrix24] Exception: {e}")
            return False

    @classmethod
    def send_price_alert(cls, product_name: str, old_price, new_price, store_name: str):
        """Send a formatted price drop alert to Bitrix24 chat."""
        msg = (
            f"[B]Снижение цены конкурента![/B]\n"
            f"Товар: [I]{product_name}[/I]\n"
            f"Магазин: [B]{store_name}[/B]\n"
            f"Старая цена: {old_price} руб.\n"
            f"Новая цена: [B]{new_price} руб.[/B]"
        )
        cls.send_message(msg)

    @classmethod
    def send_scan_summary(cls, total_scanned: int, price_changes: int, errors: int):
        """Send a scan completion summary to Bitrix24 chat."""
        msg = (
            f"[B]Price Mirror — Отчёт о сканировании[/B]\n"
            f"Просканировано: {total_scanned}\n"
            f"Изменений цен: {price_changes}\n"
            f"Ошибок: {errors}"
        )
        cls.send_message(msg)

    @classmethod
    def send_test(cls) -> tuple:
        """Send a test message. Returns (success, detail)."""
        settings = cls.get_settings()
        webhook_url = settings.get("b24_webhook_url", "").rstrip("/")
        chat_id = settings.get("b24_chat_id", "")

        if not webhook_url:
            return False, "Webhook URL не настроен"
        if not chat_id:
            return False, "Chat ID не настроен"

        dialog_id = f"chat{chat_id}" if not chat_id.startswith("chat") else chat_id

        url = f"{webhook_url}/im.message.add.json"
        payload = {
            "DIALOG_ID": dialog_id,
            "MESSAGE": "[B]Price Mirror[/B] — тестовое сообщение. Интеграция с Битрикс24 работает!",
            "SYSTEM": "N",
        }

        try:
            response = requests.post(url, json=payload, timeout=15)
            data = response.json()
            if "result" in data:
                return True, f"Сообщение отправлено (ID: {data['result']})"
            else:
                error = data.get("error_description", data.get("error", str(data)))
                return False, f"Ошибка API: {error}"
        except Exception as e:
            return False, f"Ошибка подключения: {e}"


bitrix24 = Bitrix24Notifier
