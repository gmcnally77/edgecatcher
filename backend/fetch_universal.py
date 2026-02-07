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
import telegram_alerts
from datetime import datetime, timezone, timedelta
from supabase import create_client, Client

# --- LOGGING SETUP ---
# Controls detailed per-item logging (default: False)
DEBUG_MODE = False

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# Silence noisy HTTP libs
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

# --- ASIANODDS CLIENT IMPORT ---
ASIANODDS_ENABLED = False
get_asianodds_client = None
try:
    from asianodds_client import get_client as get_asianodds_client
    ASIANODDS_ENABLED = True
    logger.info("🇸🇬 AsianOdds client loaded")
except ImportError as e:
    logger.warning(f"AsianOdds client not available: {e}")
except Exception as e:
    logger.warning(f"AsianOdds client error: {e}")

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
    logger.info(f"🔒 SCOPE_MODE ACTIVE: {SCOPE_MODE} (Filtering to Basketball, MMA & Soccer)")
    SPORTS_CONFIG = [s for s in SPORTS_CONFIG if s['name'] in ['Basketball', 'MMA', 'Soccer']]

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

# --- ASIANODDS SPORT MAPPING ---
# Maps our sport names to AsianOdds sport type IDs
# From GetSports: 1=Football, 2=Basketball, 3=Tennis, 5=AmFootball, 9=MMA
ASIANODDS_SPORT_MAP = {
    'Soccer': 1,        # Football/Soccer - has 1X2 odds
    'Basketball': 2,    # Basketball - has 1X2 moneyline (FullTimeOneXTwo)
    'MMA': 9,           # MMA - has 1X2 odds (moneyline)
}

# --- TRACKING & QUOTA (20K/MO PLAN) ---
CALLS_TODAY = 0
LAST_REPORT_DATE = datetime.now(timezone.utc).date()
INPLAY_WINDOW_SECONDS = 4 * 3600     
PREMATCH_SPY_INTERVAL = 15           
INPLAY_SPY_INTERVAL = 15             
TTL_INPLAY_SECONDS = 60

# --- SNAPSHOT SETTINGS (NEW) ---
last_snapshot_time = 0
SNAPSHOT_INTERVAL = 60  # Write history every 60s
# ---------------------------------------------------
# --- DYNAMIC CACHING SYSTEM ---
def fetch_cached_odds(sport_key, ttl_seconds, bookmakers=None, region='uk,eu'):
    """
    Fetches odds with a dynamic Time-To-Live (TTL).
    High Urgency = Low TTL (Fresh Data)
    Low Urgency = High TTL (Save API Calls)
    """
    cache_file = os.path.join(CACHE_DIR, f"{sport_key}.json")
    now = time.time()

    # 1. Check Cache Age
    # FIX: Allow caching even for urgent/in-play requests (>= instead of >)
    if os.path.exists(cache_file):
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
        'bookmakers': bookmakers or 'pinnacle,williamhill,paddypower,ladbrokes_uk'
    }

    urgency_label = "URGENT" if ttl_seconds < 150 else "NORMAL" if ttl_seconds < 600 else "LAZY"
    
    global CALLS_TODAY, LAST_REPORT_DATE
    now_dt = datetime.now(timezone.utc)
    
    # 📊 DAILY BURN REPORT (Reset at Midnight UTC)
    if now_dt.date() > LAST_REPORT_DATE:
        logger.info(f"--------------------------------------------------")
        logger.info(f"📊 DAILY CREDIT REPORT: {LAST_REPORT_DATE}")
        logger.info(f"   TOTAL CREDITS BURNT: {CALLS_TODAY}")
        logger.info(f"--------------------------------------------------")
        CALLS_TODAY = 0
        LAST_REPORT_DATE = now_dt.date()

    CALLS_TODAY += 1
    logger.info(f"🌍 API CALL [#{CALLS_TODAY} Today] ({urgency_label}): {sport_key}...")

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

def strip_team_prefix(name):
    """Strip common team prefixes for better matching."""
    prefixes = ['afc', 'fc', 'as', 'us', 'cf', 'sc', 'ac', 'ssc', 'rcd', 'rc']
    for prefix in prefixes:
        if name.startswith(prefix) and len(name) > len(prefix) + 3:
            return name[len(prefix):]
    return name

def strip_team_suffix(name):
    """Strip common football suffixes: 'ipswichtown' → 'ipswich', 'leicestercity' → 'leicester'."""
    suffixes = ['andhovealbion', 'hovealbion', 'wanderers', 'hotspur', 'athletic', 'united', 'albion',
                'rovers', 'county', 'orient', 'rangers', 'argyle', 'town', 'city']
    for suffix in suffixes:
        if name.endswith(suffix) and len(name) > len(suffix) + 3:
            return name[:-len(suffix)]
    return name

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

    # Try again with prefixes stripped
    stripped_a = strip_team_prefix(name_a)
    stripped_b = strip_team_prefix(name_b)
    if stripped_a != name_a or stripped_b != name_b:
        if stripped_a == stripped_b: return True
        if len(stripped_a) > 4 and stripped_a in stripped_b: return True
        if len(stripped_b) > 4 and stripped_b in stripped_a: return True

    return False

def team_in_event(team_norm, event_norm):
    """Check if a team name (or any known alias) appears in the event string."""
    if team_norm in event_norm:
        return True

    # Try with common prefix stripped (AFC Bournemouth → bournemouth)
    stripped = strip_team_prefix(team_norm)
    if stripped != team_norm and len(stripped) > 4 and stripped in event_norm:
        return True

    # Try with common suffix stripped (ipswichtown → ipswich, leicestercity → leicester)
    core = strip_team_suffix(team_norm)
    if core != team_norm and len(core) > 4 and core in event_norm:
        return True

    # Try both prefix and suffix stripped (AFC Bournemouth FC → bournemouth)
    core_stripped = strip_team_suffix(stripped) if stripped != team_norm else ''
    if core_stripped and core_stripped != stripped and len(core_stripped) > 4 and core_stripped in event_norm:
        return True

    # Collect all aliases for this team
    aliases = set()
    if team_norm in ALIAS_MAP:
        aliases.update(ALIAS_MAP[team_norm])
    for key, vals in ALIAS_MAP.items():
        if team_norm in vals:
            aliases.add(key)
            aliases.update(vals)
    for alias in aliases:
        if len(alias) > 4 and alias in event_norm:
            return True
        # Also try alias with prefix/suffix stripped
        stripped_alias = strip_team_prefix(alias)
        if stripped_alias != alias and len(stripped_alias) > 4 and stripped_alias in event_norm:
            return True
        core_alias = strip_team_suffix(alias)
        if core_alias != alias and len(core_alias) > 4 and core_alias in event_norm:
            return True
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

# --- ASIANODDS INTEGRATION ---
# Cache for AsianOdds - exact rate limits:
# Live=5s, Today=10s, Early=20s
ASIANODDS_TTL_LIVE = 5     # Exact limit
ASIANODDS_TTL_TODAY = 10   # Exact limit
ASIANODDS_TTL_EARLY = 20   # Exact limit
ASIANODDS_CACHE_FILE = os.path.join(CACHE_DIR, "asianodds_cache.json")

def _load_ao_cache():
    """Load persistent AO cache from disk (survives restarts)."""
    try:
        if os.path.exists(ASIANODDS_CACHE_FILE):
            file_age = time.time() - os.path.getmtime(ASIANODDS_CACHE_FILE)
            if file_age < 3600:  # discard if older than 1 hour
                with open(ASIANODDS_CACHE_FILE, 'r') as f:
                    data = json.load(f)
                total = sum(len(v) for v in data.values() if isinstance(v, dict))
                logger.info(f"Loaded AO cache from disk: {total} matches across {len(data)} keys")
                return data
    except Exception as e:
        logger.warning(f"Could not load AO cache: {e}")
    return {}

def _save_ao_cache(cache):
    """Persist AO cache to disk."""
    try:
        with open(ASIANODDS_CACHE_FILE, 'w') as f:
            json.dump(cache, f)
    except Exception as e:
        logger.warning(f"Could not save AO cache: {e}")

_asianodds_cache = _load_ao_cache()
_asianodds_cache_time = {}

def fetch_asianodds_prices(active_rows, id_to_row_map):
    """
    Fetch sharp Asian prices and match to our active markets.
    Returns dict: {row_id: {'price_pinnacle': pin_price}}
    """
    global _asianodds_cache, _asianodds_cache_time

    if not ASIANODDS_ENABLED:
        return {}

    ao_client = get_asianodds_client()
    if not ao_client:
        logger.warning("AsianOdds client not configured - skipping")
        return {}

    updates = {}
    now = time.time()

    for sport_name, sport_id in ASIANODDS_SPORT_MAP.items():
        ao_has_pin = 0
        ao_skipped_no_pin = 0
        ao_unmatched_samples = 0
        try:
            # Fetch Live, Today, and Early with separate TTLs
            # NBA only appears in Live market (market_type=1) — not in Today/Early
            # EPL matches near kickoff also move to Live before they start
            all_matches = []

            market_types = [(1, ASIANODDS_TTL_LIVE), (2, ASIANODDS_TTL_TODAY), (3, ASIANODDS_TTL_EARLY)]
            for market_type, ttl in market_types:
                cache_key = f"{sport_id}_{market_type}"
                cache_age = now - _asianodds_cache_time.get(cache_key, 0)

                if cache_key in _asianodds_cache and cache_age < ttl:
                    # Use cached data (dict keyed by home_away)
                    cached = _asianodds_cache[cache_key] or {}
                    all_matches.extend([m for m in cached.values() if m and isinstance(m, dict)])
                else:
                    # Fetch fresh — delay between calls to avoid Code -810 rate limit
                    last_fetch = getattr(fetch_asianodds_prices, '_last_fetch_time', 0)
                    elapsed = time.time() - last_fetch
                    if elapsed < ttl and last_fetch > 0:
                        time.sleep(ttl - elapsed)

                    feed_data = ao_client.get_feeds(sport_id, market_type_id=market_type, odds_format="00")
                    fetch_asianodds_prices._last_fetch_time = time.time()

                    matches = []
                    if feed_data and isinstance(feed_data, list):
                        for sf in feed_data:
                            if sf and isinstance(sf, dict):
                                matches.extend(sf.get('MatchGames', []) or [])

                    # Filter out any None values
                    filtered = [m for m in matches if m and isinstance(m, dict)]

                    # MERGE into existing cache — API returns full snapshot on first
                    # call after login, then incremental updates on subsequent calls.
                    # We key by home+away team name so updates refresh prices while
                    # preserving matches not in the incremental batch.
                    existing = _asianodds_cache.get(cache_key, {})
                    if not isinstance(existing, dict):
                        existing = {}  # reset if old format

                    for m in filtered:
                        home_obj = m.get('HomeTeam') or {}
                        away_obj = m.get('AwayTeam') or {}
                        h = home_obj.get('Name', '') if isinstance(home_obj, dict) else ''
                        a = away_obj.get('Name', '') if isinstance(away_obj, dict) else ''
                        if not h:
                            h = m.get('HomeTeamName', '')
                        if not a:
                            a = m.get('AwayTeamName', '')
                        if h and a:
                            # Include league to avoid collisions (EPL vs U21/reserves)
                            league = m.get('LeagueName', '')
                            cache_entry_key = f"{h}_{a}_{league}"
                            # Live feed returns multiple entries per game (1X2, handicap, O/U).
                            # Only overwrite if new entry has odds — don't clobber a good entry
                            # with an empty one.
                            has_odds = False
                            for odds_field in ['FullTimeOneXTwo', 'FullTimeMoneyLine']:
                                od = m.get(odds_field) or {}
                                if isinstance(od, dict) and od.get('BookieOdds'):
                                    has_odds = True
                                    break
                            if has_odds or cache_entry_key not in existing:
                                existing[cache_entry_key] = m

                    _asianodds_cache[cache_key] = existing
                    _asianodds_cache_time[cache_key] = time.time()
                    _save_ao_cache(_asianodds_cache)  # persist to disk
                    all_matches.extend(existing.values())

                    mtype_name = {1: "Live", 2: "Today", 3: "Early"}.get(market_type, str(market_type))
                    logger.info(f"AsianOdds {sport_name} {mtype_name}: {len(filtered)} fresh, {len(existing)} total cached")

            feeds = [{'MatchGames': all_matches}] if all_matches else []

            if not feeds:
                logger.info(f"AsianOdds: No feeds for {sport_name}")
                continue

            # Parse through the nested structure
            for sport_feed in feeds:
                match_games = sport_feed.get('MatchGames', []) or []

                for match in match_games:
                    if not match or not isinstance(match, dict):
                        continue

                    # Team names - try nested first, then flat
                    home_obj = match.get('HomeTeam') or {}
                    away_obj = match.get('AwayTeam') or {}
                    home_team = home_obj.get('Name', '') if isinstance(home_obj, dict) else ''
                    away_team = away_obj.get('Name', '') if isinstance(away_obj, dict) else ''

                    # Fallback to flat field names
                    if not home_team:
                        home_team = match.get('HomeTeamName', '')
                    if not away_team:
                        away_team = match.get('AwayTeamName', '')

                    if not home_team or not away_team:
                        continue

                    norm_home = normalize(home_team)
                    norm_away = normalize(away_team)

                    # Get odds - try multiple fields, use whichever has BookieOdds
                    # NBA Live market has odds in FullTimeOneXTwo (not MoneyLine)
                    bookie_odds_str = ''
                    for field in (['FullTimeMoneyLine', 'FullTimeOneXTwo'] if sport_name == 'Basketball'
                                  else ['FullTimeOneXTwo', 'FullTimeMoneyLine']):
                        md = match.get(field) or {}
                        odds = md.get('BookieOdds', '') if isinstance(md, dict) else ''
                        if odds:
                            bookie_odds_str = odds
                            break
                    if not bookie_odds_str:
                        continue

                    # Parse the bookie odds
                    parsed_odds = ao_client.parse_bookie_odds(bookie_odds_str)
                    # Accept PIN (direct Pinnacle) or SIN (Singbet = Pinnacle redistributor)
                    has_pinnacle = 'PIN' in parsed_odds or 'SIN' in parsed_odds
                    if not parsed_odds or not has_pinnacle:
                        ao_skipped_no_pin += 1
                        continue

                    ao_has_pin += 1
                    ao_matched_this = False

                    # Find matching rows in our DB
                    for row in active_rows:
                        if row['sport'] != sport_name:
                            continue

                        # Match by team names (home or away)
                        runner_match = False
                        side = None

                        if check_match(norm_home, row['norm_runner']):
                            runner_match = True
                            side = 'home'
                        elif check_match(norm_away, row['norm_runner']):
                            runner_match = True
                            side = 'away'
                        elif sport_name == 'Soccer' and 'draw' in row['norm_runner'].lower():
                            # Only soccer has draws
                            runner_match = True
                            side = 'draw'

                        if not runner_match:
                            continue

                        # Event must contain BOTH teams to prevent cross-match contamination
                        event_match = (team_in_event(norm_home, row['norm_event']) and team_in_event(norm_away, row['norm_event']))

                        if not event_match:
                            continue

                        # Get Pinnacle price — prefer PIN (direct), fallback SIN (Singbet)
                        pin_odds = parsed_odds.get('PIN') or parsed_odds.get('SIN') or {}
                        pin_price = pin_odds.get(side, 0)

                        if pin_price and pin_price > 1.01:
                            row_id = row['id']
                            updates[row_id] = {
                                'price_pinnacle': pin_price
                            }
                            ao_matched_this = True
                            src = 'PIN' if 'PIN' in parsed_odds else 'SIN'
                            logger.info(f"✓ {src}: {row['runner_name']} @ {pin_price}")

                    # Debug: log first 5 unmatched EPL/NBA entries with failure reason
                    if not ao_matched_this and ao_unmatched_samples < 5:
                        league = match.get('LeagueName', '')
                        is_target = ('PREMIER' in league.upper() and sport_name == 'Soccer') or \
                                    (sport_name == 'Basketball') or (sport_name == 'MMA')
                        if is_target:
                            ao_unmatched_samples += 1
                            # Find WHY it didn't match
                            sport_rows = [r for r in active_rows if r['sport'] == sport_name]
                            for r in sport_rows[:5]:
                                home_ok = check_match(norm_home, r['norm_runner'])
                                away_ok = check_match(norm_away, r['norm_runner'])
                                runner_ok = home_ok or away_ok or (sport_name == 'Soccer' and 'draw' in r['norm_runner'].lower())
                                ev_home = team_in_event(norm_home, r['norm_event'])
                                ev_away = team_in_event(norm_away, r['norm_event'])
                                if runner_ok and not (ev_home and ev_away):
                                    logger.info(f"  NEAR-MISS: AO={home_team} vs {away_team} [{league}]")
                                    logger.info(f"    DB runner={r['runner_name']} event={r['event_name']}")
                                    logger.info(f"    runner_ok={runner_ok} ev_home={ev_home} ev_away={ev_away}")
                                    break

            # Diagnostic: show PIN data availability
            sport_rows = [r for r in active_rows if r['sport'] == sport_name]
            logger.info(f"AO {sport_name}: {ao_has_pin} with PIN, {ao_skipped_no_pin} without PIN, {len(sport_rows)} DB rows")

            # For Soccer: count EPL matches in cache and show which have PIN
            if sport_name == 'Soccer' and all_matches:
                epl_total = 0
                epl_with_pin = 0
                epl_without_pin_samples = []
                ao_client_ref = get_asianodds_client()
                for m in all_matches:
                    league = (m.get('LeagueName') or '').upper()
                    if 'ENGLISH PREMIER' in league and 'U21' not in league and 'U23' not in league:
                        epl_total += 1
                        odds_str = (m.get('FullTimeOneXTwo') or {}).get('BookieOdds', '')
                        parsed = ao_client_ref.parse_bookie_odds(odds_str) if ao_client_ref and odds_str else {}
                        has_pin = 'PIN' in parsed or 'SIN' in parsed
                        if has_pin:
                            epl_with_pin += 1
                        elif len(epl_without_pin_samples) < 3:
                            h = ((m.get('HomeTeam') or {}).get('Name', '') or m.get('HomeTeamName', '')).lower()
                            a = ((m.get('AwayTeam') or {}).get('Name', '') or m.get('AwayTeamName', '')).lower()
                            bookies = list(parsed.keys())[:5] if parsed else ['(no odds)']
                            epl_without_pin_samples.append(f"{h} vs {a} bookies={bookies}")
                logger.info(f"  EPL in cache: {epl_total} total, {epl_with_pin} with PIN/SIN")
                if epl_without_pin_samples:
                    for s in epl_without_pin_samples:
                        logger.info(f"    EPL no PIN: {s}")

            # For Basketball: show unique leagues and find NBA-like matches
            if sport_name == 'Basketball' and all_matches:
                leagues = {}
                nba_teams = ['lakers', 'celtics', 'warriors', 'hornets', 'bucks', 'nets', 'knicks', 'bulls', 'heat', 'cavaliers']
                nba_found = []
                for m in all_matches:
                    league = m.get('LeagueName', '(none)')
                    leagues[league] = leagues.get(league, 0) + 1
                    # Also search by team name
                    h = ((m.get('HomeTeam') or {}).get('Name', '') or m.get('HomeTeamName', '')).lower()
                    a = ((m.get('AwayTeam') or {}).get('Name', '') or m.get('AwayTeamName', '')).lower()
                    for t in nba_teams:
                        if t in h or t in a:
                            ml = m.get('FullTimeMoneyLine') or {}
                            x2 = m.get('FullTimeOneXTwo') or {}
                            ml_odds = (ml.get('BookieOdds') or '')[:80] if isinstance(ml, dict) else ''
                            x2_odds = (x2.get('BookieOdds') or '')[:80] if isinstance(x2, dict) else ''
                            nba_found.append(f"{h} vs {a} [{league}] ML={ml_odds or 'N/A'} 1X2={x2_odds or 'N/A'}")
                            break
                # Show top 5 leagues by match count
                top_leagues = sorted(leagues.items(), key=lambda x: -x[1])[:5]
                logger.info(f"  Basketball leagues: {top_leagues}")
                if nba_found:
                    logger.info(f"  NBA-like matches: {len(nba_found)}")
                    for s in nba_found[:3]:
                        logger.info(f"    {s}")
                else:
                    logger.info(f"  No NBA team names found in {len(all_matches)} basketball matches")

        except Exception as e:
            logger.error(f"AsianOdds fetch error for {sport_name}: {e}")

    # Per-sport breakdown
    sport_counts = {}
    for rid, u in updates.items():
        orig = id_to_row_map.get(rid, {})
        s = orig.get('sport', 'Unknown')
        sport_counts[s] = sport_counts.get(s, 0) + 1
    if updates:
        logger.info(f"🎯 AsianOdds: Matched {len(updates)} prices {sport_counts}")
    else:
        logger.info(f"AsianOdds: No prices matched to DB rows")

    return updates


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

# 🧠 SURGICAL BUDGETING (NBA 2m / MMA 1m / 0 IN-PLAY)
        if min_seconds_away <= 0:
            # 🛑 SILENCE IN-PLAY: Save credits by sleeping 10 mins
            ttl = 600 
        elif sport['name'] == 'MMA':
            if min_seconds_away < 28800:   # 8 Hours before Fight: 1 min
                ttl = 60  
            elif min_seconds_away < 86400: # Fight Day: 5 mins
                ttl = 300 
            else:                          # Maintenance: 1 day
                ttl = 3600 
        elif sport['name'] == 'Basketball':
            if min_seconds_away < 43200:   # 12 Hours before Tip: 2 mins
                ttl = 120
            else:                          # Maintenance: 5 mins
                ttl = 300
        elif sport['name'] == 'Soccer':
            if min_seconds_away < 43200:   # 12 Hours before Kickoff: 2 mins
                ttl = 120
            else:                          # Maintenance: 5 mins
                ttl = 300
        else:
            ttl = 3600 # Fallback

        # 🔍 DEBUG: Print exactly why we are sleeping
        if min_seconds_away < 86400:
             logger.info(f"[{sport['name']}] Active Cycle (Game in {min_seconds_away/3600:.1f}h) -> TTL: {ttl}s")

        data = fetch_cached_odds(
            sport['odds_api_key'], 
            ttl_seconds=ttl, 
            bookmakers=sport.get('bookmakers')
        )

        if isinstance(data, dict) and 'message' in data:
            logger.warning(f"API MESSAGE ({sport['name']}): {data['message']}")
            continue

        # 📊 MONITORING: Check Data Age
        cache_file = os.path.join(CACHE_DIR, f"{sport['odds_api_key']}.json")
        data_age = time.time() - os.path.getmtime(cache_file) if os.path.exists(cache_file) else 0
        
        # Log based on budget zones
        if min_seconds_away < 86400: # Day of Game
            if data_age > 320: # Allow slight buffer over 300s
                logger.warning(f"⚠️  STALE (ACTIVE): {sport['name']} is {data_age:.1f}s old (Target: 300s)")
            else:
                logger.info(f"✅ FRESH (ACTIVE): {sport['name']} is {data_age:.1f}s old")
        else:
            logger.info(f"💤 ECO MODE: {sport['name']} is {data_age:.0f}s old (TTL: {ttl}s)")

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
            
            # ✅ FIX: Dynamically switch to 'william' if the config asks for it
            primary_key = 'william' if sport.get('use_williamhill_as_primary') else 'ladbrokes'
            ladbrokes_book = next((b for b in bookmakers if primary_key in str(b.get('key', '')).lower()), None)
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
                        event_match = (team_in_event(api_home, row['norm_event']) or team_in_event(api_away, row['norm_event']))
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

                # PIN price now sourced exclusively from AsianOdds (live feed)
                # The Odds API Pinnacle is stale/delayed — do not write it

                price_ladbrokes = find_price(get_h2h(ladbrokes_book), raw_name)
                if price_ladbrokes is not None:
                    updates[row_id]['price_bet365'] = price_ladbrokes

                p = find_price(get_h2h(paddy_book), raw_name)
                if p is not None:
                    updates[row_id]['price_paddy'] = p

    tracker.report()

    # --- ASIANODDS SHARP PRICE OVERLAY ---
    # Fetch Asian prices and merge into updates (overrides Pinnacle)
    if ASIANODDS_ENABLED:
        try:
            asian_prices = fetch_asianodds_prices(active_rows, id_to_row_map)
            for row_id, prices in asian_prices.items():
                if row_id in updates:
                    # Override Pinnacle with Asian price
                    updates[row_id]['price_pinnacle'] = prices['price_pinnacle']
                else:
                    # Create new update entry for this row
                    orig_row = id_to_row_map.get(row_id, {})
                    updates[row_id] = {
                        'id': row_id,
                        'sport': orig_row.get('sport'),
                        'market_id': orig_row.get('market_id'),
                        'runner_name': orig_row.get('runner_name'),
                        'price_pinnacle': prices['price_pinnacle'],
                        'last_updated': datetime.now(timezone.utc).isoformat()
                    }
            if asian_prices:
                logger.info(f"🇸🇬 AsianOdds: Applied {len(asian_prices)} sharp prices")
                for rid, ap in asian_prices.items():
                    final_pin = updates.get(rid, {}).get('price_pinnacle')
                    logger.info(f"  DB_WRITE row={rid}: pin={final_pin} (asian={ap.get('price_pinnacle')})")

            # Clear stale PIN prices for AO-sport rows that didn't get a match this cycle.
            # Prevents false matches from persisting after matching logic is fixed.
            ao_matched_ids = set(asian_prices.keys())
            stale_cleared = 0
            for row in active_rows:
                if row['sport'] not in ASIANODDS_SPORT_MAP:
                    continue
                row_id = row['id']
                if row_id in ao_matched_ids:
                    continue
                orig_row = id_to_row_map.get(row_id, {})
                if orig_row.get('price_pinnacle') is not None:
                    if row_id in updates:
                        updates[row_id]['price_pinnacle'] = None
                    else:
                        updates[row_id] = {
                            'id': row_id,
                            'sport': orig_row.get('sport'),
                            'market_id': orig_row.get('market_id'),
                            'runner_name': orig_row.get('runner_name'),
                            'price_pinnacle': None,
                            'last_updated': datetime.now(timezone.utc).isoformat()
                        }
                    stale_cleared += 1
            if stale_cleared:
                logger.info(f"🧹 Cleared {stale_cleared} stale PIN prices")
        except Exception as e:
            logger.error(f"AsianOdds integration error: {e}")
    # ------------------------------------

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
            # [INSTRUMENTATION START]
            if sport_conf['name'] == 'Basketball':
                logger.info(f"🏀 DEBUG: Query='{sport_conf.get('text_query')}' | CompID='{sport_conf.get('competition_id')}' | Found={len(markets)}")
            # [INSTRUMENTATION END]
            
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
                        # 💀 EXPLICIT KILL: Mark it closed so frontend hides it immediately
                        supabase.table('market_feed').update({
                            'market_status': 'CLOSED',
                            'in_play': True,
                            'last_updated': datetime.now(timezone.utc).isoformat()
                        }).eq('market_id', book.market_id).execute()
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

                    # Skip youth/reserve/lower leagues (noise)
                    if any(x in comp_name.upper() for x in ['U21', 'U23', 'U19', 'RESERVE', 'YOUTH', 'PREMIER LEAGUE 2', 'DIV 1', 'DIV 2']):
                        continue

                    for runner in book.runners:
                        if runner.status != 'ACTIVE':
                            continue

                        runner_details = next((r for r in market_info.runners if r.selection_id == runner.selection_id), None)
                        if not runner_details:
                            continue

                        name = runner_details.runner_name
                        if not name:  # Skip runners with null/empty name
                            continue
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

        # [GUARDRAIL START]
    if SCOPE_MODE.startswith("NBA") and best_price_map:
        has_nba = any(item['sport'] == 'Basketball' for item in best_price_map.values())
        if not has_nba:
            logger.error("🛑 CRITICAL: NBA Scope active, but 0 Basketball markets were staged for DB sync!")
    # [GUARDRAIL END]

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
    logger.info("--- STARTING UNIVERSAL ENGINE ---")
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

        # --- INDEPENDENCE V4 ALERTS ---
        try:
            telegram_alerts.run_alert_cycle(supabase)
        except Exception as e:
            logger.error(f"Alert Cycle Failed: {e}")

        # RATE LIMIT GUARD: Do not run faster than 1 cycle per 6s (approx 600-1200 calls/hr)
        time.sleep(6)