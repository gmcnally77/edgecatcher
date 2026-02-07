#!/usr/bin/env python3
"""Check what EPL matches have on AsianOdds."""
import os
import hashlib
import requests
import json
from pathlib import Path

# Load .env
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

def md5(text):
    return hashlib.md5(text.encode()).hexdigest()

def main():
    # Login
    headers = {"Accept": "application/json"}
    resp = requests.get(f"{BASE_URL}/Login", params={"username": USERNAME, "password": md5(PASSWORD)}, headers=headers, timeout=30)
    data = json.loads(resp.text.lstrip('\ufeff'))

    result = data.get("Result") or {}
    token = result.get("Token")
    key = result.get("Key")
    service_url = result.get("Url")

    # Register
    headers = {"Accept": "application/json", "AOToken": token, "AOKey": key}
    requests.get(f"{service_url}/Register", params={"username": USERNAME}, headers=headers, timeout=30)

    # Get Soccer Today
    resp = requests.get(f"{service_url}/GetFeeds", params={"sportsType": 1, "marketTypeId": 2, "oddsFormat": "00"}, headers=headers, timeout=30)
    data = json.loads(resp.text.lstrip('\ufeff'))

    result = data.get("Result") or {}
    sports = result.get("Sports") or []

    for sport in sports:
        for match in sport.get("MatchGames") or []:
            league = match.get("LeagueName", "").lower()
            if "premier" not in league:
                continue

            home = (match.get("HomeTeam") or {}).get("Name", "?")
            away = (match.get("AwayTeam") or {}).get("Name", "?")

            print(f"\n{'='*60}")
            print(f"{home} vs {away}")
            print(f"League: {match.get('LeagueName')}")
            print(f"\nALL FIELDS IN MATCH:")
            for key, value in match.items():
                if key in ['HomeTeam', 'AwayTeam']:
                    continue
                if isinstance(value, dict) and value:
                    print(f"  {key}: {value}")
                elif value and not isinstance(value, dict):
                    print(f"  {key}: {value}")

if __name__ == "__main__":
    main()
