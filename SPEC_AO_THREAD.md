# Spec: Independent AsianOdds Fetch Thread

## Problem

The AsianOdds (AO) price fetch currently runs inside the main loop alongside Betfair and Odds API calls. The main loop looks like this:

```
while True:
    fetch_betfair()          # 2-10s (Betfair API + DB upsert)
    run_ao_cycle()           # 0.5-20s (AO API + rate limit sleeps)
    maybe run_spy()          # 1-10s every 15s (Odds API + matching)
    telegram_alerts()        # <100ms
    time.sleep(6)            # fixed floor
```

AO rate limits per market type are:
- Live (market_type=0): **5s**
- Today (market_type=1): **10s**
- Early (market_type=2): **20s**

NBA lives in the Today market for most of the day (10s limit). With the 6s main loop, the effective update cadence is **~12s** — the cache expires at 10s but the next tick isn't until 12s.

Worse, when AO needs to fetch fresh data and hits the rate limit sleep, **it blocks the entire main loop for up to 20s**. During that time, Betfair prices don't update either. A slow AO re-auth (every 120s) adds another 1-2s block.

Real-world worst case per iteration:
```
fetch_betfair:       5s
run_ao_cycle:       20s  (rate limit sleep + API call + re-auth)
run_spy:            10s  (if timer fires this tick)
sleep:               6s
                   -----
Total:              41s  ← no price updates for 41 seconds
```

## Goal

Run the AO fetch on its own thread so it can fire at exactly the rate limit cadence (5s/10s/20s per market type) regardless of what Betfair or Odds API are doing. The main loop continues unblocked.

**Target cadence:**
- NBA (Today): PIN price update every **10s** (was ~12-41s)
- NBA (Live, near tipoff): PIN price update every **5-6s** (was ~12-41s)
- No blocking of main loop by AO rate limit sleeps or re-auth

## Current Architecture

### Main Loop (fetch_universal.py)
```
Main Thread:
  fetch_betfair() → run_ao_cycle() → run_spy() → alerts → sleep(6) → repeat
```

### Shared State Between Spy and AO Cycle
- `_cached_active_rows` (list) — written by `run_spy()`, read by `run_ao_cycle()`
- `_cached_id_to_row_map` (dict) — written by `run_spy()`, read by `run_ao_cycle()`
- `_asianodds_cache` (dict) — AO match cache, read/written by `fetch_asianodds_prices()`
- `_asianodds_cache_time` (dict) — per-key timestamps
- `_ao_last_fetch_by_market` (dict) — per-market-type rate limit timers
- `_asianodds_last_reauth` (float) — re-auth timer
- `ASIANODDS_CACHE_FILE` — disk persistence

### AsianOdds Client (asianodds_client.py)
Singleton instance with mutable state:
- `ao_token`, `ao_key`, `service_url` — set by `login()`/`register()`
- `last_activity` — updated on every successful `_request()`

**Not thread-safe.** Headers are built from instance vars on every request, and `ensure_authenticated()` reads `last_activity` to decide if re-auth is needed.

### Supabase Client
Both main thread and AO write to `market_feed` via `upsert()`. The DB handles conflict resolution via `on_conflict='id'`, so concurrent upserts are safe at the DB level. No explicit locking needed — last writer wins, which is the correct behaviour (most recent price should win).

## Proposed Design

### 1. AO Thread Worker

Create a dedicated daemon thread that runs `fetch_asianodds_prices()` and writes results to Supabase on its own timer.

```python
import threading
import copy

_ao_thread_running = False
_ao_lock = threading.Lock()

def _ao_worker():
    """Dedicated AO fetch loop. Runs independently of main loop."""
    global _ao_thread_running
    _ao_thread_running = True

    while _ao_thread_running:
        try:
            # Snapshot the active rows under lock (fast copy)
            with _ao_lock:
                rows = list(_cached_active_rows)       # shallow copy of list
                id_map = dict(_cached_id_to_row_map)   # shallow copy of dict

            if not rows:
                time.sleep(5)
                continue

            # Fetch prices (blocks this thread only, not main)
            asian_prices = fetch_asianodds_prices(rows, id_map)

            if asian_prices:
                # Build upsert payload
                updates = []
                for row_id, prices in asian_prices.items():
                    orig_row = id_map.get(row_id, {})
                    updates.append({
                        'id': row_id,
                        'sport': orig_row.get('sport'),
                        'market_id': orig_row.get('market_id'),
                        'runner_name': orig_row.get('runner_name'),
                        'price_pinnacle': prices['price_pinnacle'],
                        'last_updated': datetime.now(timezone.utc).isoformat()
                    })

                # Write to DB (safe — upsert with on_conflict='id')
                for i in range(0, len(updates), 100):
                    supabase.table('market_feed').upsert(
                        updates[i:i+100], on_conflict='id'
                    ).execute()
                logger.info(f"AO thread: {len(asian_prices)} PIN prices written")

        except Exception as e:
            logger.error(f"AO thread error: {e}")

        # Sleep just enough — fetch_asianodds_prices() already handles
        # per-market-type rate limiting internally via _ao_last_fetch_by_market.
        # This outer sleep just prevents a tight spin if everything is cached.
        time.sleep(2)
```

### 2. Thread Startup

In the `__main__` block, start the AO thread after the first `run_spy()` populates `_cached_active_rows`:

```python
if __name__ == "__main__":
    logger.info("--- STARTING UNIVERSAL ENGINE ---")
    run_spy()  # Populates _cached_active_rows

    # Start AO thread
    ao_thread = threading.Thread(target=_ao_worker, daemon=True, name="ao-fetcher")
    ao_thread.start()
    logger.info("AO fetch thread started")

    while True:
        fetch_betfair()
        # run_ao_cycle() — REMOVED from main loop

        spy_interval = INPLAY_SPY_INTERVAL if has_inplay_markets() else PREMATCH_SPY_INTERVAL
        if time.time() - last_spy_run > spy_interval:
            run_spy()    # Updates _cached_active_rows under lock
            last_spy_run = time.time()

        telegram_alerts.run_alert_cycle(supabase)
        time.sleep(6)
```

### 3. Protecting Shared State

Only two things need a lock — the active row cache that `run_spy()` writes and the AO thread reads:

```python
# In run_spy(), when caching rows for AO:
with _ao_lock:
    _cached_active_rows = active_rows
    _cached_id_to_row_map = id_to_row_map
```

The AO-internal state (`_asianodds_cache`, `_asianodds_cache_time`, `_ao_last_fetch_by_market`, `_asianodds_last_reauth`) is only accessed by the AO thread, so no lock needed.

### 4. AsianOdds Client — Dedicated Instance

To avoid thread-safety issues with the singleton client, give the AO thread its own client instance:

```python
def _ao_worker():
    # Own client instance — no shared token/key state with main thread
    from asianodds_client import AsianOddsClient
    ao_client = AsianOddsClient()
    ...
```

This is clean but means the AO thread manages its own session independently. The main thread's `get_client()` singleton is untouched (used nowhere else currently, but safe for future use).

### 5. Remove `run_ao_cycle()` from Main Loop

The existing `run_ao_cycle()` function and its call in the main loop are removed. All AO work moves to the thread. The `_ao_worker` replaces both `run_ao_cycle()` and the inline DB write logic.

## What Changes

| File | Change |
|------|--------|
| `fetch_universal.py` | Add `_ao_lock`, `_ao_worker()`, thread startup |
| `fetch_universal.py` | Remove `run_ao_cycle()` call from main loop |
| `fetch_universal.py` | Add `with _ao_lock:` around `_cached_active_rows` writes in `run_spy()` |
| `fetch_universal.py` | `fetch_asianodds_prices()` gets a `client` parameter instead of using `get_asianodds_client()` |

No changes to `asianodds_client.py`, `config.py`, `sports_config.py`, or any frontend code.

## What Doesn't Change

- The Betfair/Odds API fetch cadence (unchanged, still main loop)
- The Supabase table schema (unchanged)
- The matching logic in `fetch_asianodds_prices()` (unchanged)
- AO rate limits per market type (still enforced internally)
- AO re-auth every 120s (still happens, just on AO thread)
- Disk cache persistence (still happens after each fetch)
- The `run_spy()` cadence (still 15s, still populates rows for AO)

## Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| AO thread crashes silently | High | Wrap in try/except, log errors. Daemon thread dies with process anyway. Add health check: if AO thread is dead, log warning on main loop. |
| Stale `_cached_active_rows` if spy hasn't run yet | Low | AO thread checks `if not rows: sleep(5); continue` |
| Concurrent Supabase upserts (main + AO thread) | Low | DB handles via `on_conflict='id'`. Last writer wins = most recent price wins. Correct behaviour. |
| AO thread's own session competes with... nothing | None | Main loop no longer calls AO. Only one AO session exists. |
| Lock contention on `_ao_lock` | Very low | Lock is held for <1ms (list/dict copy). No real contention. |
| `fetch_asianodds_prices()` rate limit sleeps | None (feature) | Sleeps only block AO thread. Main loop is free. This is the whole point. |

## Testing

1. Deploy and watch logs for `"AO thread:"` and `"AO fetch thread started"` messages
2. Verify PIN prices still appear in DB and on dashboard
3. Check that main loop cycle time drops (should be ~8-12s instead of 12-41s)
4. Monitor for thread crash: absence of `"AO thread:"` log lines = thread died
5. Verify re-auth still works on AO thread (check for `"AO: Re-auth OK"` every ~120s)

## Optional Follow-ups (Not In Scope)

- **Reduce main loop sleep from 6s to 5s** — aligns with Live rate limit, minor win
- **Skip Early market for Basketball** — NBA is never in Early, saves ~2s per AO cycle
- **Thread health watchdog** — restart AO thread if it dies
- **Metrics** — track AO cycle time, cache hit rate, prices written per minute
