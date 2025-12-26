import betfairlightweight
from betfairlightweight import filters
import pandas as pd
import config
import time
import requests
import re
import os
import json
import logging
from datetime import datetime, timezone, timedelta
from supabase import create_client, Client

# --- LOGGING SETUP ---
# Controls detailed per-item logging (default: False)
DEBUG_MODE = os.getenv('APP_DEBUG', '0') == '1'

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# Silence noisy HTTP libs
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

# --- IMPORT CONFIG ---
try:
    from sports_config import SPORTS_CONFIG, ALIAS_MAP, SCOPE_MODE
except ImportError:
    logger.error("Could not import sports_config.py")
    SPORTS_CONFIG = []
    ALIAS_MAP = {}
    SCOPE_MODE = ""

# --- SCOPE GUARD: RUNTIME FILTER ---
if SCOPE_MODE.startswith("NBA_PREMATCH_ML"):
    logger.info(f"🔒 SCOPE_MODE ACTIVE: {SCOPE_MODE} (Filtering to Basketball Only)")
    SPORTS_CONFIG = [s for s in SPORTS_CONFIG if s['name'] == 'Basketball']

# --- SETUP ---
supabase: Client = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)
trading = betfairlightweight.APIClient(
    username=config.USERNAME,
    password=config.PASSWORD,
    app_key=config.APP_KEY,
    certs=config.CERTS_PATH
)

ODDS_API_KEY = config.ODDS_API_KEY
opening_prices_cache = {}
last_spy_run = 0
CACHE_DIR = "api_cache"

if not os.path.exists(CACHE_DIR):
    os.makedirs(CACHE_DIR)

# --- IN-PLAY SETTINGS (MINIMAL, LOCAL CONSTANTS) ---
INPLAY_WINDOW_SECONDS = 4 * 3600     # treat matches as "in-play relevant" up to 4h after start
PREMATCH_SPY_INTERVAL = 60           # seconds
INPLAY_SPY_INTERVAL = 30             # seconds (Match loop to data frequency)
TTL_INPLAY_SECONDS = 60              # odds api cache TTL (HARD LIMIT for 20k/mo budget)
CALLS_THIS_SESSION = 0               # Global counter for accounting

# --- SNAPSHOT SETTINGS (NEW) ---
last_snapshot_time = 0
SNAPSHOT_INTERVAL = 60  # Write history every 60s
# ---------------------------------------------------

# --- DYNAMIC CACHING SYSTEM ---
def fetch_cached_odds(sport_key, ttl_seconds, region='uk,eu,us'):
    """
    Fetches odds with a dynamic Time-To-Live (TTL).
    High Urgency = Low TTL (Fresh Data)
    Low Urgency = High TTL (Save API Calls)
    """
    cache_file = os.path.join(CACHE_DIR, f"{sport_key}.json")
    now = time.time()

    # 1. Check Cache Age
    # FIX: Allow caching even for urgent/in-play requests (>= instead of >)
    if os.path.exists(cache_file) and ttl_seconds >= TTL_INPLAY_SECONDS:
        file_age = now - os.path.getmtime(cache_file)
        if file_age < ttl_seconds:
            try:
                with open(cache_file, 'r') as f:
                    return json.load(f)
            except:
                pass

    # 2. Fetch Fresh Data (Only if cache expired)
    url = f'https://api.the-odds-api.com/v4/sports/{sport_key}/odds'
    params = {
        'api_key': ODDS_API_KEY,
        'regions': region,
        'markets': 'h2h',
        'oddsFormat': 'decimal',
        # Ladbrokes is the middle column provider (legacy field name on DB remains price_bet365)
        'bookmakers': 'pinnacle,ladbrokes_uk,paddypower,williamhill,unibet,betfair_sb_uk,coral,betvictor'
    }

    urgency_label = "URGENT" if ttl_seconds < 300 else "NORMAL" if ttl_seconds < 3600 else "LAZY"
    
    global CALLS_THIS_SESSION
    CALLS_THIS_SESSION += 1
    logger.info(f"🌍 CALLING API [#{CALLS_THIS_SESSION}] ({urgency_label}): {sport_key} (TTL: {ttl_seconds}s)...")

    try:
        response = requests.get(url, params=params, timeout=15)
        data = response.json()

        if isinstance(data, list):
            with open(cache_file, 'w') as f:
                json.dump(data, f)
        return data
    except Exception as e:
        logger.error(f"API Fetch Error: {e}")
        return []

# --- DIAGNOSTICS ---
class MatchStats:
    def __init__(self):
        self.stats = {}

    def log_event(self, sport, source):
        if sport not in self.stats:
            self.stats[sport] = {'exchange': 0, 'api': 0, 'matched': 0, 'unmatched': 0, 'errors': []}
        self.stats[sport][source] += 1

    def log_match(self, sport, is_match, reason="OK"):
        if sport not in self.stats:
            return
        if is_match:
            self.stats[sport]['matched'] += 1
        else:
            self.stats[sport]['unmatched'] += 1
            self.stats[sport]['errors'].append(reason)

    def report(self):
        logger.info("=== 📊 MATCHING REPORT ===")
        for sport, data in self.stats.items():
            logger.info(f"[{sport}] Exchange: {data['exchange']} | API: {data['api']}")
            logger.info(f"   ✅ Matched: {data['matched']}")
            logger.info(f"   ❌ Unmatched: {data['unmatched']}")
            if data['errors']:
                from collections import Counter
                top_errors = Counter(data['errors']).most_common(3)
                logger.info(f"   ⚠️ Reasons: {top_errors}")
        logger.info("==========================")

tracker = MatchStats()

# --- NORMALIZATION ---
def normalize(name):
    return re.sub(r'[^a-z0-9]', '', str(name).lower())

def normalize_af(name):
    if not name: return ""
    name = str(name).lower()
    # Bridge common NCAA abbreviations to their full school names before stripping mascots
    # FIX: Broaden FIU/UTSA matching (allow substrings like "Florida Int" or "U.T.S.A")
    if "florida international" in name or "fiu" in name or "florida int" in name: return "fiu"
    if "texas san antonio" in name or "utsa" in name: return "utsa"
    if "brigham young" in name or name == "byu": return "byu"
    if "connecticut" in name or "uconn" in name: return "uconn"
    
    garbage = [
        "football team", "university", "univ.", "univ", " the ", " at ",
        "hilltoppers", "golden eagles", "hurricanes", "commanders", "vikings",
        "lions", "cowboys", "wildcats", "redbirds", "bobcats",
        "panthers", "roadrunners", "bulldogs", "lobos", "cougars",
        "black knights", "huskies", "redhawks"
    ]

    for word in garbage:
        name = name.replace(word, "")
    name = name.replace(" st.", " state").replace(" st ", " state ")
    return re.sub(r'[^a-z0-9]', '', name)

def check_match(name_a, name_b):
    if not name_a or not name_b: return False
    if name_a == name_b: return True
    
    # Check explicit Alias Map first
    if name_a in ALIAS_MAP and name_b in ALIAS_MAP[name_a]: return True
    if name_b in ALIAS_MAP and name_a in ALIAS_MAP[name_b]: return True

    # Fuzzy match: Ensure we catch "westernkentucky" in "westernkentuckyhilltoppers"
    # only if the core string is significant (over 4 chars) to avoid false positives
    if len(name_a) > 4 and name_a in name_b: return True
    if len(name_b) > 4 and name_b in name_a: return True
    
    return False

# --- IN-PLAY CHECK (MINIMAL QUERY) ---
def has_inplay_markets():
    try:
        r = supabase.table('market_feed') \
            .select('id') \
            .eq('in_play', True) \
            .neq('market_status', 'CLOSED') \
            .limit(1) \
            .execute()
        return bool(r.data)
    except Exception as e:
        logger.error(f"DB Error checking in-play: {e}")
        return False

# --- MAIN ENGINE ---
def run_spy():
    logger.info("🕵️  Running Spy (Forensic Mode)...")
    
    # --- CLEANUP STEP (Pre-match Strict Mode) ---
    if SCOPE_MODE.startswith("NBA_PREMATCH_ML"):
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            # 1. Close started games
            supabase.table('market_feed').update({'market_status': 'CLOSED'}) \
                .lt('start_time', now_iso).eq('market_status', 'OPEN').execute()
            # 2. Close explicitly marked in-play games
            supabase.table('market_feed').update({'market_status': 'CLOSED'}) \
                .eq('in_play', True).eq('market_status', 'OPEN').execute()
        except Exception as e:
            logger.error(f"Cleanup Error: {e}")
    # --------------------------------------------

    tracker.__init__()

    try:
        db_rows = supabase.table('market_feed').select('*').neq('market_status', 'CLOSED').execute()
        id_to_row_map = {row['id']: row for row in db_rows.data}
    except Exception as e:
        logger.error(f"DB Error: {e}")
        return

    active_rows = []
    reset_updates = []
    sport_schedules = {}

    now_utc = datetime.now(timezone.utc)

    for row in db_rows.data:
        sport_name = row.get('sport')

        try:
            start_dt = datetime.fromisoformat(row['start_time'].replace('Z', '+00:00'))
        except:
            start_dt = None

        if sport_name not in sport_schedules:
            sport_schedules[sport_name] = []
        if start_dt:
            # Store metadata to allow granular filtering later
            sport_schedules[sport_name].append({
                'dt': start_dt,
                'event': str(row.get('event_name') or "").upper(),
                'comp': str(row.get('competition') or "").upper()
            })
        is_af = sport_name in ['NFL', 'NCAAF', 'American Football', 'NCAA FCS']

        norm_func = normalize_af if is_af else normalize

        active_rows.append({
            'id': row.get('id'),
            'sport': sport_name,
            'event_name': row.get('event_name'),
            'runner_name': row.get('runner_name'),
            'norm_runner': norm_func(row.get('runner_name')),
            'norm_event': norm_func(row.get('event_name')),
            'start_time': start_dt
        })

        # IMPORTANT:
        # Resetting prices to None causes flicker/empty UI.
        # Keep this ONLY for debug/forensics when APP_DEBUG=1.
        reset_updates.append({
            'id': row.get('id'),
            'sport': row.get('sport'),
            'market_id': row.get('market_id'),
            'runner_name': row.get('runner_name'),
            'price_pinnacle': None,
            'price_bet365': None,  # legacy field name used for Ladbrokes column in UI
            'price_paddy': None
        })

    # ✅ FIX: Do NOT clear prices in normal operation (causes pre-match + in-play to blank)
    # Only clear prices when explicitly running forensic mode.
    if DEBUG_MODE and reset_updates:
        logger.info(f"DEBUG_MODE=1 -> resetting {len(reset_updates)} prices to None (forensics)")
        for i in range(0, len(reset_updates), 100):
            supabase.table('market_feed').upsert(reset_updates[i:i+100]).execute()

    updates = {}

    for sport in SPORTS_CONFIG:
        # --- Dynamic TTL Logic (patched for in-play) ---
        raw_schedule = sport_schedules.get(sport['name'], [])
        min_seconds_away = 999999

        # Filter: Only trigger urgency if the LIVE game matches this Config's scope
        relevant_starts = []
        required_query = str(sport.get('text_query', '')).upper()
        
        for item in raw_schedule:
            # Prevent FCS games from triggering the expensive NFL Pro API
            if "NFL" in required_query and "NCAA" in item['comp']: 
                continue
            if "NFL" in required_query and "FCS" in item['comp']:
                continue
            # Prevent NFL games from triggering the FCS API
            if "FCS" in required_query and "FCS" not in item['comp']:
                continue

            relevant_starts.append(item['dt'])

        if relevant_starts:
            deltas = []
            for dt in relevant_starts:
                if not dt:
                    continue
                seconds = (dt - now_utc).total_seconds()

                # SCOPE GUARD: NBA_PREMATCH_ML -> Skip Live
                if SCOPE_MODE.startswith("NBA_PREMATCH_ML") and seconds <= 0:
                    continue

                # already started but within the in-play window -> urgent
                if seconds <= 0 and abs(seconds) <= INPLAY_WINDOW_SECONDS:
                    deltas.append(0)
                # upcoming -> normal
                elif seconds > 0:
                    deltas.append(seconds)

            if deltas:
                min_seconds_away = min(deltas)

        # FALLBACK: If schedule empty BUT active rows exist, force safe refresh (600s TTL)
        if min_seconds_away == 999999 and any(r['sport'] == sport['name'] for r in active_rows):
            min_seconds_away = 7200

        if min_seconds_away == 0:
            ttl = TTL_INPLAY_SECONDS      # Live (60s)
        elif min_seconds_away < 3600:     # < 1 Hour (Golden Hour)
            ttl = 120                     # 2 Minutes - Aggressive for team news
        elif min_seconds_away < 10800:    # 1 - 3 Hours
            ttl = 600                     # 10 Minutes - Relaxed
        elif min_seconds_away < 43200:    # 3 - 12 Hours
            ttl = 1800                    # 30 Minutes - Maintenance
        else:                             # > 12 Hours
            ttl = 1800                    # 30 Minutes - Deep Sleep (Accelerated)

        data = fetch_cached_odds(sport['odds_api_key'], ttl_seconds=ttl)

        if isinstance(data, dict) and 'message' in data:
            logger.warning(f"API MESSAGE ({sport['name']}): {data['message']}")
            continue

        strict_mode = sport.get('strict_mode', True)
        config_is_af = 'americanfootball' in sport['odds_api_key']
        norm_func_api = normalize_af if config_is_af else normalize

        for event in data:
            tracker.log_event(sport['name'], 'api')

            # === MMA DRAGNET (DEBUG ONLY) ===
            if DEBUG_MODE and sport['name'] == 'MMA':
                present = [b['key'] for b in event.get('bookmakers', [])]
                print(f"🥊 {event.get('home_team')} vs {event.get('away_team')}")
                print(f"   ↳ AVAILABLE: {present}")
                print("   ✅ LADBROKES IS HERE" if 'ladbrokes_uk' in present else "   ❌ LADBROKES CONFIRMED DEAD")
                print("-" * 30)
            # ===============================

            def get_h2h(bookie_obj):
                if not bookie_obj:
                    return []
                m = next((m for m in bookie_obj.get('markets', []) if m.get('key') == 'h2h'), None)
                return m.get('outcomes', []) if m else []

            bookmakers = event.get('bookmakers', []) or []
            pin_book = next((b for b in bookmakers if 'pinnacle' in str(b.get('key', '')).lower()), None)
            ladbrokes_book = next((b for b in bookmakers if 'ladbrokes' in str(b.get('key', '')).lower()), None)
            paddy_book = next((b for b in bookmakers if 'paddypower' in str(b.get('key', '')).lower()), None)

            ref_outcomes = get_h2h(pin_book) or get_h2h(ladbrokes_book) or get_h2h(paddy_book)
            if not ref_outcomes:
                continue

            api_home = norm_func_api(event.get('home_team'))
            api_away = norm_func_api(event.get('away_team'))
            try:
                api_start = datetime.fromisoformat(event['commence_time'].replace('Z', '+00:00'))
            except:
                continue

            for outcome in ref_outcomes:
                matched_id = None
                raw_name = outcome.get('name')
                if not raw_name:
                    continue
                norm_name = norm_func_api(raw_name)

                for row in active_rows:
                    # BLOCK COLLISION: Ensure NFL only matches NFL, etc.
                    # row['sport'] is the DB label ('NFL'), sport['name'] is from config
                    if row['sport'] != sport['name']:
                        continue
                        
                    # REPAIRED: Sub-Sport Check (Case-Insensitive)
                    is_ncaa_api = 'ncaaf' in sport['odds_api_key'].lower()
                    
                    # Inspect for College indicators
                    event_name_raw = str(row.get('event_name') or "").upper()
                    comp_name_raw = str(id_to_row_map.get(row['id'], {}).get('competition') or "").upper()
                    sport_label = str(row.get('sport') or "").upper()
                    
                    # Logic: Is this specific DB row a College game?
                    is_ncaa_db = any(x in event_name_raw or x in comp_name_raw or x in sport_label for x in ['NCAA', 'COLLEGE', 'FCS'])
                    
                    # Relax: Only block if it is explicitly NFL vs NCAA mismatch.
                    if sport['name'] == 'NFL' and is_ncaa_api != is_ncaa_db:
                        continue
                    
                    # 1. Time Check (Unchanged)
                    tolerance = 108000 if not strict_mode else 43200
                    delta = abs((row['start_time'] - api_start).total_seconds())
                    if delta > tolerance:
                        continue

                    # 2. Direct & Fuzzy Runner Match
                    # Priority: Exact match, then Alias Map, then substring
                    runner_match = (norm_name == row['norm_runner']) or \
                                   check_match(norm_name, row['norm_runner']) or \
                                   (norm_name in row['norm_runner'] or row['norm_runner'] in norm_name)
                    
                    is_match = False

                    if strict_mode:
                        # Fuzzy Event Match (Home or Away team check)
                        event_match = (api_home in row['norm_event'] or api_away in row['norm_event'])
                        if runner_match and event_match:
                            is_match = True
                    else:
                        if runner_match:
                            is_match = True

                    if is_match:
                        matched_id = row['id']
                        break

                if matched_id:
                    tracker.log_match(sport['name'], True)

                if not matched_id:
                    continue

                row_id = matched_id
                if row_id not in updates:
                    orig_row = id_to_row_map.get(row_id, {})
                    updates[row_id] = {
                        'id': row_id,
                        'sport': orig_row.get('sport'),
                        'market_id': orig_row.get('market_id'),
                        'runner_name': orig_row.get('runner_name'),
                        'last_updated': datetime.now(timezone.utc).isoformat()
                    }

                def find_price(odds_list, target_name):
                    target_norm = norm_func_api(target_name)
                    for o in odds_list or []:
                        o_name = o.get('name')
                        if not o_name:
                            continue
                        o_norm = norm_func_api(o_name)
                        if check_match(o_norm, target_norm):
                            return o.get('price')
                    return None

                p = find_price(get_h2h(pin_book), raw_name)
                if p is not None:
                    updates[row_id]['price_pinnacle'] = p

                price_ladbrokes = find_price(get_h2h(ladbrokes_book), raw_name)
                if price_ladbrokes is not None:
                    updates[row_id]['price_bet365'] = price_ladbrokes

                p = find_price(get_h2h(paddy_book), raw_name)
                if p is not None:
                    updates[row_id]['price_paddy'] = p

    tracker.report()

    if updates:
        logger.info(f"Spy: Updating {len(updates)} rows...")
        data_list = list(updates.values())
        for i in range(0, len(data_list), 100):
            # Use upsert with id as conflict target to refresh timestamps and prices
            supabase.table('market_feed').upsert(data_list[i:i+100], on_conflict='id').execute()

def chunker(seq, size):
    return (seq[pos:pos + size] for pos in range(0, len(seq), size))

# === SNAPSHOT LOGIC (NEW) ===
# ... inside fetch_universal.py ...

def run_snapshot_cycle(active_data):
    """Writes RICH history (back/lay/sport) for the Trade Ticket engine."""
    global last_snapshot_time
    # Throttle: Run every 45s to balance data density vs DB load
    if time.time() - last_snapshot_time < 45: 
        return

    if not active_data:
        return

    logger.info(f"📸 Snapshotting {len(active_data)} markets (High Fidelity)...")
    
    snapshot_rows = []
    timestamp = datetime.now(timezone.utc).isoformat()

    for row in active_data:
        # 1. Safe Price Extraction
        try:
            back = float(row.get('back_price') or 0)
            lay = float(row.get('lay_price') or 0)
        except (ValueError, TypeError):
            continue

        # 2. Mid Calculation
        mid = None
        if back > 0 and lay > 0:
            mid = (back + lay) / 2
        elif back > 0:
            mid = back
        elif lay > 0:
            mid = lay
            
        if mid is None or mid <= 1.01: # Ignore junk
            continue

        # 3. Create Row (Matches new Schema)
        snapshot_rows.append({
            "selection_key": f"{row['market_id']}::{row['runner_name']}",
            "ts": timestamp,
            "market_id": str(row['market_id']),
            "sport": row.get('sport', 'Unknown'),
            "event_name": row.get('event_name', ''),
            "runner_name": row.get('runner_name', ''),
            "back_price": back,
            "lay_price": lay,
            "mid_price": mid,
            "volume": float(row.get('volume') or 0)
        })

    if snapshot_rows:
        try:
            # Chunked Insert
            for i in range(0, len(snapshot_rows), 100):
                chunk = snapshot_rows[i:i+100]
                supabase.table('market_snapshots').insert(chunk).execute()
            
            # Prune old data (Keep last 24h)
            if time.time() % 100 < 5: # 5% chance per cycle
                old_cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
                supabase.table('market_snapshots').delete().lt('ts', old_cutoff).execute()
                
            last_snapshot_time = time.time()
        except Exception as e:
            logger.error(f"Snapshot Error: {e}")
# =============================

def fetch_betfair():
    if not trading.session_token:
        try:
            trading.login()
            logger.info("✅ Login Successful")
        except Exception as e:
            logger.error(f"❌ LOGIN FAILED: {e}")
            logger.warning("⏳ Pausing for 2 mins to avoid account lock...")
            time.sleep(120)  # PENALTY BOX: Stop spamming login!
            return
        
    update_time = datetime.now(timezone.utc).isoformat()
    best_price_map = {}

    for sport_conf in SPORTS_CONFIG:
        try:
            now_utc = datetime.now(timezone.utc)
            now_pd = pd.Timestamp.now(tz='UTC')

            filter_args = {
                'market_type_codes': ['MATCH_ODDS'],
                'market_start_time': {
                    'from': (now_pd - pd.Timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    'to': (now_pd + pd.Timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%SZ")
                }
            }

            if 'competition_id' in sport_conf:
                filter_args['competition_ids'] = [sport_conf['competition_id']]
            else:
                filter_args['event_type_ids'] = [sport_conf['betfair_id']]
                if 'text_query' in sport_conf:
                    filter_args['text_query'] = sport_conf['text_query']

            market_filter = filters.market_filter(**filter_args)

            markets = trading.betting.list_market_catalogue(
                filter=market_filter,
                max_results=500,
                market_projection=['MARKET_START_TIME', 'EVENT', 'COMPETITION', 'RUNNER_METADATA'],
                sort='FIRST_TO_START'
            )
            
            # DIAGNOSTIC LOG: Check what we actually found
            logger.info(f"🔎 SEARCH {sport_conf['name']}: Found {len(markets)} markets")
            
            if not markets:
                logger.warning(f"⚠️ No markets found for {sport_conf['name']} (Check Query/Filter)")
                continue
                continue

            price_projection = filters.price_projection(price_data=['EX_BEST_OFFERS', 'EX_TRADED'], virtualise=True)
            market_ids = [m.market_id for m in markets]

            for batch in chunker(market_ids, 10):
                market_books = trading.betting.list_market_book(market_ids=batch, price_projection=price_projection)

                for book in market_books:
                    # SCOPE GUARD: NBA_PREMATCH_ML -> Skip In-Play
                    if SCOPE_MODE.startswith("NBA_PREMATCH_ML") and book.inplay:
                        continue

                    market_info = next((m for m in markets if m.market_id == book.market_id), None)
                    if not market_info:
                        continue

                    start_dt = market_info.market_start_time
                    if start_dt.tzinfo is None:
                        start_dt = start_dt.replace(tzinfo=timezone.utc)

                    seconds_to_start = (start_dt - now_utc).total_seconds()
                    volume = book.total_matched or 0

                    # Ignore markets with < £10 matched if they are starting soon
                    if volume < 10 and seconds_to_start < 3600:
                        continue

                    comp_name = market_info.competition.name if market_info.competition else "Unknown League"

                    for runner in book.runners:
                        if runner.status != 'ACTIVE':
                            continue

                        runner_details = next((r for r in market_info.runners if r.selection_id == runner.selection_id), None)
                        if not runner_details:
                            continue

                        name = runner_details.runner_name
                        back = runner.ex.available_to_back[0].price if runner.ex.available_to_back else 0.0
                        lay = runner.ex.available_to_lay[0].price if runner.ex.available_to_lay else 0.0

                        dedup_key = f"{market_info.event.name}_{name}"
                        current_best = best_price_map.get(dedup_key)

                        if not current_best or volume > current_best['volume']:
                            best_price_map[dedup_key] = {
                                "sport": sport_conf['name'],
                                "market_id": book.market_id,
                                "event_name": market_info.event.name,
                                "runner_name": name,
                                "competition": comp_name,
                                "back_price": back,
                                "lay_price": lay,
                                "volume": int(volume),
                                "start_time": market_info.market_start_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                "in_play": book.inplay,
                                "market_status": book.status,
                                "last_updated": update_time
                            }

        except Exception as e:
            logger.error(f"Error fetching {sport_conf['name']}: {e}")

    if best_price_map:
        try:
            final_data = list(best_price_map.values())
            supabase.table('market_feed').upsert(final_data, on_conflict='market_id, runner_name').execute()
            logger.info(f"⚡ Synced {len(final_data)} items (High Volume filtered).")
            
            # --- TRIGGER SNAPSHOT ---
            run_snapshot_cycle(final_data)
            
        except Exception as e:
            logger.error(f"Database Error: {e}")

if __name__ == "__main__":
    logger.info("--- STARTING UNIVERSAL ENGINE (PROXIMITY OPTIMIZED + TIMEOUT) ---")
    run_spy()
    
    last_keep_alive = time.time()

    while True:
        # SESSION GUARD: Refresh hourly (Running every 6s = Auth Ban)
        if trading.session_token and (time.time() - last_keep_alive > 3600):
            try:
                trading.keep_alive()
                last_keep_alive = time.time()
                logger.info("🔄 Session Keep-Alive Refreshed")
            except:
                trading.login()
                
        fetch_betfair()

        # Dynamic spy interval: fast during in-play, slow otherwise
        spy_interval = INPLAY_SPY_INTERVAL if has_inplay_markets() else PREMATCH_SPY_INTERVAL

        if time.time() - last_spy_run > spy_interval:
            run_spy()
            last_spy_run = time.time()

        # RATE LIMIT GUARD: Do not run faster than 1 cycle per 6s (approx 600-1200 calls/hr)
        time.sleep(6)