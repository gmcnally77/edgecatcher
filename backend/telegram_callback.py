"""
Telegram Callback Handler — Daemon thread polling getUpdates for callback_query
button presses (arb execution) and text commands (/status).

Replaces check_bot_commands() in telegram_alerts.py to avoid getUpdates conflicts.
"""
import os
import time
import threading
import logging
import requests

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")

# Pending arbs registered by arb_scanner, awaiting user tap
_pending_arbs = {}  # arb_id -> {context, registered_at}
_pending_lock = threading.Lock()
ARB_TTL = 60  # seconds before pending arb expires

_update_offset = 0
_callback_thread = None


def register_pending_arb(arb_id, context):
    """Register an arb for potential execution. Called by arb_scanner."""
    with _pending_lock:
        _pending_arbs[arb_id] = {
            'context': context,
            'registered_at': time.time()
        }
    logger.info(f"Registered pending arb: {arb_id}")


def _cleanup_expired():
    """Remove expired pending arbs."""
    now = time.time()
    with _pending_lock:
        expired = [k for k, v in _pending_arbs.items() if now - v['registered_at'] > ARB_TTL]
        for k in expired:
            del _pending_arbs[k]
        if expired:
            logger.debug(f"Cleaned up {len(expired)} expired pending arbs")


def _poll_updates():
    """Long-poll Telegram getUpdates. Returns list of updates."""
    global _update_offset

    if not TELEGRAM_BOT_TOKEN:
        return []

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates"
    params = {"timeout": 5}
    if _update_offset:
        params["offset"] = _update_offset

    try:
        r = requests.get(url, params=params, timeout=10)
        data = r.json()
        if not data.get("ok"):
            return []

        results = data.get("result", [])
        if results:
            _update_offset = results[-1]["update_id"] + 1
        return results
    except Exception as e:
        logger.error(f"Telegram poll error: {e}")
        return []


def _answer_callback(callback_query_id, text=""):
    """Answer callback query to dismiss loading spinner."""
    if not TELEGRAM_BOT_TOKEN or not callback_query_id:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/answerCallbackQuery"
    payload = {"callback_query_id": callback_query_id}
    if text:
        payload["text"] = text
    try:
        requests.post(url, json=payload, timeout=3)
    except Exception:
        pass


def _handle_callback_query(callback_query):
    """Handle inline button press (EXECUTE ARB)."""
    from telegram_alerts import send_telegram_message

    cb_data = callback_query.get("data", "")
    cb_id = callback_query.get("id")
    chat_id = callback_query.get("message", {}).get("chat", {}).get("id")

    if str(chat_id) != str(TELEGRAM_CHAT_ID):
        _answer_callback(cb_id, "Unauthorized")
        return

    if not cb_data.startswith("exec_arb:"):
        _answer_callback(cb_id)
        return

    _answer_callback(cb_id, "Executing...")

    arb_id = cb_data.split(":", 1)[1]

    with _pending_lock:
        pending = _pending_arbs.pop(arb_id, None)

    if not pending:
        send_telegram_message("⚠️ Arb expired or already processed.")
        return

    if time.time() - pending['registered_at'] > ARB_TTL:
        send_telegram_message("⚠️ Arb expired (>60s old).")
        return

    # Execute the arb in this thread (holds _exec_lock, prevents concurrent)
    try:
        from arb_executor import execute_arb
        execute_arb(pending['context'])
    except Exception as e:
        logger.error(f"Arb execution error: {e}")
        send_telegram_message(f"❌ Execution error: {e}")


def _handle_message(message):
    """Handle text commands (replaces check_bot_commands)."""
    text = message.get("text", "").strip()
    chat_id = message.get("chat", {}).get("id")

    if str(chat_id) != str(TELEGRAM_CHAT_ID):
        return

    if text == "/status":
        from telegram_alerts import send_status_report
        send_status_report()


def _callback_loop():
    """Main loop for the callback handler thread."""
    logger.info("Telegram callback handler started")

    while True:
        try:
            _cleanup_expired()
            updates = _poll_updates()
            for update in updates:
                if "callback_query" in update:
                    _handle_callback_query(update["callback_query"])
                elif "message" in update:
                    _handle_message(update["message"])
        except Exception as e:
            logger.error(f"Callback loop error: {e}")
        time.sleep(0.5)


def start_callback_listener():
    """Start the callback handler as a daemon thread. Safe to call multiple times."""
    global _callback_thread
    if _callback_thread and _callback_thread.is_alive():
        return
    _callback_thread = threading.Thread(
        target=_callback_loop, daemon=True, name="TelegramCallbacks"
    )
    _callback_thread.start()
    logger.info("Telegram callback listener thread started")
