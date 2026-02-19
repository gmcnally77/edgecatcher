import os
import time
import sqlite3
import requests
import logging
from datetime import datetime, timezone

# --- CONFIGURATION ---
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
ALERT_COOLDOWN_SECONDS = int(os.getenv("ALERT_COOLDOWN_SECONDS", "600"))

# --- DATABASE PATH FIX ---
# Force DB to be absolute so it doesn't get lost or hit permission errors
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "alerts.db")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - ALERTS - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- SQLITE DEDUPE STORE (used by arb_scanner) ---
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
def send_telegram_message(text, reply_markup=None):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return False

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = { "chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML" }
    if reply_markup:
        payload["reply_markup"] = reply_markup
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

    msg = (
        f"<b>EdgeCatcher Bot Status</b>\n"
        f"Alerts (1h): {count}\n"
        f"UTC: {datetime.now(timezone.utc).strftime('%H:%M:%S')}"
    )
    send_telegram_message(msg)
