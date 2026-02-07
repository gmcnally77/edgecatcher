#!/usr/bin/env python3
"""
Validate AsianOdds Pinnacle Prices
Prints PIN prices for EPL, NBA, and UFC to compare with UI.
"""
import os
import hashlib
import requests
import json
from pathlib import Path

# Load .env file
env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                os.environ.setdefault(key.strip(), val.strip())

USERNAME = os.getenv("ASIANODDS_USERNAME")
PASSWORD = os.getenv("ASIANODDS_PASSWORD")

BASE_URL = "https://webapi.asianodds88.com/AsianOddsService"

def md5_hash(text):
    return hashlib.md5(text.encode()).hexdigest()

def api_request(url, headers, params=None):
    resp = requests.get(url, params=params, headers=headers, timeout=30)
    text = resp.text.lstrip('\ufeff')
    return json.loads(text)

def parse_bookie_odds(odds_string):
    """Parse BookieOdds string, return PIN prices only."""
    if not odds_string:
        return None

    for part in odds_string.split(";"):
        part = part.strip()
        if not part or part.upper().startswith("BEST"):
            continue

        bookie = None
        prices_str = None

        if "=" in part:
            bookie, prices_str = part.split("=", 1)
        elif ":" in part:
            bookie, prices_str = part.split(":", 1)

        if not bookie or not prices_str:
            continue

        if bookie.strip().upper() != "PIN":
            continue

        try:
            parts = prices_str.split(",")
            if len(parts) >= 3 and parts[2]:
                # 3-way: home, draw, away
                return {
                    "home": float(parts[0]) if parts[0] else 0,
                    "draw": float(parts[1]) if parts[1] else 0,
                    "away": float(parts[2]) if parts[2] else 0
                }
            elif len(parts) >= 2:
                # 2-way: home, away
                return {
                    "home": float(parts[0]) if parts[0] else 0,
                    "away": float(parts[1]) if parts[1] else 0
                }
        except:
            pass

    return None

def main():
    if not PASSWORD or not USERNAME:
        print("Missing ASIANODDS credentials in .env file")
        return

    # Login
    print("Logging in...")
    password_hash = md5_hash(PASSWORD)
    headers = {"Accept": "application/json"}

    login_data = api_request(
        f"{BASE_URL}/Login",
        headers,
        {"username": USERNAME, "password": password_hash}
    )

    if login_data.get("Code") != 0:
        print(f"Login failed: {login_data}")
        return

    result = login_data.get("Result", {})
    token = result.get("Token")
    key = result.get("Key")
    service_url = result.get("Url")

    # Register
    headers = {"Accept": "application/json", "AOToken": token, "AOKey": key}
    reg_data = api_request(f"{service_url}/Register", headers, {"username": USERNAME})

    if reg_data.get("Code") != 0:
        print(f"Register failed: {reg_data}")
        return

    print("Connected!\n")

    # Sport configs: (sport_id, name, league_filter)
    sports = [
        (1, "EPL (Soccer)", ["english premier"]),
        (2, "NBA (Basketball)", ["nba"]),
        (9, "UFC (MMA)", ["ufc"]),
    ]

    for sport_id, sport_name, league_filters in sports:
        print("=" * 60)
        print(f"{sport_name}")
        print("=" * 60)

        # Try Today then Early
        for market_type, market_name in [(2, "Today"), (3, "Early")]:
            feeds = api_request(
                f"{service_url}/GetFeeds",
                headers,
                {"sportsType": sport_id, "marketTypeId": market_type, "oddsFormat": "00"}
            )

            if feeds.get("Code") != 0:
                continue

            for sport_feed in feeds.get("Result", {}).get("Sports", []):
                for match in sport_feed.get("MatchGames", []):
                    league = match.get("LeagueName", "").lower()

                    # Filter by league
                    if not any(f in league for f in league_filters):
                        continue

                    home = match.get("HomeTeamName", "?")
                    away = match.get("AwayTeamName", "?")

                    # Get odds - try 1X2 first, then MoneyLine
                    odds_str = None
                    market = ""

                    ft_1x2 = match.get("FullTimeOneXTwo", {})
                    if ft_1x2.get("BookieOdds"):
                        odds_str = ft_1x2.get("BookieOdds")
                        market = "1X2"

                    if not odds_str:
                        ft_ml = match.get("FullTimeMoneyLine", {})
                        if ft_ml.get("BookieOdds"):
                            odds_str = ft_ml.get("BookieOdds")
                            market = "ML"

                    if not odds_str:
                        continue

                    pin = parse_bookie_odds(odds_str)
                    if not pin:
                        continue

                    # Print
                    if "draw" in pin:
                        print(f"[{market_name}] {home} vs {away}")
                        print(f"  PIN: H={pin['home']:.3f}  D={pin['draw']:.3f}  A={pin['away']:.3f}")
                    else:
                        print(f"[{market_name}] {home} vs {away}")
                        print(f"  PIN: H={pin['home']:.3f}  A={pin['away']:.3f}")
                    print()

        print()

if __name__ == "__main__":
    main()
