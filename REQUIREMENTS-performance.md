# Feature: Performance Optimisation

## Overview
Reduce the spy cycle time by parallelising API calls and pre-indexing data structures. The main bottleneck is sequential AsianOdds API calls with mandatory rate limit sleeps — not CPU.

---

## Current State
- AO fetches run sequentially: 3 sports × 3 markets = up to 9 API calls
- Each call has a mandatory sleep (5s Live, 10s Today, 20s Early)
- A full AO cycle can take 60-90s just waiting on rate limits
- Matching loops iterate all active rows for every AO match (O(matches × rows))
- Odds API calls also run sequentially per sport

## Target State
- AO fetches for different sports run in parallel (3x speedup)
- Matching uses pre-indexed lookups instead of full scans
- Full cycle completes in ~20-30s instead of 60-90s

---

## Requirements

### 1. Parallel AO Fetches Across Sports

Each sport (Soccer=1, Basketball=2, MMA=9) has independent rate limits on the AO API. They can be fetched concurrently.

```python
from concurrent.futures import ThreadPoolExecutor

def fetch_asianodds_prices(active_rows, id_to_row_map):
    ...
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {
            executor.submit(_fetch_sport_ao, sport_name, sport_id, active_rows, ...): sport_name
            for sport_name, sport_id in ASIANODDS_SPORT_MAP.items()
        }
        for future in as_completed(futures):
            sport_updates = future.result()
            updates.update(sport_updates)
```

**Constraints:**
- Each thread must manage its own sleep/rate-limit timing
- All threads share the same AO client (session is global) — ensure `_request()` is thread-safe or use a lock
- Cache writes (`_save_ao_cache`) need a lock to prevent concurrent file writes

**Expected gain:** ~3x reduction in AO fetch time (from ~60-90s to ~20-30s)

### 2. Pre-Index Active Rows by Sport

Currently the matching loop filters rows by sport inside every iteration:

```python
# Current: O(n) filter on every AO match
for row in active_rows:
    if row['sport'] != sport_name:
        continue
```

Pre-build once at the start of the cycle:

```python
# Proposed: O(1) lookup
rows_by_sport = {}
for row in active_rows:
    rows_by_sport.setdefault(row['sport'], []).append(row)
```

Then use `rows_by_sport.get(sport_name, [])` in both the AO and Odds API matching loops.

### 3. Team Name Lookup Index for AO Matching

Currently for each AO match, we iterate all sport rows checking `check_match()` and `team_in_event()`. Build a reverse index from normalized team names to candidate rows:

```python
# Build once per cycle
from collections import defaultdict
team_to_rows = defaultdict(list)

for row in active_rows:
    norm = row['norm_runner']
    team_to_rows[norm].append(row)
    # Also index by suffix-stripped and alias variants
    stripped = strip_team_suffix(strip_team_prefix(norm))
    if stripped != norm:
        team_to_rows[stripped].append(row)
    if norm in ALIAS_MAP:
        for alias in ALIAS_MAP[norm]:
            team_to_rows[alias].append(row)
```

Then for each AO match, look up candidate rows directly:

```python
candidates = set()
for key in [norm_home, strip_team_suffix(norm_home), ...]:
    candidates.update(team_to_rows.get(key, []))
for key in [norm_away, strip_team_suffix(norm_away), ...]:
    candidates.update(team_to_rows.get(key, []))

for row in candidates:
    # Only check rows that have a chance of matching
    ...
```

**Expected gain:** Turns O(matches × rows_per_sport) into O(matches × small_candidate_set). Marginal at current data volumes but scales better as more leagues are added.

### 4. Parallel Odds API Fetches (Optional)

The Odds API calls per sport could also be parallelised, but the TTL caching means most calls are cache hits (no network). Only worth doing if more sports/leagues are added.

---

## Implementation Order

| Priority | Change | Impact | Risk |
|----------|--------|--------|------|
| 1 | Parallel AO fetches across sports | ~3x AO speedup | Medium — needs thread safety on shared client |
| 2 | Pre-index rows by sport | Cleaner code, minor speedup | Low |
| 3 | Team name lookup index | Better scaling | Low |
| 4 | Parallel Odds API fetches | Minor unless more leagues added | Low |

---

## Files to Modify

1. `backend/fetch_universal.py` — All changes (parallelisation, indexing)
2. `backend/asianodds_client.py` — Add threading lock to `_request()` if needed

---

## Testing Checklist

- [ ] All three sports still get correct PIN prices after parallelisation
- [ ] No race conditions on AO cache reads/writes
- [ ] No duplicate or missing prices compared to sequential baseline
- [ ] Cycle time reduced from ~60-90s to ~20-30s
- [ ] Rate limits still respected (no Code -810 errors from AO)
- [ ] Stale price clearing still works correctly
- [ ] Telegram alerts still fire correctly
