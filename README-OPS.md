# RSVP Radio — Ops Notes

## What is running
- **rsvp-radio** — Express server on :3000 (system service)
- **rsvp-lights** — Hue lights service on :5005 (system service)
- **rsvp-analyzer** — Audio analyzer, posts bass/energy to /features (system service)
- **rsvp-plexamp** — Plexamp headless on :32500 (user service, runs under pi session)
- **Plex Media Server** — :32400

## Hard rules
- Plexamp MUST run as a USER service only (system rsvp-plexamp.service is masked)
- rsvp-radio runs as a SYSTEM service only
- Any new service gets quarantined first if it causes instability

## File locations

### Server
| File | Purpose |
|------|---------|
| `/home/pi/rsvp-radio/server.js` | Express server — Plex polling, art proxy, /state, /health, /features |
| `/home/pi/rsvp-radio/config.js` | Server config — env vars, ports, paths |
| `/home/pi/rsvp-radio/package.json` | Node dependencies (express, fast-xml-parser) |

### Frontend (served from /home/pi/rsvp-radio/public/)
| File | Purpose |
|------|---------|
| `public/index.html` | HTML shell — loads scripts in order |
| `public/styles.css` | All CSS — BG_CROSSFADE_MS must match constants.js |
| `public/app/constants.js` | Frontend constants — video paths, poll timing, thresholds |
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
| `/etc/systemd/system/rsvp-radio.service` | Systemd unit — sets PLEX_TOKEN and PUBLIC_DIR env vars |
| `/etc/systemd/system/rsvp-lights.service` | Systemd unit — sets Hue bridge IP, user, light ID |
| `~/Desktop/RSVP-Radio.desktop` | Desktop launcher icon |

## Environment variables (set in systemd unit)
```
PLEX_TOKEN=your-token        # required
PUBLIC_DIR=/home/pi/rsvp-radio/public
PLEX_BASE=http://127.0.0.1:32400
LIGHTS_URL=http://127.0.0.1:5005
PORT=3000
POLL_MS=2000
```

## Time blocks
Inside this repo, the server and browser are fed from the shared time-block module.
The external lights service must still mirror the same schedule.

| Block | Hours | Mirror required outside this repo |
|-------|-------|-----------------------------------|
| lofi  | 04:00–12:00 | yes |
| wrap  | 12:00–17:00 | yes |
| rap   | 17:00–23:00 | yes |
| rnb   | 23:00–04:00 | yes |

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

## Backup (run from Mac)
```bash
bash ~/Desktop/rsvp-radio-backup.sh           # excludes videos
bash ~/Desktop/rsvp-radio-backup.sh --videos  # includes videos
```
