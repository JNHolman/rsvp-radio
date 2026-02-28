# RSVP Radio — Plex Smart Playlist Rules

## RSVP Rotation (main party playlist)
```
Track Rating is greater than 4
Track Plays is greater than 0
```
Crowd-confirmed bangers. Heard at least once and rated 3 stars or higher.

## RSVP New (fresh uploads)
```
Track Plays is 0
Track Skips is 0
Limit to 25 (random)
```
Never played, never skipped. Trickles new uploads into rotation naturally.

## RSVP Exile (graveyard)
```
Track Rating is less than 4
Track Rating is greater than 0
```
Rated but penalized. 4+ strikes. Not unrated — just confirmed bad.

---

## Rating Scale
| Stars | Internal | Meaning |
|-------|----------|---------|
| 5 ⭐⭐⭐⭐⭐ | 10 | Clean play / redeemed |
| 3 ⭐⭐⭐ | 6 | 1 strike — 30 day cooldown |
| 2 ⭐⭐ | 4 | 2-3 strikes — 90-180 day cooldown |
| 1 ⭐ | 2 | 4+ strikes — exile (365 days / permanent) |

## Strike Rules
- Hard skip (0-25% played)  = 1.0 strike
- Soft skip (25-40% played) = 0.5 strike (needs 2 to count as 1 full strike)
- Played (40%+)             = no strike
- Scrobble (50%+)           = full redemption, resets all strikes to 0, back to 5 stars

## Cooldown Ladder
| Strikes | Cooldown |
|---------|----------|
| 1       | 30 days  |
| 2       | 90 days  |
| 3       | 180 days |
| 4       | 1 year   |
| 5       | Permanent exile |
