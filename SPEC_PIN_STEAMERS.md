# Spec: PIN Price Move Detection (Steamers)

## Concept

Detect when Pinnacle prices move significantly over a short window and send real-time Telegram alerts. PIN moves first — soft books (Ladbrokes, Paddy Power, Bet365, etc.) lag behind. Catching a PIN steam early gives a window to bet at stale soft-book prices before they adjust.

## Why This Matters

- Pinnacle is the sharpest book in the market. When PIN moves, it's signal, not noise.
- Other bookmakers typically take 5-30 minutes to react to PIN moves.
- The dashboard already has PIN prices updating every ~10s via AsianOdds.
- No new data sources needed — just analysis of data already flowing through the system.

## The Maths

### Measuring "Significant"

Raw odds change is misleading — a 0.05 move at 1.40 is far more meaningful than at 5.00. Use **implied probability shift** to normalise:

```
implied_prob = 1 / decimal_odds
shift = abs(prob_now - prob_before) * 100   # in percentage points
```

| PIN Move | Implied Prob Change | Signal Strength |
|----------|-------------------|-----------------|
| 2.00 → 1.85 | 50.0% → 54.1% = **4.1pp** | Strong |
| 1.50 → 1.45 | 66.7% → 69.0% = **2.3pp** | Moderate |
| 3.00 → 2.70 | 33.3% → 37.0% = **3.7pp** | Strong |
| 1.40 → 1.35 | 71.4% → 74.1% = **2.7pp** | Moderate |
| 5.00 → 4.50 | 20.0% → 22.2% = **2.2pp** | Moderate |
| 1.80 → 1.65 | 55.6% → 60.6% = **5.1pp** | Very strong |

**Default threshold: 3 percentage points** over a 15-minute window.

### Direction Matters

A steamer is a price **shortening** (odds dropping, probability rising) — money coming in. Report the direction:
- **STEAMING IN**: Odds shortened (1.80 → 1.65). Liability side getting backed hard.
- **DRIFTING OUT**: Odds lengthened (1.80 → 2.00). Money moving away.

Both are actionable — steamers for backing at soft books, drifters for laying.

## Data Available

Already in the system, no new feeds needed:

| Data | Source | Update Cadence |
|------|--------|---------------|
| `price_pinnacle` | AsianOdds (AO) | ~10s (Today), ~5s (Live) |
| `runner_name` | Betfair | Static |
| `event_name` | Betfair | Static |
| `start_time` | Betfair | Static |
| `sport` | Config | Static |

The only new thing needed is **in-memory price history** — a rolling window of recent PIN prices per runner.

## Design

### Price History Store

```python
# In-memory rolling window per market_feed row
# Key: market_feed_id, Value: list of (timestamp, price) tuples
_pin_history = {}   # {row_id: [(ts, price), (ts, price), ...]}

STEAM_WINDOW = int(os.getenv('STEAM_WINDOW', '900'))          # 15 min lookback
STEAM_THRESHOLD = float(os.getenv('STEAM_THRESHOLD', '0.03')) # 3pp implied prob shift
STEAM_MIN_PRICE = float(os.getenv('STEAM_MIN_PRICE', '1.10')) # Ignore < 1.10
STEAM_MAX_PRICE = float(os.getenv('STEAM_MAX_PRICE', '10.0')) # Ignore > 10.0
```

### Core Logic

On every main loop tick (~5s):

```python
def check_steamers(supabase_client):
    """Check for significant PIN price moves over the rolling window."""
    rows = supabase_client.table('market_feed') \
        .select('id,sport,event_name,runner_name,price_pinnacle,start_time,last_updated') \
        .neq('market_status', 'CLOSED') \
        .not_.is_('price_pinnacle', 'null') \
        .execute()

    now = time.time()
    alerts = []

    for row in rows.data or []:
        row_id = row['id']
        price = float(row.get('price_pinnacle') or 0)
        if price < STEAM_MIN_PRICE or price > STEAM_MAX_PRICE:
            continue

        # Append to history
        if row_id not in _pin_history:
            _pin_history[row_id] = []
        _pin_history[row_id].append((now, price))

        # Trim history to window
        cutoff = now - STEAM_WINDOW
        _pin_history[row_id] = [(t, p) for t, p in _pin_history[row_id] if t >= cutoff]

        # Need at least 2 data points
        history = _pin_history[row_id]
        if len(history) < 2:
            continue

        # Compare current price to oldest in window
        oldest_price = history[0][1]
        prob_now = 1 / price
        prob_then = 1 / oldest_price
        shift = prob_now - prob_then  # Positive = steaming in (odds shortened)

        if abs(shift) >= STEAM_THRESHOLD:
            direction = 'STEAMING' if shift > 0 else 'DRIFTING'
            alerts.append({
                'id': row_id,
                'sport': row.get('sport', '?'),
                'event': row.get('event_name', '?'),
                'runner': row.get('runner_name', '?'),
                'price_now': price,
                'price_before': oldest_price,
                'shift_pp': round(shift * 100, 1),
                'direction': direction,
                'window_seconds': int(now - history[0][0]),
                'start_time': row.get('start_time', ''),
            })

    return alerts
```

### Alert Deduplication

Don't spam the same steam repeatedly:

```python
_alerted_steams = {}  # row_id -> last_alert_timestamp

# Only alert once per runner per 30 minutes
STEAM_COOLDOWN = 1800

if row_id not in _alerted_steams or (now - _alerted_steams[row_id]) > STEAM_COOLDOWN:
    send_alert(...)
    _alerted_steams[row_id] = now
```

### Telegram Alert Format

```
STEAM: Miami Heat ⬆️
Utah Jazz @ Miami Heat

PIN: 1.80 → 1.65 (shortening)
Shift: +5.1pp in 12 mins
Implied: 55.6% → 60.6%
Start: 2026-02-10 00:40
```

For drifters:
```
DRIFT: Utah Jazz ⬇️
Utah Jazz @ Miami Heat

PIN: 3.50 → 4.00 (lengthening)
Shift: -3.6pp in 8 mins
Implied: 28.6% → 25.0%
Start: 2026-02-10 00:40
```

### Where It Runs

Add `check_steamers()` to the main loop alongside `run_arb_scan()`. Same tick cadence (~5s). Lightweight — single DB read, in-memory comparison, no API calls.

```python
# In main loop:
run_arb_scan(supabase)    # Existing
check_steamers(supabase)  # New — same tick
```

### Memory Cleanup

Purge history for rows whose `start_time` has passed (game started/finished) to prevent unbounded memory growth:

```python
# Periodic cleanup (every 5 minutes)
for row_id in list(_pin_history.keys()):
    if row_id not in current_row_ids:
        del _pin_history[row_id]
```

## What Gets Built

| Component | File | Effort |
|-----------|------|--------|
| `check_steamers()` function | `arb_scanner.py` (or new `steamer_scanner.py`) | ~60 lines |
| Price history store + cleanup | Same file | ~20 lines |
| Telegram alert with dedup | Same file | ~30 lines |
| Main loop integration | `fetch_universal.py` | 1 line |
| SQLite logging (optional) | Same file | ~30 lines |

Total: ~140 lines. No new dependencies, no new data sources, no schema changes.

## Configuration

```python
STEAM_WINDOW = int(os.getenv('STEAM_WINDOW', '900'))          # 15 min lookback (seconds)
STEAM_THRESHOLD = float(os.getenv('STEAM_THRESHOLD', '0.03')) # 3pp shift to alert
STEAM_COOLDOWN = int(os.getenv('STEAM_COOLDOWN', '1800'))     # 30 min between alerts per runner
STEAM_MIN_PRICE = float(os.getenv('STEAM_MIN_PRICE', '1.10')) # Ignore very short prices
STEAM_MAX_PRICE = float(os.getenv('STEAM_MAX_PRICE', '10.0')) # Ignore very long prices
STEAM_ENABLED = os.getenv('STEAM_ENABLED', '1') == '1'        # Kill switch
```

## What This Tells You

After a few days:

1. **How often do significant PIN moves happen?** Maybe 5/day for NBA, 20/day across all sports?
2. **How much do soft books lag?** If PP is still at 1.80 when PIN has moved to 1.65, that's a 15-tick window.
3. **Which sports/times produce the most steam?** NBA pre-game 2h before tip? EPL matchday morning?
4. **Is the steam sustained or does it reverse?** Track if price continues moving or snaps back.

## Optional Follow-ups (Not In Scope)

- **Soft book comparison**: Cross-reference PIN steam with current PP/LAD prices to show the exact edge (e.g., "PIN at 1.65, PP still at 1.80 = 9.1% edge")
- **Auto-bet on AsianOdds**: When steam detected + price still available, place bet automatically
- **Historical analysis**: Log all steams to SQLite for pattern analysis (time of day, sport, magnitude vs duration)
- **Opening line tracking**: Store PIN opening price per runner to track total line movement from open to close

## Limitations

- **PIN update cadence**: ~10s for Today market. A move that happens and reverses within 10s won't be caught.
- **No soft book prices in real-time**: PP/LAD update every 120-300s via Odds API. By the time you see the edge, it might be gone at the soft book. This is a fundamental limitation of polling-based architecture.
- **AO incremental deltas**: If AO returns a delta without a particular game's 1X2 data, the PIN price won't update and the steam check uses the last known price. Could miss very fast moves.
