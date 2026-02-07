"""
AsianOdds API Client
Handles authentication, session management, and odds fetching.
"""
import os
import hashlib
import requests
import time
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

class AsianOddsClient:
    BASE_URL = "https://webapi.asianodds88.com/AsianOddsService"

    def __init__(self, username=None, password=None):
        self.username = username or os.getenv("ASIANODDS_USERNAME")
        self.password = password or os.getenv("ASIANODDS_PASSWORD")

        if not self.username or not self.password:
            raise ValueError("AsianOdds credentials not provided")

        self.ao_token = None
        self.ao_key = None
        self.service_url = None
        self.last_activity = 0
        self.session_timeout = 240  # 4 minutes (API times out at 5)

    def _md5_hash(self, text):
        return hashlib.md5(text.encode()).hexdigest()

    def _request(self, method, endpoint, params=None, use_service_url=True):
        """Make authenticated request to API."""
        base = self.service_url if (use_service_url and self.service_url) else self.BASE_URL
        url = f"{base}/{endpoint}"

        headers = {
            "Accept": "application/json"
        }

        if self.ao_token:
            headers["AOToken"] = self.ao_token
        if self.ao_key:
            headers["AOKey"] = self.ao_key

        try:
            if method == "GET":
                resp = requests.get(url, params=params, headers=headers, timeout=30)
            else:
                resp = requests.post(url, params=params, headers=headers, timeout=30)

            # Handle BOM in response
            text = resp.text.lstrip('\ufeff')
            data = __import__('json').loads(text)

            if isinstance(data, dict) and data.get("Code") == 0:
                self.last_activity = time.time()
            return data

        except Exception as e:
            logger.error(f"AsianOdds API error: {e}")
            return None

    def login(self):
        """Step 1: Login and get temporary token."""
        password_hash = self._md5_hash(self.password)

        params = {
            "username": self.username,
            "password": password_hash
        }

        data = self._request("GET", "Login", params, use_service_url=False)

        if not data or data.get("Code") != 0:
            code = data.get("Code") if data else None
            result = (data.get("Result") or {}) if data else {}
            error_msg = result.get("TextMessage", "No response") if isinstance(result, dict) else "No response"
            logger.error(f"AsianOdds login failed: Code={code}, Message={error_msg}")
            return False

        result = data.get("Result") or {}
        self.ao_token = result.get("Token")
        self.ao_key = result.get("Key")
        self.service_url = result.get("Url")

        logger.info(f"AsianOdds login successful. Service URL: {self.service_url}")
        return True

    def register(self):
        """Step 2: Register within 60 seconds of login."""
        if not self.ao_token or not self.ao_key:
            logger.error("Cannot register - not logged in")
            return False

        params = {"username": self.username}
        data = self._request("GET", "Register", params)

        if not data or data.get("Code") != 0:
            code = data.get("Code") if data else None
            result = (data.get("Result") or {}) if data else {}
            error_msg = result.get("TextMessage", "No response") if isinstance(result, dict) else "No response"
            logger.error(f"AsianOdds register failed: Code={code}, Message={error_msg}")
            return False

        logger.info("AsianOdds registration successful")
        return True

    def ensure_authenticated(self):
        """Ensure we have a valid session, re-auth if needed."""
        # Check if we need to re-authenticate
        if not self.ao_token or not self.ao_key:
            if not self.login():
                return False
            if not self.register():
                return False

        # Check if session might be stale (4+ mins since last activity)
        if time.time() - self.last_activity > self.session_timeout:
            # Try IsLoggedIn first
            data = self._request("GET", "IsLoggedIn")
            if not data or data.get("Code") != 0:
                # Session expired, re-authenticate
                logger.info("AsianOdds session expired, re-authenticating...")
                if not self.login():
                    return False
                if not self.register():
                    return False

        return True

    def get_sports(self):
        """Get list of available sports."""
        if not self.ensure_authenticated():
            return []

        data = self._request("GET", "GetSports")
        if not data or data.get("Code") != 0:
            return []

        result = data.get("Result") or {}
        return result.get("Sports", []) if isinstance(result, dict) else []

    def get_leagues(self, sport_id):
        """Get leagues for a sport."""
        if not self.ensure_authenticated():
            return []

        params = {"sportsType": sport_id}
        data = self._request("GET", "GetLeagues", params)
        if not data or data.get("Code") != 0:
            return []

        result = data.get("Result") or {}
        return result.get("Leagues", []) if isinstance(result, dict) else []

    def get_feeds(self, sport_id, market_type_id=1, odds_format="00"):
        """
        Get odds feeds for a sport.

        Args:
            sport_id: Sport type ID (1=Soccer, 3=Basketball, etc.)
            market_type_id: 1=Live, 2=Today, 3=Early
            odds_format: "00"=Decimal, "01"=HK, "02"=Malay, "03"=Indo

        Returns:
            List of matches with odds
        """
        if not self.ensure_authenticated():
            return []

        params = {
            "sportsType": sport_id,
            "marketTypeId": market_type_id,
            "oddsFormat": odds_format
        }

        data = self._request("GET", "GetFeeds", params)
        if not data:
            logger.warning("GetFeeds failed: No response")
            return []

        if data.get("Code") != 0:
            code = data.get("Code")
            result = data.get("Result") or {}
            error_msg = result.get("TextMessage", "Unknown error") if isinstance(result, dict) else "Unknown error"
            logger.warning(f"GetFeeds failed: Code={code}, Message={error_msg}, Result={result}")

            # Auto-recover from auth errors (Code -4 = AOToken invalid)
            if code == -4:
                logger.info("Token invalid (Code -4), re-authenticating...")
                self.ao_token = None
                self.ao_key = None
                if not self.login() or not self.register():
                    return []
                # Retry once
                data = self._request("GET", "GetFeeds", params)
                if not data or data.get("Code") != 0:
                    return []
            else:
                return []

        result = data.get("Result") or {}
        return result.get("Sports", []) if isinstance(result, dict) else []

    def get_matches(self, sport_id, market_type_id=2):
        """
        Get match list for a sport.

        Args:
            sport_id: Sport type ID
            market_type_id: 1=Live, 2=Today, 3=Early
        """
        if not self.ensure_authenticated():
            return []

        params = {
            "sportsType": sport_id,
            "marketTypeId": market_type_id
        }

        data = self._request("GET", "GetMatches", params)
        if not data or data.get("Code") != 0:
            return []

        result = data.get("Result") or {}
        return result.get("Matches", []) if isinstance(result, dict) else []

    def parse_bookie_odds(self, odds_string):
        """
        Parse BookieOdds string format.

        Examples:
            "SIN:2.26,1.61;IBC:2.30,1.58;BEST:SIN 2.26,IBC 1.58"
            "SIN2.260,1.610;BESTSIN 2.260,SIN 1.610" (no colon)

        Returns:
            dict: {"SIN": {"home": 2.26, "away": 1.61}, ...}
        """
        if not odds_string:
            return {}

        result = {}
        parts = odds_string.split(";")

        for part in parts:
            part = part.strip()
            if not part:
                continue

            # Skip BEST section
            if part.upper().startswith("BEST"):
                continue

            # Try to parse - handle multiple formats:
            # "SIN:2.26,1.61" (colon separator)
            # "SBT=2.084,3.655,3.614" (equals separator)
            # "SIN2.26,1.61" (no separator)
            bookie = None
            prices_str = None

            if ":" in part:
                bookie, prices_str = part.split(":", 1)
            elif "=" in part:
                bookie, prices_str = part.split("=", 1)
            else:
                # Extract bookie code (letters at start)
                import re
                match = re.match(r'^([A-Za-z0-9]+)([\d.,]+)$', part)
                if match:
                    bookie = match.group(1)
                    prices_str = match.group(2)

            if not bookie or not prices_str:
                continue

            bookie = bookie.strip().upper()

            try:
                price_parts = prices_str.split(",")
                if len(price_parts) >= 3 and price_parts[2]:
                    # 3-way market (soccer 1X2): format is home,away,draw
                    home_price = float(price_parts[0]) if price_parts[0] else 0
                    away_price = float(price_parts[1]) if price_parts[1] else 0
                    draw_price = float(price_parts[2]) if price_parts[2] else 0

                    if home_price > 1.0 and away_price > 1.0:
                        result[bookie] = {
                            "home": home_price,
                            "away": away_price,
                            "draw": draw_price
                        }
                elif len(price_parts) >= 2:
                    # 2-way market (basketball ML, MMA): format is home,away
                    home_price = float(price_parts[0]) if price_parts[0] else 0
                    away_price = float(price_parts[1]) if price_parts[1] else 0

                    if home_price > 1.0 and away_price > 1.0:
                        result[bookie] = {
                            "home": home_price,
                            "away": away_price
                        }
            except (ValueError, IndexError):
                continue

        return result

    def get_best_price(self, odds_dict, side="home"):
        """
        Get best price from parsed odds dict.

        Args:
            odds_dict: Output from parse_bookie_odds()
            side: "home" or "away"

        Returns:
            tuple: (best_price, bookie_code)
        """
        best_price = 0
        best_bookie = None

        for bookie, prices in odds_dict.items():
            price = prices.get(side, 0)
            if price > best_price:
                best_price = price
                best_bookie = bookie

        return best_price, best_bookie


# Singleton instance
_client = None

def get_client():
    """Get or create singleton AsianOdds client."""
    global _client
    if _client is None:
        try:
            _client = AsianOddsClient()
        except ValueError as e:
            logger.warning(f"AsianOdds client not configured: {e}")
            return None
    return _client
