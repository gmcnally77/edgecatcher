# backend/sports_config.py

# This list controls which leagues the Universal Engine tracks.
#
# HOW TO ADD NEW LEAGUES:
# 1. Find the key from The Odds API (https://the-odds-api.com/sports-odds-data/sports-api.html)
# 2. Match it to the correct Betfair ID (Bucket):
#    - 7522     = Basketball (All)
#    - 6423     = American Football (All)
#    - 26420387 = MMA (All)
#    - 1        = Soccer (All)

# backend/sports_config.py

SPORTS_CONFIG = [
    # --- MMA (WORKING) ---
    {
        "name": "MMA",
        "betfair_id": "26420387",
        "odds_api_key": "mma_mixed_martial_arts",
        "strict_mode": False  # <--- ADD THIS. Trust the Alias Map, skip the Event Name check.
    },
    # --- AMERICAN FOOTBALL (WORKING) ---
    {
        "name": "NFL",
        "betfair_id": "6423",
        "text_query": "NFL",
        "odds_api_key": "americanfootball_nfl"
    },
    {
        "name": "NFL", 
        "betfair_id": "6423",
        "text_query": "NCAA Football",
        "odds_api_key": "americanfootball_ncaaf",
        "strict_mode": False  # Force fuzzy matching for high-variance NCAA names
    },
    {
        "name": "NFL",
        "betfair_id": "6423",
        "text_query": "FCS",
        "odds_api_key": "americanfootball_ncaaf",
        "strict_mode": False  # <--- MUST BE FALSE
    },
    # --- BASKETBALL (RESTRICTED TO NBA ONLY) ---
    {
        "name": "Basketball",
        "betfair_id": "7522",
        "text_query": "NBA",
        "odds_api_key": "basketball_nba"
    }
]

# --- ALIAS MAP ---
ALIAS_MAP = {
    # MMA Specifics (Consolidated)
    "alexandervolkanovski": ["alexvolkanovski"], 
    "alexvolkanovski": ["alexandervolkanovski"],
    "diegolopes": ["diegolopez"],
    "diegolopez": ["diegolopes"],
    
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
    "fiu": ["floridainternational", "floridainternationalpanthers", "floridaintl", "floridainternationaluniv"],
    "utsa": ["texas-sanantonio", "utsaroadrunners", "utsa-roadrunners", "texassanantonio"],
    "floridaintl": ["fiu"],
    "floridainternationalpanthers": ["fiu"],
    "utsaroadrunners": ["utsa"],
    "minnesota": ["minnesotagoldengophers", "minnesota"],
    "newmexico": ["newmexicolobos"],
    "utsa": ["texas-sanantonio", "utsaroadrunners", "utsa"],
    "dallas": ["dallascowboys"],
    "unlv": ["nevada-lasvegas", "nevadalasvegas", "unlvrunninrebels"],
    "utsa": ["texas-sanantonio", "utsaroadrunners"],
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
}