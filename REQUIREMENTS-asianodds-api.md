# Feature: AsianOdds WebAPI Integration

## Overview
Replace The Odds API's Pinnacle prices with super-sharp Asian bookmaker prices from AsianOdds WebAPI. This provides access to the sharpest betting markets in the world for comparison against Betfair Exchange.

---

## Strategic Value

- **Sharp Prices**: Asian books (Pinnacle, SBO, IBC, etc.) are the sharpest in the world
- **True Market Prices**: Better benchmark than soft UK bookmakers
- **Edge Detection**: Compare sharp Asian prices against Betfair to find true value
- **Real-time Data**: Live odds updates with configurable refresh rates

---

## API Architecture

### Authentication Flow

```
1. Login (POST /Account/Login)
   - Username + MD5(Password)
   - Returns: Token (temporary, 60-second validity)

2. Register (POST /Account/Register)
   - Must call within 60 seconds of Login
   - Returns: AOToken (persistent session token)

3. All subsequent calls use AOToken in header
```

### Key Endpoints

| Endpoint | Purpose | Rate Limit |
|----------|---------|------------|
| `GetFeeds` | Fetch odds for all markets | Live: 5s, Today: 10s, Early: 20s |
| `GetMatches` | Get match list with IDs | As needed |
| `GetPlacementInfo` | Pre-bet validation | Required before PlaceBet |
| `PlaceBet` | Place bets | After GetPlacementInfo |
| `GetAccountSummary` | Balance/P&L info | As needed |
| `GetBets` | Bet history | As needed |

---

## Data Format

### BookieOdds String Format
```
"SIN:2.26,1.61;BEST:SIN 2.26,SIN 1.61"
```

Parsing:
- Split by `;` for each bookmaker
- First part is bookie code (SIN = Singbet/Pinnacle)
- Numbers are Home odds, Away odds
- `BEST` section shows which bookie has best price for each side

### Market Types
| Code | Type | Example |
|------|------|---------|
| H | Handicap | -1.5, +0.5 |
| O | Over/Under | O 2.5, U 2.5 |
| X | 1X2 (Moneyline) | Home, Draw, Away |

### Bookmaker Codes
| Code | Bookmaker |
|------|-----------|
| SIN | Singbet (Pinnacle) |
| IBC | IBC/Maxbet |
| SBO | SBOBet |
| ISN | ISN |
| PIN | Pinnacle (direct) |

---

## Requirements

### 1. Configuration (`sports_config.py`)

Add AsianOdds config:

```python
ASIANODDS_CONFIG = {
    "enabled": True,
    "username": os.getenv("ASIANODDS_USERNAME"),
    "password": os.getenv("ASIANODDS_PASSWORD"),
    "base_url": "https://webapi.asianodds88.com/AsianOddsService",
    "preferred_bookies": ["SIN", "PIN", "IBC"],  # Priority order
    "sports": [
        {"ao_id": 1, "name": "Soccer"},
        {"ao_id": 3, "name": "Basketball"},
        {"ao_id": 5, "name": "Tennis"},
        {"ao_id": 9, "name": "MMA"},
    ],
    "rate_limits": {
        "live": 5,      # seconds
        "today": 10,
        "early": 20
    }
}
```

### 2. New Backend Module (`asianodds_client.py`)

```python
class AsianOddsClient:
    def __init__(self):
        self.ao_token = None
        self.token_expiry = None

    async def login(self) -> str:
        """Step 1: Get temporary token"""
        # POST /Account/Login
        # Body: {"Username": "x", "Password": MD5("y")}
        pass

    async def register(self, temp_token: str) -> str:
        """Step 2: Exchange for persistent AOToken"""
        # POST /Account/Register
        # Header: AOToken: {temp_token}
        pass

    async def ensure_authenticated(self):
        """Refresh token if needed"""
        if not self.ao_token or self._token_expired():
            temp = await self.login()
            self.ao_token = await self.register(temp)

    async def get_feeds(self, sport_id: int, market_type: str = "today") -> dict:
        """Fetch odds for all matches"""
        # GET /Odds/GetFeeds
        # Params: sportsType, marketTypeId
        pass

    def parse_bookie_odds(self, odds_string: str) -> dict:
        """Parse 'SIN:2.26,1.61;IBC:2.30,1.58' format"""
        result = {}
        for bookie_section in odds_string.split(';'):
            if ':' in bookie_section:
                code, prices = bookie_section.split(':')
                if code != 'BEST':
                    home, away = prices.split(',')
                    result[code] = {"home": float(home), "away": float(away)}
        return result
```

### 3. Database Schema Change

Add column to `market_feed` table:

```sql
ALTER TABLE market_feed
ADD COLUMN asian_prices JSONB DEFAULT '{}';
```

Example stored value:
```json
{
  "SIN": {"home": 2.26, "away": 1.61},
  "IBC": {"home": 2.30, "away": 1.58},
  "best_home": "IBC",
  "best_away": "SIN"
}
```

### 4. Integration with `fetch_universal.py`

Modify `run_spy()` to:

1. Fetch from AsianOdds in parallel with existing The Odds API call
2. Match events by team names (use existing normalization)
3. Store Asian prices in `asian_prices` column
4. Use best Asian price as the new "PIN" column benchmark

```python
async def run_spy():
    # Existing Betfair + Odds API fetch
    betfair_data = await fetch_betfair()
    odds_api_data = await fetch_odds_api()

    # NEW: Fetch Asian prices
    asian_client = AsianOddsClient()
    asian_data = await asian_client.get_feeds(sport_id=3)  # Basketball

    # Match and merge
    for market in markets:
        asian_match = find_asian_match(market, asian_data)
        if asian_match:
            market['asian_prices'] = asian_match['prices']
```

### 5. Frontend Changes (`page.tsx`)

Replace PIN column with ASIAN column:

| BACK | LAY | ASIAN | BEST1 | BEST2 |
|------|-----|-------|-------|-------|

- **ASIAN column**: Best price from Asian books (SIN/IBC/PIN)
- Show which bookie in tooltip
- Highlight when Asian price beats Betfair back price (value!)

---

## Betting Requirement Strategy

AsianOdds requires minimum 5k/month betting volume. Strategy to meet this as a cost:

1. **Find lowest margin markets** (Asian Handicap -0.5/+0.5)
2. **Bet both sides** at different bookies to minimize loss
3. **Book as monthly cost** (~1-2% of 5k = $50-100/month)

This maintains API access while treating it as a data subscription cost.

---

## Error Handling

| Code | Meaning | Action |
|------|---------|--------|
| -1 | Failed | Retry once, then skip |
| -4 | AOToken invalid | Re-authenticate |
| -8 | Request too frequent | Back off to rate limit |
| -403 | Forbidden | Check credentials |

---

## Files to Create/Modify

1. **NEW**: `backend/asianodds_client.py` - API client class
2. **MODIFY**: `backend/sports_config.py` - Add ASIANODDS_CONFIG
3. **MODIFY**: `backend/fetch_universal.py` - Integrate Asian odds fetch
4. **MODIFY**: `frontend/app/page.tsx` - Add ASIAN column
5. **SUPABASE**: Add `asian_prices` JSONB column

---

## Testing Checklist

- [ ] Authentication flow works (Login -> Register -> AOToken)
- [ ] Token refresh works when expired
- [ ] Rate limits respected (no -8 errors)
- [ ] BookieOdds string parsing is accurate
- [ ] Match name normalization works between Asian API and Betfair
- [ ] Best Asian price displays correctly
- [ ] Edge cases: missing prices, closed markets, suspended events

---

## Phase 1 vs Phase 2

### Phase 1 (MVP)
- Read-only odds feed integration
- Display best Asian price in dashboard
- Manual betting requirement fulfillment

### Phase 2 (Future)
- Automated low-margin betting for volume requirement
- PlaceBet integration for value bets
- Real-time alerts when Asian price beats exchange

---

## Environment Variables Required

```bash
ASIANODDS_USERNAME=your_username
ASIANODDS_PASSWORD=your_password
```

Add to `.env` and Vercel/deployment environment.
