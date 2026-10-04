# RSVP Radio — Plex Smart Playlist Rules

## RSVP Rotation (main party playlist)
```text
Track Rating is greater than 4
Track Plays is greater than 0
```
Crowd-confirmed rotation. In current code, this catches tracks rated 3 stars or 5 stars.

## RSVP New (fresh uploads)
```text
Track Plays is 0
Track Skips is 0
Limit to 25 (random)
```
Never played, never skipped. Trickles new uploads into rotation naturally.

## RSVP Exile (graveyard)
```text
Track Rating is less than 4
Track Rating is greater than 0
```
Hard-failed tracks only. In current code, this catches 1-star exile tracks.

## Important gap between playlists
2-star tracks are **on notice**, not full rotation and not exile.
With the current rating map:
- 5 stars -> clean / redeemed
- 3 stars -> cooling off after 1 strike
- 2 stars -> 2-3 strikes, cooldown / on-notice bucket
- 1 star -> 4+ strikes, exile

If you ever want 2-star tracks inside `RSVP Exile`, the Plex smart playlist rule would need to change. Right now this file documents current behavior only.

---

## Rating Scale
| Stars | Internal | Meaning |
|-------|----------|---------|
| 5 stars | 10 | Clean play / redeemed |
| 3 stars | 6 | 1 strike — 30 day cooldown |
| 2 stars | 4 | 2-3 strikes — on notice / cooldown |
| 1 star | 2 | 4+ strikes — exile |

## Strike Rules
- Hard skip (0-25% played) = 1.0 strike
- Soft skip (25-40% played) = 0.5 strike (two soft skips convert to one full strike)
- Played (40%+) = no strike
- Scrobble = full redemption, resets strikes to 0, writes the track back to 5 stars

Note: redemption is tied to Plex's `media.scrobble` event, not a hardcoded 50% threshold inside this repo.

## Cooldown Ladder
| Strikes | Cooldown |
|---------|----------|
| 1 | 30 days |
| 2 | 90 days |
| 3 | 180 days |
| 4 | 1 year |
| 5 | Permanent exile |


---

## Curated lanes

Plex still decides which songs qualify for each Smart Playlist. RSVP Radio only decides which already-curated playlist to hand to Plexamp when the room rejects the current lane.

Example local config: `config/lanes.json` (copy from `config/lanes.example.json`).

Rules:
- every lane is a real Plex **audio playlist** matched by exact title
- steering never crosses the active `lofi`, `wrap`, `rap`, or `rnb` mode
- two consecutive sub-40% skips trigger a lateral lane change by default
- a clean play resets skip pressure
- RSVP-triggered lane changes do not count as crowd skips
- missing playlists are skipped safely; they do not stop playback
- Plex rating/play/skip Smart Playlist rules remain authoritative underneath the lane layer

The lane file is local runtime configuration because playlist names can differ between Plex libraries. It is intentionally ignored by Git; only the example is committed.
