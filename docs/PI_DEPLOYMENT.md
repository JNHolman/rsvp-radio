# Raspberry Pi deployment

RSVP is split into three local runtime pieces:

1. **`rsvp-hue`** — system service, loopback-only on port 5005. It applies day/night artwork colors and six selectable club scenes through authenticated Philips Hue Bridge HTTPS. Music never drives bulb brightness.
2. **`rsvp-radio`** — system service on port 3000. It owns the programming clock, Radio/TV handoffs, state, reputation, controls, and the kiosk UI.
3. **`rsvp-analyzer`** — desktop-user service. It captures the current PipeWire/Pulse playback sink monitor with `parec`, derives bass/energy envelopes, and posts them only to the loopback `/features` endpoint. Those features remain available for RSVP telemetry, but no longer drive Hue.

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

Required Hue values are `HUE_BRIDGE_HOST`, `HUE_BRIDGE_ID`, `HUE_USERNAME`, `HUE_GROUP_ID`, and one scene ID each for `LOFI`, `LOUNGE`, `RAP`, and `R&B`. These are bridge-specific local values and do not belong in source control.

The adapter connects to the bridge over HTTPS with certificate verification enabled. `HUE_BRIDGE_HOST` is the LAN address used to reach the bridge; `HUE_BRIDGE_ID` is checked against the bridge certificate Common Name. If the Pi does not already trust the bridge chain, install/pin the appropriate Hue certificate/CA locally and set `HUE_CA_CERT_PATH`. There is no insecure TLS bypass.

### Audio analyzer

By default the analyzer follows the **current default playback sink's `.monitor` source**. This means it listens to what the Pi is playing, not to a microphone.

Normally leave `ANALYZER_SOURCE` blank. Set it only when you intentionally want a particular Pulse/PipeWire monitor source. Useful discovery commands are:

```bash
pactl get-default-sink
pactl list short sources
```

The analyzer posts only to loopback HTTP. `/features` rejects LAN clients. The analyzer operates independently of Hue lighting.

## TV artwork: sunrise and civil dusk

The kiosk's ambient day/night background automatically follows **sunrise** and
**civil dusk** (the end of evening civil twilight), rather than fixed clock
hours. The Pi calculates these times locally from `SOLAR_LATITUDE` and
`SOLAR_LONGITUDE` in `.env`; central Louisville defaults are
`38.2527` and `-85.7585`. Set `TZ=America/Kentucky/Louisville` for the
correct local calendar day, including daylight saving time.

`GET /api/solar-state` reports the current `day` or `night` phase, that
day's sunrise/dusk timestamps, and the next transition timestamp. The kiosk
uses the next solar event timer plus an hourly reconciliation check and preserves the
approved artwork transitions. On a
short endpoint failure, it retains the last valid phase rather than abruptly
switching scenes. Hue Auto now generates new saturated shades within artwork-coordinated color
families, rather than restricting the globe to a few anchor HEX codes. Day
retains its blue/waterfront and sunlit gold identity while adding diverse
complementary jewel tones. Night retains blue/indigo/violet waterfront mood
while permitting deep teal, jade, garnet, ember and antique amber. It randomly chooses short (20–40 min),
medium (50–80 min), or long (90–120 min) holds with no repeating order.
Successive colors are varied but not forced through a fixed three-color
cycle. The six club scenes use the same independently chosen hold lengths.
Choices are deterministic for a given time and selection so a service
restart does not reshuffle a hold. Each color change fades for 3 minutes,
with no extra Hue writes during a hold. Run `node scripts/review-hue-spectrum.js`
on the Pi to generate a **read-only** HTML contact sheet at
`/tmp/rsvp-hue-spectrum-review.html`, embedding the locally approved stills
next to thirty generated Day/Night shades. No live Hue actions, service
restarts, Pi desktop changes or source artwork edits occur during review.
Music-derived bass/energy remains
available as analyzer telemetry, but no longer changes the globe's brightness.
Club scenes remain selected through music handoffs and reboots until
Auto is pressed.
Neither normal startup nor Auto selection switches a physically off Hue bulb on.
Native Hue app changes to power, color mode, color or brightness yield lighting
control until an explicit RSVP selection; neither music nor the analyzer changes Hue brightness.

The two owner-approved still images are supported as separate, sharp layers:

- `public/assets/bg/rsvp_day_art.webp`
- `public/assets/bg/rsvp_night_art.webp`

Place those files under the Pi checkout at those paths and reload the kiosk.
They are intentionally **not baked into the UI**: the current live album
cover, navigation, and future FX remain independent layers. If either image is
missing or fails to load, the existing day/night MP4 continues working behind
it as a fallback. Keep the files separate from the music and Hue data.

## Boot behavior

`systemd` starts Hue and RSVP after networking. The desktop user's systemd session starts the analyzer once the audio session exists. RSVP checks the physical Hue state and restores background-matched Auto or a
persisted club scene only if the bulb is already on and the Hue app has not taken
control. It never powers on a bulb at boot. Chromium waits until RSVP returns `/health` with `"ok": true` before opening the kiosk; Hue/analyzer degradation is reported separately and does not block the screen.

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