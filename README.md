# RSVP Radio

A Raspberry Pi kiosk that displays Plex now-playing info with music-reactive Hue lighting. Built for live events — runs headless, launches from a desktop icon, and stays out of the way.

---

## What It Does

- Polls Plex for the current track every 2 seconds
- Displays album art, title, artist, and album on a fullscreen kiosk UI
- Background video switches between day and night versions automatically
- Posts bass/energy signals to a Philips Hue light for ambient pulse effects
- Lights fade between time-block modes throughout the night (lofi → wrap → rap → rnb)

---

## System Architecture

```
Plexamp (headless)     →    Plex Media Server (:32400)
                                      ↓
                             rsvp-radio server (:3000)
                             polls /status/sessions
                                      ↓
                          Chromium kiosk (localhost:3000)
                          displays now-playing UI

rsvp-audio-analyzer    →    POST /features (bass, energy)
                                      ↓
                             rsvp-radio server
                                      ↓
                          rsvp-lights service (:5005)
                          Hue bridge → bulb pulse
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| rsvp-radio | 3000 | Express server — Plex polling, art proxy, state API |
| rsvp-lights | 5005 | Python/FastAPI — Hue bridge control, signal processing |
| rsvp-analyzer | — | Python — audio analysis, posts bass/energy to /features |
| rsvp-plexamp | 32500 | Plexamp headless (user service) |

---

## File Structure

```
rsvp-radio/
├── server.js                  # Express server
├── config.js                  # Server config — env vars, ports, paths
├── package.json
│
└── public/                    # Served by Express static
    ├── index.html             # HTML shell
    ├── styles.css             # All CSS
    ├── app/
    │   ├── constants.js       # Frontend constants — video paths, timing, thresholds
    │   ├── background.js      # Video crossfade, day/night swap, memory reload
    │   ├── lights.js          # Hue signal, boundary timer, session state
    │   ├── player.js          # Plex poll loop, DOM updates, change detection
    │   └── main.js            # Boot sequence, menu wiring, exit button
    └── assets/
        ├── bg/
        │   ├── rsvp_day_720_optimized.mp4
        │   └── rsvp_night_720.mp4
        └── rsvp-icon.png      # Desktop launcher icon
```

---

## Server API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/state` | Current Plex session + audio features |
| GET | `/health` | Liveness check |
| GET | `/art?url=` | Album art proxy (locked to Plex host only) |
| POST | `/features` | Audio analyzer posts bass/energy here |
| POST | `/api/exit` | Kills Chromium (kiosk only) |

---

## Time Blocks

Lights and UI mode follow a schedule. Keep these in sync across:
- `server.js` → `blockModeForNow()`
- `public/app/constants.js` → `blockModeForNow()`
- `rsvp-services/rsvp_lights_service.py` → `timeblock_mode()`

| Mode | Hours |
|------|-------|
| lofi | 04:00 – 12:00 |
| wrap | 12:00 – 17:00 |
| rap  | 17:00 – 23:00 |
| rnb  | 23:00 – 04:00 |

---

## Environment Variables

Set in `/etc/systemd/system/rsvp-radio.service` under `[Service]`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PLEX_TOKEN` | — | Required. Plex auth token |
| `PUBLIC_DIR` | `/home/pi/rsvp-radio/public` | Static files path |
| `PLEX_BASE` | `http://127.0.0.1:32400` | Plex server URL |
| `PORT` | `3000` | Express server port |
| `POLL_MS` | `2000` | Plex poll interval |

---

## Deployment

### Requirements
- Raspberry Pi running Debian/Pi OS Bookworm
- Node.js 18+
- Python 3.10+
- Plexamp headless
- Plex Media Server
- Philips Hue bridge on local network

### Install

```bash
cd ~/rsvp-radio
npm install
```

### Systemd unit

```ini
[Unit]
Description=RSVP Radio Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/rsvp-radio
ExecStart=/usr/bin/node /home/pi/rsvp-radio/server.js
Restart=always
RestartSec=2
Environment=PLEX_TOKEN=your-token-here
Environment=PUBLIC_DIR=/home/pi/rsvp-radio/public

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable rsvp-radio
sudo systemctl start rsvp-radio
```

### Desktop launcher

The kiosk launches from a `.desktop` file — double-click to open fullscreen, use the × button in the UI to close.

```ini
[Desktop Entry]
Type=Application
Name=RSVP Radio
Icon=/home/pi/rsvp-radio/public/assets/rsvp-icon.png
Terminal=false
Exec=chromium --kiosk --force-device-scale-factor=1.6 --incognito --noerrdialogs --disable-infobars http://localhost:3000/
Categories=AudioVideo;
```

---

## Health Checks

```bash
curl http://localhost:3000/health
curl http://localhost:3000/state
sudo systemctl status rsvp-radio --no-pager
sudo systemctl status rsvp-lights --no-pager
```

---

## Backup (from Mac)

```bash
bash ~/Desktop/rsvp-radio-backup.sh           # excludes videos
bash ~/Desktop/rsvp-radio-backup.sh --videos  # includes videos
```

---

*Built for RSVP Society events. Pi runs headless. Lights breathe with the music. Nobody notices.*
