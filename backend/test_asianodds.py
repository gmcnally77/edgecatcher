#!/usr/bin/env python3
"""
AsianOdds API Connection Test
Usage: ASIANODDS_PASSWORD=yourpassword python3 test_asianodds.py
"""
import os
import hashlib
import requests
import getpass

BASE_URL = "https://webapi.asianodds88.com/AsianOddsService"
USERNAME = "Vexel77"

def md5_hash(text):
    return hashlib.md5(text.encode()).hexdigest()

def test_connection():
    # Get password from env or prompt
    password = os.getenv("ASIANODDS_PASSWORD")
    if not password:
        password = getpass.getpass("Enter AsianOdds password: ")

    password_hash = md5_hash(password)
    print(f"Username: {USERNAME}")
    print(f"Password hash: {password_hash[:8]}...")

    # Step 1: Login (GET with query params)
    print("\n[1/3] Calling Login...")
    login_url = f"{BASE_URL}/Login"

    params = {
        "username": USERNAME,
        "password": password_hash
    }

    headers = {
        "Accept": "application/json"
    }

    try:
        resp = requests.get(login_url, params=params, headers=headers, timeout=30)
        print(f"Status: {resp.status_code}")
        print(f"Raw response: {resp.text[:500]}")

        # Handle BOM in response
        text = resp.text.lstrip('\ufeff')
        login_data = __import__('json').loads(text)
        print(f"Response: {login_data}")

        if login_data.get("Code") != 0:
            print(f"❌ Login failed: {login_data.get('Result', {}).get('TextMessage')}")
            return

        result = login_data.get("Result", {})
        temp_token = result.get("Token")
        ao_key = result.get("Key")
        new_url = result.get("Url")

        if not temp_token:
            print("❌ No token in response")
            return

        print(f"✅ Got temp token: {temp_token[:20]}...")
        print(f"✅ Got AOKey: {ao_key[:20]}..." if ao_key else "No AOKey")
        print(f"✅ New URL: {new_url}" if new_url else "No URL")

    except Exception as e:
        print(f"❌ Login error: {e}")
        return

    # Step 2: Register (within 60 seconds)
    # Use the new URL if provided
    register_base = new_url if new_url else BASE_URL
    print(f"\n[2/3] Calling Register at {register_base}...")
    register_url = f"{register_base}/Register"

    headers = {
        "Accept": "application/json",
        "AOToken": temp_token,
        "AOKey": ao_key
    }

    params = {
        "username": USERNAME
    }

    try:
        resp = requests.get(register_url, params=params, headers=headers, timeout=30)
        print(f"Status: {resp.status_code}")
        print(f"Raw response: {resp.text[:500]}")

        text = resp.text.lstrip('\ufeff')
        register_data = __import__('json').loads(text)
        print(f"Response: {register_data}")

        if register_data.get("Code") != 0:
            print(f"❌ Register failed: {register_data.get('Result', {}).get('TextMessage')}")
            return

        print(f"✅ Registration successful!")

    except Exception as e:
        print(f"❌ Register error: {e}")
        return

    # Step 3: Test with GetAccountSummary
    print(f"\n[3/3] Testing GetAccountSummary...")
    summary_url = f"{register_base}/GetAccountSummary"

    headers = {
        "Accept": "application/json",
        "AOToken": temp_token,
        "AOKey": ao_key
    }

    try:
        resp = requests.get(summary_url, headers=headers, timeout=30)
        print(f"Status: {resp.status_code}")

        text = resp.text.lstrip('\ufeff')
        summary_data = __import__('json').loads(text)
        print(f"Response: {summary_data}")

        if summary_data.get("Code") == 0:
            print("\n✅ SUCCESS! API connection working.")
            result = summary_data.get("Result", {})
            print(f"   Balance: {result}")
        else:
            print(f"❌ API call failed: {summary_data.get('Result', {}).get('TextMessage')}")

    except Exception as e:
        print(f"❌ API error: {e}")

if __name__ == "__main__":
    test_connection()
