"""
Synthetic steamer alert test — fires a fake alert through the full
Telegram delivery path to verify message format and deeplink button.

Run locally:  export $(grep -v '^#' /etc/odds-fetcher.env | xargs) && python3 backend/test_steam_live.py
Run on prod:  export $(grep -v '^#' /etc/odds-fetcher.env | xargs) && python3 /opt/app/backend/test_steam_live.py
"""
import os
import sys
import time

# Sanity check
if not os.getenv("TELEGRAM_BOT_TOKEN") or not os.getenv("TELEGRAM_CHAT_ID"):
    print("ERROR: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set.")
    print("Run:  export $(grep -v '^#' /etc/odds-fetcher.env | xargs)")
    sys.exit(1)

from steamer_detector import (
    record_pin_price, record_bf_price,
    _pin_history, _bf_history, _last_alerted, _metadata_cache,
)

META_PIN = {
    'runner_name': 'Miami Heat',
    'event_name': 'Utah Jazz v Miami Heat',
    'sport': 'Basketball',
    'start_time': '2026-02-20T00:40:00Z',
    'paddy_link': 'https://www.paddypower.com/basketball/nba/utah-jazz-v-miami-heat-12345678',
}

META_BF = {
    'runner_name': 'Arsenal',
    'event_name': 'Arsenal v Chelsea',
    'sport': 'Soccer',
    'start_time': '2026-02-22T15:00:00Z',
    'paddy_link': 'https://www.paddypower.com/football/english-premier-league/arsenal-v-chelsea-87654321',
}

def clear():
    _pin_history.clear()
    _bf_history.clear()
    _last_alerted.clear()
    _metadata_cache.clear()

# --- Test 1: PIN steamer alert ---
print("\n[1] Firing synthetic PIN STEAM alert (2.00 → 1.85, +4.1pp)...")
clear()
row_id = "test_pin_synthetic"
now = time.time()
_pin_history[row_id] = [(now - 500, 2.00)]
_metadata_cache[row_id] = META_PIN
record_pin_price(row_id, 1.85, META_PIN)

if (row_id, 'PIN') in _last_alerted:
    print("  OK — PIN alert sent to Telegram")
else:
    print("  FAIL — PIN alert did not fire")

# --- Test 2: BF steamer alert ---
print("\n[2] Firing synthetic BF STEAM alert (3.00 → 2.60, +5.1pp)...")
clear()
row_id = "test_bf_synthetic"
now = time.time()
_bf_history[row_id] = [(now - 300, 3.00)]
_metadata_cache[row_id] = META_BF
record_bf_price(row_id, 2.60, META_BF)

if (row_id, 'BF') in _last_alerted:
    print("  OK — BF alert sent to Telegram")
else:
    print("  FAIL — BF alert did not fire")

print("\nCheck Telegram — you should see 2 alerts with PP deeplink buttons.")
