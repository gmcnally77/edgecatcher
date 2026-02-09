"""
Arb Scanner — Detects PIN back vs Betfair lay arbitrage opportunities.
Read-only on market_feed. Logs arbs to local SQLite and sends daily Telegram report.
"""
import os
import time
import sqlite3
import logging
from datetime import datetime, timezone, timedelta

from telegram_alerts import send_telegram_message

logger = logging.getLogger(__name__)

# --- CONFIGURATION ---
BETFAIR_COMMISSION = float(os.getenv('ARB_COMMISSION', '0.02'))
ARB_MIN_MARGIN = float(os.getenv('ARB_MIN_MARGIN', '0.001'))      # 0.1% min to log
ARB_ALERT_MARGIN = float(os.getenv('ARB_ALERT_MARGIN', '0.005'))  # 0.5% min for live Telegram alert
ARB_MIN_VOLUME = int(os.getenv('ARB_MIN_VOLUME', '100'))          # Min BF matched volume
ARB_MAX_AGE_SECONDS = int(os.getenv('ARB_MAX_AGE', '60'))         # Reject rows older than 60s
ARB_MAX_MARGIN = float(os.getenv('ARB_MAX_MARGIN', '0.05'))       # 5% cap — anything higher is stale data
ARB_ENABLED = os.getenv('ARB_ENABLED', '1') == '1'                # On by default

# --- DATABASE ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ARB_DB_FILE = os.path.join(BASE_DIR, "arb_log.db")

_open_arbs = {}          # market_feed_id -> {first_seen, peak_margin, data}
_last_daily_report = 0   # timestamp of last daily report
_db_initialized = False


def _init_db():
    global _db_initialized
    if _db_initialized:
        return
    try:
        conn = sqlite3.connect(ARB_DB_FILE)
        c = conn.cursor()
        c.execute('''
            CREATE TABLE IF NOT EXISTS arb_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                market_feed_id TEXT,
                sport TEXT,
                event_name TEXT,
                runner_name TEXT,
                pin_back REAL,
                bf_lay REAL,
                bf_back REAL,
                margin_pct REAL,
                volume INTEGER,
                first_seen TEXT,
                last_seen TEXT,
                gone_at TEXT,
                duration_seconds INTEGER,
                peak_margin_pct REAL
            )
        ''')
        c.execute('''
            CREATE INDEX IF NOT EXISTS idx_arb_first_seen ON arb_log(first_seen)
        ''')
        conn.commit()
        conn.close()
        _db_initialized = True
    except Exception as e:
        logger.error(f"Arb DB init error: {e}")


def _log_arb_open(arb, now):
    try:
        conn = sqlite3.connect(ARB_DB_FILE)
        c = conn.cursor()
        c.execute('''
            INSERT INTO arb_log (market_feed_id, sport, event_name, runner_name,
                pin_back, bf_lay, bf_back, margin_pct, volume, first_seen, last_seen, peak_margin_pct)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            str(arb['id']), arb['sport'], arb['event'], arb['runner'],
            arb['pin_back'], arb['bf_lay'], arb['bf_back'],
            arb['margin_pct'], arb['volume'],
            now.isoformat(), now.isoformat(), arb['margin_pct']
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Arb DB write error: {e}")


def _log_arb_update(market_feed_id, now, peak_margin):
    try:
        conn = sqlite3.connect(ARB_DB_FILE)
        c = conn.cursor()
        c.execute('''
            UPDATE arb_log SET last_seen = ?, peak_margin_pct = ?
            WHERE market_feed_id = ? AND gone_at IS NULL
        ''', (now.isoformat(), peak_margin, str(market_feed_id)))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Arb DB update error: {e}")


def _log_arb_close(market_feed_id, now, duration, peak_margin):
    try:
        conn = sqlite3.connect(ARB_DB_FILE)
        c = conn.cursor()
        c.execute('''
            UPDATE arb_log SET gone_at = ?, duration_seconds = ?, peak_margin_pct = ?
            WHERE market_feed_id = ? AND gone_at IS NULL
        ''', (now.isoformat(), int(duration), peak_margin, str(market_feed_id)))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Arb DB close error: {e}")


def calc_margin(p_b, p_l):
    """Calculate arb margin. Positive = profitable."""
    return ((1 - BETFAIR_COMMISSION) * (p_b - 1) - (p_l - 1)) / p_b


def calc_lay_stake(back_stake, p_b, p_l):
    """Optimal lay stake for equal profit both ways."""
    return back_stake * p_b / (p_l - BETFAIR_COMMISSION * (p_l - 1))


def scan_arbs(supabase_client):
    """Scan market_feed for arb opportunities. Returns sorted list."""
    try:
        response = supabase_client.table('market_feed') \
            .select('id,sport,event_name,runner_name,price_pinnacle,lay_price,back_price,volume,start_time,last_updated') \
            .neq('market_status', 'CLOSED') \
            .not_.is_('price_pinnacle', 'null') \
            .not_.is_('lay_price', 'null') \
            .execute()
    except Exception as e:
        logger.error(f"Arb scan DB error: {e}")
        return []

    arbs = []
    now = datetime.now(timezone.utc)

    for row in response.data or []:
        p_b = float(row.get('price_pinnacle') or 0)
        p_l = float(row.get('lay_price') or 0)

        if p_b <= 1.01 or p_l <= 1.01:
            continue

        # Reject stale rows — phantom arbs from old data
        last_updated = row.get('last_updated')
        if last_updated:
            try:
                lu_dt = datetime.fromisoformat(last_updated.replace('Z', '+00:00'))
                age = (now - lu_dt).total_seconds()
                if age > ARB_MAX_AGE_SECONDS:
                    continue
            except (ValueError, TypeError):
                continue
        else:
            continue  # No timestamp = can't trust it

        margin = calc_margin(p_b, p_l)

        if ARB_MIN_MARGIN <= margin <= ARB_MAX_MARGIN:
            arbs.append({
                'id': row['id'],
                'sport': row.get('sport', '?'),
                'event': row.get('event_name', '?'),
                'runner': row.get('runner_name', '?'),
                'pin_back': p_b,
                'bf_lay': p_l,
                'bf_back': float(row.get('back_price') or 0),
                'margin_pct': round(margin * 100, 3),
                'profit_per_100': round(margin * 100, 2),
                'volume': int(row.get('volume') or 0),
                'last_updated': row.get('last_updated', ''),
                'start_time': row.get('start_time', ''),
            })

    return sorted(arbs, key=lambda x: -x['margin_pct'])


def run_arb_scan(supabase_client):
    """Main entry point — call on every main loop tick."""
    if not ARB_ENABLED:
        return

    _init_db()

    now = datetime.now(timezone.utc)
    arbs = scan_arbs(supabase_client)
    current_ids = set()

    for arb in arbs:
        mid = arb['id']
        current_ids.add(mid)

        if mid not in _open_arbs:
            # New arb detected
            _open_arbs[mid] = {
                'first_seen': now,
                'peak_margin': arb['margin_pct'],
                'data': arb,
            }
            _log_arb_open(arb, now)
            logger.info(
                f"ARB: {arb['runner']} | PIN {arb['pin_back']:.3f} > BF lay {arb['bf_lay']:.3f} | "
                f"{arb['margin_pct']:.2f}% | vol=£{arb['volume']}"
            )

            # Live Telegram alert for big arbs
            if arb['margin_pct'] >= ARB_ALERT_MARGIN * 100 and arb['volume'] >= ARB_MIN_VOLUME:
                lay_stake = calc_lay_stake(100, arb['pin_back'], arb['bf_lay'])
                msg = (
                    f"<b>💰 ARB: {arb['runner']}</b>\n"
                    f"📋 {arb['event']}\n\n"
                    f"📌 PIN Back: <b>{arb['pin_back']:.3f}</b>\n"
                    f"🔄 BF Lay: <b>{arb['bf_lay']:.3f}</b>\n"
                    f"📊 Margin: <b>{arb['margin_pct']:.2f}%</b> (£{arb['profit_per_100']:.2f}/£100)\n"
                    f"💷 Lay £{lay_stake:.2f} per £100 back\n"
                    f"💰 BF Vol: £{arb['volume']:,}\n"
                    f"⏰ {arb['start_time'][:16] if arb['start_time'] else '?'}"
                )
                send_telegram_message(msg)
        else:
            # Update peak
            if arb['margin_pct'] > _open_arbs[mid]['peak_margin']:
                _open_arbs[mid]['peak_margin'] = arb['margin_pct']
            _log_arb_update(mid, now, _open_arbs[mid]['peak_margin'])

    # Close arbs that have disappeared
    for mid in list(_open_arbs.keys()):
        if mid not in current_ids:
            info = _open_arbs.pop(mid)
            duration = (now - info['first_seen']).total_seconds()
            _log_arb_close(mid, now, duration, info['peak_margin'])
            logger.info(
                f"ARB CLOSED: {info['data']['runner']} | lasted {duration:.0f}s | peak {info['peak_margin']:.2f}%"
            )

    # Daily report check
    _maybe_send_daily_report()


def _maybe_send_daily_report():
    """Send daily arb summary at midnight UTC."""
    global _last_daily_report

    now = time.time()
    now_utc = datetime.now(timezone.utc)

    # Fire once per day, at or after 00:00 UTC
    today_midnight = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    today_midnight_ts = today_midnight.timestamp()

    # Already sent today?
    if _last_daily_report >= today_midnight_ts:
        return

    # Only fire in the first 5 minutes after midnight (avoid re-firing all day)
    if now_utc.hour == 0 and now_utc.minute < 5:
        _send_daily_report(now_utc - timedelta(days=1))
        _last_daily_report = now


def _send_daily_report(report_date):
    """Build and send daily arb summary for the given date."""
    try:
        conn = sqlite3.connect(ARB_DB_FILE)
        c = conn.cursor()

        day_start = report_date.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        day_end = (report_date + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()

        # Total arbs detected
        c.execute(
            "SELECT COUNT(*) FROM arb_log WHERE first_seen >= ? AND first_seen < ?",
            (day_start, day_end)
        )
        total = c.fetchone()[0]

        if total == 0:
            msg = (
                f"<b>📊 DAILY ARB REPORT — {report_date.strftime('%d %b %Y')}</b>\n\n"
                f"No arbitrage opportunities detected."
            )
            send_telegram_message(msg)
            conn.close()
            return

        # Avg/max/min margin
        c.execute(
            "SELECT AVG(peak_margin_pct), MAX(peak_margin_pct), MIN(peak_margin_pct) "
            "FROM arb_log WHERE first_seen >= ? AND first_seen < ?",
            (day_start, day_end)
        )
        avg_margin, max_margin, min_margin = c.fetchone()

        # Avg duration (only closed arbs)
        c.execute(
            "SELECT AVG(duration_seconds), MAX(duration_seconds) "
            "FROM arb_log WHERE first_seen >= ? AND first_seen < ? AND duration_seconds IS NOT NULL",
            (day_start, day_end)
        )
        avg_dur, max_dur = c.fetchone()

        # By sport
        c.execute(
            "SELECT sport, COUNT(*), AVG(peak_margin_pct) "
            "FROM arb_log WHERE first_seen >= ? AND first_seen < ? GROUP BY sport ORDER BY COUNT(*) DESC",
            (day_start, day_end)
        )
        sport_rows = c.fetchall()

        # Top 5 arbs
        c.execute(
            "SELECT runner_name, event_name, pin_back, bf_lay, peak_margin_pct, duration_seconds "
            "FROM arb_log WHERE first_seen >= ? AND first_seen < ? ORDER BY peak_margin_pct DESC LIMIT 5",
            (day_start, day_end)
        )
        top_arbs = c.fetchall()

        conn.close()

        # Format message
        sport_lines = ""
        for sport, count, avg_m in sport_rows:
            sport_lines += f"  {sport}: {count} arbs, avg {avg_m:.2f}%\n"

        top_lines = ""
        for runner, event, pin, lay, margin, dur in top_arbs:
            dur_str = f"{dur}s" if dur else "still open"
            top_lines += f"  {runner}: {pin:.3f} PIN > {lay:.3f} BF ({margin:.2f}%, {dur_str})\n"

        avg_dur_str = f"{avg_dur:.0f}s" if avg_dur else "n/a"
        max_dur_str = f"{max_dur}s" if max_dur else "n/a"

        msg = (
            f"<b>📊 DAILY ARB REPORT — {report_date.strftime('%d %b %Y')}</b>\n\n"
            f"<b>Summary</b>\n"
            f"  Total arbs: {total}\n"
            f"  Margin: avg {avg_margin:.2f}% | best {max_margin:.2f}% | worst {min_margin:.2f}%\n"
            f"  Duration: avg {avg_dur_str} | longest {max_dur_str}\n\n"
            f"<b>By Sport</b>\n{sport_lines}\n"
            f"<b>Top Opportunities</b>\n{top_lines}"
        )

        send_telegram_message(msg)
        logger.info(f"Daily arb report sent for {report_date.strftime('%Y-%m-%d')}: {total} arbs")

    except Exception as e:
        logger.error(f"Daily arb report error: {e}")


def send_arb_report_now(supabase_client):
    """Manual trigger — send report for today so far. Call via /arbreport command."""
    _init_db()
    today = datetime.now(timezone.utc)
    _send_daily_report(today)
