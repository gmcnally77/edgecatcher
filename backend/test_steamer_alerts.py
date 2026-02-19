"""
Test script for steamer_detector module.
Tests implied probability math, threshold detection, cooldown/dedup logic.

Run: python backend/test_steamer_alerts.py
"""
import time
import sys
import os

# Prevent actual Telegram sends during tests
os.environ["TELEGRAM_BOT_TOKEN"] = ""
os.environ["TELEGRAM_CHAT_ID"] = ""

from steamer_detector import (
    implied_prob, _trim_history, _trim_bf_history, _check_and_alert, _maybe_alert,
    _pin_history, _bf_history, _last_alerted, _metadata_cache,
    record_pin_price, record_bf_price,
    _format_volume, _build_exchange_link,
    STEAM_THRESHOLD, STEAM_COOLDOWN, STEAM_REALERT_INCREMENT,
    STEAM_WINDOW,
)

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

def reset():
    _pin_history.clear()
    _bf_history.clear()
    _last_alerted.clear()
    _metadata_cache.clear()

META = {
    'runner_name': 'TestRunner',
    'event_name': 'TeamA v TeamB',
    'sport': 'Basketball',
    'start_time': '2026-02-20T00:40:00Z',
    'paddy_link': None,
}

META_BF = {
    'runner_name': 'TestRunner',
    'event_name': 'TeamA v TeamB',
    'sport': 'Soccer',
    'start_time': '2026-02-20T00:40:00Z',
    'paddy_link': None,
    'volume': 5000,
    'market_id': '1.234567890',
}


# ── Test 1: Implied probability math ──
print("\n[1] Implied probability")
test("1/2.00 = 0.50", abs(implied_prob(2.00) - 0.50) < 0.0001)
test("1/1.50 = 0.6667", abs(implied_prob(1.50) - 0.6667) < 0.001)
test("1/4.00 = 0.25", abs(implied_prob(4.00) - 0.25) < 0.0001)
test("1/1.00 = 0 (edge case)", implied_prob(1.00) == 0.0)
test("1/0.50 = 0 (invalid)", implied_prob(0.50) == 0.0)


# ── Test 2: 2.00 → 1.85 = 4.1pp shift (above 3pp threshold) ──
print("\n[2] PIN: 2.00 → 1.85 fires alert")
reset()
row_id = "test_row_1"
# Simulate old price 15 min ago
now = time.time()
_pin_history[row_id] = [(now - 500, 2.00)]
_metadata_cache[row_id] = META
# Record new price — should detect shift
record_pin_price(row_id, 1.85, META)
test("Alert was sent (dedup entry created)", (row_id, 'PIN') in _last_alerted)
shift = _last_alerted[(row_id, 'PIN')]['shift_pp']
test(f"Shift ~4.1pp (got {shift*100:.1f}pp)", abs(shift - 0.041) < 0.002)


# ── Test 3: Small move below threshold ──
print("\n[3] PIN: 2.00 → 1.95 does NOT fire (1.3pp < 3pp)")
reset()
row_id = "test_row_2"
now = time.time()
_pin_history[row_id] = [(now - 500, 2.00)]
_metadata_cache[row_id] = META
record_pin_price(row_id, 1.95, META)
test("No alert for small move", (row_id, 'PIN') not in _last_alerted)


# ── Test 4: BF detection works (with volume) ──
print("\n[4] BF: 3.00 → 2.60 fires alert")
reset()
row_id = "test_row_3"
now = time.time()
_bf_history[row_id] = [(now - 300, 3.00, 10000)]
_metadata_cache[row_id] = META_BF
meta_with_more_vol = dict(META_BF, volume=22000)
record_bf_price(row_id, 2.60, meta_with_more_vol)
test("BF alert fired", (row_id, 'BF') in _last_alerted)
shift = _last_alerted[(row_id, 'BF')]['shift_pp']
expected = implied_prob(2.60) - implied_prob(3.00)  # 0.385 - 0.333 = 0.052
test(f"Shift ~5.2pp (got {shift*100:.1f}pp)", abs(shift - expected) < 0.002)


# ── Test 5: Cooldown blocks re-alert ──
print("\n[5] Cooldown blocks duplicate alert")
reset()
row_id = "test_row_4"
now = time.time()
# First alert
_pin_history[row_id] = [(now - 500, 2.00)]
_metadata_cache[row_id] = META
record_pin_price(row_id, 1.85, META)
test("First alert fires", (row_id, 'PIN') in _last_alerted)
first_ts = _last_alerted[(row_id, 'PIN')]['ts']

# Same-ish move again — should be blocked by cooldown
record_pin_price(row_id, 1.84, META)
test("Second alert blocked (same shift)", _last_alerted[(row_id, 'PIN')]['ts'] == first_ts)


# ── Test 6: Re-alert when move extends past increment ──
print("\n[6] Re-alert when move extends by REALERT_INCREMENT")
reset()
row_id = "test_row_5"
now = time.time()
# First alert: 2.00 → 1.85 = 4.1pp
_pin_history[row_id] = [(now - 500, 2.00)]
_metadata_cache[row_id] = META
record_pin_price(row_id, 1.85, META)
first_shift = _last_alerted[(row_id, 'PIN')]['shift_pp']
first_ts = _last_alerted[(row_id, 'PIN')]['ts']

# Extended move: needs first_shift + REALERT_INCREMENT (0.041 + 0.02 = 0.061)
# 2.00 → 1.62 gives shift ~0.068 (prob: 0.5 → 0.617)
record_pin_price(row_id, 1.62, META)
test("Re-alert fires on extended move", _last_alerted[(row_id, 'PIN')]['ts'] > first_ts)
test("New shift is larger", _last_alerted[(row_id, 'PIN')]['shift_pp'] > first_shift)


# ── Test 7: Expired cooldown allows re-alert ──
print("\n[7] Expired cooldown allows re-alert")
reset()
row_id = "test_row_6"
now = time.time()
# Simulate an old alert beyond cooldown
_last_alerted[(row_id, 'PIN')] = {'ts': now - STEAM_COOLDOWN - 1, 'shift_pp': 0.04}
_pin_history[row_id] = [(now - 500, 2.00)]
_metadata_cache[row_id] = META
record_pin_price(row_id, 1.85, META)
test("Alert fires after cooldown expired", _last_alerted[(row_id, 'PIN')]['ts'] > now - 10)


# ── Test 8: Prices outside min/max range ignored ──
print("\n[8] Prices outside range ignored")
reset()
row_id = "test_row_7"
# Price below STEAM_MIN_PRICE (1.10)
record_pin_price(row_id, 1.05, META)
test("Sub-1.10 price ignored", row_id not in _pin_history)

# Price above STEAM_MAX_PRICE (10.0)
record_pin_price(row_id, 12.00, META)
test("Over-10.0 price ignored", row_id not in _pin_history)


# ── Test 9: History trimming (anchor preservation) ──
print("\n[9] History trimming (PIN 2-tuple)")
now = time.time()
history = [
    (now - STEAM_WINDOW - 200, 2.55),  # old stale — trimmed
    (now - STEAM_WINDOW - 100, 2.50),  # most recent pre-window — kept as anchor
    (now - STEAM_WINDOW + 10, 2.45),   # within window
    (now - 10, 2.40),                   # recent
]
trimmed = _trim_history(history, now)
test("Keeps anchor + in-window entries", len(trimmed) == 3)
test("Anchor is most recent pre-window", trimmed[0][1] == 2.50)
test("In-window entries preserved", trimmed[1][1] == 2.45 and trimmed[2][1] == 2.40)

# All entries stale — keep newest as anchor
history_all_stale = [
    (now - STEAM_WINDOW - 300, 2.00),
    (now - STEAM_WINDOW - 100, 1.95),
]
trimmed_stale = _trim_history(history_all_stale, now)
test("All stale: keeps newest as anchor", len(trimmed_stale) == 1 and trimmed_stale[0][1] == 1.95)


# ── Test 9b: BF history trimming (3-tuple) ──
print("\n[9b] BF history trimming (3-tuple)")
now = time.time()
bf_hist = [
    (now - STEAM_WINDOW - 200, 2.55, 1000),
    (now - STEAM_WINDOW - 100, 2.50, 2000),
    (now - STEAM_WINDOW + 10, 2.45, 3000),
    (now - 10, 2.40, 5000),
]
trimmed_bf = _trim_bf_history(bf_hist, now)
test("BF: keeps anchor + in-window entries", len(trimmed_bf) == 3)
test("BF: anchor has volume", trimmed_bf[0] == (bf_hist[1][0], 2.50, 2000))
test("BF: in-window entries preserved", trimmed_bf[1][2] == 3000 and trimmed_bf[2][2] == 5000)


# ── Test 10: Not enough history (single point) ──
print("\n[10] Not enough history — no alert")
reset()
row_id = "test_row_8"
record_pin_price(row_id, 1.85, META)
test("No alert with single data point", (row_id, 'PIN') not in _last_alerted)


# ── Test 11: Price lengthening (drift) does NOT alert ──
print("\n[11] Price lengthening (drift) does NOT alert")
reset()
row_id = "test_row_9"
now = time.time()
_pin_history[row_id] = [(now - 500, 1.85)]
_metadata_cache[row_id] = META
record_pin_price(row_id, 2.00, META)  # odds lengthened
test("No alert on drift (shortening only)", (row_id, 'PIN') not in _last_alerted)


# ── Test 12: Gradual shortening over multiple ticks ──
print("\n[12] Gradual shortening: 3.00 → 2.70 over 10 min")
reset()
row_id = "test_row_10"
now = time.time()
# Build gradual decline: 3.00, 2.95, 2.90, 2.85, 2.80, 2.75, 2.70
# prob shift: 1/3.00=0.333 → 1/2.70=0.370 = 3.7pp
prices = [3.00, 2.95, 2.90, 2.85, 2.80, 2.75, 2.70]
for i, p in enumerate(prices[:-1]):
    _pin_history.setdefault(row_id, []).append((now - 600 + i * 100, p))
_metadata_cache[row_id] = META
record_pin_price(row_id, 2.70, META)
test("Gradual 3.7pp move detected", (row_id, 'PIN') in _last_alerted)
shift = _last_alerted[(row_id, 'PIN')]['shift_pp']
test(f"Shift ~3.7pp (got {shift*100:.1f}pp)", abs(shift - 0.037) < 0.003)


# ── Test 13: Cleanup removes stale entries ──
print("\n[13] Cleanup purges finished events")
reset()
_pin_history['active_row'] = [(time.time(), 2.00)]
_pin_history['stale_row'] = [(time.time(), 2.00)]
_bf_history['stale_row'] = [(time.time(), 2.00, 5000)]
_metadata_cache['active_row'] = META
_metadata_cache['stale_row'] = META
_last_alerted[('stale_row', 'PIN')] = {'ts': time.time(), 'shift_pp': 0.04}

# Mock fetch_universal._cached_active_rows
import types
mock_fu = types.ModuleType('fetch_universal')
mock_fu._cached_active_rows = [{'id': 'active_row'}]
sys.modules['fetch_universal'] = mock_fu

from steamer_detector import cleanup_finished_events
cleanup_finished_events()

test("Active row kept in _pin_history", 'active_row' in _pin_history)
test("Stale row removed from _pin_history", 'stale_row' not in _pin_history)
test("Stale row removed from _bf_history", 'stale_row' not in _bf_history)
test("Stale dedup entry removed", ('stale_row', 'PIN') not in _last_alerted)

# Clean up mock
del sys.modules['fetch_universal']


# ── Test 14: Volume delta calculation ──
print("\n[14] Volume delta in BF steamer")
reset()
row_id = "test_row_vol"
now = time.time()
# Seed history with initial volume
_bf_history[row_id] = [(now - 500, 3.00, 50000)]
_metadata_cache[row_id] = dict(META_BF, volume=62450)
record_bf_price(row_id, 2.60, dict(META_BF, volume=62450))
test("BF volume alert fired", (row_id, 'BF') in _last_alerted)
# Volume delta = 62450 - 50000 = 12450
bf_hist = _bf_history[row_id]
vol_delta = bf_hist[-1][2] - bf_hist[0][2]
test(f"Volume delta = 12450 (got {vol_delta})", vol_delta == 12450)


# ── Test 15: Exchange link builder ──
print("\n[15] Exchange link builder")
link = _build_exchange_link({'market_id': '1.234567890', 'sport': 'Soccer'})
test("Soccer → football slug", link == 'https://www.betfair.com/exchange/plus/football/market/1.234567890')

link_bb = _build_exchange_link({'market_id': '1.111', 'sport': 'Basketball'})
test("Basketball slug", link_bb == 'https://www.betfair.com/exchange/plus/basketball/market/1.111')

link_none = _build_exchange_link({'market_id': '', 'sport': 'Soccer'})
test("No market_id → None", link_none is None)


# ── Test 16: Volume formatting ──
print("\n[16] Volume formatting")
test("£12,450 format", _format_volume(12450) == '\u00a312,450')
test("£500 format (small)", _format_volume(500) == '\u00a3500')
test("£1,234,567 format (large)", _format_volume(1234567) == '\u00a31,234,567')


# ── Summary ──
print(f"\n{'='*40}")
print(f"Results: {passed} passed, {failed} failed")
if failed:
    print("SOME TESTS FAILED")
    sys.exit(1)
else:
    print("ALL TESTS PASSED")
    sys.exit(0)
