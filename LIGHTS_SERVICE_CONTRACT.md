# Lights service contract

Base URL: defaults to `http://127.0.0.1:5005` and is injected into the browser from `LIGHTS_URL`.

## Endpoints used by RSVP Radio

- `POST /mode/:mode`
  - Allowed modes: `wrap`, `lofi`, `rap`, `rnb`
- `POST /transition`
  - JSON body: `{ "from": "wrap", "to": "rap", "durMs": 360000 }`
- `POST /signal`
  - JSON body: `{ "bass": 0.0-1.0, "energy": 0.0-1.0 }`
- `POST /on`
- `POST /off`

## Schedule mirror required in lights service

The lights service should mirror these time blocks exactly:

- `lofi`: 04:00–12:00
- `wrap`: 12:00–17:00
- `rap`: 17:00–23:00
- `rnb`: 23:00–04:00

Pre-fade trigger: 5 minutes before each boundary.
Default boundary transition: 360000 ms.
