"""
Test script for steamer price drop detection.
Simulates price ticks and verifies alerts fire correctly.

Run: python backend/test_steamer_alerts.py
"""
import time
import sys
import os

# Prevent actual Telegram sends and DB writes during tests
os.environ["TELEGRAM_BOT_TOKEN"] = ""
os.environ["TELEGRAM_CHAT_ID"] = ""

from telegram_alerts import (
    _price_history, check_price_drop, should_alert,
    STEAMER_DROP_PCT, STEAMER_WINDOW_TICKS,
    update_alert_history, get_last_alert, init_db, DB_FILE
)
from collections import deque

passed = 0
failed = 0

def test(name, condition):
    global passed, failed
    if condition:
        print(f"  PASS  {name}")
        passed += 1
    else:
        print(f"  FAIL  {name}")
        failed += 1

def reset_history():
    _price_history.clear()

def build_history(runner_key, ticks):
    """Build price history from list of (pin, mid) tuples, 5s apart."""
    _price_history[runner_key] = deque(maxlen=STEAMER_WINDOW_TICKS + 1)
    base_ts = time.time() - (len(ticks) * 5)
    for i, (pin, mid) in enumerate(ticks):
        _price_history[runner_key].append((base_ts + i * 5, pin, mid))


# ── Test 1: Not enough history ──
print("\n[1] Not enough history")
reset_history()
key = "test_market_TeamA"
_price_history[key] = deque(maxlen=7)
_price_history[key].append((time.time(), 2.10, 2.05))
result = check_price_drop(key, 2.00, 1.95)
test("Returns None with only 1 tick", result is None)


# ── Test 2: No drop (stable prices) ──
print("\n[2] Stable prices — no alert")
reset_history()
key = "test_market_TeamB"
ticks = [(2.10, 2.05)] * 7  # 7 identical ticks
build_history(key, ticks)
result = check_price_drop(key, 2.10, 2.05)
test("Returns None when prices stable", result is None)


# ── Test 3: PIN drops exactly 2% ──
print("\n[3] PIN drops exactly 2%")
reset_history()
key = "test_market_TeamC"
# Start at 2.10, end at 2.058 = 2% drop
old_pin = 2.100
new_pin = old_pin * (1 - STEAMER_DROP_PCT)  # exactly 2% lower
ticks = [(old_pin, 2.05)] * 6  # 6 ticks at old price
build_history(key, ticks)
result = check_price_drop(key, new_pin, 2.05)
test("Detects PIN drop at threshold", result is not None)
test("Type is PIN", result and result['type'] == 'PIN')
test("Old price correct", result and abs(result['old'] - old_pin) < 0.001)
test("New price correct", result and abs(result['new'] - new_pin) < 0.001)


# ── Test 4: PIN drops 3% (above threshold) ──
print("\n[4] PIN drops 3%")
reset_history()
key = "test_market_TeamD"
old_pin = 3.00
new_pin = 2.91  # 3% drop
ticks = [(old_pin, 2.95)] * 6
build_history(key, ticks)
result = check_price_drop(key, new_pin, 2.95)
test("Detects 3% PIN drop", result is not None)
test("Drop pct ~3%", result and abs(result['drop_pct'] - 0.03) < 0.002)


# ── Test 5: PIN drops only 1% (below threshold) ──
print("\n[5] PIN drops 1% — no alert")
reset_history()
key = "test_market_TeamE"
old_pin = 2.00
new_pin = 1.98  # 1% drop
ticks = [(old_pin, 1.95)] * 6
build_history(key, ticks)
result = check_price_drop(key, new_pin, 1.95)
test("No alert for 1% drop", result is None)


# ── Test 6: Exchange mid drops 2.5% ──
print("\n[6] Exchange mid drops 2.5%")
reset_history()
key = "test_market_TeamF"
old_mid = 4.00
new_mid = 3.90  # 2.5% drop
ticks = [(0, old_mid)] * 6  # PIN is 0 (no PIN price), only mid
build_history(key, ticks)
result = check_price_drop(key, 0, new_mid)
test("Detects exchange mid drop", result is not None)
test("Type is EX", result and result['type'] == 'EX')
test("Drop pct ~2.5%", result and abs(result['drop_pct'] - 0.025) < 0.002)


# ── Test 7: PIN drop takes priority over exchange drop ──
print("\n[7] Both PIN and EX drop — PIN fires first")
reset_history()
key = "test_market_TeamG"
old_pin, old_mid = 2.50, 2.45
new_pin = 2.50 * 0.96  # 4% PIN drop
new_mid = 2.45 * 0.97  # 3% EX drop
ticks = [(old_pin, old_mid)] * 6
build_history(key, ticks)
result = check_price_drop(key, new_pin, new_mid)
test("PIN fires when both drop", result is not None and result['type'] == 'PIN')


# ── Test 8: Price rise (not a drop) ──
print("\n[8] Price rises — no alert")
reset_history()
key = "test_market_TeamH"
ticks = [(2.00, 1.95)] * 6
build_history(key, ticks)
result = check_price_drop(key, 2.10, 2.05)  # price went UP
test("No alert on price rise", result is None)


# ── Test 9: Invalid prices (<=1.01) ignored ──
print("\n[9] Invalid prices ignored")
reset_history()
key = "test_market_TeamI"
ticks = [(1.00, 1.00)] * 6  # invalid
build_history(key, ticks)
result = check_price_drop(key, 0.95, 0.95)
test("No alert for sub-1.01 prices", result is None)


# ── Test 10: Dedup cooldown ──
print("\n[10] Dedup cooldown")
init_db()
# Use a unique key each run to avoid leftover DB state
key = f"test_dedup_{time.time()}"
# First alert should fire
test("First alert passes", should_alert(key, 0.03) == True)
# Simulate saving alert
update_alert_history(key, 0.03, 2.10, 2.04)
# Same drop within cooldown should NOT fire
test("Same drop within cooldown blocked", should_alert(key, 0.03) == False)
# Bigger drop within cooldown SHOULD fire
test("Bigger drop within cooldown passes", should_alert(key, 0.06) == True)


# ── Test 11: Gradual decline over window ──
print("\n[11] Gradual decline — 0.4% per tick × 6 intervals = ~2.4%")
reset_history()
key = "test_market_TeamJ"
base = 3.00
# Each tick drops ~0.4%, 7 ticks = 6 intervals = 2.4% total
ticks = [(base * (1 - 0.004 * i), 0) for i in range(7)]
build_history(key, ticks)
current_pin = ticks[-1][0]
result = check_price_drop(key, current_pin, 0)
test("Detects gradual decline over window", result is not None)
if result:
    test("Drop pct roughly 2.4%", result['drop_pct'] >= 0.02)


# ── Summary ──
print(f"\n{'='*40}")
print(f"Results: {passed} passed, {failed} failed")
if failed:
    print("SOME TESTS FAILED")
    sys.exit(1)
else:
    print("ALL TESTS PASSED")
    sys.exit(0)
