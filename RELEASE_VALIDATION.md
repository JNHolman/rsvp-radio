# RSVP Radio / TV — Cold Audit Validation

**Audit date:** October 4, 2026  
**Candidate status:** Cold-audited release candidate — not yet Pi/hardware-certified

This report describes the state of the exact tree packaged with this candidate. It deliberately separates what was proven in the audit environment from what still has to be proven on the Raspberry Pi.

## What passed here

- **177/177 Node unit tests passed.**
- **6/6 Python audio-analyzer tests passed.**
- Every JavaScript file passes `node --check`.
- Analyzer and analyzer tests pass Python bytecode compilation.
- Every shell script passes `bash -n`.
- A complete synthetic deployment environment passes `scripts/preflight.js`.
- The untouched `.env.example` is correctly rejected until all bridge/Plex-specific values are supplied.
- Runtime state is reset to a clean first-run baseline.
- No `.env`, private key, certificate, cache, log, temp file, `node_modules`, or populated runtime-history file is included.
- Both required ambient background videos are present and decode as H.264 1280×720 assets.
- The Philips Hue adapter is constrained to `127.0.0.1`, and preflight requires `LIGHTS_URL` to match its port.
- Hue TLS verification remains enabled and validates the configured bridge identity.
- Required Hue bridge/credential/group/scene values have no plausible target defaults; untouched placeholders are rejected.

## Material defects found and corrected during the cold audit

The final audit was not just a packaging pass. It found defects that would have affected real runtime behavior:

- Restored the **missing audio analyzer** that supplies bass/energy data for reactive Hue brightness.
- Moved analyzer → Hue relay ownership into the server so reactive lighting does not depend on Chromium being open.
- Fixed missing Hue brightness-helper imports that would have caused a runtime `ReferenceError` on real reactive-light events.
- Fixed a missing `videoEvent` import that would have caused a runtime `ReferenceError` in TV telemetry/failure handling.
- Closed `/features` and `/video-failed` to loopback; remote Plex webhooks require the configured webhook token while local Plex remains supported.
- Corrected `/api/exit` so the local kiosk can exit without knowing the optional remote API token while non-local callers still require it.
- Made persistent JSON writes atomic and reduced unnecessary session-heartbeat disk writes on the Pi.
- Removed an unread `parec` stderr pipe that could eventually stall the long-running audio analyzer.
- Removed stale browser/pre-fade scheduler compatibility code so there is one authoritative automatic schedule.
- Enforced Hue adapter bind/port consistency instead of depending on `localhost` resolution behavior.
- Fixed the installer so systemd services use the Node binary actually discovered on the Pi rather than assuming `/usr/bin/node`.
- Fixed `verify-pi.sh` so it checks `/health` JSON `ok`, not merely HTTP 200.
- Fixed `start-kiosk.sh` for the same health-contract bug so Chromium does not launch merely because an unhealthy `/health` request returned HTTP 200.
- Restored the two required ambient background videos that had been dropped from an earlier release candidate.
- Removed duplicate XML entity-decoding logic and retained a single parser implementation.
- Removed old patch-history/version comments and obsolete transition compatibility exports.
- Replaced the unsafe-looking example `HUE_GROUP_ID=1` with a required blank bridge-specific value.
- Pinned `fast-xml-parser` to `5.10.1` and added a `body-parser` `2.3.0` override in the declared dependency graph.
- Marked the package `private` to prevent accidental npm publication.

## Core behavior covered by unit regression tests

The unit suite covers the parts of the system that are most dangerous to regress:

- Four time blocks and the overnight RNB → LOFI transition.
- The 20-minute handoff centered on every boundary.
- 80/20 → 60/40 → 40/60 → 20/80 weighted Radio/TV decisions.
- Natural song/clip completion instead of mid-media cuts.
- Hue's single continuous 20-minute scheduled fade.
- Restart recovery during an active Hue fade.
- Manual control and Stop Auto-DJ behavior during an already-active handoff.
- Radio/TV media ownership and stale-command suppression.
- TV failure recovery and stale browser-event rejection.
- Hue reactive brightness rate limiting, scene-baseline preservation, fade suppression, and analyzer-loss decay.
- Session/reputation/skip persistence, clean-play recovery, and lane steering.
- Loopback/trusted-LAN request-boundary helpers.
- Media path/range helper behavior and video event identity.

## Not proven in this environment

### Full Express integration suite

The integration tests require the npm runtime dependencies (`express`, `dotenv`, `fast-xml-parser`, and resolved transitives). This audit environment has no `node_modules`, and npm registry access timed out. Therefore **the integration suite was not executed here**.

The integration test sources are present and syntax-valid, but that is not the same as executing them.

### Frozen dependency graph

There is currently **no `package-lock.json`**. Multiple attempts to generate one from npm timed out in this environment. The project has exact direct dependency pins plus the `body-parser` override, but transitive resolution is not frozen until a lockfile is generated on an npm-connected machine.

Do not call this dependency graph reproducible until that lockfile exists and `npm ci` succeeds from it.

### Raspberry Pi / hardware behavior

This environment cannot certify the physical stack:

- Raspberry Pi boot and graphical-session timing.
- Plex Media Server and Plexamp connectivity/control.
- PipeWire/PulseAudio monitor capture on the actual Pi audio session.
- Philips Hue Bridge certificate, application credential, group/zone and scene IDs.
- Real 20-minute Hue transitions on the physical lights.
- Chromium kiosk autoplay/fullscreen behavior.
- Power-cycle/reboot recovery with the real services and devices.

## Pi release gate

Before promoting this candidate beyond RC status on the Pi:

1. Copy `.env.example` to `.env` and supply the real Plex/Hue values.
2. Run `node scripts/preflight.js .env`.
3. Run `npm install` once on an npm-connected machine and commit the generated `package-lock.json`.
4. From the frozen dependency graph, run `npm ci` and then `npm test`.
5. Run `bash scripts/verify-pi.sh`.
6. Reboot the Pi and verify RSVP, Hue, analyzer, Plexamp, and Chromium recover without manual repair.
7. Observe at least one real scheduled 20-minute boundary and verify Radio/TV/Hue ownership and transition behavior across music, video and Hue.

Until those steps pass, this is correctly labeled a **cold-audited release candidate**, not a hardware-certified production release.
