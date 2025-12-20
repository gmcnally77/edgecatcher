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

# [ADD THESE TWO LINES TO SILENCE THE NOISE]
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

# --- IMPORT CONFIG ---
try:
    from sports_config import SPORTS_CONFIG, ALIAS_MAP
except ImportError:
    logger.error("Could not import sports_config.py")
    SPORTS_CONFIG = []
    ALIAS_MAP = {}

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
    if os.path.exists(cache_file):
        file_age = now - os.path.getmtime(cache_file)
        if file_age < ttl_seconds: 
            # Data is fresh enough for our current urgency level
            try:
                with open(cache_file, 'r') as f:
                    return json.load(f)
            except: pass 
    
    # 2. Fetch Fresh Data (Only if cache expired)
    # Note: We request 'ladbrokes_uk' specifically as the middle column provider
    url = f'https://api.the-odds-api.com/v4/sports/{sport_key}/odds'
    params = {
        'api_key': ODDS_API_KEY, 
        'regions': region, 
        'markets': 'h2h', 
        'oddsFormat': 'decimal',
        'bookmakers': 'pinnacle,ladbrokes_uk,paddypower,williamhill,unibet,betfair_sb_uk,coral,betvictor'
    }
    
    urgency_label = "URGENT" if ttl_seconds < 300 else "NORMAL" if ttl_seconds < 3600 else "LAZY"
    logger.info(f"🌍 CALLING API ({urgency_label}): {sport_key} (TTL: {int(ttl_seconds/60)}m)...") 
    
    try:
        # TIMEOUT ADDED: Prevents script from hanging indefinitely
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
        if sport not in self.stats: return
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
    garbage = ["football team", "university", "univ.", "univ", " the ", " at "]
    for word in garbage:
        name = name.replace(word, "")
    name = name.replace(" st.", " state").replace(" st ", " state ")
    return re.sub(r'[^a-z0-9]', '', name)

def check_match(name_a, name_b):
    if name_a == name_b: return True
    if name_a in name_b or name_b in name_a: return True
    if name_a in ALIAS_MAP and name_b in ALIAS_MAP[name_a]: return True
    if name_b in ALIAS_MAP and name_a in ALIAS_MAP[name_b]: return True
    return False

# --- MAIN ENGINE ---
# --- MAIN ENGINE (WITH MMA AUDIT) ---
def run_spy():
    logger.info("🕵️  Running Spy (Forensic Mode)...")
    tracker.__init__() 

    try:
        db_rows = supabase.table('market_feed').select('*').neq('market_status', 'CLOSED').execute()
        id_to_row_map = {row['id']: row for row in db_rows.data}
    except Exception as e:
        logger.error(f"DB Error: {e}")
        return

    # Build DB Search List
    active_rows = []
    reset_updates = [] 
    sport_schedules = {} 

    for row in db_rows.data:
        sport_name = row['sport']
        try: start_dt = datetime.fromisoformat(row['start_time'].replace('Z', '+00:00'))
        except: start_dt = None

        if sport_name not in sport_schedules: sport_schedules[sport_name] = []
        if start_dt: sport_schedules[sport_name].append(start_dt)

        is_af = sport_name in ['NFL', 'NCAAF', 'American Football', 'NCAA FCS']
        norm_func = normalize_af if is_af else normalize

        active_rows.append({
            'id': row['id'],
            'sport': sport_name,
            'event_name': row['event_name'],
            'runner_name': row['runner_name'],
            'norm_runner': norm_func(row['runner_name']),
            'norm_event': norm_func(row['event_name']),
            'start_time': start_dt
        })
        
        # Reset prices to ensure we see fresh data
        reset_updates.append({
            'id': row['id'],
            'sport': row['sport'],
            'market_id': row['market_id'],
            'runner_name': row['runner_name'],
            'price_pinnacle': None,
            'price_bet365': None,
            'price_paddy': None
        })

    if reset_updates:
        for i in range(0, len(reset_updates), 100):
            supabase.table('market_feed').upsert(reset_updates[i:i+100]).execute()

    updates = {} 
    now_utc = datetime.now(timezone.utc)

    for sport in SPORTS_CONFIG:
        # Dynamic TTL Logic
        relevant_starts = sport_schedules.get(sport['name'], [])
        min_seconds_away = 999999
        if relevant_starts:
            future_games = [ (dt - now_utc).total_seconds() for dt in relevant_starts if dt > now_utc ]
            if future_games: min_seconds_away = min(future_games)
        
        if min_seconds_away < 10800: ttl = 120    # 2 Mins
        elif min_seconds_away < 43200: ttl = 900  # 15 Mins
        else: ttl = 3600                          # 1 Hour (Fast enough for testing)

        # FETCH
        data = fetch_cached_odds(sport['odds_api_key'], ttl_seconds=ttl)
        
        if isinstance(data, dict) and 'message' in data:
            logger.warning(f"API MESSAGE ({sport['name']}): {data['message']}")
            continue

        strict_mode = sport.get('strict_mode', True)
        config_is_af = 'americanfootball' in sport['odds_api_key']

        for event in data:
            tracker.log_event(sport['name'], 'api')
            
            # === MMA DRAGNET (DEBUG ONLY) ===
            if DEBUG_MODE and sport['name'] == 'MMA':
                # Get the raw keys of everyone who returned a price
                present = [b['key'] for b in event['bookmakers']]
                
                print(f"🥊 {event['home_team']} vs {event['away_team']}")
                print(f"   ↳ AVAILABLE: {present}")
                
                if 'ladbrokes_uk' in present:
                    print("   ✅ LADBROKES IS HERE (Hidden before?)")
                else:
                    print("   ❌ LADBROKES CONFIRMED DEAD")
                print("-" * 30)
            # ===============================
            
            def get_h2h(bookie_obj):
                if not bookie_obj: return []
                m = next((m for m in bookie_obj['markets'] if m['key'] == 'h2h'), None)
                return m['outcomes'] if m else []

            pin_book = next((b for b in event['bookmakers'] if 'pinnacle' in b['key'].lower()), None)
            ladbrokes_book = next((b for b in event['bookmakers'] if 'ladbrokes' in b['key'].lower()), None)
            paddy_book = next((b for b in event['bookmakers'] if 'paddypower' in b['key'].lower()), None)

            ref_outcomes = get_h2h(pin_book) or get_h2h(ladbrokes_book) or get_h2h(paddy_book)
            if not ref_outcomes: continue

            norm_func_api = normalize_af if config_is_af else normalize
            
            api_home = norm_func_api(event.get('home_team'))
            api_away = norm_func_api(event.get('away_team'))
            api_start = datetime.fromisoformat(event['commence_time'].replace('Z', '+00:00'))

            for outcome in ref_outcomes:
                matched_id = None
                raw_name = outcome['name']
                norm_name = norm_func_api(raw_name)

                for row in active_rows:
                    if row['sport'] != sport['name']: continue
                    if not row['start_time']: continue
                    
                    tolerance = 108000 if not strict_mode else 43200
                    delta = abs((row['start_time'] - api_start).total_seconds())
                    if delta > tolerance: continue 

                    runner_match = check_match(norm_name, row['norm_runner'])
                    is_match = False
                    
                    if strict_mode:
                        if runner_match and check_match(api_home, row['norm_event']) and check_match(api_away, row['norm_event']):
                            is_match = True
                    else:
                        if runner_match: is_match = True
                            
                    if is_match:
                        matched_id = row['id']
                        break
                
                if matched_id: tracker.log_match(sport['name'], True)

                if matched_id:
                    row_id = matched_id
                    if row_id not in updates:
                        orig_row = id_to_row_map.get(row_id, {})
                        updates[row_id] = {
                            'id': row_id,
                            'sport': orig_row.get('sport'),
                            'market_id': orig_row.get('market_id'),
                            'runner_name': orig_row.get('runner_name')
                        }

                    def find_price(odds_list, target_name):
                        target_norm = norm_func_api(target_name)
                        for o in odds_list:
                            o_norm = norm_func_api(o['name'])
                            if check_match(o_norm, target_norm): return o['price']
                        return None

                    p = find_price(get_h2h(pin_book), raw_name)
                    if p: updates[row_id]['price_pinnacle'] = p
                    p = find_price(get_h2h(ladbrokes_book), raw_name)
                    if p: updates[row_id]['price_bet365'] = p
                    p = find_price(get_h2h(paddy_book), raw_name)
                    if p: updates[row_id]['price_paddy'] = p

    tracker.report()

    if updates:
        logger.info(f"Spy: Updating {len(updates)} rows...")
        data_list = list(updates.values())
        for i in range(0, len(data_list), 100):
            supabase.table('market_feed').upsert(data_list[i:i+100]).execute()

def chunker(seq, size):
    return (seq[pos:pos + size] for pos in range(0, len(seq), size))

def fetch_betfair():
    if not trading.session_token:
        try: trading.login(); logger.info("Login Successful");
        except: return

    active_market_ids = set()
    update_time = datetime.now(timezone.utc).isoformat()
    best_price_map = {} 

    for sport_conf in SPORTS_CONFIG:
        try:
            # Timezone-aware "Now" for filter logic
            now_utc = datetime.now(timezone.utc)
            
            # Pandas timestamp for the API filter (API requires strict format)
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
                filter=market_filter, max_results=500, 
                market_projection=['MARKET_START_TIME', 'EVENT', 'COMPETITION', 'RUNNER_METADATA'],
                sort='FIRST_TO_START'
            )
            
            if not markets: continue

            price_projection = filters.price_projection(price_data=['EX_BEST_OFFERS', 'EX_TRADED'], virtualise=True)
            market_ids = [m.market_id for m in markets]

            for batch in chunker(market_ids, 10): 
                market_books = trading.betting.list_market_book(market_ids=batch, price_projection=price_projection)
                
                for book in market_books:
                    market_info = next((m for m in markets if m.market_id == book.market_id), None)
                    if not market_info: continue

                    # --- FIXED ZOMBIE FILTER ---
                    # Ensure start_time is UTC-aware before subtracting
                    start_dt = market_info.market_start_time
                    if start_dt.tzinfo is None:
                        start_dt = start_dt.replace(tzinfo=timezone.utc)
                    
                    seconds_to_start = (start_dt - now_utc).total_seconds()
                    volume = book.total_matched or 0
                    
                    # Ignore markets with < £10 matched if they are starting soon (garbage/duplicate detection)
                    if volume < 10 and seconds_to_start < 3600:
                         continue
                    # ---------------------------

                    active_market_ids.add(book.market_id)
                    comp_name = market_info.competition.name if market_info.competition else "Unknown League"

                    for runner in book.runners:
                        if runner.status == 'ACTIVE':
                            runner_details = next((r for r in market_info.runners if r.selection_id == runner.selection_id), None)
                            if not runner_details: continue
                            
                            name = runner_details.runner_name
                            back = runner.ex.available_to_back[0].price if runner.ex.available_to_back else 0.0
                            lay = runner.ex.available_to_lay[0].price if runner.ex.available_to_lay else 0.0
                            
                            # Deduplication Logic
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

    # Commit Winners
    if best_price_map:
        try:
            final_data = list(best_price_map.values())
            supabase.table('market_feed').upsert(final_data, on_conflict='market_id, runner_name').execute()
            logger.info(f"⚡ Synced {len(final_data)} items (High Volume filtered).")
        except Exception as e: logger.error(f"Database Error: {e}")

if __name__ == "__main__":
    logger.info("--- STARTING UNIVERSAL ENGINE (PROXIMITY OPTIMIZED + TIMEOUT) ---")
    run_spy()

    while True:
        fetch_betfair()
        if time.time() - last_spy_run > 60:
            run_spy()
            last_spy_run = time.time()
        time.sleep(1)