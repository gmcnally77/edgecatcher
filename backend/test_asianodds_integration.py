#!/usr/bin/env python3
"""
Test AsianOdds Integration
Verifies the client can fetch feeds and parse odds.
"""
import os
import sys

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from asianodds_client import AsianOddsClient

def test_integration():
    print("=" * 60)
    print("ASIANODDS INTEGRATION TEST")
    print("=" * 60)

    # 1. Create Client
    try:
        client = AsianOddsClient()
        print("✅ Client created")
    except ValueError as e:
        print(f"❌ Client creation failed: {e}")
        print("   Set ASIANODDS_USERNAME and ASIANODDS_PASSWORD env vars")
        return False

    # 2. Login
    print("\n[1] Testing Login...")
    if not client.login():
        print("❌ Login failed")
        return False
    print(f"✅ Login successful")
    print(f"   Token: {client.ao_token[:20]}...")
    print(f"   Service URL: {client.service_url}")

    # 3. Register
    print("\n[2] Testing Register...")
    if not client.register():
        print("❌ Register failed")
        return False
    print("✅ Registration successful")

    # 4. Get Sports
    print("\n[3] Getting available sports...")
    sports = client.get_sports()
    if not sports:
        print("⚠️  No sports returned")
    else:
        print(f"✅ Found {len(sports)} sports:")
        for s in sports[:10]:  # Show first 10
            print(f"   ID: {s.get('SportsType')} - {s.get('SportsName')}")

    # 5. Get Soccer Feeds (Today)
    print("\n[4] Getting Soccer feeds (Today)...")
    soccer_feeds = client.get_feeds(sport_id=1, market_type_id=2)
    if not soccer_feeds:
        print("⚠️  No soccer feeds returned")
    else:
        total_matches = 0
        for sport_feed in soccer_feeds:
            matches = sport_feed.get('MatchGames', [])
            total_matches += len(matches)

            # Show first few matches
            for match in matches[:3]:
                home = match.get('HomeTeamName', '?')
                away = match.get('AwayTeamName', '?')
                ft = match.get('FullTimeOneXTwo', {})
                odds_str = ft.get('BookieOdds', 'N/A')

                print(f"\n   {home} vs {away}")
                print(f"   Odds: {odds_str[:80]}...")

                # Parse odds
                parsed = client.parse_bookie_odds(odds_str)
                if parsed:
                    for bookie, prices in parsed.items():
                        print(f"   -> {bookie}: H={prices.get('home'):.2f} D={prices.get('draw', 0):.2f} A={prices.get('away'):.2f}")

        print(f"\n✅ Found {total_matches} soccer matches")

    # 6. Get Basketball Feeds
    print("\n[5] Getting Basketball feeds (Today)...")
    bball_feeds = client.get_feeds(sport_id=3, market_type_id=2)
    if not bball_feeds:
        print("⚠️  No basketball feeds returned")
    else:
        total_matches = 0
        for sport_feed in bball_feeds:
            matches = sport_feed.get('MatchGames', [])
            total_matches += len(matches)

            for match in matches[:3]:
                home = match.get('HomeTeamName', '?')
                away = match.get('AwayTeamName', '?')
                ml = match.get('FullTimeMoneyLine', {})
                odds_str = ml.get('BookieOdds', 'N/A')

                print(f"\n   {home} vs {away}")
                print(f"   ML Odds: {odds_str[:80]}...")

        print(f"\n✅ Found {total_matches} basketball matches")

    print("\n" + "=" * 60)
    print("INTEGRATION TEST COMPLETE")
    print("=" * 60)
    return True

if __name__ == "__main__":
    test_integration()
