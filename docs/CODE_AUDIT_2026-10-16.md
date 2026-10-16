# RSVP Radio source audit — 2026-10-16

**Scope:** lighting, kiosk asset references, obsolete paths, systemd startup,
manual color sampler, tests and deployment documentation. Video playback logic
is **explicitly excluded** pending the RSVP TV rollout.

## Corrected on the audit branch

- The Hue adapter now tracks the brightness target of its own successful
  `/ambient` and `/signal` writes. Independent changes made in the Hue app
  to target brightness, XY color or white-temperature mode yield control.
  A short confirmation interval and limited rounding tolerance prevent an
  unfinished Hue fade or RSVP's reactive brightness writes from being mistaken
  for a native-app takeover. `POST /release` resets all tracking.
- Removed the old, unused `intelligence/light-transition.js` module and
  its tests; removed the legacy no-op `_applyLightsScene` server calls and
  obsolete scheduling variables. First-song music seeds no longer force a
  redundant independent Hue scheduler pass.
- Removed `public/tv-overlay.css`, which neither UI HTML document loads.
  The currently approved `public/tv-refined.css` remains unchanged.
- Corrected TV visual tests to protect the approved shared day/night
  water masks and nine-second ripple. Replaced brittle pinned CSS version
  expectations with a requirement for a cache-busted URL.
- Fixed the manual Hue swatch sampler and its tests: the current artwork Auto
  palette has day/night **anchor colors**, no `base` swatch.
- Added unit checks for native-app Hue control and browser asset references.

## Protected and unchanged

- Pi-local `public/assets/bg/rsvp_day_art.webp` and `rsvp_night_art.webp`.
- Approved TV artwork, active TV/menu styling, Plexamp controls, music
  programming and all video playback source files.
- Manual club selection persists until Auto; neither scheduled Hue changes nor
  server startup power on a bulb switched off in the Hue app.
- Diagnostic/preview utilities still have a purpose, especially
  `scripts/preview-solar.js`, `scripts/preview-hue.js` and
  `scripts/sample-hue-colors.js`. Do not delete them as "dead scripts."
- Govee remains outside the Philips Hue controller.

## Known boundaries and follow-up

- The native-app edit detection reads the Hue v1 group's **commanded action**
  state. Verify on the actual living-room bulb that per-bulb Hue app changes
  appear on that API; group state behavior may vary by bridge/app operation.
  Changes made while the adapter was offline may not be detectable on startup
  without a persisted hardware command baseline.
- The currently loaded Chromium page still needs a **user-initiated** refresh
  after UI deployments. Automatic kiosk reloads risk interrupting playback.
- RSVP TV paused-video load/resume behavior is intentionally deferred.
- Run syntax checks and **targeted tests in an isolated Git worktree** before
  installing on the Pi. Do not run the full test suite in the live
  `/home/pi/rsvp-radio` checkout: historical integration commands have
  interfered with Plexamp and Chromium.
- Static source review is not proof of hardware correctness or a successful
  production deployment. Collect real Hue /power state and targeted Pi tests
  before marking the change live.
