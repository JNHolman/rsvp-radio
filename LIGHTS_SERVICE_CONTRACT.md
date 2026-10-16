# Philips Hue lights service contract

RSVP Radio / TV does not talk to bulbs directly. It talks to a local lighting adapter at `LIGHTS_URL` (default `http://127.0.0.1:5005`). For this installation, that adapter controls **Philips Hue**.

The adapter is the hardware boundary: RSVP owns programming/scheduling; the Hue adapter owns bridge authentication, Hue group/zone/scene IDs, and translation to the Hue local API.

## Required endpoints

- `POST /mode/:mode`
  - Allowed modes: `lounge`, `lofi`, `rap`, `rnb`
  - Apply the Hue scene mapped to that programming mode.
- `POST /transition`
  - JSON: `{ "from": "lofi", "to": "lounge", "durMs": 1200000 }`
  - Fade the **current physical Hue state** toward the destination scene over `durMs`.
  - `from` is context/fallback only; do not snap back to a stored source scene before fading.
  - A late/retry command may contain only the remaining duration. Accept it and continue smoothly from the bulbs' current state.
- `POST /ambient`
  - JSON: `{ "xy": [0.4, 0.3], "bri": 110, "durMs": 35000 }`
  - Apply color and brightness in a single group action with a soft fade. RSVP computes
    the target from the same solar phase as TV and caps each change. The first
    return from a manual scene fades over 180 seconds.
  - The adapter caps music-reactive brightness to eight Hue steps in ambient mode.
- `POST /signal`
  - JSON: `{ "bass": 0.0-1.0, "energy": 0.0-1.0 }`
  - Reactive-light input; adjusts brightness only, never color.
  - Rate-limit bridge writes and suppress them during manually requested long
    scene transitions so the scheduled fade is uninterrupted.
- `POST /on`
- `POST /off`

Successful commands return any 2xx response. RSVP treats non-2xx or connection failure as unsuccessful and retries automatic reconciliation.

## Automatic ambience

The music schedule remains LOFI 04:00–10:00, LOUNGE 10:00–17:00,
RAP 17:00–23:00, and R&B 23:00–04:00, with the same 20-minute weighted media
handoffs. **That schedule no longer controls automatic Hue colors.**

The approved day artwork and warm Hue palette run from sunrise to civil dusk.
The night artwork and violet-magenta palette run from civil dusk to sunrise.
The server calculates the next solar event at startup and schedules Hue's phase
change for that exact boundary, with only hourly safety reconciliation for
clock changes or sleep. It does not recalculate sunrise/dusk on every light
write. A slow, irregular, deterministic palette drift avoids obvious color
cycling. Hue still receives incremental color updates every 30 seconds with
35-second crossfades; their color and brightness deltas remain capped.

Explicit manual Hue genre scene selection still works and takes priority until
the next scheduled music handoff. Manual power off and automation stop also win.

## Hue implementation requirements

Use the local Philips Hue Bridge API over HTTPS and keep bridge credentials out of this repository. The adapter should keep the Hue application key and scene/group identifiers in environment configuration or another local secret store.

Recommended mapping is one Hue scene per RSVP mode (`lofi`, `lounge`, `rap`, `rnb`) within one Hue group/zone. Scene recall/transition should target that same Hue group/zone so all lights move together.

## RSVP Lighting V3 club scenes

The slide-out **LIGHTING** menu controls the Hue globe separately from the VIBE
music menu. It offers six manual scenes: **Yin Yang Café** (The Listening Room),
**40/40 Club**, **Republic Gardens**, **The Tunnel**, **Club Crucial** and
**Boom Boom Room**, plus **AUTO**, **HUE ON** and **HUE OFF**.

- `POST /admin/lights/scene/:id` chooses a named club. These scenes use 30-second
  incremental writes to `POST /ambient`; each scene includes separate day/night
  color paths and pacing. The selector is persisted until explicit Auto.
- `POST /admin/lights/auto` clears the manual scene and resumes the currently
  scheduled solar artwork colors. The previous manual scene is not restored by a
  media/genre handoff.
- `POST /admin/lights/on` is the **only RSVP command that may power on Hue**.
  Selecting a scene or Auto never turns on a bulb that is physically off.
- `POST /admin/lights/off` explicitly turns off Hue. Hue's native phone app
  power-off also takes priority; the adapter's read-only `GET /power` exposes
  physical state and out-of-band app scene changes. The `POST /release` adapter
  action transfers control back to RSVP only after explicit user selection.
- Existing `POST /admin/lights/mode/:mode` remains available to old clients,
  but now also persists until Auto and affects Hue only, not music.
- Radio/TV programming, video/track selection and the four music time blocks
  cannot override a selected club scene. Hue overrides survive Pi restarts.

Govee H7021 balcony strings are **not controlled by this implementation**.
Their controller and native app remain separate until Govee control capabilities
are verified and a dedicated adapter is implemented.
