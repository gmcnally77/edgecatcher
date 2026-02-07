# Feature: All UK Bookmakers with Best Price Columns

## Overview
Expand the dashboard to consume ALL UK bookmakers from The Odds API, and display two "best price" columns showing the best available price for each team across all active bookmakers.

---

## Current State
- Backend fetches only 3 bookmakers: Pinnacle, Ladbrokes, Paddy Power
- Frontend displays 5 columns: BACK, LAY, PIN, LAD, PP
- Each runner row shows only that runner's prices

## Target State
- Backend fetches ALL configured UK bookmakers
- Frontend displays 5 columns: BACK, LAY, PIN, BEST1, BEST2
- Each column shows the full book at that bookmaker (both teams' prices)

---

## Layout Example

**Brooklyn Nets @ Orlando Magic**

| Runner | BACK | LAY | PIN | BEST1 (LAD) | BEST2 (BET365) |
|--------|------|-----|-----|-------------|----------------|
| Brooklyn Nets | 4.50 | 4.60 | 4.16 | **4.20** (best) | 4.00 |
| Orlando Magic | 1.28 | 1.29 | 1.27 | 1.22 | **1.25** (best) |

Where:
- **BEST1 column**: Header shows which bookie has Team 1's best price (e.g., "LAD")
  - Team 1 row: Team 1's best price (highlighted)
  - Team 2 row: Team 2's price at that same bookmaker

- **BEST2 column**: Header shows which bookie has Team 2's best price (e.g., "BET365")
  - Team 1 row: Team 1's price at that bookmaker
  - Team 2 row: Team 2's best price (highlighted)

This shows the full book at each "best" bookmaker for arb/value spotting.

---

## Requirements

### 1. Configurable Bookmakers (`sports_config.py`)

Add a new config structure for UK bookmakers:

```python
UK_BOOKMAKERS = [
    {"key": "bet365", "label": "B365", "active": True, "priority": 1},
    {"key": "ladbrokes_uk", "label": "LAD", "active": True, "priority": 2},
    {"key": "williamhill", "label": "WH", "active": True, "priority": 3},
    {"key": "paddypower", "label": "PP", "active": True, "priority": 4},
    {"key": "skybet", "label": "SKY", "active": False, "priority": 5},
    {"key": "unibet_uk", "label": "UNI", "active": False, "priority": 6},
    {"key": "coral", "label": "COR", "active": False, "priority": 7},
    {"key": "betfred", "label": "BFRD", "active": False, "priority": 8},
]
```

- `key`: The Odds API bookmaker key
- `label`: Short name for UI column headers (max 4-5 chars)
- `active`: Toggle on/off (for gubbed accounts)
- `priority`: Tie-breaker when multiple books have same best price (lower = preferred)

### 2. Database Schema Change (Supabase)

Add one new column to `market_feed` table:

```sql
ALTER TABLE market_feed
ADD COLUMN bookmaker_prices JSONB DEFAULT '{}';
```

Example stored value:
```json
{
  "bet365": 4.00,
  "ladbrokes_uk": 4.20,
  "williamhill": 4.15,
  "paddypower": 4.10
}
```

### 3. Backend Changes (`fetch_universal.py`)

Modify `run_spy()` function:

1. Build bookmaker list from `UK_BOOKMAKERS` config (only `active: True`)
2. Fetch odds for all active bookmakers in one API call
3. For each runner, extract prices from all bookmakers
4. Store as JSON in `bookmaker_prices` column
5. Keep `price_pinnacle` column as-is (Pinnacle stays separate)
6. Can deprecate/ignore `price_bet365` and `price_paddy` columns (or keep for backwards compatibility)

### 4. Frontend Changes (`page.tsx`)

Modify the runner row rendering:

1. For each market, determine:
   - Team 1 = first runner (alphabetically sorted, as current)
   - Team 2 = second runner

2. Calculate best prices:
   - Team 1's best price = highest price across all bookmakers in Team 1's `bookmaker_prices`
   - Team 2's best price = highest price across all bookmakers in Team 2's `bookmaker_prices`
   - Use priority order from config for tie-breaking

3. Display columns:
   - **BEST1 header**: Show label of bookmaker with Team 1's best price
   - **BEST1 prices**: Show both teams' prices at that bookmaker
   - **BEST2 header**: Show label of bookmaker with Team 2's best price
   - **BEST2 prices**: Show both teams' prices at that bookmaker

4. Highlighting:
   - Highlight the "best" price in each column (the team whose best bookie it is)
   - The other price is the "opposite" / paired price (likely worse)

### 5. Edge Cases

| Scenario | Handling |
|----------|----------|
| Multiple books have same best price | Use `priority` from config as tie-breaker |
| Bookmaker missing price for a runner | Skip that bookmaker for best price calc, show "—" if needed |
| Only one runner in market (shouldn't happen) | Show BEST1 only, hide BEST2 |
| Same bookmaker is best for both teams | Show same header in both columns, prices will differ |
| No bookmaker prices available | Show "—" in both BEST columns |

---

## Files to Modify

1. `backend/sports_config.py` - Add `UK_BOOKMAKERS` config
2. `backend/fetch_universal.py` - Fetch all bookmakers, store JSON
3. `frontend/app/page.tsx` - New column logic and display
4. Supabase dashboard - Add `bookmaker_prices` column

---

## Testing Checklist

- [ ] Bookmakers can be toggled on/off via config
- [ ] Tie-breaking works correctly (priority order)
- [ ] Both teams' prices display correctly in each BEST column
- [ ] Column headers update dynamically based on which bookie is best
- [ ] "Best" price is highlighted, "opposite" price is not
- [ ] Edge cases handled gracefully (missing prices, ties, etc.)
- [ ] Existing PIN column still works
- [ ] Mobile layout still works

---

## Future Considerations

- Add bookmaker logos/icons to column headers
- Show edge % calculation for each BEST column
- Alert system integration (Priority 2 feature)
- Historical tracking of which bookmaker had best price over time
