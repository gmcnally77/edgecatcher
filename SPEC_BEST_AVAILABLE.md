# Spec: Best Available Price Display

## Concept

Replace the Ladbrokes and Paddy Power columns on the dashboard with the **best available back price** from across all bookmakers in the Odds API. Instead of seeing what one specific bookie offers, you see the best price in the market for every selection — instantly spotting where the value is.

## Why This Matters

- Ladbrokes doesn't always have prices (GW26 games missing LAD entirely)
- Showing just two bookies gives a narrow view — the best price might be at Bet365, Unibet, or somewhere else
- With PIN prices as the sharp reference, seeing the best soft-book price lets you instantly calculate the edge: `best_available - PIN = your edge`
- Makes the dashboard a genuine price comparison tool, not just a 3-bookie tracker

## Current State

### What the dashboard shows now

| Column | Source | DB Column | Update Cadence |
|--------|--------|-----------|---------------|
| BACK | Betfair Exchange | `back_price` | ~5-6s |
| LAY | Betfair Exchange | `lay_price` | ~5-6s |
| PIN | AsianOdds | `price_pinnacle` | ~10s |
| LAD | Odds API (Ladbrokes UK) | `price_bet365` | 120-300s |
| PP | Odds API (Paddy Power) | `price_paddy` | 120-300s |

### What we want

| Column | Source | DB Column | Update Cadence |
|--------|--------|-----------|---------------|
| BACK | Betfair Exchange | `back_price` | ~5-6s (unchanged) |
| LAY | Betfair Exchange | `lay_price` | ~5-6s (unchanged) |
| PIN | AsianOdds | `price_pinnacle` | ~10s (unchanged) |
| BEST | Odds API (highest across all bookies) | `price_best` | 120-300s |
| BEST@ | Odds API (which bookie) | `best_bookmaker` | 120-300s |

**Or alternatively**, keep two columns showing the top 2 distinct bookmaker prices:

| Column | Source | Description |
|--------|--------|-------------|
| 1st | Odds API | Highest price + bookie name |
| 2nd | Odds API | Second highest price + bookie name |

This shows whether there's one outlier or multiple soft books at similar levels.

## Data Available from Odds API

The Odds API supports requesting ALL bookmakers or a specific list. Currently we request:
```
bookmakers=pinnacle,williamhill,paddypower,ladbrokes_uk
```

Available UK/EU bookmakers (non-exhaustive):
- `pinnacle` (sharp — already have via AO)
- `williamhill`
- `paddypower`
- `ladbrokes_uk`
- `bet365`
- `unibet_eu`
- `betfair_ex_eu` (exchange — already have direct)
- `betway`
- `888sport`
- `skybet`
- `betvictor`
- `coral`
- `boylesports`

**Important**: Each bookmaker included costs the same number of API credits per call. Requesting more bookmakers does NOT increase API usage — the cost is per event, not per bookmaker. So requesting ALL bookmakers is free vs requesting 4.

## Design

### Option A: Best Price Only (Simpler)

Store the single best available price and which bookmaker it's from.

**DB changes:**
```sql
ALTER TABLE market_feed ADD COLUMN price_best REAL;
ALTER TABLE market_feed ADD COLUMN best_bookmaker TEXT;
```

**Backend changes (`run_spy` in `fetch_universal.py`):**

```python
# Change API request to fetch all bookmakers
bookmakers = 'ALL'  # Or a curated list of 10-15 UK bookies

# For each matched runner, find the best price across all bookies
all_bookies = event.get('bookmakers', [])
best_price = 0
best_bookie = None

for bookie in all_bookies:
    if bookie['key'] == 'pinnacle':
        continue  # Skip PIN — we have it from AO
    if bookie['key'] == 'betfair_ex_eu':
        continue  # Skip BF — we have it direct

    h2h = next((m for m in bookie.get('markets', []) if m['key'] == 'h2h'), None)
    if not h2h:
        continue

    for outcome in h2h.get('outcomes', []):
        if check_match(normalize(outcome['name']), runner_norm):
            price = outcome.get('price', 0)
            if price > best_price:
                best_price = price
                best_bookie = bookie['key']

if best_price > 1.01:
    updates[row_id]['price_best'] = best_price
    updates[row_id]['best_bookmaker'] = best_bookie
```

**Frontend changes (`page.tsx`):**
```javascript
// Replace LAD/PP columns with:
{ name: 'Best', p: runner.bookmakers.best, subtitle: runner.bookmakers.bestBookmaker }
```

### Option B: Top 2 Prices (Richer)

Store the top 2 bookmaker prices to show competitive landscape.

**DB changes:**
```sql
ALTER TABLE market_feed ADD COLUMN price_best REAL;
ALTER TABLE market_feed ADD COLUMN best_bookmaker TEXT;
ALTER TABLE market_feed ADD COLUMN price_second REAL;
ALTER TABLE market_feed ADD COLUMN second_bookmaker TEXT;
```

**Backend**: Same as Option A but track top 2 instead of top 1.

**Frontend**: Two columns, each showing price + abbreviated bookie name:
```
| 1.85 WH | 1.82 LAD |
```

### Option C: JSONB Column (Most Flexible)

Store all bookmaker prices in a single JSONB column.

**DB changes:**
```sql
ALTER TABLE market_feed ADD COLUMN bookmaker_prices JSONB DEFAULT '{}';
```

**Stored format:**
```json
{
  "williamhill": 1.85,
  "paddypower": 1.82,
  "ladbrokes_uk": 1.80,
  "bet365": 1.83,
  "unibet_eu": 1.81
}
```

**Pros**: Most flexible, frontend can sort/filter/display any way it wants.
**Cons**: Larger payload, more complex frontend logic, harder to query in Supabase.

### Recommended: Option A (Best Price Only)

Simplest to implement, delivers 90% of the value. You see the best price available and who's offering it. If you want more detail later, Option C can be added incrementally.

## API Credit Impact

Currently requesting 4 bookmakers per API call. The Odds API charges per request, NOT per bookmaker — so switching to `bookmakers=ALL` or requesting 15 bookmakers costs **exactly the same** number of credits.

No additional API spend.

## What Changes

| File | Change |
|------|--------|
| `sports_config.py` | Update `bookmakers` string per sport to include more bookies (or use ALL) |
| `fetch_universal.py` | Modify `run_spy()` to find best price across all bookies |
| `fetch_universal.py` | Write `price_best` and `best_bookmaker` to upsert payload |
| Supabase | Add `price_best` (float) and `best_bookmaker` (text) columns to `market_feed` |
| `frontend/app/dashboard/page.tsx` | Replace LAD/PP columns with Best price + bookie indicator |

## What Doesn't Change

- Betfair feed (unchanged)
- AsianOdds feed (unchanged)
- PIN prices (unchanged)
- Arb/churn scanner (unchanged — still uses PIN vs BF lay)
- API call frequency/credits (unchanged)

## Frontend Display

### Current
```
| BACK | LAY | PIN  | LAD  | PP   |
| 1.39 | 1.41| 1.40 | 1.35 | 1.36 |
```

### Proposed (Option A)
```
| BACK | LAY | PIN  | BEST      |
| 1.39 | 1.41| 1.40 | 1.38 (WH) |
```

Or keep two columns — best + second best:
```
| BACK | LAY | PIN  | BEST      | 2ND       |
| 1.39 | 1.41| 1.40 | 1.38 (WH) | 1.36 (PP) |
```

The bookie abbreviation can be colour-coded or shown as a small label below the price.

### Bookie Abbreviations for Display

| Odds API Key | Display |
|-------------|---------|
| `williamhill` | WH |
| `paddypower` | PP |
| `ladbrokes_uk` | LAD |
| `bet365` | B365 |
| `unibet_eu` | UNI |
| `betway` | BW |
| `888sport` | 888 |
| `skybet` | SKY |
| `betvictor` | BV |
| `coral` | COR |

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Odds API returns different bookies per event | Low | Best price logic handles variable availability gracefully |
| Best price is from a bookie user doesn't have an account with | Low | Show the bookie name so user knows where to go |
| Larger API response (more bookmakers) | Very low | Response is still a single JSON array, slightly larger payload |
| Need new Supabase columns | Low | Simple ALTER TABLE, no migration tool needed |
| Frontend needs to handle new column format | Low | Straightforward React change |

## Implementation Order

1. **Add Supabase columns** (`price_best`, `best_bookmaker`) — 1 minute
2. **Update `sports_config.py`** — expand bookmakers list — 1 minute
3. **Update `run_spy()`** — find best price, write to DB — ~20 lines
4. **Update frontend** — replace LAD/PP with Best display — ~15 lines
5. **Test** — verify prices appear, check they look sensible vs PIN

Total: ~40 lines of backend code, ~15 lines of frontend, 2 new DB columns. No new files, no new dependencies.

## Optional Follow-ups (Not In Scope)

- **Edge calculation**: Show `best_price - pin_price` as a percentage edge directly on the dashboard
- **Historical best price tracking**: Log best available over time to spot patterns
- **Bookmaker ranking**: Track which bookmaker is "softest" (most often the best price) across all events
- **Alert on big edge**: If best available is >5% above PIN, send Telegram alert (this is essentially the steamer alert from the other spec, but from the soft-book side)
