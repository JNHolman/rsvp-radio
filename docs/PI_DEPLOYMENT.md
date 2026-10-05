# Raspberry Pi deployment

RSVP is split into three local runtime pieces:

1. **`rsvp-hue`** — system service, loopback-only on port 5005. It translates RSVP's four ambience modes and reactive brightness intent into Philips Hue Bridge HTTPS commands.
2. **`rsvp-radio`** — system service on port 3000. It owns the programming clock, Radio/TV handoffs, state, reputation, controls, and the kiosk UI.
3. **`rsvp-analyzer`** — desktop-user service. It captures the current PipeWire/Pulse playback sink monitor with `parec`, derives bass/energy envelopes, and posts them only to the loopback `/features` endpoint. The server—not Chromium—relays those features to Hue.

Plexamp remains a separate user-session dependency. RSVP can continue operating if Hue or the analyzer is temporarily unavailable; `/health` reports the degraded component so it is visible instead of silently disappearing.

## First install

```bash
cd ~/rsvp-radio
cp .env.example .env
chmod 600 .env
nano .env
./scripts/install-pi.sh
```

The installer checks Node/Python, installs the small analyzer runtime dependencies (`python3-numpy` and `pulseaudio-utils`) when missing, installs the two system services, installs the analyzer user service, and installs the Chromium kiosk autostart entry.

Set `TZ` to the venue timezone so every programming boundary remains correct after a reflash. This build defaults to `America/Kentucky/Louisville` in `.env.example`.

## Required local configuration

### Plex

Configure `PLEX_TOKEN`, `PLEX_TARGET_CLIENT_IDENTIFIER`, and the four `PLAYLIST_*` ratingKeys. Plexamp itself must already be installed/configured for the desktop user.

If Plex Media Server runs on this same Pi, `/plex` webhooks are accepted from loopback without another secret. If Plex webhooks originate from another machine, set `PLEX_WEBHOOK_TOKEN` and configure the webhook URL as:

```text
http://<pi>:3000/plex?token=<PLEX_WEBHOOK_TOKEN>
```

### Philips Hue

Required Hue values are `HUE_BRIDGE_HOST`, `HUE_BRIDGE_ID`, `HUE_USERNAME`, `HUE_GROUP_ID`, and one scene ID each for `LOFI`, `WRAP`, `RAP`, and `RNB`. These are bridge-specific local values and do not belong in source control.

The adapter connects to the bridge over HTTPS with certificate verification enabled. `HUE_BRIDGE_HOST` is the LAN address used to reach the bridge; `HUE_BRIDGE_ID` is checked against the bridge certificate Common Name. If the Pi does not already trust the bridge chain, install/pin the appropriate Hue certificate/CA locally and set `HUE_CA_CERT_PATH`. There is no insecure TLS bypass.

### Audio analyzer

By default the analyzer follows the **current default playback sink's `.monitor` source**. This means it listens to what the Pi is playing, not to a room microphone.

Normally leave `ANALYZER_SOURCE` blank. Set it only when you intentionally want a particular Pulse/PipeWire monitor source. Useful discovery commands are:

```bash
pactl get-default-sink
pactl list short sources
```

The analyzer posts only to loopback HTTP. `/features` rejects LAN clients, and the kiosk is not required for reactive Hue behavior.

## Boot behavior

`systemd` starts Hue and RSVP after networking. The desktop user's systemd session starts the analyzer once the audio session exists. RSVP immediately reconciles persisted power intent and the correct scheduled Hue scene/remaining 20-minute transition. Chromium waits until RSVP returns `/health` with `"ok": true` before opening the kiosk; Hue/analyzer degradation is reported separately and does not block the screen.

The analyzer is deliberately a **user** service rather than a system service because PipeWire/Pulse playback belongs to the desktop user's audio session.

## Verify

```bash
./scripts/verify-pi.sh
```

The verification script checks:

- Node and Python analyzer dependencies;
- `.env`/configuration preflight;
- Hue and RSVP system services;
- analyzer user service;
- Hue bridge reachability;
- RSVP health;
- fresh bass/energy telemetry reaching RSVP;
- kiosk autostart and Chromium availability.

For failures:

```bash
journalctl -u rsvp-hue -n 100 --no-pager
journalctl -u rsvp-radio -n 100 --no-pager
journalctl --user -u rsvp-analyzer -n 100 --no-pager
```

## Kiosk startup

`./scripts/install-pi.sh` installs `deploy/autostart/rsvp-kiosk.desktop` for the desktop user who runs the installer. `scripts/start-kiosk.sh` detects either `chromium` or `chromium-browser`, waits until the RSVP core health payload reports `"ok": true`, and then opens the local UI in kiosk mode.

## Dependency lock

A production snapshot should include `package-lock.json` and use `npm ci`. If the lockfile is absent, the installer warns and falls back to `npm install`; generate and commit the lockfile from an npm-connected machine before treating the dependency graph as frozen.
