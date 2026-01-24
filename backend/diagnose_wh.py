import os
import requests
import json
from dotenv import load_dotenv

# 1. Load Keys
load_dotenv()
KEY = os.getenv("ODDS_API_KEY")

# 2. Config
SPORT = "mma_mixed_martial_arts"
REGION = "uk"

if not KEY:
    print("❌ Error: ODDS_API_KEY not found in .env")
    exit()

print(f"🔎 Fetching William Hill data for {SPORT}...")

# 3. Fetch ONLY William Hill
url = f'https://api.the-odds-api.com/v4/sports/{SPORT}/odds'
params = {
    'api_key': KEY,
    'regions': REGION,
    'markets': 'h2h',
    'bookmakers': 'williamhill', # 🎯 Target ONLY William Hill
    'oddsFormat': 'decimal',
}

res = requests.get(url, params=params)
data = res.json()

if "message" in data:
    print(f"❌ API Error: {data['message']}")
    exit()

print(f"✅ Found {len(data)} events from William Hill.\n")

# 4. Print The Names
for event in data:
    home = event['home_team']
    away = event['away_team']
    
    # Extract WH Price
    wh_prices = []
    for b in event['bookmakers']:
        if 'william' in b['key']:
            for m in b['markets']:
                if m['key'] == 'h2h':
                    wh_prices = [f"{o['name']} ({o['price']})" for o in m['outcomes']]
    
    if wh_prices:
        print(f"🥊 {home} vs {away}")
        print(f"   ↳ WH Names: {wh_prices}")
        print("-" * 30)
    else:
        # If WH is missing for this specific fight
        pass