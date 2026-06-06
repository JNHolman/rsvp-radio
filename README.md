# RSVP Radio

A self-DJing music and video system for live events, built on a Raspberry Pi 5. It runs the room the way a working DJ would: the first track of the night seeds the vibe, a time-block schedule moves the energy through the day, skip behavior steers laterally between curated playlist lanes, and music videos take over the screen on command — all without anyone touching a laptop mid-party.

Built and operated by [DJ Infamous One](https://github.com/JNHolman) for RSVP Society events in Louisville, KY. This is a live production system, not a demo: it has run multi-hour real-world sessions and carries the scar tissue (and regression tests) to prove it.

## What it does

**The vibe model.** Four genre modes — lofi, rap, rnb, wrap — own the day on a schedule (lofi 07:30, rap 15:00, rnb 21:30, wrap 02:00). The system never starts music cold: it reacts to what a human starts. The first song of a session seeds the genre; boundaries shift it; manual overrides hold until the next boundary, then the schedule resumes. Music and video manual picks follow the same lifecycle, so the operator's mental model is one rule everywhere.

**Skip-driven lateral steering.** Within a block, consecutive skips walk playback to a vibe-adjacent playlist "lane" — the DJ move from one sub-vibe to its neighbor, never a jarring cut across genres. Lane choice can be delegated to Claude (an LLM picks the most vibe-adjacent lane by name from the curator's own playlist naming); with no API key it degrades to deterministic round-robin, never to broken. A clean play (70%+ ride) resets the skip streak; a boundary or manual change resets to the anchor lane.

**Track intelligence.** Every skip and play is tracked: hard skips earn strikes, partial listens earn soft skips, full listens redeem. Strikes sync back to Plex as star ratings, so the library itself learns what the room likes.

**Admin-triggered video mode.** Music videos play in the kiosk's own `<video>` element from local files (no Plex client round-trip), auto-advancing through shuffled playlists with boundary-aware switching. Pausing music, advancing clips, recovering from failures, and handing audio back when the clip set stops are all server-owned and tested.

**Lights.** A separate lights service drives the room's color on its own schedule, deliberately decoupled from playback — the bulb follows the *night*, not every track.

## Architecture

```
┌─────────────────────────── Raspberry Pi 5 ───────────────────────────┐
│                                                                      │
│  Plex Media Server (:32400) ◄──── library, playlists, metadata       │
│        ▲                                                             │
│        │ poll /status/sessions, webhooks                             │
│  Node/Express server (:3000) ──── the brain                          │
│        │   ├─ state machine + handoff arbitration                    │
│        │   ├─ skip tracker / lane steering / session seeding         │
│        │   ├─ video mode (server-owned clip queue)                   │
│        │   └─ /media/:key local file streaming (range requests)      │
│        │                                                             │
│  Plexamp headless (:32500) ◄── audio player (pause/resume/playlists) │
│  Lights service (:5005)    ◄── room color (decoupled schedule)       │
│  Chromium kiosk ──────────► fullscreen UI, polls /state,             │
│                             plays video clips, beacons events back   │
└──────────────────────────────────────────────────────────────────────┘
```

Audio routes through PipeWire so Plexamp (mp3s) and Chromium (video audio) share the HDMI output instead of fighting over exclusive hardware access.

## Reliability engineering

This system is designed to survive a party, which is a hostile environment:

- **Most-recent-wins handoff.** When Plex reports both a video and an audio session, whichever the human started more recently wins — start an MP3 over a lingering video and music takes over immediately; start a video over music and the video gets its own audio.
- **Stale-video guard.** A dead Plex Web tab can report "playing" forever with a frozen offset. After N polls without offset movement, a phantom video forfeits to live audio — but a frozen video *alone* keeps showing rather than blanking the screen.
- **Dead-media resilience.** Every clip is stat'd on disk before a video session starts; missing files (stale Plex paths after folder reorgs) are dropped loudly. A clip that fails mid-session is dropped and the queue advances — one bad file can no longer kill a set.
- **Self-correcting lights schedule.** Boundary transitions re-assert on every tick instead of firing in a one-shot window, so a missed tick heals itself.
- **Graceful AI degradation.** Lane steering's LLM picker failing means round-robin, not silence.

## Testing

```
npm run verify     # lint (node --check on every file) + full test suite
```

168 tests across unit and integration: the integration suite spawns the real server against a scripted fake Plex and asserts observable behavior through `/state` — handoff arbitration, phantom-video demotion, media range requests, path-traversal protection, admin routes, autoplay prohibitions, and the full skip/strike/redemption ladder.

## Stack

Node.js / Express · Plex Media Server + Plexamp headless · fast-xml-parser (with a regex fallback for parser parity) · Anthropic API (lane steering) · PipeWire · systemd · Chromium kiosk · Raspberry Pi OS (Trixie)

## Repo guide

| Path | What |
|------|------|
| `server.js` | State machine, polling, video mode, all routes |
| `intelligence/` | plex-parser, skip-tracker, lane-steering, session seeding, plex-sync |
| `shared/timeblocks.js` | The schedule, shared server ↔ kiosk |
| `public/` | Kiosk UI (vanilla JS modules) + admin console |
| `test/` | Unit + integration suites and the spawn-a-real-server harness |
| `README-OPS.md` | Deploy ritual, services, troubleshooting field guide |
| `SYSTEM-NOTES.md` | OS-level setup that lives outside this repo |

Setup: copy `.env.example` to `.env`, fill in your Plex token and playlist ratingKeys, and read `README-OPS.md`. Secrets never live in this repo.
