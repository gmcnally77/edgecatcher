"""
Source-level steamer detection.

Hooks into _ao_match_all_cached() and fetch_betfair() to detect sharp price
shortenings using implied probability shift. No Supabase reads — prices are
captured at the moment of observation.

Run tests: python backend/test_steamer_alerts.py
"""
import os
import time
import logging
from datetime import datetime, timezone

import telegram_alerts

logger = logging.getLogger(__name__)

# --- CONFIG (all env-overridable) ---
STEAM_WINDOW = int(os.getenv('STEAM_WINDOW', '900'))                  # 15-min lookback
STEAM_THRESHOLD = float(os.getenv('STEAM_THRESHOLD', '0.03'))         # 3pp implied prob shift
STEAM_COOLDOWN = int(os.getenv('STEAM_COOLDOWN', '1800'))             # 30-min per-runner cooldown
STEAM_REALERT_INCREMENT = float(os.getenv('STEAM_REALERT_INCREMENT', '0.02'))  # re-alert if +2pp more
STEAM_MIN_PRICE = float(os.getenv('STEAM_MIN_PRICE', '1.10'))
STEAM_MAX_PRICE = float(os.getenv('STEAM_MAX_PRICE', '10.0'))
STEAM_PIN_ENABLED = os.getenv('STEAM_PIN_ENABLED', '1') == '1'
STEAM_BF_ENABLED = os.getenv('STEAM_BF_ENABLED', '1') == '1'

# --- IN-MEMORY STATE ---
_pin_history = {}    # row_id -> [(timestamp, price), ...]
_bf_history = {}     # row_id -> [(timestamp, price, volume), ...]
_last_alerted = {}   # (row_id, source) -> {'ts': float, 'shift_pp': float}
_metadata_cache = {} # row_id -> metadata dict (latest)


def implied_prob(price):
    """Convert decimal odds to implied probability."""
    if price <= 1.0:
        return 0.0
    return 1.0 / price


def _trim_history(history, now):
    """Remove entries older than STEAM_WINDOW, but keep the most recent
    pre-window observation as an anchor baseline. This prevents baseline
    loss when AO doesn't send a delta for longer than the window."""
    cutoff = now - STEAM_WINDOW
    in_window = [(t, p) for t, p in history if t >= cutoff]
    pre_window = [(t, p) for t, p in history if t < cutoff]
    # Keep the most recent pre-window entry as anchor
    if pre_window:
        return [pre_window[-1]] + in_window
    return in_window


def _trim_bf_history(history, now):
    """Same anchor logic as _trim_history but for BF 3-tuples (timestamp, price, volume)."""
    cutoff = now - STEAM_WINDOW
    in_window = [(t, p, v) for t, p, v in history if t >= cutoff]
    pre_window = [(t, p, v) for t, p, v in history if t < cutoff]
    if pre_window:
        return [pre_window[-1]] + in_window
    return in_window


def record_pin_price(row_id, price, metadata):
    """Record a PIN price observation from AO and check for steaming."""
    if not STEAM_PIN_ENABLED:
        return
    if price < STEAM_MIN_PRICE or price > STEAM_MAX_PRICE:
        return

    now = time.time()
    if row_id not in _pin_history:
        _pin_history[row_id] = []
    _pin_history[row_id].append((now, price))
    _pin_history[row_id] = _trim_history(_pin_history[row_id], now)
    _metadata_cache[row_id] = metadata

    _check_and_alert(row_id, 'PIN', _pin_history[row_id], now)


def record_bf_price(row_id, price, metadata):
    """Record a BF price observation and check for steaming."""
    if not STEAM_BF_ENABLED:
        return
    if price < STEAM_MIN_PRICE or price > STEAM_MAX_PRICE:
        return

    now = time.time()
    volume = metadata.get('volume', 0) or 0
    if row_id not in _bf_history:
        _bf_history[row_id] = []
    _bf_history[row_id].append((now, price, volume))
    _bf_history[row_id] = _trim_bf_history(_bf_history[row_id], now)
    _metadata_cache[row_id] = metadata

    # Compute volume matched during the window
    history = _bf_history[row_id]
    volume_matched = 0
    if len(history) >= 2:
        volume_matched = history[-1][2] - history[0][2]
        if volume_matched < 0:
            volume_matched = 0

    # Extract 2-tuples for _check_and_alert (same interface as PIN)
    history_2t = [(t, p) for t, p, v in history]
    _check_and_alert(row_id, 'BF', history_2t, now, volume_matched=volume_matched)


def _check_and_alert(row_id, source, history, now, volume_matched=0):
    """Check history for implied prob shift >= threshold, then maybe alert."""
    if len(history) < 2:
        return

    oldest_ts, oldest_price = history[0]
    latest_ts, latest_price = history[-1]

    prob_now = implied_prob(latest_price)
    prob_then = implied_prob(oldest_price)
    shift = prob_now - prob_then  # positive = shortening (steaming in)

    if shift < STEAM_THRESHOLD:
        return

    _maybe_alert(row_id, source, oldest_price, latest_price, shift, oldest_ts, now,
                 volume_matched=volume_matched)


def _maybe_alert(row_id, source, old_price, new_price, shift, oldest_ts, now,
                 volume_matched=0):
    """Apply cooldown/dedup and send alert if appropriate."""
    key = (row_id, source)
    last = _last_alerted.get(key)

    if last:
        elapsed = now - last['ts']
        if elapsed < STEAM_COOLDOWN:
            # Within cooldown — only re-alert if move extended significantly
            if shift < last['shift_pp'] + STEAM_REALERT_INCREMENT:
                return
        # Cooldown expired or move extended — allow alert

    # Send it — update dedup state regardless of send result to avoid spam on outages
    metadata = _metadata_cache.get(row_id, {})
    _last_alerted[key] = {'ts': now, 'shift_pp': shift}
    sent = _send_steam_alert(source, old_price, new_price, shift, oldest_ts, now, metadata,
                             volume_matched=volume_matched)
    logger.info(
        f"STEAM ALERT: {source} {metadata.get('runner_name', '?')} "
        f"{old_price:.2f}→{new_price:.2f} ({shift*100:.1f}pp)"
        f"{'' if sent else ' (Telegram send failed)'}"
    )


def _format_duration(seconds):
    """Format seconds as e.g. '8m 20s' or '45s'."""
    m, s = divmod(int(seconds), 60)
    if m > 0:
        return f"{m}m {s}s"
    return f"{s}s"


def _format_kickoff(start_time_str):
    """Format start_time ISO string to readable local-ish time."""
    if not start_time_str:
        return 'Unknown'
    try:
        dt = datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
        return dt.strftime('%d %b %H:%M')
    except Exception:
        return start_time_str


def _format_volume(volume):
    """Format volume as e.g. '£12,450'."""
    if volume >= 1000:
        return f"\u00a3{volume:,.0f}"
    return f"\u00a3{volume:.0f}"




def _send_steam_alert(source, old_price, new_price, shift, oldest_ts, now, metadata,
                      volume_matched=0):
    """Format and send a steamer alert via Telegram."""
    runner_name = metadata.get('runner_name', 'Unknown')
    event_name = metadata.get('event_name', '')
    start_time = metadata.get('start_time', '')
    duration = _format_duration(now - oldest_ts)

    prob_old = implied_prob(old_price) * 100
    prob_new = implied_prob(new_price) * 100
    shift_pp = shift * 100

    msg = (
        f"<b>{source} STEAM: {runner_name}</b>\n"
        f"{event_name}\n"
        f"\n"
        f"{source}: {old_price:.2f} \u2192 {new_price:.2f} (shortening)\n"
        f"Shift: +{shift_pp:.1f}pp in {duration}\n"
        f"Implied: {prob_old:.1f}% \u2192 {prob_new:.1f}%\n"
    )

    # Volume line for BF alerts only
    if source == 'BF' and volume_matched > 0:
        msg += f"Matched: {_format_volume(volume_matched)} during move\n"

    msg += f"Kick-off: {_format_kickoff(start_time)}"

    # Build inline keyboard buttons
    buttons = []
    paddy_link = metadata.get('paddy_link')
    if paddy_link:
        buttons.append({"text": "\U0001f517 BET (PaddyPower)", "url": paddy_link})

    # Exchange link for BF alerts
    exchange_link = metadata.get('exchange_link')
    if source == 'BF' and exchange_link:
        buttons.append({"text": "\U0001f4ca Exchange", "url": exchange_link})

    reply_markup = None
    if buttons:
        reply_markup = {"inline_keyboard": [buttons]}

    return telegram_alerts.send_telegram_message(msg, reply_markup=reply_markup)


def cleanup_finished_events():
    """Purge history for rows no longer active. Call from main loop."""
    # Import here to avoid circular import at module load
    try:
        import fetch_universal
        active_ids = set(r['id'] for r in fetch_universal._cached_active_rows)
    except Exception:
        return

    for store in (_pin_history, _bf_history, _metadata_cache):
        stale = [k for k in store if k not in active_ids]
        for k in stale:
            del store[k]

    # Also clean dedup state for finished events
    stale_keys = [k for k in _last_alerted if k[0] not in active_ids]
    for k in stale_keys:
        del _last_alerted[k]
