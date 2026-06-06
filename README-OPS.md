# RSVP Radio — Operations

Field guide for running, deploying, and fixing the system. Written for 2am.

## Services

| Unit | What | Restart |
|------|------|---------|
| `rsvp-radio` (system) | Node server :3000 | `sudo systemctl restart rsvp-radio` |
| `plexamp` (user) | Plexamp headless :32500 | `systemctl --user restart plexamp` |
| Plex Media Server | :32400 | `sudo systemctl restart plexmediaserver` |
| lights service | :5005 | (separate repo) |

The Plexamp user unit MUST point at Node 20 via nvm (`/home/pi/.nvm/versions/node/v20.20.2/bin/node`), not system node (v22) — wrong node = silent crash-loop. `loginctl enable-linger pi` must be set or user services don't start on headless boots. See SYSTEM-NOTES.md for the full out-of-repo checklist (pipewire-alsa is the other critical one).

The kiosk launches by desktop icon double-click only — never on boot, by design.

## Deploy ritual (non-negotiable)

Changes ship as Python patch scripts with assert-or-abort verbatim replaces — a patch that doesn't match the file exactly writes nothing. Never paste multi-line code over SSH; scp the patch in.

```
python3 patch-<name>.py        # makes dated .baks itself, aborts on drift
node --check server.js
npm run verify                 # exit condition: every test green
sudo systemctl restart rsvp-radio
```

`npm run verify` is the gate — the FULL suite, not a subset. (We once shipped on a 33-test subset while 3 tests were red in the files nobody ran. Never again.)

Config rule: `config.js` is an explicit whitelist. Any new env key goes into `config.js` AND `.env` in the same patch, or the server silently reads `undefined` and features disarm without errors.

Frontend-only changes (public/) need no restart — static files are served `no-store`. Relaunch the kiosk via its desktop icon and check `journalctl -u rsvp-radio -f` for `[browser]` lines (the kiosk beacons its events to `/api/log`).

## Backups and releases (different things)

- **BACKUP zip** — disaster recovery. Includes `data/` (skip/strike history is valuable). Excludes node_modules, .git, .env, *.bak*, *.py, *.tar*.
- **RELEASE zip** — what deploy/auditors touch. Same exclusions PLUS `data/*` — a release must never be able to overwrite live history.
- `.env` is in NEITHER. Back it up separately and privately; without it the server boots with a loud token warning and nothing works.

## Routes

| Route | Notes |
|-------|-------|
| `GET /state` | Full nested state — the kiosk and admin poll this |
| `GET /health` | Liveness + asset check |
| `GET /admin` | Admin console |
| `GET /admin/skip-data`, `/admin/top-songs` | Intelligence data |
| `POST /mode/:mode`, `/mode/clear` | Manual music override (expires at next boundary) / clear |
| `POST /admin/force-timeblock-sync` | Snap music to the schedule now |
| `GET /admin/video-playlists` | Video playlists + active state |
| `POST /admin/video/play/:key` | Start a video set — a manual pick, holds until next boundary |
| `POST /admin/video/{stop,next,prev,pause,resume}` | Transport |
| `POST /video-failed` | Kiosk reports a clip failure; server drops the clip and advances |
| `GET /media/:ratingKey` | Local file streaming with range support, locked inside MEDIA_DIR |
| `GET /art` | Art proxy (never expose the Plex token to the browser) |
| `POST /features` | Audio analyzer bass/energy |
| `POST /api/log` | Kiosk event beacons (the `ended` beacon drives clip advance — load-bearing) |
| `POST /api/exit` | Kills the kiosk (token-gated) |
| `POST /plex` | Plex webhooks |
| `POST /admin/lights/*` | Forwards to the lights service |

All admin routes are LAN-open by design except `/api/exit`.

## Troubleshooting — symptoms seen in the field

| Symptom | Cause | Fix |
|---------|-------|-----|
| Videos play silent while music works (or vice versa) | `pipewire-alsa` missing — ALSA `default` maps to raw hardware, first app locks the other out | `sudo apt install pipewire-alsa`, restart plexamp. Verify: `aplay -L` shows "currently PipeWire Media Server" |
| Music dead after reboot, plexamp unit shows `status=1/FAILURE` loops | Unit pointing at system node v22 | Point ExecStart at nvm node v20, `systemctl --user daemon-reload && restart` |
| Video session "bounces" — clip starts, music comes back, repeats | Dead media paths (Plex playlist entries pointing at renamed folders) | Journal shows `MISSING ON DISK` drops at session start since v18. Fix in Plex: clean duplicate folders FIRST, then Scan Library, Empty Trash, re-add clips |
| Admin says TIMEBLOCK while a manual override is active during video | Fixed in v18 — /state now reports real manual state. If seen again, that's a regression | |
| Manual video pick gets yanked back at a clip gap | Pre-v17g behavior. Manual picks now hold until the next boundary (gold MANUAL · UNTIL line on admin) | |
| Phantom "playing" video steals the music card | Stale-video guard (v19) demotes it after STALE_VIDEO_POLLS frozen polls. Watch for `[video] stale video` log lines | Tune STALE_VIDEO_POLLS if false demotions appear |
| A single test fails in the full run, passes alone | Port-collision flake — the harness uses random ports in a 300 slot range, suite runs parallel | Rerun. (Hardening idea on the list: sequential or OS-assigned ports) |
| Accented filenames 404 from /media | Was the Victoria Monét bug — numeric XML entities in paths. Fixed in the parser; tests pin it | |
| Volume gap: clips much louder than mp3s | Plexamp loudness-normalizes, raw files don't | Trim Chromium's PipeWire stream (`wpctl` while a clip plays) or ffmpeg-loudnorm the clip library |

## Reading the journal

```
journalctl -u rsvp-radio -f
```

Prefixes that matter: `[video-mode]` (session lifecycle, boundary switches, MISSING ON DISK, advances — "no play recorded" means admin-skip or failure, not a clean play), `[steering]` (skip streaks, lane moves, model picks), `[skip-tracker]` (strikes/redemptions), `[browser]` (kiosk beacons incl. clip error codes), `[mode]` (manual overrides), `[playlist]` (commanded switches).

## Standing checks before any event

1. `npm run verify` green.
2. Reboot test: power-cycle, confirm server + plexamp up, music plays.
3. Ears test: mp3 playing → start video → CLIP HAS SOUND → stop → music resumes. (The bug class that hides from every log.)
4. Start each video playlist once; zero `MISSING ON DISK` lines.
5. 2+ hour video burn-in if the library changed (reshuffle-after-full-pass needs >2 clips and a real session).
