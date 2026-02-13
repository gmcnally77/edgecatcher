---
globs: backend/**/*.py
---

# Backend Rules

## AsianOdds
- Rate limits are enforced server-side. Never lower: Live=5s, Today=10s, Early=20s.
- AO sessions persist across restarts — first API call may return incremental delta, not full snapshot. Always MERGE cache, never replace.
- Delta entries with empty BookieOdds must NOT overwrite cached entries that have BookieOdds. Use field-level merge.
- Bucket ordering: build all_matches Early→Today→Live so Live wins last-write.
- Any negative AO error code means broken session — trigger re-auth.

## Team Name Matching
- AO uses full names, Betfair abbreviates. Matching requires alias maps + suffix/prefix stripping.
- ALIAS_MAP must be fully transitive — check_match only looks 1 level deep.
- Cache keys must include league name to prevent cross-league collisions.

## Database
- All price writes go through Supabase upsert with on_conflict='id'. Last writer wins — correct behaviour.
- The AO thread and main thread both write to market_feed concurrently. No application-level locking needed.

## Testing
- Run `python backend/test_steamer_alerts.py` after modifying alert logic.
- Test cache/matching changes locally before pushing to production.
