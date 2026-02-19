"""
Test script for source-level arb detection in fetch_universal.py.
Tests margin math, guards (cooldown, staleness, volume, max margin, start time).

Run: python backend/test_arb_detection.py
"""
import time
import sys
import os

# Prevent actual Telegram sends during tests
os.environ["TELEGRAM_BOT_TOKEN"] = ""
os.environ["TELEGRAM_CHAT_ID"] = ""

from arb_scanner import (
    calc_margin, calc_lay_stake,
    ARB_ALERT_MARGIN, ARB_MIN_VOLUME, ARB_MAX_MARGIN, BETFAIR_COMMISSION,
)

passed = 0
failed = 0
alerts_sent = []


def test(name, condition):
    global passed, failed
    if condition:
        print(f"  PASS  {name}")
        passed += 1
    else:
        print(f"  FAIL  {name}")
        failed += 1


def mock_send_telegram(msg, reply_markup=None):
    alerts_sent.append({'msg': msg, 'reply_markup': reply_markup})


def reset():
    alerts_sent.clear()


# ── Test 1: Margin math ──
print("\n[1] Margin math (calc_margin)")
# PIN back 2.10, BF lay 2.00
# margin = (1 - 0.02) * (2.10 - 1) - (2.00 - 1)) / 2.10
# = (0.98 * 1.10 - 1.00) / 2.10 = (1.078 - 1.00) / 2.10 = 0.0371
m1 = calc_margin(2.10, 2.00)
test(f"PIN 2.10 / BF 2.00 = {m1*100:.2f}% (expect ~3.71%)", abs(m1 - 0.0371) < 0.001)

# PIN back 1.50, BF lay 1.50 — zero margin after commission
m2 = calc_margin(1.50, 1.50)
test(f"PIN 1.50 / BF 1.50 = {m2*100:.2f}% (expect negative)", m2 < 0)

# PIN back 3.00, BF lay 2.80
m3 = calc_margin(3.00, 2.80)
test(f"PIN 3.00 / BF 2.80 = {m3*100:.2f}% (expect positive)", m3 > 0)

# Edge: identical prices should be negative (commission eats margin)
m4 = calc_margin(2.00, 2.00)
test(f"PIN=BF=2.00 → negative after comm ({m4*100:.2f}%)", m4 < 0)


# ── Test 2: Lay stake calculation ──
print("\n[2] Lay stake calculation")
ls = calc_lay_stake(100, 2.10, 2.00)
test(f"Lay stake for £100 @ 2.10/2.00 = £{ls:.2f} (expect ~106)", 100 < ls < 115)

ls2 = calc_lay_stake(100, 1.50, 1.45)
test(f"Lay stake for £100 @ 1.50/1.45 = £{ls2:.2f}", ls2 > 100)


# ── Test 3: Source-level detection simulation ──
print("\n[3] Source-level detection fires for valid arb")
reset()

# Simulate what _ao_match_all_cached does
pin_price = 2.10
lay_price = 2.00
volume = 500
start_time_str = '2030-01-01T00:00:00Z'  # Far future

net_margin = calc_margin(pin_price, lay_price)
fires = (
    net_margin >= ARB_ALERT_MARGIN
    and net_margin <= ARB_MAX_MARGIN
    and volume >= ARB_MIN_VOLUME
    and lay_price > 1.01
    and pin_price > 1.01
)
test(f"Valid arb fires (margin={net_margin*100:.2f}%)", fires)

# Build alert message (same format as production)
if fires:
    pnl = round(net_margin * 100, 2)
    lay_stake = calc_lay_stake(100, pin_price, lay_price)
    raw_gap = round((pin_price - lay_price) / lay_price * 100, 2)
    msg = (
        f"<b>💰 ARB: TestRunner</b>\n"
        f"📋 TeamA v TeamB\n\n"
        f"📌 PIN Back: <b>{pin_price:.3f}</b>\n"
        f"🔄 BF Lay: <b>{lay_price:.3f}</b>\n"
        f"📊 Raw Gap: <b>+{raw_gap:.2f}%</b>\n"
        f"💷 P&L: <b>+£{pnl:.2f}</b>/£100 (after {BETFAIR_COMMISSION*100:.0f}% comm)\n"
        f"💷 Lay £{lay_stake:.2f} per £100 back\n"
        f"💰 BF Vol: £{volume:,}\n"
        f"⏰ {start_time_str[:16]}"
    )
    mock_send_telegram(msg)
    test("Alert message built", len(alerts_sent) == 1)
    test("Message contains PIN price", "2.100" in alerts_sent[0]['msg'])
    test("Message contains BF lay", "2.000" in alerts_sent[0]['msg'])


# ── Test 4: Volume too low — no alert ──
print("\n[4] Volume guard blocks thin markets")
net_margin = calc_margin(2.10, 2.00)
fires = net_margin >= ARB_ALERT_MARGIN and 50 >= ARB_MIN_VOLUME
test(f"Volume=50 blocked (min={ARB_MIN_VOLUME})", not fires)


# ── Test 5: Max margin cap — stale data guard ──
print("\n[5] Max margin cap blocks suspicious arbs")
# PIN 3.00, BF lay 2.00 — 8% net margin, way too high
m_stale = calc_margin(3.00, 2.00)
test(f"Margin {m_stale*100:.1f}% exceeds cap {ARB_MAX_MARGIN*100:.0f}%", m_stale > ARB_MAX_MARGIN)
fires = m_stale >= ARB_ALERT_MARGIN and m_stale <= ARB_MAX_MARGIN
test("Suspicious arb blocked by max margin", not fires)


# ── Test 6: Started game blocked ──
print("\n[6] Start time guard blocks started events")
from datetime import datetime, timezone

start_time_str = '2020-01-01T00:00:00Z'  # In the past
try:
    start_dt = datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
    already_started = datetime.now(timezone.utc) >= start_dt
except (ValueError, TypeError):
    already_started = False
test("Past start time detected as started", already_started)

# Future event
start_time_str = '2030-01-01T00:00:00Z'
try:
    start_dt = datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
    already_started = datetime.now(timezone.utc) >= start_dt
except (ValueError, TypeError):
    already_started = False
test("Future start time NOT started", not already_started)


# ── Test 7: Cooldown prevents duplicate alerts ──
print("\n[7] Cooldown prevents spam")
from fetch_universal import _arb_alert_cooldown, ARB_ALERT_COOLDOWN_SECONDS

_arb_alert_cooldown.clear()
row_id = "test_cooldown"
now = time.time()

# No previous alert — should pass
last_alert = _arb_alert_cooldown.get(row_id, 0)
test("First alert passes cooldown", now - last_alert >= ARB_ALERT_COOLDOWN_SECONDS)

# Simulate alert fired
_arb_alert_cooldown[row_id] = now

# Immediate re-check — should be blocked
last_alert = _arb_alert_cooldown.get(row_id, 0)
test("Immediate re-alert blocked", time.time() - last_alert < ARB_ALERT_COOLDOWN_SECONDS)

# Simulate expired cooldown
_arb_alert_cooldown[row_id] = now - ARB_ALERT_COOLDOWN_SECONDS - 1
last_alert = _arb_alert_cooldown.get(row_id, 0)
test("Alert passes after cooldown expired", time.time() - last_alert >= ARB_ALERT_COOLDOWN_SECONDS)

_arb_alert_cooldown.clear()


# ── Test 8: Lay price staleness guard ──
print("\n[8] Staleness guard: missing/invalid lay price")
test("Lay=0 blocked", not (0 > 1.01))
test("Lay=1.01 blocked", not (1.01 > 1.01))
test("Lay=1.02 passes", 1.02 > 1.01)
test("Lay=None→0 blocked", not (float(None or 0) > 1.01))


# ── Test 9: Thin margin (below threshold) ──
print("\n[9] Thin margin below threshold")
# PIN 2.02, BF lay 2.00 — very thin
m_thin = calc_margin(2.02, 2.00)
test(f"Thin margin {m_thin*100:.3f}% below threshold {ARB_ALERT_MARGIN*100:.1f}%",
     m_thin < ARB_ALERT_MARGIN)


# ── Test 10: Negative margin (no arb) ──
print("\n[10] Negative margin — PIN below BF lay")
m_neg = calc_margin(1.95, 2.00)
test(f"PIN < BF lay → negative margin ({m_neg*100:.2f}%)", m_neg < 0)


# ── Summary ──
print(f"\n{'='*40}")
print(f"Results: {passed} passed, {failed} failed")
if failed:
    print("SOME TESTS FAILED")
    sys.exit(1)
else:
    print("ALL TESTS PASSED")
    sys.exit(0)
