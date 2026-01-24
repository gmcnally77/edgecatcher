import os
import sys
import logging
from datetime import datetime, timezone

# 1. SETUP: Fake Environment Variables
os.environ["TELEGRAM_BOT_TOKEN"] = "FAKE_TOKEN"
os.environ["TELEGRAM_CHAT_ID"] = "FAKE_ID"
os.environ["ALERT_EDGE_THRESHOLD"] = "0.003"
os.environ["ALERT_MIN_VOLUME"] = "200"
os.environ["ALERT_MIN_PRICE_ADVANTAGE"] = "0.02"  # 2%
os.environ["ALERT_MAX_SPREAD"] = "0.04"           # 4%

# 2. IMPORT engine
import telegram_alerts

# 3. MOCK: Fake Supabase
class MockSupabase:
    def __init__(self, rows):
        self.rows = rows
    def table(self, _): return self
    def select(self, _): return self
    def eq(self, _, __): return self
    def execute(self):
        return type('obj', (object,), {'data': self.rows})

# 4. MOCK: Intercept Telegram & Memory
mock_sent_messages = []
def mock_send_telegram(text):
    mock_sent_messages.append(text)
    return True

# Apply Mocks
telegram_alerts.send_telegram_message = mock_send_telegram
telegram_alerts.update_alert_history = lambda a,b,c,d: None 
telegram_alerts.get_last_alert = lambda key: None # <--- CRITICAL: Always say "Fresh Alert"

# --- THE TEST DATA (UPDATED WITH FUTURE DATES) ---
# We use 2026 to ensure "now < start_time" is always True
future_date = "2026-01-01T00:00:00Z"

test_scenarios = [
    {
        # SCENARIO 1: TRUE STEAMER (Should Fire)
        "market_id": "TEST_1", "selection_id": "1", "runner_name": "✅ True Steamer (Lakers)",
        "market_status": "OPEN", "in_play": "false", "volume": 5000,
        "price_paddy": 2.55, "price_bet365": 2.50, # Book = 2.55
        "back_price": 2.38, "lay_price": 2.40,     # Lay = 2.40 (Spread 0.8% - OK)
        "start_time": future_date                  # FUTURE DATE
    },
    {
        # SCENARIO 2: WEAK PRICE (Should Fail)
        "market_id": "TEST_2", "selection_id": "2", "runner_name": "❌ Weak Price (Cavs)",
        "market_status": "OPEN", "in_play": "false", "volume": 5000,
        "price_paddy": 2.55, "price_bet365": 2.50, 
        "back_price": 2.56, "lay_price": 2.58,     # Book (2.55) < Lay (2.58) -> FAIL
        "start_time": future_date
    },
    {
        # SCENARIO 3: LOOSE MARKET (Should Fail)
        "market_id": "TEST_3", "selection_id": "3", "runner_name": "❌ Loose Market (Spurs)",
        "market_status": "OPEN", "in_play": "false", "volume": 5000,
        "price_paddy": 3.00, "price_bet365": 2.50, 
        "back_price": 2.00, "lay_price": 2.50,     # Spread 25% -> FAIL
        "start_time": future_date
    }
]

# --- RUN TEST ---
print("\n🧪 STARTING STEAMER LOGIC TEST...\n")
mock_db = MockSupabase(test_scenarios)
telegram_alerts.run_alert_cycle(mock_db)

# --- VERIFY ---
print("-" * 30)
print(f"📊 ALERTS SENT: {len(mock_sent_messages)}")
print("-" * 30)

failed = False

if any("True Steamer" in msg for msg in mock_sent_messages):
    print("✅ PASS: True Steamer was detected.")
else:
    print("❌ FAIL: True Steamer was MISSED.")
    failed = True

if any("Weak Price" in msg for msg in mock_sent_messages):
    print("❌ FAIL: Weak Price triggered an alert!")
    failed = True
else:
    print("✅ PASS: Weak Price was correctly ignored.")

if any("Loose Market" in msg for msg in mock_sent_messages):
    print("❌ FAIL: Loose Market triggered an alert!")
    failed = True
else:
    print("✅ PASS: Loose Market was correctly ignored.")

print("\n" + "="*30)
if failed:
    print("🔴 TEST FAILED")
else:
    print("🟢 TEST PASSED: Logic is solid.")
print("="*30 + "\n")