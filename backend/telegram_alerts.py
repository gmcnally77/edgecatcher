import os
import time
import sqlite3
import requests
import logging
from datetime import datetime, timezone
from collections import deque

# --- CONFIGURATION ---
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
ALERT_MIN_VOLUME = float(os.getenv("ALERT_MIN_VOLUME", "200.0"))
ALERT_COOLDOWN_SECONDS = int(os.getenv("ALERT_COOLDOWN_SECONDS", "600"))

# Steamer detection config
STEAMER_DROP_PCT = float(os.getenv("STEAMER_DROP_PCT", "0.02"))  # 2% drop threshold
STEAMER_WINDOW_TICKS = int(os.getenv("STEAMER_WINDOW_TICKS", "6"))  # ~30s at 5s ticks

# Guard: Only run logic if this mode is active
SCOPE_MODE = os.getenv("SCOPE_MODE", "NBA_PREMATCH_ML_STEAMERS")

# --- DATABASE PATH FIX ---
# Force DB to be absolute so it doesn't get lost or hit permission errors
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "alerts.db")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - ALERTS - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- IN-MEMORY PRICE HISTORY ---
# {runner_key: deque([(timestamp, pin_price, mid_price), ...], maxlen=7)}
_price_history = {}

# --- SQLITE DEDUPE STORE ---
def init_db():
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute('''
            CREATE TABLE IF NOT EXISTS alert_history (
                id TEXT PRIMARY KEY,
                last_alert_time REAL,
                last_edge REAL,
                last_book_price REAL,
                last_lay_price REAL
            )
        ''')
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"CRITICAL: Cannot Create DB at {DB_FILE}. Error: {e}")

def get_last_alert(runner_key):
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("SELECT * FROM alert_history WHERE id = ?", (runner_key,))
        row = c.fetchone()
        conn.close()
        return row
    except Exception as e:
        logger.error(f"DB Read Error: {e}")
        return None

def update_alert_history(runner_key, drop_pct, old_price, new_price):
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        now = time.time()
        c.execute('''
            INSERT OR REPLACE INTO alert_history
            (id, last_alert_time, last_edge, last_book_price, last_lay_price)
            VALUES (?, ?, ?, ?, ?)
        ''', (runner_key, now, drop_pct, old_price, new_price))
        conn.commit()
        conn.close()
        logger.info(f"Alert saved to memory: {runner_key}")
    except Exception as e:
        logger.error(f"DB Write Failed! Alerts will duplicate. Error: {e}")

# --- TELEGRAM BOT UTILS ---
def send_telegram_message(text):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return False

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = { "chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML" }
    try:
        r = requests.post(url, json=payload, timeout=5)
        return r.status_code == 200
    except Exception as e:
        logger.error(f"Telegram send failed: {e}")
        return False

def check_bot_commands():
    if not TELEGRAM_BOT_TOKEN: return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates"
    try:
        r = requests.get(url, params={"offset": -1, "timeout": 1}, timeout=3)
        data = r.json()
        if not data.get("ok"): return

        for result in data.get("result", []):
            update_id = result.get("update_id")
            msg = result.get("message", {})
            text = msg.get("text", "")
            chat_id = msg.get("chat", {}).get("id")

            if str(chat_id) != str(TELEGRAM_CHAT_ID): continue

            if text.strip() == "/status":
                send_status_report()
                requests.get(url, params={"offset": update_id + 1})
    except Exception:
        pass

def send_status_report():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    try:
        hour_ago = time.time() - 3600
        c.execute("SELECT count(*) FROM alert_history WHERE last_alert_time > ?", (hour_ago,))
        count = c.fetchone()[0]
    except:
        count = 0
    conn.close()

    tracking = len(_price_history)
    msg = (
        f"<b>Independence Bot Status</b>\n"
        f"Mode: {SCOPE_MODE}\n"
        f"Alerts (1h): {count}\n"
        f"Tracking: {tracking} runners\n"
        f"Drop threshold: {STEAMER_DROP_PCT*100}% in ~{STEAMER_WINDOW_TICKS*5}s\n"
        f"UTC: {datetime.now(timezone.utc).strftime('%H:%M:%S')}"
    )
    send_telegram_message(msg)

# --- STEAMER DETECTION ---
def check_price_drop(runner_key, current_pin, current_mid):
    history = _price_history.get(runner_key)
    if not history or len(history) < STEAMER_WINDOW_TICKS:
        return None  # Not enough history yet

    old_ts, old_pin, old_mid = history[0]  # oldest entry (~30s ago)

    # Check PIN drop
    if old_pin and old_pin > 1.01 and current_pin and current_pin > 1.01:
        pin_drop = (old_pin - current_pin) / old_pin
        if pin_drop >= STEAMER_DROP_PCT:
            return {'type': 'PIN', 'old': old_pin, 'new': current_pin, 'drop_pct': pin_drop}

    # Check exchange mid drop
    if old_mid and old_mid > 1.01 and current_mid and current_mid > 1.01:
        mid_drop = (old_mid - current_mid) / old_mid
        if mid_drop >= STEAMER_DROP_PCT:
            return {'type': 'EX', 'old': old_mid, 'new': current_mid, 'drop_pct': mid_drop}

    return None

def should_alert(runner_key, drop_pct):
    last = get_last_alert(runner_key)
    if not last:
        return True

    _, last_ts, last_drop, _, _ = last
    # Cooldown not expired
    if (time.time() - last_ts) <= ALERT_COOLDOWN_SECONDS:
        # Re-alert if this drop is significantly bigger than the last one
        if drop_pct >= (last_drop + 0.02):
            return True
        return False
    return True

def run_alert_cycle(supabase_client):
    init_db()
    check_bot_commands()

    try:
        response = supabase_client.table("market_feed") \
            .select("*") \
            .eq("market_status", "OPEN") \
            .eq("in_play", "false") \
            .execute()
        rows = response.data
    except Exception as e:
        logger.error(f"Supabase fetch failed: {e}")
        return

    now = time.time()
    alerts_sent = 0

    for row in rows:
        vol = row.get('volume')
        if vol is None or vol < ALERT_MIN_VOLUME:
            continue

        start_time_str = row.get('start_time')
        if start_time_str:
            try:
                start_dt = datetime.fromisoformat(start_time_str.replace("Z", "+00:00"))
                if datetime.now(timezone.utc) >= start_dt:
                    continue
            except:
                pass

        pin_price = float(row.get('price_pinnacle') or 0)
        back_price = float(row.get('back_price') or 0)
        lay_price = float(row.get('lay_price') or 0)

        # Calculate exchange mid price
        mid_price = 0
        if back_price > 1.01 and lay_price > 1.01:
            mid_price = (back_price + lay_price) / 2

        m_id = row.get('market_id', 'uid')
        runner_name = row.get('runner_name', 'Unknown')
        runner_key = f"{m_id}_{runner_name}"

        # Record this tick
        if runner_key not in _price_history:
            _price_history[runner_key] = deque(maxlen=STEAMER_WINDOW_TICKS + 1)
        _price_history[runner_key].append((now, pin_price, mid_price))

        # Check for drop
        drop = check_price_drop(runner_key, pin_price, mid_price)
        if not drop:
            continue

        drop_pct = drop['drop_pct']
        if not should_alert(runner_key, drop_pct):
            continue

        # Build alert message
        source = "PIN" if drop['type'] == 'PIN' else "Exchange"
        drop_pct_display = round(drop_pct * 100, 1)
        event_name = row.get('event_name', '')
        sport = row.get('sport', '')

        sport_emoji = {
            'basketball': '🏀', 'nba': '🏀',
            'soccer': '⚽', 'football': '⚽',
            'mma': '🥊', 'ufc': '🥊',
            'tennis': '🎾',
            'baseball': '⚾',
            'hockey': '🏒', 'nhl': '🏒',
            'rugby': '🏉',
            'cricket': '🏏',
        }.get(sport.lower(), '📉')

        msg = (
            f"{sport_emoji} <b>Steamer: {runner_name}</b>\n"
            f"Was: {drop['old']:.3f}  Now: {drop['new']:.3f}\n"
            f"\n"
            f"{event_name}\n"
            f"\n"
            f"{source} dropped {drop_pct_display}% in ~{STEAMER_WINDOW_TICKS * 5}s\n"
            f"Kick-off: {start_time_str}"
        )

        if send_telegram_message(msg):
            update_alert_history(runner_key, drop_pct, drop['old'], drop['new'])
            alerts_sent += 1
            logger.info(f"STEAMER ALERT: {runner_name} — {source} dropped {drop_pct_display}%")

    if alerts_sent > 0:
        logger.info(f"Sent {alerts_sent} steamer alerts.")
