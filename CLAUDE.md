# CLAUDE.md — EdgeCatcher

## Project Overview

EdgeCatcher is a real-time odds comparison platform. It monitors Betfair Exchange prices against bookmaker prices (Pinnacle/AsianOdds, Ladbrokes, PaddyPower, Bet365) and surfaces value betting opportunities: positive edges, arbitrage, and "steamer" alerts (sharp money movement).

## Tech Stack

- **Backend**: Python 3 — no framework for the main engine (`fetch_universal.py`), FastAPI planned
- **Frontend**: Next.js 16 + React 19 + TypeScript (strict mode) + Tailwind CSS 4
- **Database**: Supabase (hosted PostgreSQL). Local SQLite for `alerts.db` and `arb_log.db`
- **External APIs**: Betfair Exchange, The Odds API, AsianOdds WebAPI
- **Alerts**: Telegram Bot API
- **Deployment**: DigitalOcean (backend systemd service), Vercel (frontend), GitHub Actions CI/CD

## Directory Structure

```
backend/
  fetch_universal.py    # Main engine — 5s loop: Betfair + AO + OddsAPI + alerts + arb scan
  asianodds_client.py   # AsianOdds API client (MD5 auth, AOToken session)
  arb_scanner.py        # Arbitrage detection (PIN back vs BF lay)
  telegram_alerts.py    # Steamer/edge alert system with dedup cooldowns
  sports_config.py      # Sport/league/bookmaker configuration
  test_steamer_alerts.py
frontend/
  app/page.tsx          # Landing page
  app/dashboard/page.tsx # Main dashboard — groups market_feed by event
  components/           # MarketsCard, SteamersPanel, Header, Footer
  lib/normalization.ts  # Team name matching/normalization
  utils/supabase.ts     # Supabase client init
scripts/
  ao_bet_smoke_test.py  # AsianOdds end-to-end betting test
.github/workflows/
  deploy.yml            # SSH deploy to DigitalOcean on push to main
```

## Commands

### Frontend (run from `frontend/`)
```bash
npm run dev       # Dev server at localhost:3000
npm run build     # Production build
npm run lint      # ESLint (Next.js + TypeScript rules)
npm start         # Production server
```

### Backend
```bash
python backend/fetch_universal.py         # Start main engine
python backend/test_steamer_alerts.py     # Unit tests for steamer alerts
python scripts/ao_bet_smoke_test.py       # AO smoke test (needs live creds)
```

## Architecture

### Backend Main Loop (`fetch_universal.py`, 5-second cycle)
1. Betfair session keep-alive (hourly)
2. `fetch_betfair()` — get exchange back/lay prices
3. `_ao_fetch_one_tick()` — AsianOdds delta fetch (non-blocking, rate-limited per market type)
4. `_ao_match_all_cached()` — match AO prices to Betfair markets
5. `run_spy()` (every 15s) — full market sync from The Odds API
6. `telegram_alerts.run_alert_cycle()` — steamer/edge detection
7. `run_arb_scan()` — detect PIN/Betfair arbs
8. `_maybe_save_ao_cache()` — persist cache to disk (every 30s)

### Frontend Data Flow
Supabase real-time subscription to `market_feed` → `groupData()` engine → per-event `MarketsCard` components with exchange and bookie price boxes.

### Key Database Table: `market_feed`
Core columns: `sport`, `event_name`, `runner_name`, `back_price`, `lay_price`, `price_pinnacle`, `price_bet365`, `price_paddy`, `bookmaker_prices` (JSONB), `volume`, `in_play`, `market_status`, `competition`, `start_time`, `last_updated`.

## Supported Sports

Configured in `backend/sports_config.py`:
- Basketball (NBA — competition 10547864)
- Soccer (EPL — competition 10932509)
- MMA (all)
- NFL (currently disabled — off-season)

## AsianOdds Rate Limits

Per market type — respect these strictly:
- Live (type 0): 5s
- Today (type 1): 10s
- Early (type 2): 20s

## Environment Variables

All secrets live in env vars (never commit `backend/config.py`, `certs/`, or `.env` files):
- `BETFAIR_USERNAME`, `BETFAIR_PASSWORD`, `BETFAIR_APP_KEY`, `BETFAIR_CERTS_PATH`
- `SUPABASE_URL`, `SUPABASE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `ODDS_API_KEY`
- `ASIANODDS_USERNAME`, `ASIANODDS_PASSWORD`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

## Code Conventions

- **Python**: PEP 8 style. Structured logging with timestamps. `_` prefix for internal functions. Global caches as module-level dicts. try/except with `logger.error()` for all API calls.
- **TypeScript**: Strict mode. Path alias `@/*` for imports. Tailwind for styling. Lucide React for icons.
- **Team name matching**: Ruthless normalization (lowercase, strip punctuation/spaces) + 100+ alias dictionary + fuzzy matching fallback.

## Specs and Requirements Docs

Read these before working on related features:
- `REQUIREMENTS-all-bookmakers.md` — expand dashboard to all UK bookmakers with best-price columns
- `SPEC_AO_THREAD.md` — move AsianOdds fetch to independent background thread
- `REQUIREMENTS-asianodds-api.md` — AsianOdds API integration (auth flow, endpoints, data format)
- `SPEC_ARB_SCANNER.md` — arbitrage scanning and logging (math, lifecycle tracking, alerts)
