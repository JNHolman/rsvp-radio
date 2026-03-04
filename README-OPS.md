# RSVP Radio — Ops Notes

## What is running
- **rsvp-radio** — Express server on :3000 (system service)
- **rsvp-lights** — Hue lights service on :5005 (system service)
- **rsvp-analyzer** — Audio analyzer, posts bass/energy to `/features` (system service)
- **rsvp-plexamp** — Plexamp headless on :32500 (user service, runs under pi session)
- **Plex Media Server** — :32400

## Hard rules
- Plexamp MUST run as a USER service only (system `rsvp-plexamp.service` is masked)
- `rsvp-radio` runs as a SYSTEM service only
- Any new service gets quarantined first if it causes instability

## File locations

### Server
| File | Purpose |
|------|---------|
| `/home/pi/rsvp-radio/server.js` | Express server — Plex polling, art proxy, `/state`, `/health`, `/features`, webhook handling |
| `/home/pi/rsvp-radio/config.js` | Server config — env vars, ports, paths, local service URLs |
| `/home/pi/rsvp-radio/package.json` | Node dependencies and scripts |
| `/home/pi/rsvp-radio/shared/timeblocks.js` | Repo-side time-block source of truth |

### Frontend (served from `/home/pi/rsvp-radio/public/`)
| File | Purpose |
|------|---------|
| `public/index.html` | HTML shell — loads runtime config first, then app scripts |
| `public/styles.css` | All CSS |
| `public/app/constants.js` | Browser defaults and runtime-config fallbacks — video paths, poll timing, thresholds, time blocks |
| `public/app/background.js` | Video crossfade, day/night swap, memory reload |
| `public/app/lights.js` | Hue lights — signal throttle, boundary timer, session state |
| `public/app/player.js` | Plex poll loop, DOM updates, change detection |
| `public/app/main.js` | Boot sequence, menu wiring, exit button |

### Assets
| File | Purpose |
|------|---------|
| `public/assets/bg/rsvp_day_720_optimized.mp4` | Day background video |
| `public/assets/bg/rsvp_night_720.mp4` | Night background video |
| `public/assets/rsvp-icon.png` | Desktop launcher icon |

### System
| File | Purpose |
|------|---------|
| `/etc/systemd/system/rsvp-radio.service` | Systemd unit — sets Plex token, paths, and runtime env vars |
| `/etc/systemd/system/rsvp-lights.service` | Systemd unit — sets Hue bridge IP, user, and light IDs |
| `~/Desktop/RSVP-Radio.desktop` | Desktop launcher icon |

## Environment variables (set in systemd unit)
```bash
PLEX_TOKEN=your-token
PUBLIC_DIR=/home/pi/rsvp-radio/public
PLEX_BASE=http://127.0.0.1:32400
LIGHTS_URL=http://127.0.0.1:5005
PORT=3000
POLL_MS=2000
POLL_TIMEOUT_MS=2500
HEALTH_STALE_MS=15000
SESSION_GENRE_FETCH_TIMEOUT_MS=4000
EXIT_API_TOKEN=
```

## Time blocks
Inside this repo, the server and browser are fed from the shared time-block module.
The external lights service must still mirror the same schedule.

| Block | Hours | Mirror required outside this repo |
|-------|-------|-----------------------------------|
| lofi  | 04:00-12:00 | yes |
| wrap  | 12:00-17:00 | yes |
| rap   | 17:00-23:00 | yes |
| rnb   | 23:00-04:00 | yes |

## Runtime behavior notes
- There is currently **no** `/stats` route or bundled stats page in this repo
- On a true new session, the server waits for seed-genre resolution before publishing the first play-state mode
- If Plex genre lookup times out or returns no match, mode falls back to the current time block
- `/health` returns unhealthy when required background assets are missing
- `/api/exit` is local-only by default; token auth is optional and only needed if you want to call it remotely

## Quick health checks
```bash
ss -ltnp | egrep ':3000|:32400|:32500|:5005'
curl -sS http://127.0.0.1:3000/health
curl -sS http://127.0.0.1:3000/state
sudo systemctl status rsvp-radio --no-pager -l
sudo systemctl status rsvp-lights --no-pager -l
systemctl --user status rsvp-plexamp --no-pager -l
```

## Recovery
```bash
# Restart radio server
sudo systemctl restart rsvp-radio

# Restart lights
sudo systemctl restart rsvp-lights

# Restart plexamp (user service)
systemctl --user restart rsvp-plexamp

# Check server logs
sudo journalctl -u rsvp-radio -n 50 --no-pager

# Check lights logs
sudo journalctl -u rsvp-lights -n 50 --no-pager
```

## Backup and rollback scripts
These scripts belong in Git because they are part of the operating model.

- `rsvp-radio-backup.sh` -> run from your Mac to pull a backup from the Pi
- `rsvp-snapshot.sh` -> run on the Pi to create an app + systemd snapshot
- `rsvp-rollback.sh` -> run on the Pi to restore a snapshot

Examples:
```bash
# From your Mac, from the repo root or by full path
bash ./rsvp-radio-backup.sh
bash ./rsvp-radio-backup.sh --videos

# On the Pi
bash /home/pi/rsvp-radio/rsvp-snapshot.sh
bash /home/pi/rsvp-radio/rsvp-rollback.sh
```
