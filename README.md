# RSVP Radio

RSVP Radio is a Pi-hosted Plex kiosk UI with music-reactive lighting and session-aware mode control.

## What it does

- Polls Plex for the active Plexamp session
- Displays now-playing metadata and proxied album art
- Pushes bass / energy signals to the local lights service
- Detects new listening sessions after idle time and seeds the session mode from track genre
- Waits for seed-genre resolution on a true new session so the first light-mode command is genre-first, or falls back cleanly to the current time block if genre lookup times out or does not match
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

There is currently **no** `/stats` route or bundled stats page in this codebase.

## Scripts

- `npm run lint` -> syntax-check all repo JS files
- `npm test` -> unit + integration tests
- `npm run test:smoke` -> smoke test against an already-running server
- `npm run verify` -> lint + full automated test suite

## Deployment assumptions

- Plex is local: `http://127.0.0.1:32400`
- Lights service is local: `http://127.0.0.1:5005`
- Public assets live on the Pi under `/home/pi/rsvp-radio/public`
- Background files expected on disk:
  - `/assets/bg/rsvp_day_720_optimized.mp4`
  - `/assets/bg/rsvp_night_720.mp4`

## Single source of truth inside this repo

Time blocks come from `shared/timeblocks.js` and are injected into the browser through `GET /runtime-config.js`.
Browser-side fallback values still exist in `public/app/constants.js` as a safety net if runtime config is unavailable.

- `lofi`: 04:00-12:00
- `wrap`: 12:00-17:00
- `rap`: 17:00-23:00
- `rnb`: 23:00-04:00

Pre-fade trigger: 5 minutes before each boundary.
Default boundary transition: 360000 ms.

## Ops notes

- `/health` reports stale poll state plus missing required background assets
- `/api/exit` is local-only by default; token auth can be enabled with `EXIT_API_TOKEN`
- Seed-genre lookup timeout can be tuned with `SESSION_GENRE_FETCH_TIMEOUT_MS`
- The lights service contract is documented in `LIGHTS_SERVICE_CONTRACT.md`
