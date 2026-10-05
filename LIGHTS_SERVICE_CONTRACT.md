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
- `POST /signal`
  - JSON: `{ "bass": 0.0-1.0, "energy": 0.0-1.0 }`
  - Reactive-light input. It may modulate brightness only; the active RSVP scene keeps ownership of color.
  - Rate-limit bridge writes and suppress reactive writes while a scheduled scene transition is active so the 20-minute fade is never interrupted.
- `POST /on`
- `POST /off`

Successful commands return any 2xx response. RSVP treats non-2xx or connection failure as unsuccessful and retries automatic reconciliation.

## RSVP schedule

- `lofi`: 04:00–10:00
- `lounge`: 10:00–17:00
- `rap`: 17:00–23:00
- `rnb`: 23:00–04:00

## Unified 20-minute handoff

Each boundary is a 20-minute ambience transition centered on the schedule boundary:

- -10 to -5 minutes: music/video selection is 80% outgoing / 20% incoming
- -5 to 0 minutes: 60% / 40%
- 0 to +5 minutes: 40% / 60%
- +5 to +10 minutes: 20% / 80%
- +10 minutes: incoming mode owns the programming fully

Hue receives one continuous destination-scene fade beginning at -10 minutes and ending at +10 minutes. If RSVP or the Hue adapter starts late, RSVP sends the remaining duration instead of snapping directly to the destination.

## Hue implementation requirements

Use the local Philips Hue Bridge API over HTTPS and keep bridge credentials out of this repository. The adapter should keep the Hue application key and scene/group identifiers in environment configuration or another local secret store.

Recommended mapping is one Hue scene per RSVP mode (`lofi`, `lounge`, `rap`, `rnb`) within one Hue group/zone. Scene recall/transition should target that same Hue group/zone so all lights move together.
