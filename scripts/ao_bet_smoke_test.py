#!/usr/bin/env python3
"""
ao_bet_smoke_test.py — AsianOdds single-bet smoke test.

SAFETY: DRY_RUN is ON by default. To place a real bet you need BOTH:
  --dry-run false   AND   env CONFIRM_PLACEBET=YES

WARNING: Running this script logs in to AO, which may invalidate
any existing session (e.g., the production feed engine). Run only
when the production engine is stopped, or accept a re-auth cycle.

Examples:
  # Dry run — 1X2 Home on a soccer match by search
  python scripts/ao_bet_smoke_test.py \\
      --sport soccer --market today --search "Arsenal" \\
      --bet-type 1X2 --selection home --book PIN

  # Dry run — OU Over on NBA by game ID
  python scripts/ao_bet_smoke_test.py \\
      --sport basketball --market live \\
      --game-id 123456 --bet-type OU --selection over \\
      --total "210.5" --book PIN

  # Dry run — HDP Away on MMA
  python scripts/ao_bet_smoke_test.py \\
      --sport mma --market early --search "Njokuani" \\
      --bet-type HDP --selection away --book PIN --pick-first

  # Real tiny bet (requires CONFIRM_PLACEBET=YES)
  CONFIRM_PLACEBET=YES python scripts/ao_bet_smoke_test.py \\
      --sport soccer --market today --game-id 789 \\
      --bet-type HDP --selection home --handicap "-0.5" \\
      --book SIN --dry-run false --stake 2
"""

import argparse
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone

# --- PATH SETUP ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(SCRIPT_DIR, '..', 'backend')
sys.path.insert(0, BACKEND_DIR)

from asianodds_client import AsianOddsClient

# --- LOGGING WITH CREDENTIAL REDACTION ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger('ao_smoke_test')

REDACT_KEYS = {'token', 'key', 'password', 'aotoken', 'aokey'}


def redact(obj):
    """Deep-redact sensitive fields from dicts for safe logging."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k.lower() in REDACT_KEYS:
                out[k] = '***REDACTED***'
            else:
                out[k] = redact(v)
        return out
    elif isinstance(obj, list):
        return [redact(i) for i in obj]
    return obj


def pp(obj):
    """Pretty-print with redaction."""
    return json.dumps(redact(obj), indent=2, default=str)


# --- CONSTANTS ---
SPORT_NAME_MAP = {
    'soccer': 1, 'football': 1, 'epl': 1,
    'basketball': 2, 'nba': 2,
    'mma': 9, 'ufc': 9, 'fighting': 9,
}

MARKET_NAME_MAP = {'live': 0, 'today': 1, 'early': 2}

ODDS_FORMAT_ALIASES = {
    '00': '00', 'decimal': '00', 'euro': '00',
    'my': 'MY', 'malay': 'MY',
    'hk': 'HK', 'hongkong': 'HK',
}

GAME_TYPE_MAP = {'1X2': 'X', 'HDP': 'H', 'OU': 'O'}

MAX_STAKE_DEFAULT = 5.0


# ── Resolvers ──────────────────────────────────────────────────────

def resolve_sport_id(sport_str):
    try:
        return int(sport_str)
    except ValueError:
        pass
    key = sport_str.strip().lower()
    if key in SPORT_NAME_MAP:
        return SPORT_NAME_MAP[key]
    raise SystemExit(f"Unknown sport '{sport_str}'. Valid: {list(SPORT_NAME_MAP.keys())}")


def resolve_market_type(market_str):
    key = market_str.strip().lower()
    if key in MARKET_NAME_MAP:
        return MARKET_NAME_MAP[key]
    try:
        v = int(market_str)
        if v in (0, 1, 2):
            return v
    except ValueError:
        pass
    raise SystemExit(f"Unknown market '{market_str}'. Valid: live, today, early (or 0,1,2)")


def resolve_odds_format(fmt_str):
    key = fmt_str.strip().lower()
    if key in ODDS_FORMAT_ALIASES:
        return ODDS_FORMAT_ALIASES[key]
    if fmt_str.upper() in ('MY', '00', 'HK'):
        return fmt_str.upper()
    raise SystemExit(f"Unknown odds format '{fmt_str}'. Valid: MY, 00, HK")


def get_odds_name(bet_type, selection):
    mapping = {
        '1X2': {'home': 'HomeOdds', 'away': 'AwayOdds', 'draw': 'DrawOdds'},
        'HDP': {'home': 'HomeOdds', 'away': 'AwayOdds'},
        'OU':  {'over': 'OverOdds', 'under': 'UnderOdds'},
    }
    bt = bet_type.upper()
    sel = selection.lower()
    if bt not in mapping:
        raise SystemExit(f"Unknown bet type '{bet_type}'. Valid: 1X2, HDP, OU")
    if sel not in mapping[bt]:
        raise SystemExit(
            f"Invalid selection '{selection}' for {bet_type}. "
            f"Valid: {list(mapping[bt].keys())}"
        )
    return mapping[bt][sel]


def get_feed_field(bet_type, is_full_time):
    prefix = 'FullTime' if is_full_time else 'HalfTime'
    suffix = {'1X2': 'OneXTwo', 'HDP': 'Hdp', 'OU': 'Ou'}
    return f"{prefix}{suffix[bet_type.upper()]}"


# ── Feed helpers ───────────────────────────────────────────────────

def team_name(team_obj):
    if isinstance(team_obj, dict):
        return team_obj.get('Name', '')
    return ''


def format_kickoff(start_ms):
    if not start_ms:
        return '?'
    try:
        dt = datetime.fromtimestamp(int(start_ms) / 1000, tz=timezone.utc)
        return dt.strftime('%Y-%m-%d %H:%M UTC')
    except (ValueError, TypeError, OSError):
        return str(start_ms)


def parse_book_price(bookie_odds_str, book_code, bet_type, selection):
    """
    Extract a single price from a BookieOdds string.

    BookieOdds format:  "PIN=h,a,d;SIN=h,a,d;BEST=..."
    Position mapping:
      HDP:  0=Home, 1=Away
      OU:   0=Over, 1=Under
      1X2:  0=Home, 1=Away, 2=Draw
    """
    if not bookie_odds_str:
        return None

    idx_map = {
        'HDP': {'home': 0, 'away': 1},
        'OU':  {'over': 0, 'under': 1},
        '1X2': {'home': 0, 'away': 1, 'draw': 2},
    }
    idx = idx_map.get(bet_type.upper(), {}).get(selection.lower())
    if idx is None:
        return None

    for part in bookie_odds_str.split(';'):
        part = part.strip()
        if not part or part.upper().startswith('BEST'):
            continue

        bookie = prices_str = None
        if '=' in part:
            bookie, prices_str = part.split('=', 1)
        elif ':' in part:
            bookie, prices_str = part.split(':', 1)
        else:
            m = re.match(r'^([A-Za-z]+)([\d.,]+)$', part)
            if m:
                bookie, prices_str = m.group(1), m.group(2)

        if not bookie or not prices_str:
            continue
        if bookie.strip().upper() != book_code.upper():
            continue

        try:
            vals = prices_str.split(',')
            if idx < len(vals) and vals[idx]:
                return float(vals[idx])
        except (ValueError, IndexError):
            continue

    return None


# ── HTTP helper for POST-with-JSON-body ────────────────────────────

def post_json(client, endpoint, body):
    """POST with JSON body (GetPlacementInfo / PlaceBet use this)."""
    base = client.service_url or client.BASE_URL
    url = f"{base}/{endpoint}"
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if client.ao_token:
        headers["AOToken"] = client.ao_token
    if client.ao_key:
        headers["AOKey"] = client.ao_key

    logger.debug(f"POST {endpoint}  body={pp(body)}")

    try:
        resp = client.session.post(url, json=body, headers=headers, timeout=90)
        text = resp.text.lstrip('\ufeff')
        data = json.loads(text)
        if isinstance(data, dict) and data.get("Code") == 0:
            client.last_activity = time.time()
        return data
    except Exception as e:
        logger.error(f"POST {endpoint} failed: {e}")
        return None


# ── MAIN ───────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='AsianOdds single-bet smoke test',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    # Match identification
    g_match = parser.add_argument_group('Match identification')
    g_match.add_argument('--sport', required=True,
                         help='Sport name or AO SportsType ID (soccer/basketball/mma or 1/2/9)')
    g_match.add_argument('--market', required=True,
                         help='live|today|early (or 0|1|2)')
    g_match.add_argument('--game-id', type=int,
                         help='GameId from feed (direct, unambiguous)')
    g_match.add_argument('--search',
                         help='Search text to match in Home/Away team names')
    g_match.add_argument('--event-index', type=int, default=0,
                         help='Pick Nth match from search results (0-based, default: 0)')
    g_match.add_argument('--pick-first', action='store_true',
                         help='Auto-pick first search result')

    # Bet specification
    g_bet = parser.add_argument_group('Bet specification')
    g_bet.add_argument('--bet-type', required=True, choices=['1X2', 'HDP', 'OU'],
                       help='Bet type')
    g_bet.add_argument('--selection', required=True,
                       help='home|away|draw (1X2/HDP) or over|under (OU)')
    g_bet.add_argument('--handicap',
                       help='Handicap value for HDP (e.g., "-0.5", "1.0")')
    g_bet.add_argument('--total',
                       help='Total/goal line for OU (e.g., "2.5", "210.5")')
    g_bet.add_argument('--is-full-time', type=int, default=1, choices=[0, 1],
                       help='1=FullTime (default), 0=HalfTime')

    # Book and odds
    g_book = parser.add_argument_group('Book and odds')
    g_book.add_argument('--book', default='PIN',
                        help='Bookie code (default: PIN)')
    g_book.add_argument('--odds-format', default='00',
                        help='MY|00|HK (default: 00 = Decimal/Euro)')

    # Stake and safety
    g_safe = parser.add_argument_group('Stake and safety')
    g_safe.add_argument('--stake', type=float,
                        help='Stake amount (default: min stake from GetPlacementInfo)')
    g_safe.add_argument('--max-stake', type=float, default=MAX_STAKE_DEFAULT,
                        help=f'Hard cap on stake (default: {MAX_STAKE_DEFAULT})')
    g_safe.add_argument('--dry-run', default='true',
                        help='true|false (default: true)')
    g_safe.add_argument('--timeout', type=int, default=30,
                        help='GetPlacementInfo bookie timeout in seconds (default: 30)')

    args = parser.parse_args()

    # ── Resolve inputs ─────────────────────────────────────────────
    sport_id     = resolve_sport_id(args.sport)
    market_type  = resolve_market_type(args.market)
    odds_format  = resolve_odds_format(args.odds_format)
    bet_type     = args.bet_type.upper()
    selection    = args.selection.lower()
    game_type    = GAME_TYPE_MAP[bet_type]
    odds_name    = get_odds_name(bet_type, selection)
    feed_field   = get_feed_field(bet_type, args.is_full_time)
    is_full_time = args.is_full_time
    book         = args.book.upper()
    dry_run      = args.dry_run.lower() != 'false'
    max_stake    = args.max_stake

    # ── Safety gates ───────────────────────────────────────────────
    if market_type == 0:
        if os.getenv('ALLOW_LIVE', 'false').lower() != 'true':
            print("\n!! LIVE betting blocked. Set env ALLOW_LIVE=true to enable.")
            sys.exit(1)

    confirm_env = os.getenv('CONFIRM_PLACEBET', '')
    if not dry_run and confirm_env != 'YES':
        print("\n!! Real bet requested but env CONFIRM_PLACEBET != 'YES'.")
        print("   Export CONFIRM_PLACEBET=YES to proceed.")
        sys.exit(1)

    if not args.game_id and not args.search:
        print("!! Must provide --game-id or --search.")
        sys.exit(1)

    # ── Banner ─────────────────────────────────────────────────────
    mkt_label  = {0: 'LIVE', 1: 'TODAY', 2: 'EARLY'}[market_type]
    mode_label = 'DRY RUN' if dry_run else '*** REAL BET ***'

    print(f"\n{'='*60}")
    print(f"  AO Bet Smoke Test  [{mode_label}]")
    print(f"{'='*60}")
    print(f"  Sport:     {args.sport} (SportsType={sport_id})")
    print(f"  Market:    {mkt_label} (MarketTypeId={market_type})")
    print(f"  Bet Type:  {bet_type} (GameType={game_type})")
    print(f"  Selection: {selection} -> OddsName={odds_name}")
    print(f"  Feed Field:{feed_field}")
    print(f"  Book:      {book}")
    print(f"  Format:    {odds_format}")
    print(f"  FullTime:  {'Yes' if is_full_time else 'No (HalfTime)'}")
    if bet_type == 'HDP' and args.handicap:
        print(f"  Handicap:  {args.handicap}")
    if bet_type == 'OU' and args.total:
        print(f"  Total:     {args.total}")
    print(f"  Max Stake: {max_stake}")
    print(f"{'='*60}\n")

    # ══════════════════════════════════════════════════════════════
    # STEP 1: AUTHENTICATE
    # ══════════════════════════════════════════════════════════════
    print("[1/6] Authenticating...")
    client = AsianOddsClient()
    if not client.ensure_authenticated():
        print("  !! Authentication failed. Check ASIANODDS_USERNAME / ASIANODDS_PASSWORD.")
        sys.exit(1)
    print(f"  OK. Service URL: {client.service_url}")

    # ══════════════════════════════════════════════════════════════
    # STEP 2: FIND THE MATCH
    # ══════════════════════════════════════════════════════════════
    print(f"\n[2/6] Fetching feeds (sport={sport_id}, market={mkt_label}, since=0 for full snapshot)...")

    feed_result = client.get_feeds(
        sport_id, market_type_id=market_type,
        odds_format=odds_format, since=0
    )
    feed_sports = feed_result.get('sports', [])

    all_matches = []
    for sf in feed_sports:
        if sf and isinstance(sf, dict):
            all_matches.extend(sf.get('MatchGames', []) or [])

    print(f"  Feed returned {len(all_matches)} raw entries.")

    # Filter to active, non-removed entries
    active = [
        m for m in all_matches
        if m and isinstance(m, dict)
        and not m.get('WillBeRemoved', False)
        and m.get('IsActive', True) is not False
    ]
    print(f"  Active entries: {len(active)}")

    target = None

    if args.game_id:
        # ── Direct GameId lookup ───────────────────────────────
        print(f"  Looking up GameId={args.game_id}...")
        for m in active:
            if m.get('GameId') == args.game_id:
                target = m
                break

        if not target:
            print(f"  !! GameId {args.game_id} not found in {len(active)} active entries.")
            print("     Note: AO uses different GameIds per bet type (1X2/HDP/OU).")
            print("     Try --search instead, or use the GameId for the correct bet type.\n")
            # Show some available GameIds
            for m in active[:10]:
                h = team_name(m.get('HomeTeam'))
                a = team_name(m.get('AwayTeam'))
                gid = m.get('GameId', '?')
                lg = m.get('LeagueName', '?')
                print(f"     {gid} | {h} v {a} | {lg}")
            sys.exit(1)
        print(f"  Found.")

    else:
        # ── Search by team name ────────────────────────────────
        search_text = args.search.lower()
        print(f"  Searching for: '{args.search}'")

        candidates = []
        for m in active:
            home = team_name(m.get('HomeTeam'))
            away = team_name(m.get('AwayTeam'))
            combined = f"{home} {away}".lower()

            if search_text not in combined:
                continue

            # Must have the required odds block populated
            odds_block = m.get(feed_field) or {}
            if not isinstance(odds_block, dict) or not odds_block.get('BookieOdds'):
                continue

            candidates.append(m)

        if not candidates:
            print(f"\n  No matches for '{args.search}' with {feed_field} BookieOdds.")
            print(f"  Showing first 20 active entries:\n")
            for m in active[:20]:
                h = team_name(m.get('HomeTeam'))
                a = team_name(m.get('AwayTeam'))
                gid = m.get('GameId', '?')
                lg = m.get('LeagueName', '?')
                ob = m.get(feed_field) or {}
                has = 'Y' if (isinstance(ob, dict) and ob.get('BookieOdds')) else '-'
                print(f"    {gid} | {h} v {a} | {lg} | {feed_field}={has}")
            sys.exit(1)

        # Display candidates
        print(f"\n  Found {len(candidates)} match(es):\n")
        for i, m in enumerate(candidates):
            home = team_name(m.get('HomeTeam'))
            away = team_name(m.get('AwayTeam'))
            gid  = m.get('GameId', '?')
            lg   = m.get('LeagueName', '?')
            ko   = format_kickoff(m.get('StartTime'))
            ob   = m.get(feed_field, {})
            line = ''
            if bet_type == 'HDP':
                line = f" | HDP={ob.get('Handicap', '?')}"
            elif bet_type == 'OU':
                line = f" | Goal={ob.get('Goal', '?')}"
            print(f"  [{i}] GameId={gid} | {home} v {away}")
            print(f"      {lg} | {ko}{line}")

        # Pick one
        idx = 0 if (len(candidates) == 1 or args.pick_first) else args.event_index
        if idx >= len(candidates):
            print(f"\n  --event-index {idx} out of range (0..{len(candidates)-1})")
            sys.exit(1)

        target = candidates[idx]
        print(f"\n  -> Selected [{idx}]")

    # ══════════════════════════════════════════════════════════════
    # STEP 3: EXTRACT ODDS FROM FEED
    # ══════════════════════════════════════════════════════════════
    home    = team_name(target.get('HomeTeam'))
    away    = team_name(target.get('AwayTeam'))
    game_id = target.get('GameId')
    league  = target.get('LeagueName', '?')
    kickoff = format_kickoff(target.get('StartTime'))

    print(f"\n[3/6] Extracting {feed_field} odds...")
    print(f"  Event:    {home} v {away}")
    print(f"  GameId:   {game_id}")
    print(f"  League:   {league}")
    print(f"  Kick-off: {kickoff}")

    odds_block      = target.get(feed_field) or {}
    bookie_odds_str = odds_block.get('BookieOdds', '')

    if bet_type == 'HDP':
        feed_line = odds_block.get('Handicap', '?')
        print(f"  Handicap: {feed_line}")
        if args.handicap and str(feed_line) != args.handicap:
            print(f"  NOTE: Requested --handicap={args.handicap} but feed shows {feed_line}")
    elif bet_type == 'OU':
        feed_line = odds_block.get('Goal', '?')
        print(f"  Goal:     {feed_line}")
        if args.total and str(feed_line) != args.total:
            print(f"  NOTE: Requested --total={args.total} but feed shows {feed_line}")

    print(f"  BookieOdds: {bookie_odds_str[:200]}{'...' if len(bookie_odds_str) > 200 else ''}")

    feed_price = parse_book_price(bookie_odds_str, book, bet_type, selection)
    if feed_price is None:
        print(f"\n  !! Book '{book}' not found in {feed_field} odds for {selection}.")
        print(f"     Raw: {bookie_odds_str}")
        sys.exit(1)

    print(f"  -> {book} {selection} = {feed_price}")

    # ══════════════════════════════════════════════════════════════
    # STEP 4: GetPlacementInfo
    # ══════════════════════════════════════════════════════════════
    print(f"\n[4/6] GetPlacementInfo...")

    placement_body = {
        "GameId":       game_id,
        "GameType":     game_type,
        "IsFullTime":   is_full_time,
        "Bookies":      book,
        "MarketTypeId": market_type,
        "OddsFormat":   odds_format,
        "OddsName":     odds_name,
        "SportsType":   sport_id,
        "Timeout":      args.timeout,
    }
    print(f"  Request: {pp(placement_body)}")

    placement_resp = post_json(client, "GetPlacementInfo", placement_body)

    if not placement_resp:
        print("  !! No response from GetPlacementInfo.")
        sys.exit(1)

    if placement_resp.get('Code') != 0:
        print(f"  !! GetPlacementInfo Code={placement_resp.get('Code')}")
        print(f"     {pp(placement_resp)}")
        sys.exit(1)

    odds_data = (placement_resp.get('Result') or {}).get('OddsPlacementData', [])
    if not odds_data:
        print(f"  !! Empty OddsPlacementData. Response:\n{pp(placement_resp)}")
        sys.exit(1)

    # Find our book
    placement = None
    for od in odds_data:
        if od.get('Bookie', '').upper() == book:
            placement = od
            break

    if not placement:
        avail = [od.get('Bookie') for od in odds_data]
        print(f"  !! Book '{book}' not in results. Available: {avail}")
        sys.exit(1)

    pl_price    = placement.get('Price')
    min_amount  = placement.get('MinimumAmount', 0)
    max_amount  = placement.get('MaximumAmount', 0)
    rejected    = placement.get('Rejected', False)
    currency    = placement.get('Currency', '?')
    hdp_or_goal = placement.get('HDPorGoal', '')
    pl_message  = placement.get('Message')

    print(f"\n  GetPlacementInfo result:")
    print(f"    Book:      {book}")
    print(f"    Price:     {pl_price}")
    print(f"    Min Stake: {min_amount} {currency}")
    print(f"    Max Stake: {max_amount} {currency}")
    print(f"    HDP/Goal:  {hdp_or_goal}")
    print(f"    Rejected:  {rejected}")
    if pl_message:
        print(f"    Message:   {pl_message}")

    if rejected:
        print("\n  !! Placement REJECTED by bookie. Cannot proceed.")
        sys.exit(1)

    # ══════════════════════════════════════════════════════════════
    # STEP 5: DETERMINE STAKE & (OPTIONALLY) PLACE BET
    # ══════════════════════════════════════════════════════════════
    requested = args.stake if args.stake is not None else min_amount
    actual_stake = max(requested, min_amount)
    actual_stake = min(actual_stake, max_amount)
    actual_stake = min(actual_stake, max_stake)

    if actual_stake < min_amount:
        print(f"\n  !! Calculated stake {actual_stake} < minimum {min_amount}.")
        print(f"     Hard cap is {max_stake}. Increase --max-stake if intentional.")
        sys.exit(1)

    # BookieOdds for PlaceBet: "BOOK:PRICE"
    bookie_odds_value = f"{book}:{pl_price}"
    place_bet_id = f"SMOKE-{int(time.time())}"

    bet_body = {
        "PlaceBetId":   place_bet_id,
        "GameId":       game_id,
        "GameType":     game_type,
        "IsFullTime":   is_full_time,
        "MarketTypeId": market_type,
        "OddsFormat":   odds_format,
        "OddsName":     odds_name,
        "SportsType":   sport_id,
        "BookieOdds":   bookie_odds_value,
        "Amount":       actual_stake,
    }

    action = 'DRY RUN -- would place' if dry_run else 'PLACING'
    print(f"\n[5/6] {action} bet:")
    print(f"    Stake:      {actual_stake} {currency}")
    print(f"    BookieOdds: {bookie_odds_value}")
    print(f"    Event:      {home} v {away}")
    print(f"    Type:       {bet_type} {selection}")
    print(f"    PlaceBetId: {place_bet_id}")
    print(f"\n    Full body:  {pp(bet_body)}")

    if dry_run:
        print(f"\n  DRY RUN complete. No bet placed.")
        print(f"  To go live:  --dry-run false  +  env CONFIRM_PLACEBET=YES")
        sys.exit(0)

    # ── REAL BET ───────────────────────────────────────────────
    print(f"\n  >>> Sending PlaceBet to AO...")
    bet_resp = post_json(client, "PlaceBet", bet_body)

    if not bet_resp:
        print("  !! PlaceBet: no response")
        sys.exit(1)

    if bet_resp.get('Code') != 0:
        print(f"  !! PlaceBet failed. Code={bet_resp.get('Code')}")
        print(f"     {pp(bet_resp)}")
        sys.exit(1)

    bet_result = bet_resp.get('Result', {})

    # Response can be two shapes:
    #   New: {"PlacementData": [{"BetPlacementReference": "...", ...}]}
    #   Old: {"BetPlacementReference": "...", "Message": "..."}
    placement_data = bet_result.get('PlacementData', [])
    if placement_data:
        first = placement_data[0]
        bet_ref = first.get('BetPlacementReference')
        msg = first.get('Message', '')
    else:
        bet_ref = bet_result.get('BetPlacementReference')
        msg = bet_result.get('Message', '')

    print(f"\n  PlaceBet accepted!")
    print(f"    Reference: {bet_ref}")
    print(f"    Message:   {msg}")

    # ══════════════════════════════════════════════════════════════
    # STEP 6: CHECK BET STATUS
    # ══════════════════════════════════════════════════════════════
    if not bet_ref:
        print(f"\n[6/6] No reference returned. Check GetBets manually.")
        sys.exit(0)

    print(f"\n[6/6] Checking bet status (GetBetByReference)...")
    time.sleep(3)

    status_resp = client._request("GET", "GetBetByReference", {"betReference": bet_ref})

    if not status_resp or status_resp.get('Code') != 0:
        print(f"  Could not retrieve status. Use reference to check manually:")
        print(f"    betReference={bet_ref}")
        sys.exit(0)

    sr = status_resp.get('Result', {})
    print(f"\n  Bet Status:")
    print(f"    Status:     {sr.get('Status', '?')}")
    print(f"    Bookie:     {sr.get('Bookie', '?')}")
    print(f"    Odds:       {sr.get('Odds', '?')}")
    print(f"    Stake:      {sr.get('Stake', '?')} {sr.get('Currency', '?')}")
    print(f"    RefNumber:  {sr.get('ReferenceNumber', '?')}")
    print(f"    Home:       {sr.get('HomeName', '?')}")
    print(f"    Away:       {sr.get('AwayName', '?')}")
    print(f"    League:     {sr.get('LeagueName', '?')}")
    print(f"    BetType:    {sr.get('BetType', '?')}")
    print(f"    HDP/Goal:   {sr.get('HdpOrGoal', '?')}")
    print(f"    Term:       {sr.get('Term', '?')}")

    print(f"\nDone.")


if __name__ == '__main__':
    main()
