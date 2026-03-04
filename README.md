# RSVP Radio

RSVP Radio is a Pi-hosted Plex kiosk UI with music-reactive lighting and session-aware mode control.

## What it does

- Polls Plex for the active Plexamp session
- Displays now-playing metadata and proxied album art
- Pushes bass / energy signals to the local lights service
- Detects new listening sessions after idle time and seeds the session mode from track genre
- Pre-fades lighting at time-block boundaries without changing the override model
- Runs locally on a Raspberry Pi kiosk with Pi-local background video assets

## Runtime routes

- `GET /state`
- `GET /health`
- `GET /art?url=...`
- `POST /features`
- `POST /plex`
- `POST /api/exit`
- `GET /runtime-config.js`

## Scripts

- `npm run lint` → syntax-check all repo JS files
- `npm test` → unit + integration tests
- `npm run test:smoke` → smoke test against a running server
- `npm run verify` → lint + full automated test suite

## Deployment assumptions

- Plex is local: `http://127.0.0.1:32400`
- Lights service is local: `http://127.0.0.1:5005`
- Public assets live on the Pi under `/home/pi/rsvp-radio/public`
- Background files expected on disk:
  - `/assets/bg/rsvp_day_720_optimized.mp4`
  - `/assets/bg/rsvp_night_720.mp4`

## Single source of truth inside this repo

Time blocks now come from `shared/timeblocks.js` and are injected into the browser through `GET /runtime-config.js`.

- `lofi`: 04:00–12:00
- `wrap`: 12:00–17:00
- `rap`: 17:00–23:00
- `rnb`: 23:00–04:00

Pre-fade trigger: 5 minutes before each boundary.
Default boundary transition: 360000 ms.

## Ops notes

- `/health` reports stale poll state plus missing background assets
- `/api/exit` is local-only unless an explicit `EXIT_API_TOKEN` is set
- The lights service contract is documented in `LIGHTS_SERVICE_CONTRACT.md`
