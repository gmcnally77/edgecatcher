# EdgeCatcher / prop-dashboard

## Project Overview
Betting dashboard comparing Pinnacle (sharp) prices from AsianOdds against Betfair Exchange and soft bookmakers. Detects arbs, steamers, and value edges.

## Architecture
- **Backend**: Python (`backend/`), runs a main loop polling Betfair + Odds API, with a separate AO thread for Pinnacle prices. Writes to Supabase (`market_feed` table).
- **Frontend**: Next.js + Tailwind (`frontend/`), reads from Supabase real-time.
- **DB**: Supabase (Postgres). `market_feed` is the core table — all pricing data upserts there with `on_conflict='id'`.

## Key Files
- `backend/fetch_universal.py` — main engine: Betfair fetch, spy (Odds API), AO thread, arb scanner, steamer detection
- `backend/asianodds_client.py` — AO API client (login, register, getFeeds)
- `backend/sports_config.py` — sport configs, team alias maps, league settings
- `backend/arb_scanner.py` — arb detection (PIN back vs BF lay)
- `backend/telegram_alerts.py` — alert dispatch

## Specs
Read the relevant SPEC before working on a feature:
- `SPEC_ARB_SCANNER.md` — arb detection logic and maths
- `SPEC_PIN_STEAMERS.md` — PIN price move detection
- `SPEC_AO_THREAD.md` — AO thread architecture and shared state
- `SPEC_BEST_AVAILABLE.md` — best soft-book price display
- `SPEC_AUTO_TWITTER.md` — automated X/Twitter posting

## Production Server
- **SSH**: `ssh root@139.59.173.141`
- **Backend process**: `systemctl status odds-fetcher`
- **Logs**: `journalctl -u odds-fetcher --no-pager -n 100`
- **Code path**: `/opt/app/backend/`

## Critical Rules
- **AO rate limits**: Live=5s, Today=10s, Early=20s. Never reduce these.
- **AO market types**: 0=Live, 1=Today, 2=Early (NOT 1,2,3).
- **NBA is in Live market (type=0)**, league name is `*NBA`.
- **Delta merges must be field-level** — never overwrite populated BookieOdds with empty delta fields.
- **Arb detection uses PIN back vs BF lay only** — no other combinations.
- **Betfair session keep-alive** — sessions die after 1hr without activity.
- **Test locally before pushing** — production regressions (lost prices) are worse than slow fixes.
