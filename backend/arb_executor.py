"""
Arb Execution Module — Semi-automated two-leg trade (AO back + BF lay).

Called from telegram_callback.py when user taps "EXECUTE ARB" button.
7-step pipeline: BF revalidate -> AO placement info -> margin check ->
stake adjust -> AO PlaceBet -> verify -> BF placeOrders LAY.
"""
import os
import time
import sqlite3
import threading
import logging
from datetime import datetime, timezone

import betfairlightweight
from betfairlightweight import filters
import config

logger = logging.getLogger(__name__)

# --- CONFIGURATION ---
EXEC_ENABLED = os.getenv('EXEC_ENABLED', '0') == '1'
EXEC_BACK_STAKE = float(os.getenv('EXEC_BACK_STAKE', '5'))
EXEC_MIN_MARGIN = float(os.getenv('EXEC_MIN_MARGIN', '0.005'))
EXEC_SLIPPAGE = float(os.getenv('EXEC_SLIPPAGE', '0.005'))
EXEC_VERIFY_TIMEOUT = int(os.getenv('EXEC_VERIFY_TIMEOUT', '3'))
CHURN_MONTHLY_GOAL = float(os.getenv('CHURN_MONTHLY_GOAL', '5000'))
BETFAIR_COMMISSION = float(os.getenv('ARB_COMMISSION', '0.02'))

_exec_lock = threading.Lock()

# Separate BF client for executor thread (thread safety)
_bf_trading = None

# --- DATABASE ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHURN_DB_FILE = os.path.join(BASE_DIR, "churn_tracker.db")
_churn_db_initialized = False


def _init_churn_db():
    global _churn_db_initialized
    if _churn_db_initialized:
        return
    try:
        conn = sqlite3.connect(CHURN_DB_FILE)
        c = conn.cursor()
        c.execute('''
            CREATE TABLE IF NOT EXISTS executions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                sport TEXT, event_name TEXT, runner_name TEXT,
                ao_ref TEXT, bf_bet_id TEXT,
                ao_stake REAL, ao_price REAL,
                bf_lay_stake REAL, bf_lay_price REAL,
                margin_pct REAL, expected_profit REAL,
                status TEXT DEFAULT 'executed',
                error_message TEXT,
                month_key TEXT
            )
        ''')
        conn.commit()
        conn.close()
        _churn_db_initialized = True
    except Exception as e:
        logger.error(f"Churn DB init error: {e}")


def _log_execution(ctx, ao_ref=None, bf_bet_id=None, ao_stake=0, ao_price=0,
                   bf_lay_stake=0, bf_lay_price=0, margin_pct=0, expected_profit=0,
                   status='executed', error_message=None):
    _init_churn_db()
    now = datetime.now(timezone.utc)
    try:
        conn = sqlite3.connect(CHURN_DB_FILE)
        c = conn.cursor()
        c.execute('''
            INSERT INTO executions (timestamp, sport, event_name, runner_name,
                ao_ref, bf_bet_id, ao_stake, ao_price, bf_lay_stake, bf_lay_price,
                margin_pct, expected_profit, status, error_message, month_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            now.isoformat(),
            ctx.get('sport', ''),
            ctx.get('event_name', ''),
            ctx.get('runner_name', ''),
            ao_ref, bf_bet_id,
            ao_stake, ao_price, bf_lay_stake, bf_lay_price,
            margin_pct, expected_profit, status, error_message,
            now.strftime('%Y-%m')
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Churn DB write error: {e}")


def _send_msg(text):
    from telegram_alerts import send_telegram_message
    send_telegram_message(text)


def _calc_margin(p_b, p_l):
    """Net arb margin after BF commission. Positive = profitable."""
    return ((1 - BETFAIR_COMMISSION) * (p_b - 1) - (p_l - 1)) / p_b


def _calc_lay_stake(back_stake, p_b, p_l):
    """Lay stake for equal profit both ways (accounting for BF commission)."""
    return back_stake * p_b / (p_l - BETFAIR_COMMISSION * (p_l - 1))


def _get_bf_client():
    """Get or create a BF API client for the executor thread."""
    global _bf_trading
    if _bf_trading is None:
        _bf_trading = betfairlightweight.APIClient(
            username=config.USERNAME,
            password=config.PASSWORD,
            app_key=config.APP_KEY,
            certs=config.CERTS_PATH
        )
    if not _bf_trading.session_token:
        _bf_trading.login()
    return _bf_trading


def execute_arb(ctx):
    """
    Execute a two-leg arb trade. 7-step pipeline with safety checks.

    ctx keys:
        market_feed_id, sport, event_name, runner_name,
        market_id, selection_id, pin_back, bf_lay,
        ao_game_id, ao_game_type, ao_is_full_time, ao_market_type_id,
        ao_odds_name, ao_sports_type, ao_bookie_code
    """
    if not _exec_lock.acquire(blocking=False):
        _send_msg("⚠️ Another execution in progress. Try again.")
        return

    try:
        _execute_arb_inner(ctx)
    finally:
        _exec_lock.release()


def _execute_arb_inner(ctx):
    _init_churn_db()

    runner = ctx.get('runner_name', '?')
    event = ctx.get('event_name', '?')

    # --- KILL SWITCH ---
    if not EXEC_ENABLED:
        _send_msg(
            f"🔒 <b>EXEC DISABLED (dry run)</b>\n"
            f"Would execute: <b>{runner}</b>\n"
            f"{event}\n\n"
            f"AO back @ {ctx.get('pin_back', 0):.3f}\n"
            f"BF lay @ {ctx.get('bf_lay', 0):.3f}\n"
            f"Stake: €{EXEC_BACK_STAKE}"
        )
        _log_execution(ctx, status='dry_run', ao_price=ctx.get('pin_back', 0),
                       bf_lay_price=ctx.get('bf_lay', 0))
        return

    # --- Step 1: Re-validate BF lay price ---
    _send_msg(f"⚡ <b>Executing arb: {runner}</b>\nStep 1: Validating BF lay...")

    try:
        trading = _get_bf_client()

        price_projection = filters.price_projection(
            price_data=['EX_BEST_OFFERS']
        )
        market_books = trading.betting.list_market_book(
            market_ids=[ctx['market_id']],
            price_projection=price_projection
        )

        if not market_books:
            _send_msg(f"❌ BF market not found: {ctx['market_id']}")
            _log_execution(ctx, status='failed', error_message='BF market not found')
            return

        book = market_books[0]

        if book.inplay:
            _send_msg(f"❌ Market is now IN-PLAY. Aborting.")
            _log_execution(ctx, status='failed', error_message='Market now in-play')
            return

        if book.status != 'OPEN':
            _send_msg(f"❌ Market status: {book.status}. Aborting.")
            _log_execution(ctx, status='failed', error_message=f'Market status: {book.status}')
            return

        runner_book = None
        for r in book.runners:
            if r.selection_id == ctx['selection_id']:
                runner_book = r
                break

        if not runner_book or runner_book.status != 'ACTIVE':
            _send_msg(f"❌ Runner not active on BF. Aborting.")
            _log_execution(ctx, status='failed', error_message='Runner not active')
            return

        if not runner_book.ex.available_to_lay:
            _send_msg(f"❌ No BF lay available. Aborting.")
            _log_execution(ctx, status='failed', error_message='No lay available')
            return

        live_bf_lay = runner_book.ex.available_to_lay[0].price
        bf_lay_size = runner_book.ex.available_to_lay[0].size

    except Exception as e:
        _send_msg(f"❌ BF validation error: {e}")
        _log_execution(ctx, status='failed', error_message=f'BF error: {e}')
        return

    # --- Step 2: AO GetPlacementInfo ---
    _send_msg(f"Step 2: Checking AO placement...")

    try:
        from asianodds_client import get_client
        ao_client = get_client()
        if not ao_client:
            _send_msg(f"❌ AO client not available. Aborting.")
            _log_execution(ctx, status='failed', error_message='AO client unavailable')
            return

        placement_info = ao_client.get_placement_info(
            game_id=ctx['ao_game_id'],
            game_type=ctx.get('ao_game_type', 'X'),
            is_full_time=ctx.get('ao_is_full_time', 1),
            bookies=ctx.get('ao_bookie_code', 'PIN'),
            market_type_id=ctx.get('ao_market_type_id', 1),
            odds_format='00',
            odds_name=ctx.get('ao_odds_name', 'HomeOdds'),
            sports_type=ctx.get('ao_sports_type', 1)
        )

        if not placement_info or placement_info.get('Code') != 0:
            code = placement_info.get('Code') if placement_info else None
            _send_msg(f"❌ AO GetPlacementInfo failed (Code={code}). Aborting.")
            _log_execution(ctx, status='failed',
                           error_message=f'AO placement info failed: Code={code}')
            return

        result = placement_info.get('Result') or {}
        placement_data = result.get('PlacementData') or result.get('Data') or [{}]
        if isinstance(placement_data, list) and placement_data:
            pd_item = placement_data[0]
        else:
            pd_item = placement_data if isinstance(placement_data, dict) else {}

        live_pin_price = float(pd_item.get('Odds') or pd_item.get('Price') or 0)
        ao_min_amount = float(pd_item.get('MinimumAmount') or pd_item.get('MinAmount') or 0)
        ao_max_amount = float(pd_item.get('MaximumAmount') or pd_item.get('MaxAmount') or 99999)

        if live_pin_price <= 1.01:
            _send_msg(f"❌ AO live price invalid: {live_pin_price}. Aborting.")
            _log_execution(ctx, status='failed',
                           error_message=f'AO price invalid: {live_pin_price}')
            return

        logger.info(f"AO placement: price={live_pin_price}, min={ao_min_amount}, max={ao_max_amount}")

    except Exception as e:
        _send_msg(f"❌ AO placement check error: {e}")
        _log_execution(ctx, status='failed', error_message=f'AO placement error: {e}')
        return

    # --- Step 3: Margin check ---
    margin = _calc_margin(live_pin_price, live_bf_lay)
    min_required = EXEC_MIN_MARGIN + EXEC_SLIPPAGE

    if margin < min_required:
        _send_msg(
            f"❌ Margin too thin: {margin*100:.2f}% (need {min_required*100:.2f}%)\n"
            f"PIN: {live_pin_price:.3f}, BF lay: {live_bf_lay:.3f}"
        )
        _log_execution(ctx, status='margin_gone', ao_price=live_pin_price,
                       bf_lay_price=live_bf_lay, margin_pct=margin * 100)
        return

    # --- Step 4: Adjust stake ---
    ao_stake = EXEC_BACK_STAKE
    ao_stake = max(ao_stake, ao_min_amount)
    ao_stake = min(ao_stake, ao_max_amount)

    # Check BF depth
    needed_lay_stake = _calc_lay_stake(ao_stake, live_pin_price, live_bf_lay)
    if needed_lay_stake > bf_lay_size:
        # Reduce back stake to fit BF depth
        reduction_ratio = bf_lay_size / needed_lay_stake
        ao_stake = ao_stake * reduction_ratio * 0.95  # 5% buffer
        ao_stake = max(ao_stake, ao_min_amount)
        needed_lay_stake = _calc_lay_stake(ao_stake, live_pin_price, live_bf_lay)
        logger.info(f"Stake reduced to fit BF depth: €{ao_stake:.2f}")

    expected_profit = margin * ao_stake

    _send_msg(
        f"Steps 3-4: ✅ Margin OK: {margin*100:.2f}%\n"
        f"PIN: {live_pin_price:.3f}, BF lay: {live_bf_lay:.3f}\n"
        f"AO stake: €{ao_stake:.2f}, BF lay: €{needed_lay_stake:.2f}\n"
        f"Expected profit: €{expected_profit:.2f}"
    )

    # --- Step 5: AO PlaceBet ---
    _send_msg(f"Step 5: Placing AO back bet...")

    try:
        place_result = ao_client.place_bet(
            game_id=ctx['ao_game_id'],
            game_type=ctx.get('ao_game_type', 'X'),
            is_full_time=ctx.get('ao_is_full_time', 1),
            market_type_id=ctx.get('ao_market_type_id', 1),
            odds_format='00',
            odds_name=ctx.get('ao_odds_name', 'HomeOdds'),
            sports_type=ctx.get('ao_sports_type', 1),
            bookie_odds=live_pin_price,
            amount=ao_stake
        )

        if not place_result or place_result.get('Code') != 0:
            code = place_result.get('Code') if place_result else None
            result_data = place_result.get('Result') if place_result else None
            _send_msg(f"❌ AO PlaceBet failed (Code={code}). Aborting.\n{result_data}")
            _log_execution(ctx, status='ao_failed', ao_stake=ao_stake,
                           ao_price=live_pin_price,
                           error_message=f'AO place bet failed: Code={code}')
            return

        ao_result = place_result.get('Result') or {}
        bet_ref = ao_result.get('BetPlacementReference') or ao_result.get('PlaceBetId')

        if not bet_ref:
            _send_msg(
                f"🚨 <b>CHECK MANUALLY</b>\n"
                f"AO bet placed but no reference returned.\n"
                f"Response: {ao_result}"
            )
            _log_execution(ctx, status='ao_no_ref', ao_stake=ao_stake,
                           ao_price=live_pin_price,
                           error_message='No bet reference returned')
            return

    except Exception as e:
        _send_msg(f"❌ AO PlaceBet error: {e}")
        _log_execution(ctx, status='ao_error', ao_stake=ao_stake,
                       ao_price=live_pin_price, error_message=f'AO place error: {e}')
        return

    # --- Step 6: Verify AO bet ---
    _send_msg(f"Step 6: Verifying AO bet (ref: {bet_ref})...")

    ao_confirmed = False
    confirmed_stake = ao_stake
    verify_start = time.time()

    while time.time() - verify_start < EXEC_VERIFY_TIMEOUT:
        try:
            verify_result = ao_client.get_bet_by_reference(bet_ref)
            if verify_result and verify_result.get('Code') == 0:
                bet_data = verify_result.get('Result') or {}
                bets = (bet_data.get('Bets') or bet_data.get('BetList')
                        or bet_data.get('Data') or [])
                if isinstance(bets, list) and bets:
                    bet = bets[0]
                    status = str(bet.get('Status') or '').lower()
                    if status in ('confirmed', 'accepted', 'running'):
                        confirmed_stake = float(
                            bet.get('Stake') or bet.get('ConfirmedStake') or ao_stake
                        )
                        ao_confirmed = True
                        break
                    elif status in ('rejected', 'cancelled', 'void'):
                        _send_msg(
                            f"❌ AO bet {status}. Aborting — no BF lay placed."
                        )
                        _log_execution(ctx, status=f'ao_{status}',
                                       ao_ref=str(bet_ref),
                                       ao_stake=ao_stake, ao_price=live_pin_price,
                                       error_message=f'AO bet {status}')
                        return
        except Exception as e:
            logger.warning(f"AO verify poll error: {e}")

        time.sleep(0.5)

    if not ao_confirmed:
        _send_msg(
            f"🚨🚨 <b>CHECK MANUALLY</b> 🚨🚨\n\n"
            f"AO bet ref <b>{bet_ref}</b> — verification timed out ({EXEC_VERIFY_TIMEOUT}s)\n"
            f"DO NOT place BF lay until AO bet is confirmed.\n\n"
            f"<b>{runner}</b> | {event}"
        )
        _log_execution(ctx, status='ao_timeout', ao_ref=str(bet_ref),
                       ao_stake=ao_stake, ao_price=live_pin_price,
                       error_message='AO verification timeout')
        return

    _send_msg(f"Step 6: ✅ AO bet confirmed. Stake: €{confirmed_stake:.2f}")

    # --- Step 7: BF placeOrders LAY ---
    _send_msg(f"Step 7: Placing BF lay...")

    # Recalculate lay stake with confirmed AO stake
    final_lay_stake = _calc_lay_stake(confirmed_stake, live_pin_price, live_bf_lay)
    final_lay_stake = round(final_lay_stake, 2)

    try:
        place_instruction = betfairlightweight.filters.place_instruction(
            order_type='LIMIT',
            selection_id=ctx['selection_id'],
            side='LAY',
            limit_order=betfairlightweight.filters.limit_order(
                size=final_lay_stake,
                price=live_bf_lay,
                persistence_type='LAPSE'
            )
        )

        place_orders_result = _get_bf_client().betting.place_orders(
            market_id=ctx['market_id'],
            instructions=[place_instruction]
        )

        bf_bet_id = None
        if place_orders_result and place_orders_result.place_instruction_reports:
            report = place_orders_result.place_instruction_reports[0]
            if report.status == 'SUCCESS':
                bf_bet_id = report.bet_id
            else:
                raise Exception(
                    f"BF order status: {report.status}, error: {report.error_code}"
                )
        else:
            raise Exception("No BF order response")

    except Exception as e:
        _send_msg(
            f"🚨🚨 <b>HEDGE MANUALLY</b> 🚨🚨\n\n"
            f"AO BACK confirmed (ref {bet_ref}, €{confirmed_stake:.2f} @ "
            f"{live_pin_price:.3f})\n"
            f"BF LAY FAILED: {e}\n\n"
            f"<b>You must lay {runner} manually on Betfair!</b>\n"
            f"Market: {ctx['market_id']}\n"
            f"Lay price ~{live_bf_lay:.3f}, stake ~€{final_lay_stake:.2f}"
        )
        _log_execution(ctx, status='bf_failed', ao_ref=str(bet_ref),
                       ao_stake=confirmed_stake, ao_price=live_pin_price,
                       bf_lay_stake=final_lay_stake, bf_lay_price=live_bf_lay,
                       margin_pct=margin * 100, expected_profit=expected_profit,
                       error_message=f'BF lay failed: {e}')
        return

    # --- SUCCESS ---
    _log_execution(ctx, ao_ref=str(bet_ref), bf_bet_id=str(bf_bet_id),
                   ao_stake=confirmed_stake, ao_price=live_pin_price,
                   bf_lay_stake=final_lay_stake, bf_lay_price=live_bf_lay,
                   margin_pct=margin * 100, expected_profit=expected_profit,
                   status='executed')

    # Monthly churn progress
    month_key = datetime.now(timezone.utc).strftime('%Y-%m')
    monthly_total = _get_monthly_churn(month_key)

    _send_msg(
        f"✅ <b>ARB EXECUTED</b> ✅\n\n"
        f"<b>{runner}</b>\n{event}\n\n"
        f"📌 AO Back: €{confirmed_stake:.2f} @ {live_pin_price:.3f} (ref: {bet_ref})\n"
        f"🔄 BF Lay: €{final_lay_stake:.2f} @ {live_bf_lay:.3f} (bet: {bf_bet_id})\n\n"
        f"📊 Margin: {margin*100:.2f}%\n"
        f"💰 Expected profit: €{expected_profit:.2f}\n\n"
        f"📈 Monthly churn: €{monthly_total:.0f} / €{CHURN_MONTHLY_GOAL:.0f}"
    )


def _get_monthly_churn(month_key):
    _init_churn_db()
    try:
        conn = sqlite3.connect(CHURN_DB_FILE)
        c = conn.cursor()
        c.execute(
            "SELECT COALESCE(SUM(ao_stake), 0) FROM executions "
            "WHERE month_key = ? AND status = 'executed'",
            (month_key,)
        )
        total = c.fetchone()[0]
        conn.close()
        return total
    except Exception:
        return 0
