# Spec: PIN/Betfair Arb Scanner

## Concept

A read-only scanner that runs on every main loop tick, compares Pinnacle back prices (from AsianOdds) against Betfair lay prices already in `market_feed`, and flags any row where backing at PIN and laying on Betfair locks in a guaranteed profit after commission.

No bets placed. No side effects. Just detection, logging, and alerting.

## The Maths

**Back at Pinnacle (price P_b), Lay on Betfair (price P_l), Betfair commission c:**

If the selection wins:
```
Profit = S_back * (P_b - 1) - S_lay * (P_l - 1)
```

If the selection loses:
```
Profit = -S_back + S_lay * (1 - c)
```

**Arb exists when:**
```
(1 - c) * (P_b - 1) > (P_l - 1)
```

**Margin (profit as % of back stake):**
```
margin = ((1 - c) * (P_b - 1) - (P_l - 1)) / P_b
```

If `margin > 0`, there's an arb.

**Optimal lay stake (for equal profit both ways):**
```
S_lay = S_back * P_b / (P_l - c * (P_l - 1))
```

**Profit per £100 back stake:**
```
profit = margin * 100
```

### Worked Examples

| PIN Back | BF Lay | Commission | Margin | Profit/£100 |
|----------|--------|------------|--------|--------------|
| 2.000 | 1.950 | 2% | 1.50% | £1.50 |
| 3.000 | 2.900 | 2% | 2.00% | £2.00 |
| 1.500 | 1.480 | 2% | 0.33% | £0.33 |
| 2.100 | 2.100 | 2% | -0.95% | NO ARB |
| 1.800 | 1.750 | 2% | 1.22% | £1.22 |

### Break-Even PIN Price

Given a Betfair lay price, the minimum PIN back price for an arb:
```
P_b_min = 1 + (P_l - 1) / (1 - c)
```

At 2% commission:
- BF lay 1.50 → PIN must be > 1.510
- BF lay 2.00 → PIN must be > 2.020
- BF lay 3.00 → PIN must be > 3.041
- BF lay 5.00 → PIN must be > 5.082

The higher the price, the bigger the gap needed. Low-odds favourites are where arbs are most likely — the commission bite is smaller relative to the odds.

## Data Available (Already in `market_feed`)

Every row has:

| Column | Source | Update Cadence |
|--------|--------|---------------|
| `price_pinnacle` | AsianOdds (PIN/SIN) | ~10s (Today), ~5s (Live) |
| `lay_price` | Betfair Exchange | ~5-6s |
| `back_price` | Betfair Exchange | ~5-6s |
| `runner_name` | Betfair | On market creation |
| `event_name` | Betfair | On market creation |
| `sport` | Config | Static |
| `start_time` | Betfair | Static |
| `market_status` | Betfair | Updated on state change |
| `volume` | Betfair | ~5-6s |
| `last_updated` | System | On any price write |

**Key insight:** The scanner needs zero new data feeds. Everything is already in one table.

## Scanner Design

### Core Function

```python
BETFAIR_COMMISSION = 0.02  # 2% standard, adjust per user's tier

def scan_arbs(supabase):
    """Scan market_feed for PIN vs Betfair arb opportunities. Read-only."""
    rows = supabase.table('market_feed') \
        .select('id,sport,event_name,runner_name,price_pinnacle,lay_price,back_price,volume,start_time,last_updated') \
        .neq('market_status', 'CLOSED') \
        .not_.is_('price_pinnacle', 'null') \
        .not_.is_('lay_price', 'null') \
        .execute()

    arbs = []
    for row in rows.data:
        p_b = row['price_pinnacle']   # PIN back price
        p_l = row['lay_price']        # Betfair lay price

        if not p_b or not p_l or p_b <= 1.01 or p_l <= 1.01:
            continue

        margin = ((1 - BETFAIR_COMMISSION) * (p_b - 1) - (p_l - 1)) / p_b

        if margin > 0:
            arbs.append({
                'id': row['id'],
                'sport': row['sport'],
                'event': row['event_name'],
                'runner': row['runner_name'],
                'pin_back': p_b,
                'bf_lay': p_l,
                'bf_back': row.get('back_price'),
                'margin_pct': round(margin * 100, 3),
                'profit_per_100': round(margin * 100, 2),
                'volume': row.get('volume', 0),
                'last_updated': row['last_updated'],
            })

    return sorted(arbs, key=lambda x: -x['margin_pct'])
```

### Where It Runs

Add `run_arb_scan()` to the main loop, right after `run_ao_cycle()`:

```python
# In the main while True loop:
run_ao_cycle()
run_arb_scan()    # <-- new, every tick (~5s)
```

Lightweight — single DB query, no API calls, CPU only for margin calculation.

### What It Does When It Finds an Arb

**1. Log it:**
```
ARB FOUND: Brooklyn Nets @ 2.560 PIN > 2.520 BF lay | margin=0.78% | £0.78/£100 | vol=£12,450
```

**2. Track it in a new DB table `arb_log`:**

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Auto PK |
| `market_feed_id` | int | FK to market_feed row |
| `sport` | text | Basketball, Soccer, MMA |
| `event_name` | text | e.g. "Brooklyn Nets @ Chicago Bulls" |
| `runner_name` | text | e.g. "Brooklyn Nets" |
| `pin_back` | float | PIN back price at detection |
| `bf_lay` | float | Betfair lay price at detection |
| `bf_back` | float | Betfair back price at detection |
| `margin_pct` | float | Arb margin % |
| `volume` | int | Betfair matched volume |
| `first_seen` | timestamptz | When arb first appeared |
| `last_seen` | timestamptz | When arb was last confirmed |
| `gone_at` | timestamptz | When arb disappeared (null = still live) |
| `duration_seconds` | int | How long it lasted (computed on close) |
| `peak_margin_pct` | float | Best margin seen during lifetime |

This table lets you answer:
- How often do arbs appear?
- How long do they last?
- What margins are typical?
- Which sports/events produce the most arbs?
- Is there a pattern by time of day or proximity to kickoff?

**3. Telegram alert (optional):**

Send alert on first detection of a new arb above a configurable threshold (e.g. >0.5% margin). Use the existing `telegram_alerts` module.

### Arb Lifecycle Tracking

The scanner runs every tick. To track duration, it needs to know which arbs are currently "open":

```python
_open_arbs = {}  # market_feed_id -> {first_seen, peak_margin, ...}

def run_arb_scan():
    arbs = scan_arbs(supabase)
    now = datetime.now(timezone.utc)

    current_ids = set()
    for arb in arbs:
        mid = arb['id']
        current_ids.add(mid)

        if mid not in _open_arbs:
            # New arb — log to DB and alert
            _open_arbs[mid] = {
                'first_seen': now,
                'peak_margin': arb['margin_pct'],
                'data': arb,
            }
            logger.info(f"ARB OPENED: {arb['runner']} | {arb['pin_back']} PIN > {arb['bf_lay']} BF | {arb['margin_pct']}%")
            _log_arb_to_db(arb, 'opened', now)
            _maybe_send_alert(arb)
        else:
            # Existing arb — update peak
            if arb['margin_pct'] > _open_arbs[mid]['peak_margin']:
                _open_arbs[mid]['peak_margin'] = arb['margin_pct']

    # Check for closed arbs
    for mid in list(_open_arbs.keys()):
        if mid not in current_ids:
            info = _open_arbs.pop(mid)
            duration = (now - info['first_seen']).total_seconds()
            logger.info(f"ARB CLOSED: {info['data']['runner']} | lasted {duration:.0f}s | peak {info['peak_margin']}%")
            _log_arb_close(mid, now, duration, info['peak_margin'])
```

## What Gets Built

| Component | File | Effort |
|-----------|------|--------|
| `scan_arbs()` function | `fetch_universal.py` | ~30 lines |
| `run_arb_scan()` with lifecycle tracking | `fetch_universal.py` | ~60 lines |
| `arb_log` table migration | Supabase SQL | 1 CREATE TABLE |
| DB logging helpers | `fetch_universal.py` | ~20 lines |
| Telegram alert integration | `fetch_universal.py` | ~10 lines (reuse existing) |
| Main loop integration | `fetch_universal.py` | 1 line |

Total: ~120 lines of code, 1 new DB table. No new files, no new dependencies.

## Configuration

```python
# Arb scanner settings
ARB_COMMISSION = float(os.getenv('ARB_COMMISSION', '0.02'))    # Betfair commission rate
ARB_MIN_MARGIN = float(os.getenv('ARB_MIN_MARGIN', '0.001'))   # Min margin to log (0.1%)
ARB_ALERT_MARGIN = float(os.getenv('ARB_ALERT_MARGIN', '0.005'))  # Min margin for Telegram alert (0.5%)
ARB_MIN_VOLUME = int(os.getenv('ARB_MIN_VOLUME', '100'))       # Min BF matched volume (filter illiquid)
ARB_ENABLED = os.getenv('ARB_ENABLED', '0') == '1'             # Kill switch
```

Off by default (`ARB_ENABLED=0`). Turn on in `.env` when ready.

## What This Tells You (Before Building Execution)

After running for a few days, `arb_log` answers:

1. **Do arbs actually exist?** — maybe PIN and BF are always in sync and there's nothing there
2. **How often?** — 5 per day? 50? 500?
3. **How long do they last?** — 2 seconds (too fast to execute) or 30 seconds (executable)?
4. **What margins?** — 0.1% (not worth it after slippage) or 2%+ (real money)?
5. **Which sport/time?** — NBA pre-match 2h before tip? EPL matchday? MMA fight week?
6. **Is there enough Betfair liquidity?** — volume column tells you if you could actually get a lay filled

If the data shows arbs lasting >10s with >0.5% margins and >£1000 liquidity, execution is worth building. If they last 2s at 0.1%, it's not.

## Limitations / Caveats

- **Price staleness**: PIN prices are ~10s old, BF lay is ~5s old. A detected "arb" may already be gone. The `duration_seconds` metric in `arb_log` will reveal how real this is.
- **Betfair lay liquidity**: `lay_price` is best available, but volume at that price may be tiny. Would need `lay_size` (available to lay amount) to assess executability — currently not stored in `market_feed` but available from Betfair API.
- **PIN placement latency**: Even if arb is real, AO bet placement takes time. The scanner can't tell you if you'd actually get filled at the detected price.
- **Commission tiers**: 2% is standard Betfair. Power users may have lower rates (making more arbs viable). Configurable via `ARB_COMMISSION`.

## Not In Scope

- Bet placement on either side
- Staking calculations beyond the example formula
- Real-time websocket feeds (current polling cadence is the constraint)
- Betfair lay depth (would need schema change to store `lay_size`)
