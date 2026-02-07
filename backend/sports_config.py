# backend/sports_config.py
import os

# This list controls which leagues the Universal Engine tracks.
#
# HOW TO ADD NEW LEAGUES:
# 1. Find the key from The Odds API (https://the-odds-api.com/sports-odds-data/sports-api.html)
# 2. Match it to the correct Betfair ID (Bucket):
#    - 7522     = Basketball (All)
#    - 6423     = American Football (All)
#    - 26420387 = MMA (All)
#    - 1        = Soccer (All)

SPORTS_CONFIG = [
    # --- MMA (WORKING) ---
    {
        "name": "MMA",
        "betfair_id": "26420387",
        "odds_api_key": "mma_mixed_martial_arts",
        "bookmakers": "pinnacle,williamhill,paddypower",
        "use_williamhill_as_primary": True, # Map WH to the middle column
        "strict_mode": False
    },
    # --- AMERICAN FOOTBALL (OFF-SEASON - DISABLED) ---
    # {
    #     "name": "NFL",
    #     "betfair_id": "6423",
    #     "text_query": "NFL",
    #     "odds_api_key": "americanfootball_nfl"
    # },
    # {
    #     "name": "NFL",
    #     "betfair_id": "6423",
    #     "text_query": "NCAA Football",
    #     "odds_api_key": "americanfootball_ncaaf",
    #     "strict_mode": False  # Force fuzzy matching for high-variance NCAA names
    # },
    # {
    #     "name": "NFL",
    #     "betfair_id": "6423",
    #     "text_query": "FCS",
    #     "odds_api_key": "americanfootball_ncaaf",
    #     "strict_mode": False  # <--- MUST BE FALSE
    # },
    # --- SOCCER ---
    {
        "name": "Soccer",
        "betfair_id": "1",
        "competition_id": "10932509",  # English Premier League (specific ID, no reserve leagues)
        "odds_api_key": "soccer_epl",
        "bookmakers": "pinnacle,williamhill,paddypower,ladbrokes_uk"
    },
    # --- BASKETBALL (RESTRICTED TO NBA ONLY) ---
    {
        "name": "Basketball",
        "betfair_id": "7522",
        "competition_id": "10547864",  # <--- CRITICAL FIX: Target specific NBA ID
        # "text_query": "NBA",         # <--- REMOVE or COMMENT OUT (Causes 0 results)
        "odds_api_key": "basketball_nba",
        "bookmakers": "pinnacle,ladbrokes_uk,paddypower"
    }
]

# --- ALIAS MAP ---
ALIAS_MAP = {
    # MMA Specifics (Consolidated)
    "alexandervolkanovski": ["alexvolkanovski"], 
    "alexvolkanovski": ["alexandervolkanovski"],
    "alexanderhernandez": ["alexhernandez"],
    "alexhernandez": ["alexanderhernandez"],
    "danhooker": ["danielhooker"],
    "danielhooker": ["danhooker"],
    "diegolopes": ["diegolopez"],
    "diegolopez": ["diegolopes"],
    "dommarfan": ["dominicmarfan", "dommarfan"], 
    "sangwookkim": ["kimsangwook", "sangkim", "sang-wookkim"],
    "klaudiasygula": ["ksygula", "klaudiasygua", "sygula"],
    "klaudiasygua": ["klaudiasygula"],
    "ksygula": ["klaudiasygula"],

    # NFL (Standardized to handle market vs. full names)
    "washington": ["washingtoncommanders", "commanders"],
    "washingtoncommanders": ["washington"],
    "detroit": ["detroitlions"],
    "detroitlions": ["detroit"],
    "minnesotavikings": ["minnesota"], # Strict for NFL
    "minnesotagoldengophers": ["minnesota", "minnesotagophers"], # Strict for NCAA
    "dallas": ["dallascowboys"],
    "dallascowboys": ["dallas"],
    "nygiants": ["newyorkgiants"],
    "newyorkgiants": ["nygiants"],
    "nyjets": ["newyorkjets"],
    "newyorkjets": ["nyjets"],
    "baltimore": ["baltimoreravens"],
    "greenbay": ["greenbaypackers"],
    "cincinnati": ["cincinnatibengals"],
    "arizona": ["arizonacardinals"],
    "indianapolis": ["indianapoliscolts"],
    "jacksonville": ["jacksonvillejaguars"],
    
    # NCAAF (Bridging school names and mascots)
    "miami": ["miamifl", "miamiflorida", "miamihurricanes", "miamioh", "miamiohio"],
    "miamifl": ["miami", "miamiflorida", "miamihurricanes"],
    "miamiflorida": ["miami", "miamifl", "miamihurricanes"],
    "miamiohio": ["miami", "miamioh", "miamiohioredhawks", "miami (oh)"],
    "miami (oh)": ["miamiohio"],
    "miami (oh) redhawks": ["miamiohio"],
    "olemiss": ["mississippi", "mississippistate", "olemissrebels"],
    "mississippi": ["olemiss"],
    "ncstate": ["northcarolinastate"],
    "northcarolinastate": ["ncstate"],
    "usc": ["southerncalifornia", "usctrojans"],
    "southerncalifornia": ["usc"],
    "newmexico": ["newmexicolobos"],
    "fiu": ["floridainternational", "floridainternationalpanthers", "floridaintl", "floridainternationaluniv", "floridaint", "flainternational", "fiu"],
    "utsa": ["texas-sanantonio", "utsaroadrunners", "utsa-roadrunners", "texassanantonio"],
    "floridainternationalpanthers": ["fiu"],
    "minnesota": ["minnesotagoldengophers", "minnesota"],
    "utsa": ["texas-sanantonio", "utsaroadrunners", "utsa"],
    "dallas": ["dallascowboys"],
    "unlv": ["nevada-lasvegas", "nevadalasvegas", "unlvrunninrebels"],
    "ohio": ["ohiobobcats"],
    "army": ["armywestpoint", "armyblackknights"],
    "connecticut": ["uconn", "uconnhuskies", "connecticut huskies"],
    "uconn": ["connecticut"],
    "army": ["army black knights", "army"],
    "byu": ["brighamyoung", "byucougars"],
    "georgiatech": ["georgiatechyellowjackets"],
    "fresnostate": ["calstfresno", "fresnostatebulldogs"],
    
    # NCAA FCS (Consistent abbreviations)
    "northdakotastate": ["ndsu", "northdakotast"],
    "ndsu": ["northdakotastate"],
    "southdakotastate": ["sdsu", "southdakotast"],
    "sdsu": ["southdakotastate"],
    "montana": ["montanagrizzlies"],
    "montanastate": ["montanast", "montanastbobcats"],
    "delaware": ["delawarebluehens"],
    "illinoisstate": ["illstate", "ilstate", "illinoisst", "illinoisstredbirds"],
    "villanova": ["villanovawildcats", "nova"],
    
    # --- NBA ---
    "losangeles": ["lalakers", "laclippers", "la", "lakers", "clippers"],
    "lalakers": ["losangeleslakers", "losangeles", "lakers"],
    "laclippers": ["losangelesclippers", "losangeles", "clippers"],
    "newyork": ["nyknicks", "ny", "knicks"],
    "nyknicks": ["newyorkknicks", "newyork", "knicks"],
    "goldenstate": ["gswarriors", "gs", "warriors"],
    "gswarriors": ["goldenstatewarriors", "goldenstate"],
    "sanantonio": ["sanantoniospurs", "spurs"],
    "sanantoniospurs": ["sanantonio"],
}

# --- SCOPE GUARD (NEW) ---
SCOPE_MODE = os.getenv("SCOPE_MODE", "")

if SCOPE_MODE.startswith("NBA_PREMATCH_ML"):
    # 1. Filter Sports to NBA, MMA & Soccer
    SPORTS_CONFIG = [s for s in SPORTS_CONFIG if s["name"] in ["Basketball", "MMA", "Soccer"]]
    print(f">> 🔒 SCOPE_MODE ACTIVE: {SCOPE_MODE} (Filtering Sports)")