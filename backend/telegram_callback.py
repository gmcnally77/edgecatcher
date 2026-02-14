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


def _handle_test_bet(args):
    """
    /test_bet <runner> — Test GetPlacementInfo from within the running service.
    Uses the service's live AO session and execution context.
    """
    from telegram_alerts import send_telegram_message
    from fetch_universal import _ao_execution_context, _cached_active_rows

    if not args:
        send_telegram_message("Usage: /test_bet <runner name>\nExample: /test_bet Serghei Spivac")
        return

    search = args.lower()
    ao_ctx = _ao_execution_context
    active_rows = _cached_active_rows

    logger.info(f"test_bet: search='{search}', ctx_size={len(ao_ctx)}, rows={len(active_rows)}")

    # Find matching row in execution context
    match_id = None
    match_ctx = None
    match_row = None
    for row_id, ctx in ao_ctx.items():
        row = next((r for r in active_rows if str(r['id']) == str(row_id)), None)
        if not row:
            continue
        if search in (row.get('runner_name') or '').lower():
            match_id = row_id
            match_ctx = ctx
            match_row = row
            break

    if not match_ctx:
        available = []
        for row_id, ctx in ao_ctx.items():
            row = next((r for r in active_rows if str(r['id']) == str(row_id)), None)
            if row:
                available.append(f"  {row['runner_name']} ({row['event_name']})")
        msg = f"No match for '{args}' in AO execution context.\n"
        if available:
            msg += f"\nAvailable ({len(available)}):\n" + "\n".join(available[:10])
        else:
            msg += "Execution context is empty."
        send_telegram_message(msg)
        return

    send_telegram_message(
        f"🧪 <b>Testing GetPlacementInfo</b>\n"
        f"Runner: {match_row['runner_name']}\n"
        f"Event: {match_row['event_name']}\n"
        f"AO GameId: {match_ctx.get('ao_game_id')}\n"
        f"OddsName: {match_ctx.get('ao_odds_name')}\n"
        f"MarketType: {match_ctx.get('ao_market_type_id')}\n"
        f"SportsType: {match_ctx.get('ao_sports_type')}\n"
        f"Bookie: {match_ctx.get('ao_bookie_code')}"
    )

    # Call GetPlacementInfo using the service's AO client
    try:
        from asianodds_client import get_client
        ao = get_client()
        if not ao:
            send_telegram_message("AO client not available")
            return

        result = ao.get_placement_info(
            game_id=match_ctx['ao_game_id'],
            game_type=match_ctx.get('ao_game_type', 'X'),
            is_full_time=match_ctx.get('ao_is_full_time', 1),
            bookies=match_ctx.get('ao_bookie_code', 'PIN'),
            market_type_id=match_ctx.get('ao_market_type_id', 1),
            odds_format='00',
            odds_name=match_ctx.get('ao_odds_name', 'HomeOdds'),
            sports_type=match_ctx.get('ao_sports_type', 1)
        )

        if not result:
            send_telegram_message("GetPlacementInfo: No response")
            return

        code = result.get('Code')
        if code != 0:
            msg = result.get('Result', {})
            if isinstance(msg, dict):
                msg = msg.get('TextMessage', '') or msg.get('Message', '')
            send_telegram_message(f"GetPlacementInfo failed: Code={code}\n{msg}")
            return

        r = result.get('Result') or {}
        pd = r.get('OddsPlacementData') or r.get('PlacementData') or r.get('Data') or [{}]
        if isinstance(pd, list) and pd:
            item = pd[0]
        else:
            item = pd if isinstance(pd, dict) else {}

        live_price = item.get('Odds') or item.get('Price') or 0
        min_amt = item.get('MinimumAmount') or item.get('MinAmount') or 0
        max_amt = item.get('MaximumAmount') or item.get('MaxAmount') or 0

        send_telegram_message(
            f"✅ <b>GetPlacementInfo OK</b>\n\n"
            f"Live price: {live_price}\n"
            f"Min stake: {min_amt}\n"
            f"Max stake: {max_amt}\n"
            f"Bookie: {match_ctx.get('ao_bookie_code', 'PIN')}"
        )

    except Exception as e:
        send_telegram_message(f"GetPlacementInfo error: {e}")


def _handle_message(message):
    """Handle text commands (replaces check_bot_commands)."""
    text = message.get("text", "").strip()
    chat_id = message.get("chat", {}).get("id")

    if str(chat_id) != str(TELEGRAM_CHAT_ID):
        return

    if text == "/status":
        from telegram_alerts import send_status_report
        send_status_report()
    elif text.startswith("/test_bet"):
        args = text[len("/test_bet"):].strip()
        _handle_test_bet(args)


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
