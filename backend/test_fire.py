import os
from dotenv import load_dotenv

# 1. CRITICAL: Load keys BEFORE importing your app code
load_dotenv()

# 2. Now import the alert engine (it will now see the keys)
import telegram_alerts

# 3. Verify Keys Exist
token = os.getenv("TELEGRAM_BOT_TOKEN")
chat_id = os.getenv("TELEGRAM_CHAT_ID")

print("--- DIAGNOSTICS ---")
if token:
    print(f"✅ Token Found: {token[:6]}......")
else:
    print("❌ Token Missing! Check .env")

if chat_id:
    print(f"✅ Chat ID Found: {chat_id}")
else:
    print("❌ Chat ID Missing! Check .env")
print("-------------------")

# 4. Construct Payload
msg = (
    "<b>🚀 MANUAL TEST FIRE</b>\n\n"
    "If you are reading this, your <b>Telegram Integration</b> is 100% working.\n\n"
    "✅ Credentials Valid\n"
    "✅ Network Connected\n"
    "✅ Bot Online"
)

# 5. Fire!
print("\nAttempting to send message...")
try:
    success = telegram_alerts.send_telegram_message(msg)
    
    if success:
        print("✅ SUCCESS: Check your phone! The message was sent.")
    else:
        print("❌ FAILED: The function returned False.")
        print("👉 TIP: Make sure you have messaged /start to your bot on Telegram!")
except Exception as e:
    print(f"❌ CRASHED: {e}")