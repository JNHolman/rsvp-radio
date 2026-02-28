# RSVP Radio

A Raspberry Pi kiosk that displays Plex now-playing info with music-reactive Hue lighting. Built for live events — runs headless, launches from a desktop icon, and stays out of the way.

---

## What It Does

- Polls Plex for the current track every 2 seconds
- Displays album art, title, artist, and album on a fullscreen kiosk UI
- Background video switches between day and night versions automatically
- Posts bass/energy signals to a Philips Hue light for ambient pulse effects
- Lights fade between time-block modes throughout the night (lofi → wrap → rap → rnb)
- Tracks every skip and builds a reputation score for each song
- Automatically syncs reputation to Plex star ratings
- Detects new sessions from seed song genres and sets the lights mode accordingly
- Stats dashboard at `/stats` shows session info, skip history, and exile list

---

## Intelligence

RSVP Radio learns the crowd over time. Every skip is recorded, every play is confirmed. Songs that get skipped repeatedly cool down or get exiled. Songs that play through get redeemed.

### Skip Thresholds

| Played | Type | Strike |
|--------|------|--------|
| 0–25% | Hard skip | 1.0 strike |
| 25–40% | Soft skip | 0.5 strike |
| 40%+ | Played | no strike |
| 50%+ (scrobble) | Full play | resets all strikes |

### Cooldown Ladder

| Strikes | Cooldown |
|---------|----------|
| 1 | 30 days |
| 2 | 90 days |
| 3 | 180 days |
| 4 | 1 year |
| 5 | Permanent exile |

### Plex Rating Sync

Strikes map to Plex star ratings so smart playlists stay in sync automatically.

| Stars | Meaning |
|-------|---------|
| ⭐⭐⭐⭐⭐ | Clean / redeemed |
| ⭐⭐⭐ | 1 strike — 30 day cooldown |
| ⭐⭐ | 2–3 strikes — 90–180 day cooldown |
| ⭐ | 4+ strikes — exile |

### Redemption

One clean play (50%+ scrobble) after a cooldown expires resets all strikes to zero and restores 5 stars. The song gets a second chance.

### Session Detection

After 45 minutes of idle time, the next song triggers a new session. The seed song's genres are fetched from Plex and used to set the lights mode automatically. If the song has no genre tags, the system falls back to the current time block.

| Genre | Mode |
|-------|------|
| R&B, Soul | rnb |
| Hip Hop, Rap, Trap | rap |
| Lo-Fi, Lounge, Jazz | lofi |
| Pop, Dance, Party | wrap |

---

## Smart Playlists

Three Plex smart playlists work with the intelligence layer.

**RSVP Rotation** — crowd-confirmed bangers
```
Track Rating > 4
Track Plays > 0
```

**RSVP New** — fresh uploads, limit 25 random
```
Track Plays = 0
Track Skips = 0
```

**RSVP Exile** — penalized songs
```
Track Rating < 4
Track Rating > 0
```

---

## System Architecture

```
Plexamp (headless)   →   Plex Media Server (:32400)
                               ↓
                     rsvp-radio server (:3000)
                     polls /status/sessions
                               ↓
                     Chromium kiosk (localhost:3000)
                     displays now-playing UI

rsvp-audio-analyzer  →   POST /features (bass, energy)
                               ↓
                     rsvp-radio server
                               ↓
                     rsvp-lights service (:5005)
                     Hue bridge → bulb pulse
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| rsvp-radio | 3000 | Express server — Plex polling, art proxy, state API, stats dashboard |
| rsvp-lights | 5005 | Python/FastAPI — Hue bridge control, signal processing |
| rsvp-audio-analyzer | — | Audio analysis, posts bass/energy to rsvp-radio |

---

## File Structure

```
rsvp-radio/
├── server.js               # Express server
├── config.js               # Server config
├── package.json
│
├── intelligence/
│   ├── skip-tracker.js     # Skip detection + reputation + cooldown
│   ├── plex-sync.js        # Syncs strike count to Plex star rating
│   └── session.js          # Session detection + seed song genre mapping
│
├── data/
│   ├── skip-data.json      # Persisted skip history (auto-generated)
│   └── session.json        # Current session state (auto-generated)
│
├── public/
│   ├── index.html          # HTML shell
│   ├── styles.css          # All CSS
│   ├── stats.html          # Admin stats dashboard
│   └── app/
│       ├── constants.js    # Frontend constants + time block config
│       ├── background.js   # Video crossfade logic
│       ├── lights.js       # Hue signal visualizer
│       ├── player.js       # Plex polling + now-playing state
│       └── main.js         # Boot sequence
│   └── assets/
│       ├── bg/
│       │   ├── rsvp_day_720_optimized.mp4
│       │   └── rsvp_night_720.mp4
│       └── rsvp-icon.png   # Desktop launcher icon
```

---

## Server API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/state` | Current Plex session + audio features |
| GET | `/health` | Liveness check |
| GET | `/art?url=` | Album art proxy (locked to Plex host only) |
| POST | `/features` | Audio analyzer posts bass/energy here |
| POST | `/api/exit` | Stops Plexamp + kills Chromium (kiosk only) |
| GET | `/stats` | Admin stats dashboard |
| GET | `/stats/data` | Raw skip-data.json as JSON |
| GET | `/stats/session` | Current session.json as JSON |

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
| rap | 17:00 – 23:00 |
| rnb | 23:00 – 04:00 |

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

### Systemd Unit

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

### Desktop Launcher

The kiosk launches from a `.desktop` file — double-click to open fullscreen, use the × button in the UI to close.

```ini
[Desktop Entry]
Type=Application
Name=RSVP Radio
Icon=/home/pi/rsvp-radio/public/assets/rsvp-icon.png
Terminal=false
Exec=chromium --kiosk --force-device-scale-factor=1 http://localhost:3000
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
bash ~/Desktop/rsvp-radio-backup.sh
bash ~/Desktop/rsvp-radio-backup.sh --verify
```

---

*Built for RSVP Society events. Pi runs headless. Lights breathe with the music. Nobody notices.*
