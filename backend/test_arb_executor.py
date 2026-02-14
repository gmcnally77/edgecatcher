"""
Arb Executor Test Script — Phases 1-2 verification.

Tests:
  1. AO execution context is populated for live matches
  2. AO GetPlacementInfo works for a real match
  3. BF market book lookup works
  4. Dry-run execute_arb() with EXEC_ENABLED=0

Usage:
  cd backend/
  python3 test_arb_executor.py
"""
import os
import sys
import time
import logging

# Force EXEC_ENABLED=0 for safety
os.environ['EXEC_ENABLED'] = '0'

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

import config
from supabase import create_client

supabase = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)

# ─── TEST 1: Check AO execution context populates ───

def test_ao_context():
    """Verify _ao_execution_context gets populated for matched rows."""
    print("\n" + "=" * 60)
    print("TEST 1: AO Execution Context")
    print("=" * 60)

    from fetch_universal import (
        _ao_execution_context, _ao_fetch_one_tick, _ao_match_all_cached,
        _cached_active_rows, ASIANODDS_ENABLED
    )

    if not ASIANODDS_ENABLED:
        print("SKIP: AsianOdds not enabled")
        return {}

    # Need cached active rows — trigger a spy run first
    from fetch_universal import run_spy
    run_spy()

    # Run AO fetch + match
    print("Fetching AO data...")
    for _ in range(3):  # A few ticks to build cache
        _ao_fetch_one_tick()
        time.sleep(1)

    _ao_match_all_cached()

    if not _ao_execution_context:
        print("WARNING: No AO execution context populated yet (may need more ticks)")
        print(f"  Cached active rows: {len(_cached_active_rows)}")
        return {}

    print(f"SUCCESS: {len(_ao_execution_context)} entries in AO execution context")

    # Find Sunderland v Fulham - The Draw
    target_ctx = None
    target_id = None
    for mid, ctx in _ao_execution_context.items():
        row = next((r for r in _cached_active_rows if r['id'] == mid), None)
        if row:
            if 'sunderland' in (row.get('event_name') or '').lower():
                print(f"\n  FOUND: {row['runner_name']} in {row['event_name']}")
                print(f"    AO Game ID: {ctx.get('ao_game_id')}")
                print(f"    Market Type: {ctx.get('ao_market_type_id')}")
                print(f"    Odds Name: {ctx.get('ao_odds_name')}")
                print(f"    Sports Type: {ctx.get('ao_sports_type')}")
                print(f"    Bookie: {ctx.get('ao_bookie_code')}")
                if 'draw' in (row.get('runner_name') or '').lower():
                    target_ctx = ctx
                    target_id = mid

    return {'target_ctx': target_ctx, 'target_id': target_id}


# ─── TEST 2: AO GetPlacementInfo ───

def test_ao_placement(ao_ctx):
    """Test GetPlacementInfo for a real match."""
    print("\n" + "=" * 60)
    print("TEST 2: AO GetPlacementInfo")
    print("=" * 60)

    if not ao_ctx:
        print("SKIP: No AO context for target match")
        return

    from asianodds_client import get_client
    ao_client = get_client()
    if not ao_client:
        print("SKIP: AO client not available")
        return

    game_id = ao_ctx.get('ao_game_id')
    if not game_id:
        print("FAIL: No ao_game_id in context")
        return

    print(f"Calling GetPlacementInfo for GameId={game_id}...")

    result = ao_client.get_placement_info(
        game_id=game_id,
        game_type=ao_ctx.get('ao_game_type', 'X'),
        is_full_time=ao_ctx.get('ao_is_full_time', 1),
        bookies=ao_ctx.get('ao_bookie_code', 'PIN'),
        market_type_id=ao_ctx.get('ao_market_type_id', 1),
        odds_format='00',
        odds_name=ao_ctx.get('ao_odds_name', 'HomeOdds'),
        sports_type=ao_ctx.get('ao_sports_type', 1)
    )

    if not result:
        print("FAIL: No response from GetPlacementInfo")
        return

    print(f"  Code: {result.get('Code')}")
    print(f"  Result: {result.get('Result')}")

    if result.get('Code') == 0:
        r = result.get('Result') or {}
        pd = r.get('PlacementData') or r.get('Data') or [{}]
        if isinstance(pd, list) and pd:
            item = pd[0]
            print(f"\n  Live Price: {item.get('Odds') or item.get('Price')}")
            print(f"  Min Amount: {item.get('MinimumAmount') or item.get('MinAmount')}")
            print(f"  Max Amount: {item.get('MaximumAmount') or item.get('MaxAmount')}")
            print("  SUCCESS: GetPlacementInfo works!")
        else:
            print(f"  PlacementData: {pd}")
    else:
        print(f"  FAIL: Code={result.get('Code')}")


# ─── TEST 3: BF Market Book Lookup ───

def test_bf_lookup():
    """Test BF market book lookup for Sunderland v Fulham."""
    print("\n" + "=" * 60)
    print("TEST 3: BF Market Book Lookup")
    print("=" * 60)

    # Get market_id and selection_id from Supabase
    try:
        response = supabase.table('market_feed') \
            .select('id,market_id,selection_id,runner_name,event_name,lay_price,back_price,price_pinnacle') \
            .ilike('event_name', '%sunderland%fulham%') \
            .neq('market_status', 'CLOSED') \
            .execute()
    except Exception as e:
        print(f"FAIL: Supabase query error: {e}")
        return None, None

    if not response.data:
        print("No rows found for Sunderland v Fulham")
        return None, None

    print(f"Found {len(response.data)} runners:")
    target_row = None
    for row in response.data:
        pin = row.get('price_pinnacle') or 0
        lay = row.get('lay_price') or 0
        marker = " <<< TARGET" if 'draw' in (row.get('runner_name') or '').lower() else ""
        print(f"  {row['runner_name']}: PIN={pin}, Lay={lay}, MktId={row.get('market_id')}, SelId={row.get('selection_id')}{marker}")
        if 'draw' in (row.get('runner_name') or '').lower():
            target_row = row

    if not target_row:
        print("No Draw runner found")
        return None, None

    market_id = target_row.get('market_id')
    selection_id = target_row.get('selection_id')

    if not market_id or not selection_id:
        print(f"FAIL: Missing market_id ({market_id}) or selection_id ({selection_id})")
        return None, None

    # Test BF lookup
    import betfairlightweight
    from betfairlightweight import filters

    try:
        trading = betfairlightweight.APIClient(
            username=config.USERNAME,
            password=config.PASSWORD,
            app_key=config.APP_KEY,
            certs=config.CERTS_PATH
        )
        trading.login()

        price_proj = filters.price_projection(price_data=['EX_BEST_OFFERS'])
        books = trading.betting.list_market_book(
            market_ids=[market_id],
            price_projection=price_proj
        )

        if not books:
            print(f"FAIL: No market book for {market_id}")
            return target_row, None

        book = books[0]
        print(f"\n  Market Status: {book.status}")
        print(f"  In-Play: {book.inplay}")

        for r in book.runners:
            if r.selection_id == selection_id:
                lay = r.ex.available_to_lay[0] if r.ex.available_to_lay else None
                back = r.ex.available_to_back[0] if r.ex.available_to_back else None
                print(f"  The Draw — Status: {r.status}")
                if back:
                    print(f"    Best Back: {back.price} (£{back.size})")
                if lay:
                    print(f"    Best Lay: {lay.price} (£{lay.size})")
                print("  SUCCESS: BF lookup works!")
                break

        return target_row, book

    except Exception as e:
        print(f"FAIL: BF error: {e}")
        return target_row, None


# ─── TEST 4: Dry-Run execute_arb ───

def test_dry_run(target_row, ao_ctx):
    """Dry-run execute_arb with EXEC_ENABLED=0."""
    print("\n" + "=" * 60)
    print("TEST 4: Dry-Run execute_arb (EXEC_ENABLED=0)")
    print("=" * 60)

    if not target_row or not ao_ctx:
        print("SKIP: Missing target row or AO context")
        return

    from arb_executor import execute_arb, EXEC_ENABLED
    print(f"  EXEC_ENABLED = {EXEC_ENABLED} (should be False)")

    ctx = {
        'market_feed_id': target_row['id'],
        'sport': 'Soccer',
        'event_name': target_row.get('event_name', 'Sunderland v Fulham'),
        'runner_name': target_row.get('runner_name', 'The Draw'),
        'market_id': target_row.get('market_id'),
        'selection_id': target_row.get('selection_id'),
        'pin_back': float(target_row.get('price_pinnacle') or 3.43),
        'bf_lay': float(target_row.get('lay_price') or 3.40),
        **ao_ctx,
    }

    print(f"\n  Context:")
    for k, v in ctx.items():
        print(f"    {k}: {v}")

    print(f"\n  Calling execute_arb()...")
    print("  (This will send a dry-run Telegram message)")

    execute_arb(ctx)
    print("  DONE — check Telegram for dry-run message")


# ─── MAIN ───

if __name__ == '__main__':
    print("=" * 60)
    print("ARB EXECUTOR TEST SUITE")
    print("EXEC_ENABLED=0 — Safe dry-run mode")
    print("=" * 60)

    # Test 1: AO context
    ao_result = test_ao_context()
    ao_ctx = ao_result.get('target_ctx')

    # Test 2: AO placement (only if we have context)
    if ao_ctx:
        test_ao_placement(ao_ctx)

    # Test 3: BF lookup
    target_row, bf_book = test_bf_lookup()

    # Test 4: Dry run
    if target_row:
        # Use AO context if available, otherwise mock it
        if not ao_ctx:
            print("\n  NOTE: No AO context found — using mock context for dry run")
            ao_ctx = {
                'ao_game_id': 'UNKNOWN',
                'ao_game_type': 'X',
                'ao_is_full_time': 1,
                'ao_market_type_id': 1,
                'ao_odds_name': 'DrawOdds',
                'ao_sports_type': 1,
                'ao_bookie_code': 'PIN',
            }
        test_dry_run(target_row, ao_ctx)

    print("\n" + "=" * 60)
    print("TEST COMPLETE")
    print("=" * 60)
