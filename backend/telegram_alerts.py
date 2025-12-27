import os
import time
import sqlite3
import requests
import logging
from datetime import datetime, timezone

# --- CONFIGURATION ---
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
ALERT_EDGE_THRESHOLD = float(os.getenv("ALERT_EDGE_THRESHOLD", "0.003"))
ALERT_COMMISSION = float(os.getenv("ALERT_COMMISSION", "0.02"))
ALERT_MIN_VOLUME = float(os.getenv("ALERT_MIN_VOLUME", "200.0"))
ALERT_COOLDOWN_SECONDS = int(os.getenv("ALERT_COOLDOWN_SECONDS", "600"))

# Guard: Only run logic if this mode is active
SCOPE_MODE = os.getenv("SCOPE_MODE", "NBA_PREMATCH_ML_STEAMERS")

# Local persistence for dedupe (Safe on Droplet)
DB_FILE = os.path.join(os.path.dirname(__file__), "alerts.db")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - ALERTS - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- SQLITE DEDUPE STORE ---
def init_db():
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

def update_alert_history(runner_key, edge, book_price, lay_price):
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        now = time.time()
        c.execute('''
            INSERT OR REPLACE INTO alert_history 
            (id, last_alert_time, last_edge, last_book_price, last_lay_price)
            VALUES (?, ?, ?, ?, ?)
        ''', (runner_key, now, edge, book_price, lay_price))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"DB Write Error: {e}")

# --- TELEGRAM BOT UTILS ---
def send_telegram_message(text):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        logger.warning("Telegram credentials missing. Skipping message.")
        return False
    
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "HTML"
    }
    try:
        r = requests.post(url, json=payload, timeout=5)
        return r.status_code == 200
    except Exception as e:
        logger.error(f"Telegram send failed: {e}")
        return False

def check_bot_commands():
    """
    Simple polling for /status. 
    """
    if not TELEGRAM_BOT_TOKEN:
        return

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates"
    try:
        # Short timeout to not block the main loop
        r = requests.get(url, params={"offset": -1, "timeout": 1}, timeout=3)
        data = r.json()
        
        if not data.get("ok"):
            return

        for result in data.get("result", []):
            update_id = result.get("update_id")
            msg = result.get("message", {})
            text = msg.get("text", "")
            chat_id = msg.get("chat", {}).get("id")
            
            # Security: Only reply to the Admin
            if str(chat_id) != str(TELEGRAM_CHAT_ID):
                continue

            if text.strip() == "/status":
                send_status_report()
                # Acknowledge update
                requests.get(url, params={"offset": update_id + 1})
    except Exception:
        pass 

def send_status_report():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    hour_ago = time.time() - 3600
    try:
        c.execute("SELECT count(*) FROM alert_history WHERE last_alert_time > ?", (hour_ago,))
        count = c.fetchone()[0]
    except:
        count = 0
    conn.close()

    msg = (
        f"<b>🤖 Independence Bot Status</b>\n"
        f"✅ Mode: {SCOPE_MODE}\n"
        f"📊 Alerts (1h): {count}\n"
        f"🕒 UTC: {datetime.now(timezone.utc).strftime('%H:%M:%S')}"
    )
    send_telegram_message(msg)

# --- CORE LOGIC ---
def calculate_edge(book_odds, lay_odds):
    if not book_odds or not lay_odds or book_odds <= 1.01 or lay_odds <= 1.01:
        return -1.0
    
    implied_back = 1.0 / book_odds
    # Formula: implied_lay_net = 1 / (lay_odds * (1 - commission))
    implied_lay_net = 1.0 / (lay_odds * (1.0 - ALERT_COMMISSION))
    
    edge = implied_lay_net - implied_back
    return edge

def should_alert(runner_key, edge, book_price, lay_price):
    last = get_last_alert(runner_key)
    
    if not last:
        return True # First alert
    
    _, last_ts, last_edge, last_book, last_lay = last
    
    # 1. Edge improves by +0.2%
    if edge >= (last_edge + 0.002):
        return True
        
    # 2. Cooldown expired (> 10 mins)
    if (time.time() - last_ts) > ALERT_COOLDOWN_SECONDS:
        return True
        
    # 3. Price moved significantly (>= 0.03)
    if abs(book_price - last_book) >= 0.03 or abs(lay_price - last_lay) >= 0.03:
        return True
        
    return False

def run_alert_cycle(supabase_client):
    """
    Main entry point called by fetch_universal.py
    """
    init_db()
    check_bot_commands()

    # Fetch OPEN, Not In Play markets
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

    alerts_sent = 0

    for row in rows:
        # Liquidity Filter
        vol = row.get('volume')
        if vol is None or vol < ALERT_MIN_VOLUME:
            continue

        # Time Filter (Pre-match only)
        start_time_str = row.get('start_time')
        if start_time_str:
            try:
                # Handle ISO 8601 string
                start_dt = datetime.fromisoformat(start_time_str.replace("Z", "+00:00"))
                if datetime.now(timezone.utc) >= start_dt:
                    continue 
            except:
                pass 

        # Price Logic
        # Note: In your DB, 'price_bet365' is populated with Ladbrokes data per your config comment
        p_paddy = float(row.get('price_paddy') or 0)
        p_ladbrokes = float(row.get('price_bet365') or 0) 
        
        book_price = max(p_paddy, p_ladbrokes)
        lay_price = float(row.get('lay_price') or 0)

        # Edge Calc
        edge = calculate_edge(book_price, lay_price)
        
        if edge >= ALERT_EDGE_THRESHOLD:
            m_id = row.get('market_id', 'uid')
            sel_id = row.get('selection_id', 'sid')
            runner_key = f"{m_id}_{sel_id}"
            
            if should_alert(runner_key, edge, book_price, lay_price):
                runner_name = row.get('runner_name', 'Unknown')
                bookie_name = "PaddyPower" if p_paddy >= p_ladbrokes else "Ladbrokes"
                edge_pct = round(edge * 100, 2)
                
                msg = (
                    f"🔥 <b>NBA STEAMER: {runner_name}</b>\n\n"
                    f"🚀 <b>Edge: +{edge_pct}%</b>\n"
                    f"🏦 {bookie_name}: <b>{book_price}</b>\n"
                    f"🔄 Exchange Lay: <b>{lay_price}</b>\n"
                    f"💰 Vol: £{int(vol)}\n"
                    f"⏰ {start_time_str}"
                )
                
                if send_telegram_message(msg):
                    update_alert_history(runner_key, edge, book_price, lay_price)
                    alerts_sent += 1

    if alerts_sent > 0:
        logger.info(f"Sent {alerts_sent} alerts.")