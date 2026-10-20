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
  - Apply color and brightness in one Hue Bridge group action with a soft fade.
    Auto and the six clubs select contrasting color destinations and hold them
    for irregular 20–120 minute intervals. Each change uses a 180-second Hue
    fade; no repeated color writes interrupt a hold.
  - Hue brightness remains fixed at the artwork/club baseline between scene changes.
    Music features never alter Hue brightness.
- `POST /signal`
  - Deprecated compatibility endpoint; returns `applied: false`.
  - Does not send Hue Bridge commands or alter brightness.
- `POST /on`
- `POST /off`

Successful commands return any 2xx response. RSVP treats non-2xx or connection failure as unsuccessful and retries automatic reconciliation.

## Automatic ambience

The music schedule remains LOFI 04:00–10:00, LOUNGE 10:00–17:00,
RAP 17:00–23:00, and R&B 23:00–04:00, with the same 20-minute weighted media
handoffs. **That schedule no longer controls automatic Hue colors.**

The approved artwork remains unchanged: sky-blue/gold/waterfront by day and
indigo/violet/illuminated waterfront by night. **AUTO generates new saturated
Hue shades within curated complementary hue families**, including teal,
jade, garnet and warm amber, instead of selecting from the handful of fixed
artwork anchor HEX codes. Day and night retain their own brightness baselines.
The original fixed artwork anchors remain available for legacy comparisons.
The server calculates the next solar event at startup and schedules Hue's phase
change for that exact boundary, with only hourly safety reconciliation for
clock changes or sleep. It does not recalculate sunrise/dusk on every light
write. The scheduler independently chooses a short (20–40 min), medium (50–80 min),
or long (90–120 min) hold, with no fixed order or forced color cycle.
It favors contrasting hue families and avoids A→B→A family backtracking,
without a prescribed color-family rotation. The generation is reproducible
from the event seed, so restarts do not reshuffle an active hold. Choices derive from a stable seeded
sequence, preserving the current destination and its end time across service
restarts. The 30-second server checks send a Hue command only when a
destination actually changes. Each Hue Bridge fade lasts 180 seconds.

Explicit club or legacy Hue scene selection takes priority until the user chooses
**AUTO**, including across music handoffs and restarts. Native app power-off
or scene/brightness edits yield control; only explicit **HUE ON** may power a
bulb back on. Music automation stopping does not change the selected lighting
collection.

## Hue implementation requirements

Use the local Philips Hue Bridge API over HTTPS and keep bridge credentials out of this repository. The adapter should keep the Hue application key and scene/group identifiers in environment configuration or another local secret store.

Recommended mapping is one Hue scene per RSVP mode (`lofi`, `lounge`, `rap`, `rnb`) within one Hue group/zone. Scene recall/transition should target that same Hue group/zone so all lights move together.

## RSVP Lighting V3 club scenes

The slide-out **LIGHTING** menu controls the Hue globe separately from the VIBE
music menu. It offers six manual scenes: **Yin Yang Café** (The Listening Room),
**40/40 Club**, **Republic Gardens**, **The Tunnel**, **Club Crucial** and
**Boom Boom Room**, plus **AUTO**, **HUE ON** and **HUE OFF**.

- `POST /admin/lights/scene/:id` chooses a named club. Each club uses rich
  day/night colors, irregular 20–120 minute holds and three-minute fades to
  substantially different hues. The controller sends no color writes while a
  destination is held. The selector is persisted until explicit Auto.
- `POST /admin/lights/auto` clears the manual scene and resumes the currently
  scheduled solar artwork colors. The previous manual scene is not restored by a
  media/genre handoff.
- `POST /admin/lights/on` is the **only RSVP command that may power on Hue**.
  Selecting a scene or Auto never turns on a bulb that is physically off.
- `POST /admin/lights/off` explicitly turns off Hue. Hue's native phone app
  power-off also takes priority; the adapter's read-only `GET /power` exposes
  physical state and out-of-band app color, color-temperature and brightness changes.
  During a Hue Bridge-driven three-minute fade, intermediate color/brightness
  readings must **not** be interpreted as Hue app takeover. Wait for the
  fade plus a five-second settling margin before comparing targets again.
  Physical power-off is honored immediately even during a fade; a genuine
  manual scene/color change is recognized after the fade settles, without
  RSVP sending any additional color commands during the hold. The `POST /release` adapter
  action transfers control back to RSVP only after explicit user selection.
- Existing `POST /admin/lights/mode/:mode` remains available to old clients,
  but now also persists until Auto and affects Hue only, not music.
- Radio/TV programming, video/track selection and the four music time blocks
  cannot override a selected club scene. Hue overrides survive Pi restarts.

Govee H7021 balcony strings are **not controlled by this implementation**.
Their controller and native app remain separate until Govee control capabilities
are verified and a dedicated adapter is implemented.
