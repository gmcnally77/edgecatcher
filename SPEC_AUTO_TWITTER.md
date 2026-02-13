# SPEC: Automated Twitter/X Posting

## Goal
Automatically post to Twitter/X when EdgeCatcher detects significant betting edges,
turning the existing alert pipeline into a marketing channel with zero manual effort.

## Why
- EdgeCatcher's biggest growth bottleneck is distribution, not features
- Betting Twitter is highly engaged — edge screenshots and price discrepancy posts get traction
- The alert infrastructure already exists (Telegram) — Twitter is a second output from the same trigger
- Automates the hardest part of marketing: consistent, relevant content

## X API Access

### Option A: X Free Tier (Recommended starting point)
- **Cost:** Free
- **Limits:** 1,500 tweets/month (~50/day) — more than enough
- **Access:** Write-only (post tweets, no reading) — all we need
- **Risk:** X is transitioning to pay-per-use pricing (beta as of Feb 2026).
  Free tier may be discontinued. Existing free users get a $10 voucher.
- **Setup:** Create X developer account at https://developer.x.com,
  create a project/app, generate OAuth 1.0a keys (consumer key, consumer secret,
  access token, access token secret)

### Option B: Pay-Per-Use (Fallback)
- X's new pay-per-credit model — per-tweet costs TBD but expected to be low for posting
- Monitor https://devcommunity.x.com for pricing announcements

### Option C: Scheduling Tool API (Backup)
- If X API becomes too expensive, use Buffer or Typefully free tiers
- Buffer free plan: 3 social channels, 10 scheduled posts per channel
- Adds a dependency but avoids X API costs entirely

## Architecture

### Trigger
Piggyback on the existing Telegram alert flow in `backend/telegram_alerts.py`.
When an alert fires, also post to Twitter if the edge meets the posting threshold.

### Flow
```
Edge detected (fetch_universal.py)
  → Telegram alert (existing)
  → Twitter post (new) — only if edge >= TWITTER_MIN_EDGE_PCT
```

### Tweet Format
```
Edge spotted 🔥

Man City ML
Ladbrokes: 2.10
True market: 1.85
Edge: +13.5%

#ValueBetting #EPL #EdgeCatcher
edgecatcher.com
```

Variations:
- Include sport-specific hashtags (#NBA, #EPL, #MMA, #PremierLeague)
- For steam moves: "Pinnacle just moved from 1.90 → 1.75 on [event]. Soft books haven't caught up."
- Rotate phrasing to avoid looking spammy (template pool)

### Posting Rules
- **Minimum edge threshold:** Only post edges >= 5% (configurable via TWITTER_MIN_EDGE_PCT)
- **Rate limit:** Max 10 tweets/day to avoid looking like spam
- **Deduplication:** Don't post the same event twice within 2 hours
- **Cooldown:** Minimum 15 minutes between tweets
- **Hours:** Only post during peak engagement hours (8am-11pm GMT)
- **No duplicate text:** Vary tweet templates to avoid X flagging as automated spam

### Configuration (environment variables)
```
TWITTER_ENABLED=true
TWITTER_API_KEY=xxx
TWITTER_API_SECRET=xxx
TWITTER_ACCESS_TOKEN=xxx
TWITTER_ACCESS_TOKEN_SECRET=xxx
TWITTER_MIN_EDGE_PCT=5.0
TWITTER_MAX_DAILY_POSTS=10
TWITTER_COOLDOWN_MINS=15
```

## Implementation

### New file: `backend/twitter_poster.py`
- `post_edge_tweet(event, bookie, bookie_price, market_price, edge_pct, sport)` — formats and posts
- `can_post()` — checks daily limit, cooldown, dedup, posting hours
- Uses `tweepy` library for X API v2 OAuth
- Maintains simple state: last post time, daily count, posted event set (in-memory, resets daily)

### Changes to existing files:
- `backend/telegram_alerts.py` — after sending Telegram alert, call `post_edge_tweet()` if enabled
- `backend/config.py` — add Twitter env vars
- `requirements.txt` — add `tweepy`

### Estimated scope
- ~80-100 lines new code in `twitter_poster.py`
- ~10 lines changes to existing files
- No database changes
- No frontend changes

## Tweet Template Pool
To keep posts varied and avoid spam detection:

1. "Edge spotted: {event} — {bookie} offering {bookie_price} vs {market_price} true market. +{edge}% edge. #{sport}"
2. "{bookie} has {team} at {bookie_price}. Market says {market_price}. That's a +{edge}% edge. #{sport} #ValueBetting"
3. "Price gap alert: {event}. {bookie_price} on {bookie} vs {market_price} market lay. #{sport} #EdgeCatcher"
4. "The market says {market_price}. {bookie} says {bookie_price}. Who's right? +{edge}% says the bookie is wrong. #{sport}"
5. "Steam move: {event}. Sharp money moving — soft books haven't adjusted yet. #{sport} #Pinnacle"

## Success Metrics
- Follower growth on the EdgeCatcher X account
- Click-throughs to edgecatcher.com from tweets (track via UTM params)
- Engagement rate (likes, retweets, replies)
- Subscriber conversions attributed to Twitter

## Dependencies
- X developer account with API keys
- `tweepy` Python package
- Existing Telegram alert pipeline (already working)

## Risks
- X may fully deprecate the free tier — monitor and be ready to switch to Option B or C
- Posting too aggressively could get the account flagged — conservative limits by default
- Tweet content showing live edges could attract attention from bookmakers — consider
  posting edges with a slight delay (e.g., 5-10 mins after detection)
