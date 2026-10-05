# RSVP Radio / TV

## The room changes before anyone notices.

RSVP Radio / TV is a personal ambience system built around a simple idea: **music, video and light should feel like one thing**.

It is not a productivity tool and it is not trying to solve a business workflow. It exists to make a room feel different at different times of day without anyone having to think about why.

A Raspberry Pi quietly watches the clock, Plex, Plexamp, what is being played, what gets skipped, which visual program owns the screen, and what the Philips Hue lights are doing. Then it keeps the whole room moving together.

The goal is that nobody notices the machinery.

They just notice the room feels right.

---

## What it feels like

At 11:50 AM, LOFI does not suddenly disappear because WRAP begins at noon.

The handoff starts early. The outgoing sound still owns most of the room, but the next block begins appearing. Across twenty minutes the balance moves through **80/20 → 60/40 → 40/60 → 20/80**. Songs finish naturally. Videos finish naturally. The lights begin one continuous fade toward the next Hue scene.

At 12:10 PM, WRAP owns the room completely.

There is no obvious switch.

That same idea repeats throughout the day:

| Time | Programming world |
|---|---|
| 4:00 AM – 12:00 PM | **LOFI** |
| 12:00 PM – 5:00 PM | **WRAP** |
| 5:00 PM – 11:00 PM | **RAP** |
| 11:00 PM – 4:00 AM | **R&B** |

Even the overnight R&B → LOFI handoff follows the same rules.

---

## Radio and TV are one system

RSVP Radio and RSVP TV are not separate applications competing for the room. They are two outputs of the same programming clock.

**Radio** steers Plexamp through curated music playlists and sibling lanes. **TV** uses Plex video playlists as visual programming. When TV owns the room, Radio stops issuing stale music commands underneath it. When TV ends, audio ownership returns cleanly.

During a scheduled blend, the next song or video source is chosen using the current old/new weighting. The decision happens only at a natural media boundary, so RSVP never chops a song or clip in half just because the clock changed.

TV also remembers where it was in each playlist. If a blend moves from one genre to another and later comes back, it does not keep restarting at clip one.

---

## The lights are part of the programming

Each programming world maps to a Philips Hue scene.

Hue follows the same twenty-minute handoff as the media system: one continuous fade begins ten minutes before the boundary and completes ten minutes after it. RSVP does not repeatedly re-fire the scene during that fade, because doing so would restart the bridge's transition clock.

Outside a scheduled long fade, the room can breathe gently with the music. A small local analyzer listens to the Pi's **playback monitor**—not a microphone—reduces the room audio to bass and energy envelopes, and feeds those into **rate-limited brightness movement only**. The active RSVP scene keeps ownership of color, so reactive lighting adds life without turning the room into a random light show. If the analyzer disappears, the server decays the last signal back toward the scene's baseline instead of leaving the lights stranded at an elevated brightness.

Manual light power is respected independently from scene intent. If the lights are off, the scheduler can keep track of where the room *should* be without silently turning them back on.

---

## The room develops a memory

RSVP pays attention to what survives the room.

Early skips create negative reputation. Strong completions can redeem it. Repeated failures affect rotation, and the resulting reputation can be synchronized back into Plex ratings. That means the system does not only follow a schedule; over time, the material inside that schedule can become better suited to the room.

Curated sibling playlists create another layer. If repeated skips suggest that the current lane is missing, RSVP can move laterally to another lane without abandoning the programming world entirely. An optional AI picker can choose among allowed sibling lanes, but it is constrained to the playlists already curated for that mode—the model does not get to invent the room's taste.

The result is not an autonomous DJ trying to be clever. It is a programmed environment that can gradually become more selective.

---

## It still lets a person take over

Automation is supposed to disappear when it is useful and get out of the way when it is not.

The admin surface can:

- stop or resume automation;
- force a programming mode;
- return immediately to the current schedule;
- start, pause, skip, go back, or stop RSVP TV;
- control Hue power;
- inspect the current room owner, media state, mode source, reputation and playlist alignment;
- synchronize learned reputation back to Plex.

A manual decision wins immediately. Scheduled automation is allowed to reclaim control only at the next legitimate future handoff, not a boundary that already began before the manual stop.

---

## What is actually running

```text
                         ┌──────────────────────────┐
                         │      RSVP CLOCK          │
                         │ LOFI / WRAP / RAP / R&B │
                         └────────────┬─────────────┘
                                      │
                         20-minute weighted handoff
                                      │
                 ┌────────────────────┼────────────────────┐
                 │                    │                    │
                 ▼                    ▼                    ▼
         ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
         │    RADIO     │     │      TV      │     │     HUE      │
         │   Plexamp    │     │ Plex videos  │     │ room scenes  │
         │ playlists    │     │ clip lanes   │     │ + brightness │
         └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
                │                    │                    │
                └──────────────┬─────┴────────────────────┘
                               ▼
                    ┌────────────────────┐
                    │ RSVP ORCHESTRATOR  │
                    │ ownership / state  │
                    │ memory / recovery  │
                    └─────────┬──────────┘
                              │
                   ┌──────────┴──────────┐
                   ▼                     ▼
          reputation + steering    kiosk + admin UI
```

The core runtime is a Node/Express service on the Pi. Plex is the media catalog, Plexamp is the audio player, RSVP TV serves local Plex video media to the kiosk, a local audio analyzer listens to the active PipeWire/PulseAudio playback monitor, and a loopback-only Hue adapter translates RSVP scene/brightness intent into authenticated HTTPS calls to the Philips Hue Bridge.

The analyzer does not control Hue directly. It only reports bass and energy to RSVP over loopback. RSVP owns the reactive-lighting relay, which means closing or reloading the kiosk does not stop the room from breathing with the music.

The browser is deliberately not a second scheduler. It renders state, plays the selected media and sends controls/telemetry. The server remains the authority for automation so two clocks cannot fight each other.

---

## Built to survive the boring failures too

The parts nobody sees matter because the whole illusion breaks if they do.

- Runtime/session/reputation state is written atomically so a sudden Pi power loss does not leave half-written JSON behind.
- Radio/TV ownership and Plexamp pause responsibility survive service restarts.
- Failed Hue commands remain unsynchronized so the scheduler retries instead of pretending the room changed.
- Hue credentials and bridge-generated resource IDs stay in local environment configuration, not source control.
- Hue TLS verifies the bridge identity rather than disabling certificate checks.
- system `systemd` services manage RSVP and Hue; a user-level service owns audio analysis inside the Pi audio session.
- The kiosk waits until RSVP reports its core runtime healthy before launching Chromium after boot; Hue/analyzer degradation remains visible through `/health` and the Pi verifier without blocking the screen.
- Missing critical configuration is surfaced instead of failing silently.
- Overnight schedule wraparound is covered by regression tests.

---

## Project layout

```text
server.js                  room orchestration, Plex state, Radio/TV ownership
shared/timeblocks.js       one schedule + one 20-minute blend policy
intelligence/              reputation, session, steering and transition policies
hue-adapter.js             loopback Philips Hue hardware boundary
hue/                       Hue configuration, TLS and payload logic
analyzer/                  playback-monitor bass/energy analysis
public/                     fullscreen now-playing UI + room-control console
deploy/                     systemd and kiosk autostart definitions
scripts/                    install, preflight, reset and Pi verification tools
test/                       unit + integration regression coverage
```

Deployment details live in [`docs/PI_DEPLOYMENT.md`](docs/PI_DEPLOYMENT.md). The Hue boundary is documented in [`LIGHTS_SERVICE_CONTRACT.md`](LIGHTS_SERVICE_CONTRACT.md).

---

## Why this exists

Because a room can have programming without looking programmed.

A song ends and the next era begins a little more often. A video finishes and the next visual world has quietly gained weight. The lights have been moving toward a different color for minutes. The system remembers what keeps getting rejected. A person can interrupt any of it and the automation knows how to find its way back later.

Most of that should be invisible.

That is the point.

**Lights breathe. Music moves. TV follows. The room changes. Nobody notices the system doing it.**
