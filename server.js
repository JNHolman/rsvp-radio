"use strict";

/**
 * server.js — RSVP Radio / TV orchestration server
 *
 * Owns system state, Plex/Plexamp coordination, Radio/TV ownership, scheduled
 * programming, weighted handoffs, Hue intent, reputation and the kiosk/admin
 * API. The browser renders state and sends controls; it does not run a second
 * automation clock.
 */

// Auto-load .env before config so manual `node server.js` and `npm start`
// use the same values as the systemd deployment. EnvironmentFile= already
// covers production, while dotenv keeps local/manual starts predictable.
//
// If dotenv is unavailable, real environment variables still work.



try {
  require("dotenv").config();
} catch (err) {
  console.warn("[server] dotenv unavailable:", err.message, "— relying on real env vars");
}

const express  = require("express");
const { exec } = require("child_process");
const { URL }  = require("url");
const fs       = require("fs");
const path     = require("path");
const cfg         = require("./config");
const skipTracker = require("./intelligence/skip-tracker");
const videoSkipTracker = skipTracker.createTracker(process.env.VIDEO_SKIP_DATA_PATH || path.join(__dirname, "data", "video-skip-data.json"));
const plexSync    = require("./intelligence/plex-sync");
const session     = require("./intelligence/session");
const playlistCtl = require("./intelligence/playlist-controller");
const blendPolicy = require("./intelligence/blend-policy");
const lightTransition = require("./intelligence/light-transition");
const videoBlendPolicy = require("./intelligence/video-blend-policy");
const videoRecovery = require("./intelligence/video-recovery");
const videoEvent = require("./intelligence/video-event");
const automationPolicy = require("./intelligence/automation-policy");
const laneSteering = require("./intelligence/lane-steering");
const plexParser  = require("./intelligence/plex-parser");
const plexArt     = require("./intelligence/plex-art");
const requestAuth = require("./intelligence/request-auth");
const runtimeState = require("./intelligence/runtime-state");
const timeblocks  = require("./shared/timeblocks");
const _persistedRuntime = runtimeState.load();

// ── Express setup ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "64kb" }));

// LAN controls intentionally require no login, but a random internet page open
// on a phone/laptop must not be able to submit cross-site mutations to the Pi.
// Non-browser clients (curl/Plex) do not send Sec-Fetch-Site and remain valid.
app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!requestAuth.browserMutationAllowed({
    secFetchSite: req.get("sec-fetch-site"),
    origin: req.get("origin"),
    host: req.get("host"),
  })) {
    return res.status(403).json({ ok: false, error: "cross_site_forbidden" });
  }
  return next();
});

const fetch = global.fetch.bind(global);

// ── Audio feature state ───────────────────────────────────────────────────────
let lastFeatures = { bass: 0.0, energy: 0.0, updatedAt: 0 };

function clamp01(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

function featuresNow() {
  const age = Date.now() - (lastFeatures.updatedAt || 0);
  if (!lastFeatures.updatedAt) return { bass: 0, energy: 0 };
  if (age <= cfg.FEATURES_STALE_MS) {
    return { bass: lastFeatures.bass, energy: lastFeatures.energy };
  }
  const t = Math.min(1, (age - cfg.FEATURES_STALE_MS) / cfg.FEATURES_DECAY_MS);
  return {
    bass:   +(lastFeatures.bass   * (1 - t)).toFixed(4),
    energy: +(lastFeatures.energy * (1 - t)).toFixed(4),
  };
}

function featureHealth() {
  if (!lastFeatures.updatedAt) return { fresh: false, updatedAt: 0, ageMs: null };
  const ageMs = Math.max(0, Date.now() - lastFeatures.updatedAt);
  return { fresh: ageMs <= cfg.FEATURES_STALE_MS, updatedAt: lastFeatures.updatedAt, ageMs };
}

// ── Time blocks ───────────────────────────────────────────────────────────────
function blockModeForNow() {
  return timeblocks.blockModeForDate(new Date());
}

// ── Fetch with timeout ────────────────────────────────────────────────────────
function fetchWithTimeout(url, ms, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

// ── Plex XML parsing ──────────────────────────────────────────────────────────
// Pure parsing lives in intelligence/plex-parser.js. These thin wrappers
// pass the configured client IDs through.

function parseSessions(xml) {
  return plexParser.parseSessions(xml, {
    targetClientId: cfg.PLEX_TARGET_CLIENT_IDENTIFIER || "",
    // TV is started explicitly from RSVP Admin. Plex remains the catalog,
    // but a stray Plex Web/TV session must never steal media ownership.
    ignoreVideo: true,
  });
}

function buildPlexArtUrl(thumb) {
  return plexArt.browserSafeSourceUrl(thumb, cfg.PLEX_BASE);
}



function publicAssetExists(assetPath) {
  const relative = String(assetPath || "").replace(/^\/+/, "");
  return require("fs").existsSync(require("path").join(cfg.PUBLIC_DIR, relative));
}

function assetHealth() {
  const required = [cfg.BG_DAY, cfg.BG_NIGHT];
  const missing = required.filter((asset) => !publicAssetExists(asset));
  return { ok: missing.length === 0, required, missing };
}

function requestAddress(req) {
  return String(req.socket?.remoteAddress || req.ip || "");
}

function localOnlyRequest(req) {
  return requestAuth.isLoopbackAddress(requestAddress(req));
}

// ── Video metadata helpers ────────────────────────────────────────────────────
// Parse artist/title from filename when Plex does not have proper metadata.
// Handles "Artist - Title (Clean).mp4" format.
function _parseFilenameMetadata(filePath) {
  if (!filePath) return null;
  const base = path.basename(filePath, path.extname(filePath));
  const dashIdx = base.indexOf(" - ");
  if (dashIdx === -1) return null;
  return {
    artist: base.slice(0, dashIdx).trim(),
    title:  base.slice(dashIdx + 3).trim(),
  };
}

// ── UI state ──────────────────────────────────────────────────────────────────
// Nested shape — server is the single source of truth. Browser renders only.
//
//   appState           — high-level state machine value
//   media.*            — current media identity and player state
//   mode.*             — current lights/playlist mode + source + manual expiry
//   video.*            — server-known video phase (none|playing|paused only)
//   intelligence.*     — strike count, Plex rating, last play percent
//   plexamp.*          — whether RSVP paused Plexamp for video handoff
//   music.*            — desired/commanded playlist + alignment
//   features.*         — bass/energy from analyzer (last reported)
//
// appState values:
//   IDLE | AUDIO_PLAYING | AUDIO_PAUSED | VIDEO_PLAYING | VIDEO_PAUSED
//
// mode.source values:
//   "manual" | "timeblock" | "video-session"
// First-song seed affects Hue only; it does not rewrite the programming mode.
// Manual mode yields when the next scheduled 20-minute handoff begins.

function _emptyMedia() {
  return {
    type: "idle", playerState: "",
    title: "", artist: "", album: "",
    ratingKey: "", artUrl: "", mediaUrl: "",
    viewOffsetMs: 0, durationMs: 0,
  };
}

function _emptyMusic() {
  return {
    desiredPlaylist:        "",
    lastCommandedPlaylist:  "",
    commandAligned:         true,
  };
}

function _initialState() {
  return {
    appState: "IDLE",
    media:        _emptyMedia(),
    mode:         { current: blockModeForNow(), source: "timeblock", manualExpiresAt: 0 },
    video:        { phase: "none" },
    intelligence: { strikes: 0, softStrikes: 0, rating: 10, lastPlayPercent: null },
    plexamp:      { pausedByRsvpVideo: false },
    music:        _emptyMusic(),
    features:     { bass: 0, energy: 0 },
    updatedAt:    Date.now(),
    error:        "",
  };
}

function deriveAppState(playerState, isVideo) {
  if (!playerState || playerState === "stopped") return "IDLE";
  if (playerState === "paused")  return isVideo ? "VIDEO_PAUSED"  : "AUDIO_PAUSED";
  if (playerState === "playing") return isVideo ? "VIDEO_PLAYING" : "AUDIO_PLAYING";
  return "IDLE";
}

function _computeIntelligence(ratingKey, lastPlayPercent = null) {
  const base = { strikes: 0, softStrikes: 0, rating: 10, lastPlayPercent };
  if (!ratingKey) return base;
  const entry = skipTracker.getStatus(ratingKey);
  if (!entry) return base;
  return {
    strikes:         entry.strikes || 0,
    softStrikes:     entry.softStrikes || 0,
    rating:          plexSync.starsForStrikes(entry.strikes || 0, entry.softStrikes || 0),
    lastPlayPercent,
  };
}

let lastState = _initialState();

// ── Manual mode override (server-owned) ──────────────────────────────────────
// Set via POST /mode/:mode. Auto-expires when the next scheduled music blend
// begins. A manual selection made during an active blend survives that blend and
// expires at the following one. Cleared explicitly via POST /mode/clear.
let _manualMode = (_persistedRuntime.manualMode && _persistedRuntime.manualMode.expiresAt > Date.now())
  ? { ..._persistedRuntime.manualMode }
  : null; // { mode: "rap", expiresAt: 1234567890 } or null
let _automation = _persistedRuntime.automation?.manualStop
  ? { ..._persistedRuntime.automation }
  : { enabled: true, manualStop: false, stoppedMode: null, stoppedAt: 0 };
function _stopAutomation() {
  _automation = { enabled:false, manualStop:true, stoppedMode:blockModeForNow(), stoppedAt:Date.now() };
  // Stop means stop NOW: clear decisions that were queued by automation so a
  // track/clip ending before the next poll cannot fire stale work.
  _pendingPlaylistSwitch = null;
  _musicBlendSession = null;
  _pendingVideoMode = null;
  _persistRuntimeState();
}
function _startAutomation() {
  _automation = { enabled:true, manualStop:false, stoppedMode:null, stoppedAt:0 };
  _persistRuntimeState();
}
function _maybeResumeAutomationForBlend(blendState = timeblocks.getMusicBlendState(new Date())) {
  if (!automationPolicy.shouldReclaimForBlend({
    manualStop: _automation.manualStop,
    stoppedAt: _automation.stoppedAt,
    blendState,
    blendHalfMin: timeblocks.MUSIC_BLEND_HALF_MIN,
  })) return false;

  _startAutomation();
  _videoSkipPressure = { count:0, lastRatingKey:"", lastAt:0 };
  console.log(`[automation] future scheduled ${timeblocks.MUSIC_BLEND_WINDOW_MIN}-minute blend reclaimed automation control`);
  return true;
}

function _isManualActive() {
  if (!_manualMode) return false;
  if (Date.now() >= _manualMode.expiresAt) {
    console.log(`[mode] manual override expired (was ${_manualMode.mode})`);
    _manualMode = null;
    _persistRuntimeState();
    return false;
  }
  return true;
}

function _setManualMode(mode) {
  const expiresAt = timeblocks.getNextMusicBlendStartMs(new Date());
  _manualMode = { mode, expiresAt };
  // Explicit operator intent wins immediately over any queued automatic work.
  _pendingPlaylistSwitch = null;
  _musicBlendSession = null;
  _pendingVideoMode = null;
  _persistRuntimeState();
  console.log(`[mode] manual override → ${mode} (expires at next music blend ${new Date(expiresAt).toISOString()})`);
}

function _clearManualMode() {
  if (_manualMode) console.log(`[mode] manual override cleared (was ${_manualMode.mode})`);
  _manualMode = null;
  _persistRuntimeState();
}

// Light-only manual scene. Unlike /mode/:mode this never changes Radio/TV
// programming. It holds until the next future 20-minute handoff begins, then
// Hue fades from the human-selected scene back into the scheduled ambience.
let _manualLights = (_persistedRuntime.manualLights && _persistedRuntime.manualLights.expiresAt > Date.now())
  ? { ..._persistedRuntime.manualLights }
  : null;

function _isManualLightsActive() {
  if (!_manualLights) return false;
  if (Date.now() < _manualLights.expiresAt) return true;
  console.log(`[lights] manual scene expired (was ${_manualLights.mode})`);
  _manualLights = null;
  _persistRuntimeState();
  return false;
}

function _setManualLights(mode) {
  const expiresAt = timeblocks.getNextMusicBlendStartMs(new Date());
  _manualLights = { mode, expiresAt };
  _persistRuntimeState();
  console.log(`[lights] manual scene → ${mode} (expires at next handoff ${new Date(expiresAt).toISOString()})`);
  return expiresAt;
}

// ── Pending playlist switch ──────────────────────────────────────────────────
// Boundary crosses queue a switch that fires at end of current track (option B).
// Manual mode changes fire IMMEDIATELY (user explicit intent).
let _pendingPlaylistSwitch = null; // { mode, playlistKey, queuedAt, reason, blendBoundaryMs? }
let _lastBlockMode = null;          // tracked across polls to detect boundary cross
let _musicBlendSession = null;      // active weighted handoff state for one boundary
let _lastCommandedPlaylist = "";    // last successfully commanded playlist ratingKey
let _firstStartAligned     = false; // whether first-start playlist alignment has been issued
let _suppressedVideoRatingKey = ""; // video ratingKey suppressed after browser playback failure

// Helper — does the server believe Plex is currently playing audio or video?
// Used to gate playlist commands so we never wake a stopped Plexamp.
// Plexamp is user-controlled; RSVP only steers an
// already-active session, never starts one from cold.
function _isPlayingNow() {
  const t = lastState.media?.type;
  const ps = lastState.media?.playerState;
  return (t === "audio" || t === "video") && (ps === "playing" || ps === "paused");
}

// ── Skip-driven lateral steering (the brain) ──────────────────────────────────
// Time boundary owns the vertical axis (mode reset to anchor); this owns the
// lateral axis (skips walk to a vibe-adjacent lane within the current mode).
// It only ever decides "switch to playlist X" — playback/lights/video are
// untouched; the existing machinery handles whatever actually plays.
const _laneMap = laneSteering.buildLaneMap(cfg);
const _lanePickFn = laneSteering.buildClaudePickFn({
  apiKey: cfg.ANTHROPIC_API_KEY,
  model: cfg.ANTHROPIC_MODEL,
  timeoutMs: cfg.ANTHROPIC_TIMEOUT_MS,
  fetchImpl: fetch,
});
const _steering = laneSteering.createSteering({
  laneMap:       _laneMap,
  skipThreshold: cfg.SKIP_STEER_THRESHOLD,
  skipWindowMs:  cfg.STEERING_SKIP_WINDOW_MS || 10 * 60 * 1000,
  minDwellMs:    cfg.STEERING_MIN_DWELL_MS || 15 * 60 * 1000,
  pickFn:         _lanePickFn,
  log: (m) => console.log(m),
});

// Queue a switch to an explicit lane ratingKey (not a mode). Fires at end of the
// current track via the same pending mechanism as boundary switches, so a steer
// never interrupts mid-song. Skipped when idle (never wake cold Plexamp).
function _queueLaneSwitch(lane, reason) {
  if (!lane || !lane.key) return;
  if (!_isPlayingNow()) {
    console.log(`[steering] idle — not queueing lane "${lane.name}" (${reason})`);
    return;
  }
  _pendingPlaylistSwitch = {
    mode:        _steering.snapshot().activeMode || "steer",
    playlistKey: lane.key,
    queuedAt:    Date.now(),
    reason:      `steer→${lane.name} (${reason})`,
  };
  console.log(`[steering] queued lane switch → "${lane.name}" ${lane.key} (${reason}, fires at end of track)`);
}

function _fireImmediatePlaylistSwitch(mode, reason) {
  const playlistKey = playlistCtl.playlistKeyForMode(mode, cfg);
  if (!playlistKey) {
    console.log(`[playlist] would switch to ${mode} (${reason}) but PLAYLIST_${mode.toUpperCase()} not configured`);
    return;
  }
  // Idle = no command. Plexamp/Plex is user-controlled — RSVP never wakes it
  // up from cold. The desired mode is still recorded in /state.mode.current
  // (and music.desiredPlaylist) so that the moment the user starts playing,
  // the next poll's first-start logic queues a switch.
  if (!_isPlayingNow()) {
    console.log(`[playlist] idle — not sending ${mode} switch (${reason}). Will align when playback resumes.`);
    _pendingPlaylistSwitch = null;
    return;
  }
  console.log(`[playlist] immediate switch → ${mode} playlist ${playlistKey} (${reason})`);
  playlistCtl.playPlaylist({
    playlistRatingKey: playlistKey,
    plexBase:          cfg.PLEX_BASE,
    plexToken:         cfg.PLEX_TOKEN,
    clientId:          PLEXAMP_PI_ID,
    fetchWithTimeout,
    timeoutMs:         cfg.POLL_TIMEOUT_MS,
  }).then((result) => {
    if (result.ok) {
      _lastCommandedPlaylist = playlistKey;
    } else {
      console.warn(`[playlist] switch failed: ${result.reason}; retrying at next natural track boundary`);
      // A transient Plex/Plexamp failure must not permanently strand playback
      // on the wrong source. Preserve the no-mid-song rule by retrying only
      // when the next track naturally changes. Do not resurrect Radio work if
      // TV took ownership while this command was in flight.
      if (_roomOwner === "radio" && !_pendingPlaylistSwitch) {
        _pendingPlaylistSwitch = { mode, playlistKey, queuedAt: Date.now(), reason: `${reason} retry` };
      }
    }
  });
  // Success is immediate; failures re-enter the natural-boundary queue above.
  _pendingPlaylistSwitch = null;
}

function _queuePlaylistSwitch(mode, reason) {
  const playlistKey = playlistCtl.playlistKeyForMode(mode, cfg);
  if (!playlistKey) {
    console.log(`[playlist] would queue ${mode} (${reason}) but PLAYLIST_${mode.toUpperCase()} not configured`);
    _pendingPlaylistSwitch = null;
    return;
  }
  _pendingPlaylistSwitch = { mode, playlistKey, queuedAt: Date.now(), reason };
  console.log(`[playlist] queued switch → ${mode} ${playlistKey} (${reason}, fires at end of current track)`);
}

function _knownBlendSourceMode(blend) {
  const fromKey = playlistCtl.playlistKeyForMode(blend.fromMode, cfg);
  const toKey   = playlistCtl.playlistKeyForMode(blend.toMode, cfg);
  if (_lastCommandedPlaylist && _lastCommandedPlaylist === fromKey) return blend.fromMode;
  if (_lastCommandedPlaylist && _lastCommandedPlaylist === toKey) return blend.toMode;
  // On a restart we may not know what Plexamp's queue came from. Before the
  // boundary, old is the safest assumption; after it, new is the safest.
  return blend.offsetMin < 0 ? blend.fromMode : blend.toMode;
}

function _syncWeightedMusicBlend(blend, currentTrackKey) {
  // Blend just ended: guarantee the system lands on the incoming block, but still
  // wait for the current song to finish. Any stale weighted decision is replaced.
  if (!blend) {
    if (_musicBlendSession) {
      const finished = _musicBlendSession;
      if (_pendingPlaylistSwitch?.blendBoundaryMs === finished.boundaryMs) {
        _pendingPlaylistSwitch = null;
      }
      if (finished.sourceMode !== finished.toMode) {
        _queuePlaylistSwitch(finished.toMode, `${timeblocks.MUSIC_BLEND_WINDOW_MIN}-minute blend complete`);
      }
      console.log(`[playlist] blend complete ${finished.fromMode}→${finished.toMode}; canonical mode=${finished.toMode}`);
      _musicBlendSession = null;
    }
    return;
  }

  if (!_musicBlendSession || _musicBlendSession.boundaryMs !== blend.boundaryMs) {
    _musicBlendSession = {
      boundaryMs: blend.boundaryMs,
      fromMode: blend.fromMode,
      toMode: blend.toMode,
      sourceMode: _knownBlendSourceMode(blend),
      lastDecisionKey: "",
    };
    console.log(`[playlist] weighted blend started ${blend.fromMode}→${blend.toMode} (${timeblocks.MUSIC_BLEND_WINDOW_MIN} min centered on boundary)`);
  }

  // One decision per track per stage. If a five-minute stage changes while the
  // same song is still playing, re-evaluate once so the next song reflects the
  // newest 80/20, 60/40, 40/60, or 20/80 weighting.
  const decisionKey = `${blend.boundaryMs}:${blend.stageIndex}:${currentTrackKey || "unknown"}`;
  if (_musicBlendSession.lastDecisionKey === decisionKey) return;
  _musicBlendSession.lastDecisionKey = decisionKey;

  let selectedMode = blendPolicy.chooseMode(blend);
  let selectedKey  = playlistCtl.playlistKeyForMode(selectedMode, cfg);

  // A partially configured install should degrade to whichever side exists, not
  // silently kill the handoff. If neither side is configured, stay observer-only.
  if (!selectedKey) {
    const fallbackMode = selectedMode === blend.fromMode ? blend.toMode : blend.fromMode;
    const fallbackKey  = playlistCtl.playlistKeyForMode(fallbackMode, cfg);
    if (!fallbackKey) {
      console.log(`[playlist] blend observer-only: neither ${blend.fromMode} nor ${blend.toMode} playlist is configured`);
      return;
    }
    selectedMode = fallbackMode;
    selectedKey  = fallbackKey;
  }

  if (selectedMode === _musicBlendSession.sourceMode) {
    if (_pendingPlaylistSwitch?.blendBoundaryMs === blend.boundaryMs) _pendingPlaylistSwitch = null;
    console.log(`[playlist] blend ${blend.oldPct}/${blend.newPct} holds ${selectedMode}`);
    return;
  }

  _pendingPlaylistSwitch = {
    mode: selectedMode,
    playlistKey: selectedKey,
    queuedAt: Date.now(),
    reason: `weighted blend ${blend.fromMode}→${blend.toMode} ${blend.oldPct}/${blend.newPct}`,
    blendBoundaryMs: blend.boundaryMs,
  };
  console.log(`[playlist] blend ${blend.oldPct}/${blend.newPct} queued next source → ${selectedMode}`);
}

function _flushPendingPlaylistSwitch(reason) {
  if (!_pendingPlaylistSwitch) return;
  const pending = _pendingPlaylistSwitch;
  const { mode, playlistKey } = pending;

  // Optimistically advance the blend source before the async Plex command. The
  // same poll immediately makes the NEXT weighted decision; without this, it
  // can queue a duplicate switch based on stale source state. Roll back on a
  // failed command if no later decision has moved the source again.
  let previousBlendSource = null;
  if (pending.blendBoundaryMs && _musicBlendSession?.boundaryMs === pending.blendBoundaryMs) {
    previousBlendSource = _musicBlendSession.sourceMode;
    _musicBlendSession.sourceMode = mode;
  }

  console.log(`[playlist] flushing queued ${mode} switch (trigger: ${reason})`);
  playlistCtl.playPlaylist({
    playlistRatingKey: playlistKey,
    plexBase:          cfg.PLEX_BASE,
    plexToken:         cfg.PLEX_TOKEN,
    clientId:          PLEXAMP_PI_ID,
    fetchWithTimeout,
    timeoutMs:         cfg.POLL_TIMEOUT_MS,
  }).then((result) => {
    if (result.ok) {
      _lastCommandedPlaylist = playlistKey;
    } else {
      if (previousBlendSource !== null &&
          _musicBlendSession?.boundaryMs === pending.blendBoundaryMs &&
          _musicBlendSession.sourceMode === mode) {
        _musicBlendSession.sourceMode = previousBlendSource;
      }
      console.warn(`[playlist] flush failed: ${result.reason}`);
      // For an ordinary boundary/lane switch, retain the request for the next
      // natural track boundary. Weighted-blend decisions are recalculated from
      // the current clock instead of replaying a stale percentage choice.
      if (_roomOwner === "radio" && !_pendingPlaylistSwitch) {
        if (pending.blendBoundaryMs) {
          const liveBlend = timeblocks.getMusicBlendState(new Date());
          if (liveBlend && liveBlend.boundaryMs === pending.blendBoundaryMs && _musicBlendSession) {
            _musicBlendSession.lastDecisionKey = "";
          }
        } else {
          _pendingPlaylistSwitch = { ...pending, queuedAt: Date.now(), reason: `${pending.reason} retry` };
        }
      }
    }
  });
  _pendingPlaylistSwitch = null;
}

// Current video file path — kept server-side only, never sent to browser via /state
let _currentVideoPath = "";

// ── Plexamp pause/resume ──────────────────────────────────────────────────────
// Only pause Plexamp if it was actively playing when video started.
// Only resume if RSVP Radio was the one that paused it.
//
// Client-ID precedence:
//   1. PLEXAMP_CLIENT_IDENTIFIER (env, dedicated)
//   2. cfg.PLEX_TARGET_CLIENT_IDENTIFIER (the configured Pi client ID)
//
// Video handoff token: pause/resume requests are asynchronous and can
// complete out of order relative to the actual video state. The token
// solves this:
//   - Every state transition (video start, end, fail) increments the token.
//   - Pause callbacks capture the token when issued and check it on completion.
//   - If the token has changed by the time a pause lands, the pause is stale.
//     The function issues a corrective RESUME — because the actual command
//     already hit Plex and Plexamp is now paused. Without this corrective
//     step, late pauses would silently leave Plexamp paused with no flag set.
const PLEXAMP_PI_ID =
  process.env.PLEXAMP_CLIENT_IDENTIFIER ||
  cfg.PLEX_TARGET_CLIENT_IDENTIFIER ||
  "";
const PLEXAMP_BASE = process.env.PLEXAMP_BASE || "http://localhost:32500";
// Playback COMMANDS (pause/resume/stop) go DIRECT to Plexamp here, not via
// PLEX_BASE (:32400). The PMS->Plexamp relay stops registering the client after
// an SD reflash, silently dropping every resume-after-video. Verified on-device:
// play to :32500 returns 200 and Plexamp actually plays.
let _plexampPausedByRsvp = !!_persistedRuntime.plexampPausedByRsvp;
let _wasVideoMode        = !!_persistedRuntime.wasVideoMode;
let _videoHandoffToken   = 0; // incremented on every video state transition

function _bumpVideoHandoffToken() {
  return ++_videoHandoffToken;
}

async function _checkPlexampPlaying() {
  if (!PLEXAMP_PI_ID) return false;
  try {
    const url = `${cfg.PLEX_BASE}/status/sessions?X-Plex-Token=${encodeURIComponent(cfg.PLEX_TOKEN)}`;
    const r   = await fetchWithTimeout(url, 2000);
    if (!r.ok) return false;
    const xml = await r.text();
    // When PLEXAMP_PI_ID is set, only count this client as playing.
    // Avoids picking up Plexamp on a phone or another Pi as if it were ours.
    return plexParser.isPlexampPlaying(xml, { plexampClientId: PLEXAMP_PI_ID });
  } catch { return false; }
}

async function plexampPauseIfPlaying(token) {
  // If the caller did not pass a handoff token, capture the current one.
  // Tokens are only meaningful when invalidated by a later state transition.
  const myToken = token === undefined ? _videoHandoffToken : token;

  const isPlaying = await _checkPlexampPlaying();
  if (!isPlaying) return;
  try {
    const url = `${PLEXAMP_BASE}/player/playback/pause?X-Plex-Token=${encodeURIComponent(cfg.PLEX_TOKEN)}&X-Plex-Target-Client-Identifier=${encodeURIComponent(PLEXAMP_PI_ID)}&X-Plex-Client-Identifier=rsvp-radio&commandID=${Date.now()}`;
    const r = await fetchWithTimeout(url, 3000);
    if (!r.ok) {
      console.warn(`[plexamp] pause failed HTTP ${r.status} — not marking paused`);
      return;
    }
    // Pause command succeeded. Check whether it's still relevant.
    if (myToken !== _videoHandoffToken) {
      // The video state has moved on (ended, failed, or another transition fired).
      // The pause already landed on Plex though — Plexamp is now paused. We
      // must issue a corrective resume to undo it, otherwise we leave Plexamp
      // silently paused with _plexampPausedByRsvp=false (no one would resume it).
      console.warn("[plexamp] late pause landed after video state changed — issuing corrective resume");
      try {
        const resumeUrl = `${PLEXAMP_BASE}/player/playback/play?X-Plex-Token=${encodeURIComponent(cfg.PLEX_TOKEN)}&X-Plex-Target-Client-Identifier=${encodeURIComponent(PLEXAMP_PI_ID)}&X-Plex-Client-Identifier=rsvp-radio&commandID=${Date.now()}`;
        const rr = await fetchWithTimeout(resumeUrl, 3000);
        // If the corrective resume fails, retain ownership so the next poll can retry.
        // (Plex 4xx/5xx, client unavailable), we cannot silently abandon
        // recovery — Plexamp would stay paused with no flag set, no retry.
        // Set _plexampPausedByRsvp=true so the next normal trigger (parse-null
        // branch, /video-failed, manual mode change) will re-attempt resume
        // through the guarded plexampResumeIfWePaused path.
        if (!rr.ok) {
          console.warn(`[plexamp] corrective resume failed HTTP ${rr.status} — setting paused-by-rsvp flag for retry`);
          _setPlexampPausedByRsvp(true);
        }
      } catch (e) {
        // Same reasoning for network/timeout errors — preserve recovery state.
        console.warn("[plexamp] corrective resume failed:", e.message, "— setting paused-by-rsvp flag for retry");
        _setPlexampPausedByRsvp(true);
      }
      return;
    }
    _setPlexampPausedByRsvp(true);
    console.log("[plexamp] paused by RSVP for video mode");
  } catch (err) {
    console.warn("[plexamp] pause failed:", err.message);
  }
}

async function plexampResumeIfWePaused() {
  if (!_plexampPausedByRsvp) return;
  if (!PLEXAMP_PI_ID) {
    console.warn("[plexamp] cannot resume: Plexamp client identifier is not configured");
    return;
  }
  // Resume-from-paused STALLS on Plexamp after a reflash (cold cache: ~30-60s
  // of silence before audio actually starts). skipNext is INSTANT. So instead
  // of un-pausing the stuck track, we skip to the next track (which starts
  // playing immediately) and then send play to guarantee a playing state on
  // builds where skipNext preserves the paused flag. Tradeoff: we advance one
  // track rather than resuming the exact paused song — acceptable for
  // background music coming back after a video set.
  const mk = (cmd) => `${PLEXAMP_BASE}/player/playback/${cmd}?X-Plex-Token=${encodeURIComponent(cfg.PLEX_TOKEN)}&X-Plex-Target-Client-Identifier=${encodeURIComponent(PLEXAMP_PI_ID)}&X-Plex-Client-Identifier=rsvp-radio&commandID=${Date.now()}`;
  try {
    const r = await fetchWithTimeout(mk("skipNext"), 3000);
    // Only clear the flag after Plex confirms the command succeeded. If we
    // cleared optimistically and it failed, Plexamp would stay paused and we'd
    // never retry — silent dead-air.
    if (!r.ok) {
      console.warn(`[plexamp] resume (skipNext) failed HTTP ${r.status} — keeping paused-by-rsvp flag for retry`);
      return;
    }
    // Best-effort: ensure playing (not paused) state. Non-fatal if it fails.
    try { await fetchWithTimeout(mk("play"), 3000); } catch (_) {}
    _setPlexampPausedByRsvp(false);
    console.log("[plexamp] resumed (skipNext) by RSVP after video mode");
  } catch (err) {
    console.warn("[plexamp] resume failed:", err.message, "— keeping paused-by-rsvp flag for retry");
  }
}

// ============================================================================
// Admin-triggered local video mode (Pi-local, sticky)
// ----------------------------------------------------------------------------
// Video is triggered from the ADMIN panel (not Plex Web on the Mac). It plays
// through the kiosk's own <video> element via /media/:ratingKey (local files),
// auto-advances through the chosen playlist, and LOOPS -- it keeps playing
// video until Plexamp is started, which is the ONLY override. Because the
// SERVER started video, it never guesses video state from a Plex session:
// while _videoMode.active, the poll SYNTHESIZES lastState from the current clip
// instead of reading /status/sessions.
//
// Sticky transitions:
//   admin picks a video playlist  -> video ON  (Plexamp paused)
//   our Plexamp starts playing    -> video OFF (music wins, stays music)
//   clip ends (frontend beacon)   -> advance to next clip (loop at end)
// ============================================================================
const _savedVideoMode = _persistedRuntime.videoMode;
let _roomOwner = _savedVideoMode ? "tv" : "radio"; // sticky: only explicit start of the other medium changes this
let _pendingVideoMode = null;

let _videoMode = _savedVideoMode ? {
  ..._savedVideoMode,
  index: Math.min(_savedVideoMode.index || 0, Math.max(0, _savedVideoMode.clips.length - 1)),
} : {
  active:        false,
  playlistKey:   "",
  playlistTitle: "",
  clips:         [],
  index:         0,
  mode:          "",
  startedAt:     0,
  paused:        false,
  manualUntil:   0,
};
if (_videoMode.active) _wasVideoMode = true;

// Radio may reclaim the room only after TV takeover has observed Plexamp in a
// definite non-playing state. A persisted TV session starts disarmed so a stale
// "playing" timeline after reboot cannot instantly kill TV.
let _radioTakeoverArmed = !_videoMode.active;

function _isManualVideoActive() {
  const until = Number(_videoMode.manualUntil) || 0;
  if (!_videoMode.active || !until) return false;
  if (Date.now() < until) return true;
  console.log(`[video-mode] manual TV override expired (was ${_videoMode.mode})`);
  _videoMode.manualUntil = 0;
  _persistRuntimeState();
  return false;
}

// Internal weighted handoffs may move back and forth between old/new video
// genres during the 20-minute blend. Preserve the next clip position per
// playlist so returning to a genre does not keep replaying clip #1.
const _videoPlaylistResumeIndex = new Map(
  Object.entries(_persistedRuntime.videoResumeIndex || {}).map(([key, value]) => [String(key), value]),
);

function _persistRuntimeState() {
  runtimeState.save({
    plexampPausedByRsvp: _plexampPausedByRsvp,
    wasVideoMode: _wasVideoMode,
    lightsEnabled: typeof _lightsEnabled === "boolean" ? _lightsEnabled : true,
    lightsScene: typeof _lightsScene === "string" ? _lightsScene : "",
    seedMode: _seedMode ? { ..._seedMode } : null,
    manualMode: _manualMode ? { ..._manualMode } : null,
    manualLights: _manualLights ? { ..._manualLights } : null,
    automation: { ..._automation },
    videoMode: _videoMode.active ? { ..._videoMode } : null,
    videoResumeIndex: Object.fromEntries(_videoPlaylistResumeIndex),
  });
}

function _setPlexampPausedByRsvp(value) {
  _plexampPausedByRsvp = !!value;
  _persistRuntimeState();
}

// Set when admin explicitly stops video — tells the frontend to exit video
// immediately and skip the 12s between-clips grace. Auto-expires.
let _videoStopSignal = 0;

// Lights seed: the FIRST song of a session sets the light color by its genre,
// and holds until the next scheduled Hue handoff begins.
// This is decoupled from the schedule/playlist mode on purpose — lights follow
// the opening song's vibe; music keeps following the timeblock schedule.
// Shape: { mode, expiresAt }.
let _seedMode = (_persistedRuntime.seedMode && _persistedRuntime.seedMode.expiresAt > Date.now())
  ? { ..._persistedRuntime.seedMode }
  : null;
let _videoMeta = null; // cached metadata for the current video clip
function _isSeedActive() {
  if (!_seedMode) return false;
  if (Date.now() < _seedMode.expiresAt) return true;
  _seedMode = null;
  _persistRuntimeState();
  return false;
}

function _xmlDecodeAttr(str) {
  return plexParser.decodeXmlEntities(str);
}

function _videoPlaylistMode(title) {
  const t = String(title || "").toLowerCase();
  if (/r&b|rnb|soul|quiet storm|slow jam|wind ?down|last call/.test(t)) return "rnb";
  if (/rap|trap|hip ?hop|drill|club|party|twerk|bounce/.test(t))        return "rap";
  if (/lounge|cocktail|dinner|daytime|pop|dance|edm|funk|house/.test(t)) return "lounge";
  if (/lo-?fi|chill|jazz|ambient|study|focus/.test(t))                  return "lofi";
  return blockModeForNow();
}

async function fetchVideoPlaylists() {
  try {
    const url = `${cfg.PLEX_BASE}/playlists?X-Plex-Token=${encodeURIComponent(cfg.PLEX_TOKEN)}`;
    const r = await fetchWithTimeout(url, 4000);
    if (!r.ok) return [];
    const xml = await r.text();
    const out = [];
    const re = /<Playlist\b([^>]*?)\/?>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const attrs = m[1];
      if (!/playlistType="video"/i.test(attrs)) continue;
      const keyM   = /ratingKey="(\d+)"/i.exec(attrs);
      const titleM = /\btitle="([^"]*)"/i.exec(attrs);
      if (keyM) out.push({ ratingKey: keyM[1], title: titleM ? _xmlDecodeAttr(titleM[1]) : keyM[1] });
    }
    return out;
  } catch (e) {
    console.warn("[video-mode] fetchVideoPlaylists failed:", e.message);
    return [];
  }
}

async function fetchVideoPlaylistItems(playlistKey) {
  try {
    const url = `${cfg.PLEX_BASE}/playlists/${encodeURIComponent(playlistKey)}/items?X-Plex-Token=${encodeURIComponent(cfg.PLEX_TOKEN)}`;
    const r = await fetchWithTimeout(url, 5000);
    if (!r.ok) return [];
    const xml = await r.text();
    const out = [];
    const re = /<Video\b([^>]*?)>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const attrs = m[1];
      const keyM   = /ratingKey="(\d+)"/i.exec(attrs);
      const titleM = /\btitle="([^"]*)"/i.exec(attrs);
      if (keyM) out.push({ ratingKey: keyM[1], title: titleM ? _xmlDecodeAttr(titleM[1]) : keyM[1] });
    }
    return out;
  } catch (e) {
    console.warn("[video-mode] fetchVideoPlaylistItems failed:", e.message);
    return [];
  }
}

async function _plexampStateDirect() {
  if (!PLEXAMP_PI_ID) return "unknown";
  try {
    const url = `${PLEXAMP_BASE}/player/timeline/poll?wait=0&commandID=${Date.now()}`
      + `&X-Plex-Client-Identifier=rsvp-radio`
      + `&X-Plex-Target-Client-Identifier=${encodeURIComponent(PLEXAMP_PI_ID)}`;
    const r = await fetchWithTimeout(url, 2000);
    if (!r.ok) return "unknown";
    const xml = await r.text();
    const tl = xml.match(/<Timeline\b[^>]*\btype="music"[^>]*>/i);
    if (!tl) return "stopped";
    const stateM = /\bstate="([^"]+)"/i.exec(tl[0]);
    return stateM ? String(stateM[1]).toLowerCase() : "stopped";
  } catch {
    return "unknown";
  }
}

async function _waitForPlexampNotPlaying({ timeoutMs = 4000, pollMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const state = await _plexampStateDirect();
    if (state !== "unknown" && state !== "playing") return true;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}

async function _plexampPauseDirect({ preserveExistingPause = false } = {}) {
  const directState = await _plexampStateDirect();
  if (directState === "unknown") {
    console.warn("[video-mode] cannot confirm Plexamp state before TV takeover");
    return false;
  }
  const wasPlaying = directState === "playing";
  if (!wasPlaying) {
    // Switching from one RSVP TV lane/genre to another must not erase the fact
    // that RSVP already paused Plexamp. That flag is needed for video-failure
    // recovery. On a fresh TV start, however, silence means RSVP paused nothing.
    if (!preserveExistingPause) _setPlexampPausedByRsvp(false);
    return true;
  }
  try {
    const url = `${PLEXAMP_BASE}/player/playback/pause?X-Plex-Token=${encodeURIComponent(cfg.PLEX_TOKEN)}&X-Plex-Target-Client-Identifier=${encodeURIComponent(PLEXAMP_PI_ID)}&X-Plex-Client-Identifier=rsvp-radio&commandID=${Date.now()}`;
    const r = await fetchWithTimeout(url, 3000);
    if (!r.ok) {
      console.warn(`[video-mode] Plexamp pause HTTP ${r.status}`);
      return false;
    }
    _setPlexampPausedByRsvp(true);
    console.log("[video-mode] paused Plexamp for video");
    return true;
  } catch (e) {
    console.warn("[video-mode] Plexamp pause failed:", e.message);
    return false;
  }
}

async function enterVideoMode(playlistKey, {
  allowBlendMode = false,
  preservePosition = false,
  atClipBoundary = false,
  manualOverride = false,
} = {}) {
  const clips = await fetchVideoPlaylistItems(playlistKey);
  if (!clips.length) return { ok: false, reason: "empty_or_unreadable_playlist" };

  let title = String(playlistKey);
  try {
    const all = await fetchVideoPlaylists();
    const found = all.find(p => p.ratingKey === String(playlistKey));
    if (found) title = found.title;
  } catch (_) {}

  const playlistMode = _videoPlaylistMode(title);
  const roomMode = _isManualActive() ? _manualMode.mode : blockModeForNow();
  const activeBlend = (!_isManualActive() && _automation.enabled)
    ? timeblocks.getMusicBlendState(new Date())
    : null;
  const blendAllows = !!(allowBlendMode && activeBlend &&
    (playlistMode === activeBlend.fromMode || playlistMode === activeBlend.toMode));
  if (!manualOverride && playlistMode !== roomMode && !blendAllows) {
    return { ok: false, reason: `playlist_outside_current_block:${playlistMode}:${roomMode}` };
  }

  const previous = _videoMode;
  const switchingPlaylist = previous.active && previous.playlistKey && previous.playlistKey !== String(playlistKey);
  if (preservePosition && switchingPlaylist && previous.clips.length) {
    const resumeIndex = atClipBoundary
      ? (previous.index + 1) % previous.clips.length
      : previous.index;
    _videoPlaylistResumeIndex.set(previous.playlistKey, resumeIndex);
  }

  // Handoff is atomic from the system's perspective: silence Radio first, then
  // publish TV ownership. Preserve the pause flag when TV already owns playback.
  //
  // On a fresh Radio -> TV handoff, do not publish TV until the direct Plexamp
  // receiver has actually reported a non-playing state. This prevents the
  // previous "bounce" where a stale playing timeline was mistaken for a human
  // Radio override immediately after RSVP itself sent Pause.
  const freshTakeover = !previous.active;
  if (freshTakeover) _radioTakeoverArmed = false;
  if (!await _plexampPauseDirect({ preserveExistingPause: previous.active })) {
    return { ok: false, reason: "plexamp_pause_failed" };
  }
  if (freshTakeover && !await _waitForPlexampNotPlaying()) {
    console.warn("[video-mode] Plexamp pause did not settle; keeping Radio ownership");
    // This was never a completed TV handoff, so do NOT use the normal
    // resume-after-video path (it intentionally skipNexts). If Plexamp is still
    // playing, the pause never took and there is nothing to recover. If the
    // receiver is unreachable, keep the paused-by-RSVP flag so the ordinary
    // recovery loop can repair a pause that may have landed.
    const failedState = await _plexampStateDirect();
    if (failedState === "playing") _setPlexampPausedByRsvp(false);
    return { ok: false, reason: "plexamp_pause_unconfirmed" };
  }
  if (freshTakeover) _radioTakeoverArmed = true;

  // TV owns playback now. Any queued/active Radio blend decision was calculated
  // for a medium that is no longer playing and must never fire later as stale work.
  _pendingPlaylistSwitch = null;
  _musicBlendSession = null;

  const savedIndex = preservePosition ? _videoPlaylistResumeIndex.get(String(playlistKey)) : undefined;
  const startIndex = Number.isInteger(savedIndex) && savedIndex >= 0 && savedIndex < clips.length ? savedIndex : 0;
  const manualUntil = manualOverride
    ? timeblocks.getNextBoundaryMs(new Date())
    : (previous.active && Number(previous.manualUntil) > Date.now() ? Number(previous.manualUntil) : 0);

  _videoMode = {
    active:        true,
    playlistKey:   String(playlistKey),
    playlistTitle: title,
    clips,
    index:         startIndex,
    mode:          playlistMode,
    startedAt:     Date.now(),
    paused:        false,
    manualUntil,
  };
  _roomOwner = "tv";
  _wasVideoMode = true;
  _videoStopSignal = 0;
  _videoMeta = null;
  _bumpVideoHandoffToken();
  _persistRuntimeState();
  console.log(`[video-mode] ON -> "${title}" (${clips.length} clips), lights=${_videoMode.mode}${manualUntil ? `, manual-until=${new Date(manualUntil).toISOString()}` : ""}`);
  return { ok: true, clips: clips.length, title, mode: _videoMode.mode, manualUntil };
}

async function _switchVideoToMode(mode, options = {}) {
  const playlists = (await fetchVideoPlaylists()).filter((p) => _videoPlaylistMode(p.title) === mode);
  if (!playlists.length) return false;
  const preferred = playlists.find((p) => p.ratingKey !== _videoMode.playlistKey) || playlists[0];
  const r = await enterVideoMode(preferred.ratingKey, options);
  return !!r.ok;
}

let _videoSkipPressure = { count: 0, lastRatingKey: "", lastAt: 0 };

async function _steerVideoLaneAfterSkip(ratingKey) {
  const now = Date.now();
  if (_videoSkipPressure.lastAt && now - _videoSkipPressure.lastAt > 10 * 60 * 1000) _videoSkipPressure.count = 0;
  if (ratingKey && ratingKey !== _videoSkipPressure.lastRatingKey) _videoSkipPressure.count += 1;
  _videoSkipPressure.lastRatingKey = ratingKey || "";
  _videoSkipPressure.lastAt = now;
  if (_videoSkipPressure.count < 2) return false;

  // Steer laterally inside the genre the current video lane actually belongs to.
  // During a weighted blend that may be the incoming genre before the clock
  // reaches the hard boundary.
  const mode = _videoMode.mode || (_isManualActive() ? _manualMode.mode : blockModeForNow());
  const playlists = (await fetchVideoPlaylists()).filter((p) => _videoPlaylistMode(p.title) === mode);
  if (playlists.length < 2) { _videoSkipPressure.count = 0; return false; }
  const current = playlists.findIndex((p) => p.ratingKey === _videoMode.playlistKey);
  const next = playlists[(current < 0 ? 0 : current + 1) % playlists.length];
  _videoSkipPressure = { count: 0, lastRatingKey: "", lastAt: 0 };
  if (!next || next.ratingKey === _videoMode.playlistKey) return false;
  const r = await enterVideoMode(next.ratingKey, {
    allowBlendMode: true,
    preservePosition: true,
    atClipBoundary: true,
  });
  if (r.ok) console.log(`[video-mode] skip pressure steered ${mode} -> "${next.title}"`);
  return !!r.ok;
}

async function advanceVideoMode({ skipped = false } = {}) {
  if (!_videoMode.active || !_videoMode.clips.length) return;
  const finished = _videoMode.clips[_videoMode.index];

  // Settle reputation for the clip that actually ended BEFORE switching lanes
  // or genres. The old code changed playlists first when a boundary was pending,
  // which silently lost the completed clip's play record.
  if (finished && finished.ratingKey) {
    const item = { ratingKey: finished.ratingKey, title: finished.title, artist: _videoMode.playlistTitle };
    try {
      if (skipped) videoSkipTracker.recordSkip(item, 0);
      else videoSkipTracker.recordPlay(item);
    } catch (_) {}

    const manualVideoActive = _isManualVideoActive();

    // Two skips steer laterally inside the CURRENT video genre/lane family.
    // An explicit admin-picked TV playlist is sticky until its boundary expiry.
    if (skipped && _automation.enabled && !manualVideoActive && await _steerVideoLaneAfterSkip(finished.ratingKey)) return;
    if (!skipped) _videoSkipPressure = { count: 0, lastRatingKey: "", lastAt: 0 };  }

  const manualVideoActive = _isManualVideoActive();
  if (_automation.enabled && !_isManualActive() && !manualVideoActive) {
    const blend = timeblocks.getMusicBlendState(new Date());
    const targetMode = videoBlendPolicy.chooseNextVideoMode({
      currentMode: _videoMode.mode,
      blendState: blend,
      pendingMode: _pendingVideoMode,
      automationEnabled: _automation.enabled,
      manualActive: false,
    });

    if (blend) _pendingVideoMode = null;
    else if (_pendingVideoMode) _pendingVideoMode = null;

    if (targetMode && targetMode !== _videoMode.mode) {
      const moved = await _switchVideoToMode(targetMode, {
        allowBlendMode: !!blend,
        preservePosition: true,
        atClipBoundary: true,
      });
      if (moved) {
        if (blend) console.log(`[video-mode] weighted blend ${blend.oldPct}/${blend.newPct} -> ${targetMode}`);
        return;
      }
    }
  }

  _videoMode.index = (_videoMode.index + 1) % _videoMode.clips.length;
  _videoMode.startedAt = Date.now();
  _videoMode.paused = false;
  _videoMeta = null;
  _persistRuntimeState();
  const next = _videoMode.clips[_videoMode.index];
  console.log(`[video-mode] advance -> [${_videoMode.index + 1}/${_videoMode.clips.length}] "${(next && (next.title || next.ratingKey)) || "?"}"`);
}

// Step BACK one clip (operator "previous"). Unlike advance, this does not record
// a play for the current clip — going back isn't a completed listen. Resumes
// playing so the previous clip starts immediately.
function prevVideoMode() {
  if (!_videoMode.active || !_videoMode.clips.length) return;
  const len = _videoMode.clips.length;
  _videoMode.index = (_videoMode.index - 1 + len) % len;
  _videoMode.startedAt = Date.now();
  _videoMode.paused = false;
  _videoMeta = null;
  _persistRuntimeState();
  const prev = _videoMode.clips[_videoMode.index];
  console.log(`[video-mode] prev -> [${_videoMode.index + 1}/${len}] "${(prev && (prev.title || prev.ratingKey)) || "?"}"`);
}

function setVideoPaused(paused) {
  if (!_videoMode.active) return false;
  _videoMode.paused = !!paused;
  _persistRuntimeState();
  console.log(`[video-mode] ${_videoMode.paused ? "paused" : "resumed"} [${_videoMode.index + 1}/${_videoMode.clips.length}]`);
  return true;
}

async function exitVideoMode(reason) {
  if (!_videoMode.active) return;
  console.log(`[video-mode] OFF (${reason})`);
  _videoMode.active = false;
  _videoMode.manualUntil = 0;
  _wasVideoMode = false;
  _radioTakeoverArmed = false;
  _bumpVideoHandoffToken();
  if (reason === "plexamp-override") {
    // Human explicitly started Radio; that explicit start owns the handoff.
    _roomOwner = "radio";
    _setPlexampPausedByRsvp(false);
  } else {
    if (reason === "admin-stop") _videoStopSignal = Date.now();
    // Sticky ownership: stopping TV leaves TV active/silent. Radio returns
    // only when a human explicitly starts Plexamp.
    _setPlexampPausedByRsvp(false);
  }
  _persistRuntimeState();
}

// Fetch + parse a video clip's display metadata. Video clips are <Video> items
// whose title tag is INCONSISTENT (sometimes clean "CHANEL", sometimes the full
// "Artist - Title (Club)"). The file path is the most reliable source and
// usually follows "Artist - Title (Clean|Dirty|Club).ext", so we parse that
// FIRST:
//   line 1 (title)  = part after the first " - ", trailing "(...)" tag stripped
//   line 2 (artist) = part before the first " - "
//   line 3 (album)  = the playlist name (set by the caller)
//
// Anything the filename does not supply (e.g. clips not following the naming
// convention, or where Plex exposes the item as <Track> rather than <Video>)
// falls back to the element's tag attributes — title and grandparentTitle —
// so the card never shows a blank artist when Plex actually knows it.
async function _fetchVideoMeta(ratingKey) {
  try {
    const url = `${cfg.PLEX_BASE}/library/metadata/${encodeURIComponent(ratingKey)}?X-Plex-Token=${encodeURIComponent(cfg.PLEX_TOKEN)}`;
    const r = await fetchWithTimeout(url, 3000);
    if (!r.ok) return null;
    const xml = await r.text();
    // Match whichever metadata element Plex returns — <Video> for video items,
    // but some libraries (and the test stub) expose it as <Track>.
    const item = (xml.match(/<(?:Video|Track)\b[^>]*>/i) || [""])[0];
    const attr = (seg, re) => { const m = re.exec(seg); return m ? _xmlDecodeAttr(m[1]) : ""; };
    const tagTitle  = attr(item, /\btitle="([^"]*)"/i);
    const tagArtist = attr(item, /\bgrandparentTitle="([^"]*)"/i);
    const thumb     = attr(item, /\bthumb="([^"]*)"/i) || attr(item, /\bart="([^"]*)"/i);
    const partFile  = attr(xml, /<Part\b[^>]*\bfile="([^"]*)"/i);

    // Filename-first parse.
    let artist = "", title = "";
    if (partFile) {
      const base = partFile.replace(/^.*[\/\\]/, "").replace(/\.[^.]+$/, "");
      const i = base.indexOf(" - ");
      if (i !== -1) {
        artist = base.slice(0, i).trim();
        // strip trailing "(Clean)/(Dirty)/(Club)/..." tag(s) and collapse spaces
        title  = base.slice(i + 3).trim().replace(/(\s*\([^)]*\))+\s*$/, "").replace(/\s{2,}/g, " ").trim();
      } else {
        title = base; // no "Artist - Title" convention — keep basename as title
      }
    }

    // Tag fallbacks for anything the filename did not give us.
    if (!artist) artist = tagArtist;
    if (!title)  title  = tagTitle;

    const duration = parseInt(attr(xml, /<Part\b[^>]*\bduration="(\d+)"/i) || attr(item, /\bduration="(\d+)"/i) || "0", 10) || 0;
    return { ratingKey: String(ratingKey), title: title || "Video", artist, thumb, duration };
  } catch { return null; }
}

async function _videoModeState({ bass, energy }) {
  const clip = _videoMode.clips[_videoMode.index] || {};
  const ratingKey = clip.ratingKey || "";
  const mode = _videoMode.mode || blockModeForNow();

  // Pull the clip's real metadata. Title/artist come from the file path
  // (parsed in _fetchVideoMeta); the playlist name is line 3 (album). Cache per
  // clip so we don't re-fetch every 2s poll while the same clip plays.
  let meta = null;
  if (ratingKey) {
    if (_videoMeta && _videoMeta.ratingKey === ratingKey) meta = _videoMeta;
    else { meta = await _fetchVideoMeta(ratingKey); _videoMeta = meta; }
  }
  const plexArt = meta ? buildPlexArtUrl(meta.thumb) : "";
  const paused  = !!_videoMode.paused;
  const manualVideoActive = _isManualVideoActive();

  return {
    appState: paused ? "VIDEO_PAUSED" : "VIDEO_PLAYING",
    media: {
      type:         "video",
      playerState:  paused ? "paused" : "playing",
      title:        (meta && meta.title)  || clip.title || "Video",   // line 1: song
      artist:       (meta && meta.artist) || "",                       // line 2: artist
      album:        _videoMode.playlistTitle || "",                    // line 3: playlist
      ratingKey,
      artUrl:       plexArt ? `/art?url=${encodeURIComponent(plexArt)}` : "",
      mediaUrl:     ratingKey ? `/media/${ratingKey}` : "",
      viewOffsetMs: 0,
      durationMs:   (meta && meta.duration) || 0,
    },
    mode:         {
      current: mode,
      source: manualVideoActive ? "manual" : "video-session",
      manualExpiresAt: manualVideoActive ? (Number(_videoMode.manualUntil) || 0) : 0,
    },
    video:        { phase: paused ? "paused" : "playing" },
    intelligence: { strikes: 0, softStrikes: 0, rating: 10, lastPlayPercent: null },
    plexamp:      { pausedByRsvpVideo: _plexampPausedByRsvp },
    music: {
      desiredPlaylist:       "",
      lastCommandedPlaylist: _lastCommandedPlaylist,
      commandAligned:        true,
    },
    steering:     _steering.snapshot(),
    automation:   { ..._automation },
    features:     { bass, energy },
    updatedAt:    Date.now(),
    error:        "",
    videoMode: {
      playlist: _videoMode.playlistTitle,
      index:    _videoMode.index,
      total:    _videoMode.clips.length,
      paused,
    },
  };
}

// ============================================================================
// Now-playing card fallback for cached Plexamp playback
// ----------------------------------------------------------------------------
// When Plexamp plays library content that was loaded from its own cache, Plex
// /status/sessions can report size=0 -- the server is blind to it, so the card
// vanishes even though music is playing. Plexamp's OWN timeline on :32500 still
// reports the track. So when sessions look empty, we consult the timeline and,
// if it is genuinely playing, fetch the track metadata and build the card from
// it. This is display-only: it does NOT drive skip-tracking (that stays on the
// real-session path) so there is no risk of double-counting.
// ============================================================================
async function _plexampTimelineState() {
  const empty = { playing: false, ratingKey: "", viewOffsetMs: 0, durationMs: 0 };
  if (!PLEXAMP_PI_ID) return empty;
  try {
    const url = `${PLEXAMP_BASE}/player/timeline/poll?wait=0&commandID=${Date.now()}`
      + `&X-Plex-Client-Identifier=rsvp-radio`
      + `&X-Plex-Target-Client-Identifier=${encodeURIComponent(PLEXAMP_PI_ID)}`;
    const r = await fetchWithTimeout(url, 2000);
    if (!r.ok) return empty;
    const xml = await r.text();
    const tl = xml.match(/<Timeline\b[^>]*\btype="music"[^>]*>/i);
    if (!tl) return empty;
    const seg = tl[0];
    const get = (re) => { const m = re.exec(seg); return m ? m[1] : ""; };
    return {
      playing:      get(/\bstate="([^"]+)"/i) === "playing",
      ratingKey:    get(/\bratingKey="(\d+)"/i),
      viewOffsetMs: parseInt(get(/\btime="(\d+)"/i) || "0", 10) || 0,
      durationMs:   parseInt(get(/\bduration="(\d+)"/i) || "0", 10) || 0,
    };
  } catch { return empty; }
}

async function _fetchTrackMeta(ratingKey) {
  try {
    const url = `${cfg.PLEX_BASE}/library/metadata/${encodeURIComponent(ratingKey)}?X-Plex-Token=${encodeURIComponent(cfg.PLEX_TOKEN)}`;
    const r = await fetchWithTimeout(url, 3000);
    if (!r.ok) return null;
    const xml = await r.text();
    const seg = (xml.match(/<Track\b[^>]*>/i) || xml.match(/<Directory\b[^>]*>/i) || [""])[0];
    if (!seg) return null;
    const get = (re) => { const m = re.exec(seg); return m ? _xmlDecodeAttr(m[1]) : ""; };
    const title  = get(/\btitle="([^"]*)"/i);
    if (!title) return null;
    return {
      ratingKey: String(ratingKey),
      title,
      artist:   get(/\bgrandparentTitle="([^"]*)"/i) || get(/\bparentTitle="([^"]*)"/i),
      album:    get(/\bparentTitle="([^"]*)"/i),
      thumb:    get(/\bthumb="([^"]*)"/i) || get(/\bparentThumb="([^"]*)"/i) || get(/\bgrandparentThumb="([^"]*)"/i),
      duration: parseInt(get(/\bduration="(\d+)"/i) || "0", 10) || 0,
    };
  } catch { return null; }
}

function _plexampFallbackState({ bass, energy, meta, tl }) {
  const timeBlockMode = blockModeForNow();
  let modeCurrent = timeBlockMode, modeSource = "timeblock", manualExpiresAt = 0;
  if (_isManualActive()) {
    modeCurrent = _manualMode.mode; modeSource = "manual"; manualExpiresAt = _manualMode.expiresAt;
  }
  const plexArt = buildPlexArtUrl(meta.thumb);
  const desired = playlistCtl.playlistKeyForMode(modeCurrent, cfg);
  return {
    appState: deriveAppState("playing", false),
    media: {
      type:         "audio",
      playerState:  "playing",
      title:        meta.title,
      artist:       meta.artist,
      album:        meta.album,
      ratingKey:    meta.ratingKey,
      artUrl:       plexArt ? `/art?url=${encodeURIComponent(plexArt)}` : "",
      mediaUrl:     "",
      viewOffsetMs: tl.viewOffsetMs || 0,
      durationMs:   tl.durationMs || meta.duration || 0,
    },
    mode:         { current: modeCurrent, source: modeSource, manualExpiresAt },
    video:        { phase: "none" },
    intelligence: _computeIntelligence(meta.ratingKey, null),
    plexamp:      { pausedByRsvpVideo: _plexampPausedByRsvp },
    music: {
      desiredPlaylist:       desired,
      lastCommandedPlaylist: _lastCommandedPlaylist,
      commandAligned:        !desired || desired === _lastCommandedPlaylist,
    },
    steering:     _steering.snapshot(),
    automation:   { ..._automation },
    features:     { bass, energy },
    updatedAt:    Date.now(),
    error:        "",
    plexampFallback: true,
  };
}

// ── Skip detection state ──────────────────────────────────────────────────────
let _prevPollTrack = null; // { ratingKey, title, artist, scrobbled, isVideo }
let _pollInFlight  = false;

// ── Play-count dedup (fixes double redemption) ────────────────────────────────
// A single track-end can be reported by TWO independent paths: the poll's
// clean-play detection (recordSkip with pct >= 0.70 → recordPlay) and the
// Plex /plex webhook's media.scrobble (→ recordPlay). With no dedup, the same
// play was counted twice — plays += 2 AND strikes -= 2, which over-redeems a
// benched song back into rotation. The skip-tracker is a pure counter (its
// unit tests require every recordPlay to count), so dedup lives HERE, at the
// orchestration layer that owns both sources. Keyed by ratingKey + time:
// within PLAY_DEDUP_MS, the second report of the same track-end is dropped.
// Skips are single-source (only the poll records them) so they are NOT gated.
const PLAY_DEDUP_MS = Number(process.env.PLAY_DEDUP_MS) || 15000;
const _recentPlays  = new Map(); // ratingKey -> ts of last counted play
function _playAlreadyCounted(ratingKey) {
  if (!ratingKey) return false;
  const ts = _recentPlays.get(ratingKey);
  return ts !== undefined && (Date.now() - ts) < PLAY_DEDUP_MS;
}
function _markPlayCounted(ratingKey) {
  if (!ratingKey) return;
  const nowTs = Date.now();
  _recentPlays.set(ratingKey, nowTs);
  // Opportunistic prune so the map can't grow unbounded over a long run.
  if (_recentPlays.size > 256) {
    const cutoff = nowTs - PLAY_DEDUP_MS;
    for (const [k, t] of _recentPlays) if (t < cutoff) _recentPlays.delete(k);
  }
}

// Record skip if a known prev track ended without scrobbling and wasn't a video.
// Uses lastState.media.viewOffsetMs / durationMs to compute play percentage.
// Called from idle branches when _prevPollTrack is about to be cleared.
function _maybeRecordStopSkip() {
  if (!_prevPollTrack) return;
  if (_prevPollTrack.scrobbled) return;
  if (_prevPollTrack.isVideo)   return;
  const dur  = lastState.media.durationMs   || 0;
  const view = lastState.media.viewOffsetMs || 0;
  if (dur <= 0 || view <= 0) return;

  const pct = view / dur;
  skipTracker.recordSkip(_prevPollTrack, pct);
  plexSync.syncRating(_prevPollTrack.ratingKey, cfg.PLEX_BASE, cfg.PLEX_TOKEN);
}

// Build an idle-state snapshot. Used in HTTP fail, parse-null, and exception
// branches. Honors active manual override even when idle.
function _idleState({ bass, energy, error }) {
  const timeBlockMode = blockModeForNow();
  let modeCurrent = timeBlockMode;
  let modeSource  = "timeblock";
  let manualExpiresAt = 0;
  if (_isManualActive()) {
    modeCurrent     = _manualMode.mode;
    modeSource      = "manual";
    manualExpiresAt = _manualMode.expiresAt;
  }
  const desired = playlistCtl.playlistKeyForMode(modeCurrent, cfg);
  return {
    appState:     "IDLE",
    owner:        _roomOwner,
    media:        _emptyMedia(),
    mode:         { current: modeCurrent, source: modeSource, manualExpiresAt },
    video:        { phase: (_videoStopSignal && (Date.now() - _videoStopSignal < 6000)) ? "stopped" : "none" },
    intelligence: { strikes: 0, softStrikes: 0, rating: 10, lastPlayPercent: null },
    plexamp:      { pausedByRsvpVideo: _plexampPausedByRsvp },
    music: {
      desiredPlaylist:       desired,
      lastCommandedPlaylist: _lastCommandedPlaylist,
      commandAligned:        !desired || desired === _lastCommandedPlaylist,
    },
    steering:     _steering.snapshot(),
    automation:   { ..._automation },
    features:     { bass, energy },
    updatedAt:    Date.now(),
    error:        error || "",
  };
}

// ── Plex poll ─────────────────────────────────────────────────────────────────
async function pollSessions() {
  if (_pollInFlight) return;
  _pollInFlight = true;

  const { bass, energy } = featuresNow();
  _relayFeaturesToLights(bass, energy);
  const now              = new Date();
  const timeBlockMode    = blockModeForNow();
  const musicBlend       = timeblocks.getMusicBlendState(now);
  _maybeResumeAutomationForBlend(musicBlend);

  try {
    // -- Admin video mode override (Pi-local, sticky) --
    // While video mode is active, the SERVER owns video state. The only thing
    // that ends it is OUR Plexamp actually playing (the user started music).
    if (_videoMode.active) {
      const manualVideoActive = _isManualVideoActive();
      if (_automation.enabled && !_isManualActive() && !manualVideoActive) {
        // During the 20-minute handoff, clip-end weighting owns genre choice.
        // Outside it, queue the canonical block and switch only when the clip ends.
        if (musicBlend) {
          _pendingVideoMode = null;
        } else if (_videoMode.mode !== timeBlockMode) {
          _pendingVideoMode = timeBlockMode;
        }
      }

      const directState = await _plexampStateDirect();
      if (!_radioTakeoverArmed) {
        if (directState !== "unknown" && directState !== "playing") {
          _radioTakeoverArmed = true;
          console.log("[video-mode] Radio takeover armed after confirmed Plexamp non-playing state");
        }
      } else if (directState === "playing") {
        await exitVideoMode("plexamp-override");
        // fall through to the normal parse so music/idle state is reflected
      }

      if (_videoMode.active) {
        lastState = await _videoModeState({ bass, energy });
        return;
      }
    }

    const url = `${cfg.PLEX_BASE}/status/sessions?X-Plex-Token=${encodeURIComponent(cfg.PLEX_TOKEN)}`;
    const r   = await fetchWithTimeout(url, cfg.POLL_TIMEOUT_MS);

    if (!r.ok) {
      // Transient HTTP failure — do NOT record skip-on-stop here. We treat
      // Plex blips as transient. Skip-on-stop fires only in the parse-null
      // branch (a real "Plex says nothing is playing").
      //
      // Also do NOT resume Plexamp here — a single hiccup while a video is
      // playing would dual-audio for ~2s until the next poll re-pauses.
      // Plexamp resume fires only in the parse-null branch (genuine stop).
      _currentVideoPath = "";
      _prevPollTrack    = null;
      lastState = _idleState({ bass, energy, error: `plex_http_${r.status}` });
      return;
    }

    const t = parseSessions(await r.text());

    if (!t || (!t.title && !t.thumb && !t.artist && !t.album)) {
      // Cached-playback card fallback: sessions look empty, but Plexamp may be
      // playing from its own cache. Consult the :32500 timeline; if it is truly
      // playing, build the card from track metadata so it does not vanish.
      if (!_videoMode.active) {
        const tl = await _plexampTimelineState();
        if (tl.playing && tl.ratingKey) {
          const meta = await _fetchTrackMeta(tl.ratingKey);
          if (meta) {
            _maybeRecordStopSkip();          // settle any pending real-session skip
            _prevPollTrack = null;           // fallback path does not skip-track
            _currentVideoPath = "";
            if (_wasVideoMode) { _wasVideoMode = false; _bumpVideoHandoffToken(); }
            lastState = _plexampFallbackState({ bass, energy, meta, tl });
            return;
          }
        }
      }
      // Genuine stop — record skip-on-stop before clearing prev track.
      _maybeRecordStopSkip();
      _currentVideoPath = "";
      _prevPollTrack    = null;
      if (_wasVideoMode) {
        _wasVideoMode = false;
        _bumpVideoHandoffToken();
      }
      // A failed resume keeps ownership persisted. Retry from every genuine
      // idle poll, including after a process restart, until Plexamp confirms
      // recovery instead of allowing permanent dead-air.
      if (_plexampPausedByRsvp) plexampResumeIfWePaused();
      // Clear any pending playlist switch — we don't autoplay from idle.
      // If the user stopped playback, intent is "stop". When they start
      // again later, the timeblock-cross detection re-evaluates and queues
      // a switch then if needed (since _lastBlockMode is preserved through
      // idle). See _lastBlockMode handling in the playing branch below.
      if (_pendingPlaylistSwitch) {
        console.log(`[playlist] dropping pending ${_pendingPlaylistSwitch.mode} switch — playback stopped (no autoplay)`);
        _pendingPlaylistSwitch = null;
      }
      // First-start alignment is handled in the playing branch only.
      // Idle = stay idle. Plexamp is user-controlled; we never wake it up.
      // _firstStartAligned will get set on the first playing poll.
      lastState = _idleState({ bass, energy, error: "" });
      return;
    }

    // If the browser reported this video as unplayable, suppress it until
    // failed via POST /video-failed, treat the session as if it weren't
    // there. Plex may keep reporting the failed video for a few polls
    // before its session list updates; we don't want to flip back into
    // video mode and re-pause Plexamp during that window.
    if (t && t.isVideo && t.ratingKey && _suppressedVideoRatingKey === t.ratingKey) {
      // Behave like parse-null: clear video state, resume Plexamp once.
      // Don't fire skip-on-stop here — the video isn't a track.
      _currentVideoPath = "";
      _prevPollTrack    = null;
      if (_wasVideoMode) {
        _wasVideoMode = false;
        _bumpVideoHandoffToken();
      }
      // A failed resume keeps ownership persisted. Retry from every genuine
      // idle poll, including after a process restart, until Plexamp confirms
      // recovery instead of allowing permanent dead-air.
      if (_plexampPausedByRsvp) plexampResumeIfWePaused();
      lastState = _idleState({ bass, energy, error: "video_suppressed" });
      return;
    }
    // If Plex moved on to a different ratingKey, the suppression is stale.
    if (_suppressedVideoRatingKey && t && t.ratingKey && t.ratingKey !== _suppressedVideoRatingKey) {
      _suppressedVideoRatingKey = "";
    }

    if (!t.isVideo && (t.playerState === "playing" || t.playerState === "paused")) _roomOwner = "radio";

    const plexArt = buildPlexArtUrl(t.thumb);

    // ── Skip detection on track change ───────────────────────────────────────
    // Skip tracking only applies to audio tracks, not music videos.
    // Guard against zero progress (happens when lastState was just reset).
    if (_prevPollTrack && _prevPollTrack.ratingKey !== t.ratingKey) {
      let _wasSkip = false;
      let _wasCleanPlay = false;
      if (!_prevPollTrack.scrobbled && !_prevPollTrack.isVideo &&
          lastState.media.durationMs > 0 && lastState.media.viewOffsetMs > 0) {
        const pct = lastState.media.viewOffsetMs / lastState.media.durationMs;
        // Same thresholds the skip-tracker uses: <40% = skip, >=70% = clean play.
        if (pct >= 0.70) {
          // Clean play → recordSkip routes to recordPlay (plays++, redeem strike).
          // Dedup against a media.scrobble webhook for the same track-end so the
          // play isn't counted (and a strike redeemed) twice.
          if (!_playAlreadyCounted(_prevPollTrack.ratingKey)) {
            skipTracker.recordSkip(_prevPollTrack, pct);
            plexSync.syncRating(_prevPollTrack.ratingKey, cfg.PLEX_BASE, cfg.PLEX_TOKEN);
            _markPlayCounted(_prevPollTrack.ratingKey);
          }
          _wasCleanPlay = true; // steering still sees the clean play even if deduped
        } else {
          // Skip or neutral — single-source (webhooks never record these), no dedup.
          skipTracker.recordSkip(_prevPollTrack, pct);
          plexSync.syncRating(_prevPollTrack.ratingKey, cfg.PLEX_BASE, cfg.PLEX_TOKEN);
          if (pct < 0.40) _wasSkip = true;
        }
      }
      // End-of-track is the boundary we wait on. Never fire a music playlist
      // command while RSVP TV owns playback: entering/changing a video clears
      // stale pending music work. When audio returns, schedule/blend logic below
      // recalculates from the current clock instead of replaying an old decision.
      if (t.isVideo) {
        if (_pendingPlaylistSwitch) {
          console.log(`[playlist] clearing pending music switch while video owns playback (${_pendingPlaylistSwitch.reason || "pending"})`);
          _pendingPlaylistSwitch = null;
        }
      } else {
        _flushPendingPlaylistSwitch("track-change");
      }

      // ── Lateral steering (the brain) ───────────────────────────────────────
      // Only steer audio (never video), only when following the schedule or a
      // manual mode. Skips walk laterally within the current mode; the boundary
      // reset (below) owns vertical moves.
      if (!t.isVideo && _automation.enabled && !musicBlend) {
        const steerMode = _isManualActive() ? _manualMode.mode : timeBlockMode;
        if (_wasCleanPlay) {
          _steering.onCleanPlay();
        } else if (_wasSkip) {
          _steering.onSkip(steerMode, _prevPollTrack.ratingKey).then((nextLane) => {
            if (nextLane) _queueLaneSwitch(nextLane, `${steerMode} skip-steer`);
          }).catch((e) => console.warn(`[steering] onSkip error: ${e.message}`));
        }
      }
    }

    // Update prev track — include isVideo so skip guard works correctly
    if (!_prevPollTrack || _prevPollTrack.ratingKey !== t.ratingKey) {
      _prevPollTrack = { ratingKey: t.ratingKey, title: t.title, artist: t.artist, scrobbled: false, isVideo: t.isVideo || false };
    }

    // ── Mode resolution ──────────────────────────────────────────────────────
    // Priority: manual > timeblock > seed.
    //
    // Manual override is server-owned (set via POST /mode/:mode) and auto-
    // expires at the next scheduled music-blend start. Once playlist switching is
    // configured, timeblock is canonical and seed is fallback only — its role
    // is to catch cases where the user hand-picked a non-RSVP playlist in
    // Plexamp (we can't command that, but we can still adjust lights).
    let resolvedMode, resolvedSource;
    let manualExpiresAt = 0;

    if (_isManualActive()) {
      resolvedMode    = _manualMode.mode;
      resolvedSource  = "manual";
      manualExpiresAt = _manualMode.expiresAt;
    } else if (t.isVideo) {
      // Videos live in a movie library — no music genre tags, follow timeblock.
      resolvedMode   = timeBlockMode;
      resolvedSource = "timeblock";
    } else {
      // Schedule/playlist mode always follows the timeblock (unchanged). The
      // first song's genre drives the LIGHTS only, captured into _seedMode below.
      resolvedMode   = timeBlockMode;
      resolvedSource = "timeblock";

      // Maintain the session + detect a new-session seed on EVERY audio poll.
      // (Previously gated behind an empty-playlist check, so when a block had a
      // playlist the first song's genre was never read — the "Rap song but LOFI
      // lights" bug.) checkSession only returns a mode on a genuine new session
      // (>= IDLE_TIMEOUT of silence); otherwise it just updates the timestamp.
      try {
        const seedMode = await session.checkSession(
          { ratingKey: t.ratingKey, title: t.title, artist: t.artist },
          cfg.PLEX_BASE, cfg.PLEX_TOKEN, blockModeForNow,
        );
        if (seedMode) {
          _seedMode = { mode: seedMode, expiresAt: timeblocks.getNextBoundaryMs(new Date()) };
          _persistRuntimeState();
          console.log(`[lights] seed -> ${seedMode} (holds until the handoff window)`);
          // Server owns automatic lights. Apply/reconcile the seed immediately
          // instead of depending on the kiosk browser to issue a second command.
          if (_automation.enabled) {
            // Do not block the Plex/session poll on an independent light-service
            // network call. Reconciliation is best-effort and the periodic
            // light scheduler will retry if this immediate sync fails.
            _syncScheduledLights().catch((err) =>
              console.warn("[lights] seed sync failed:", err.message),
            );
          }
        }
      } catch (_) {}
    }

    // ── Boundary + weighted music handoff ───────────────────────────────────
    // Only applies when we're following the schedule. Music blends for 20
    // minutes centered on the boundary: 80/20, 60/40, 40/60, 20/80. The
    // currently playing track is never cut; the weighted choice becomes the
    // source for the next natural track change.
    if (resolvedSource === "timeblock" && _automation.enabled && !t.isVideo) {
      // First-start alignment: outside a blend, align to the schedule at the
      // next natural track change. Inside a blend, the weighted policy owns the
      // next source decision instead of forcing either side.
      if (!_firstStartAligned) {
        _firstStartAligned = true;
        if (!musicBlend &&
            playlistCtl.playlistKeyForMode(timeBlockMode, cfg) &&
            _lastCommandedPlaylist !== playlistCtl.playlistKeyForMode(timeBlockMode, cfg)) {
          console.log(`[playlist] first-start alignment (playing) → ${timeBlockMode}`);
          _queuePlaylistSwitch(timeBlockMode, "first-start (playing)");
        }
      }

      // A schedule boundary still resets lateral steering to the incoming mode,
      // but during the post-boundary half of a blend it must NOT force 100% new
      // music yet. The weighted handoff owns that until +10 minutes.
      if (_lastBlockMode && _lastBlockMode !== timeBlockMode) {
        if (!musicBlend) {
          _queuePlaylistSwitch(timeBlockMode, `boundary cross from ${_lastBlockMode}`);
        }
        _steering.onBoundaryOrModeChange(timeBlockMode);
      }

      _syncWeightedMusicBlend(musicBlend, t.ratingKey);

      // Only update _lastBlockMode when music automation is actually in control.
      // Video intentionally leaves it stale so audio resume can reconcile any
      // boundary crossed while RSVP TV owned playback.
      _lastBlockMode = timeBlockMode;
    } else if (resolvedSource !== "timeblock" || !_automation.enabled) {
      if (_musicBlendSession) {
        // Manual control or stopped automation cancels an in-flight automatic
        // blend immediately; explicit user intent wins.
        if (_pendingPlaylistSwitch?.blendBoundaryMs === _musicBlendSession.boundaryMs) {
          _pendingPlaylistSwitch = null;
        }
        _musicBlendSession = null;
      }
    }

    _currentVideoPath = t.isVideo ? (t.localFilePath || "") : "";

    // Plex video sessions are intentionally ignored by parseSessions().
    // Radio/TV ownership is controlled only by the server-owned admin TV mode
    // above, so there is no second PMS-driven pause/resume controller here.

    // For videos, Plex may not have proper artist/title metadata.
    // If artist === title (Plex using title as artist), parse from filename.
    let displayTitle  = t.title;
    let displayArtist = t.artist;
    if (t.isVideo && t.artist === t.title && t.localFilePath) {
      const parsed = _parseFilenameMetadata(t.localFilePath);
      if (parsed) {
        displayArtist = parsed.artist;
        displayTitle  = parsed.title;
      }
    }

    const isVideo  = !!t.isVideo;
    const appState = deriveAppState(t.playerState, isVideo);
    let videoPhase = "none";
    if (isVideo) videoPhase = t.playerState === "paused" ? "paused" : "playing";

    // Track last play percent for admin debugging.
    const lastPlayPercent = (!isVideo && t.durationMs > 0)
      ? Math.min(1, t.viewOffsetMs / t.durationMs)
      : null;

    const desiredPlaylist = playlistCtl.playlistKeyForMode(resolvedMode, cfg);

    // Lights mode: manual > seed (first-song genre, until boundary) > timeblock.
    // Decoupled from resolvedMode (the schedule/playlist mode) so the lights
    // follow the opening song's vibe while music keeps following the schedule.
    let lightsMode = resolvedMode, lightsSource = resolvedSource;
    if (!isVideo && !_isManualActive() && _isSeedActive()) {
      lightsMode   = _seedMode.mode;
      lightsSource = "seed";
    }

    lastState = {
      appState,
      owner:        _roomOwner,
      media: {
        type:         isVideo ? "video" : "audio",
        playerState:  t.playerState,
        title:        displayTitle,
        artist:       displayArtist,
        album:        t.album,
        ratingKey:    t.ratingKey || "",
        artUrl:       plexArt ? `/art?url=${encodeURIComponent(plexArt)}` : "",
        mediaUrl:     isVideo && t.ratingKey ? `/media/${t.ratingKey}` : "",
        viewOffsetMs: t.viewOffsetMs,
        durationMs:   t.durationMs,
      },
      mode:         { current: lightsMode, source: lightsSource, manualExpiresAt },
      video:        { phase: videoPhase },
      intelligence: _computeIntelligence(t.ratingKey || "", lastPlayPercent),
      plexamp:      { pausedByRsvpVideo: _plexampPausedByRsvp },
      music: {
        desiredPlaylist,
        lastCommandedPlaylist: _lastCommandedPlaylist,
        commandAligned: !desiredPlaylist || desiredPlaylist === _lastCommandedPlaylist,
        blend: (!isVideo && resolvedSource === "timeblock" && _automation.enabled && musicBlend) ? {
          fromMode: musicBlend.fromMode,
          toMode: musicBlend.toMode,
          oldPct: musicBlend.oldPct,
          newPct: musicBlend.newPct,
          stageIndex: musicBlend.stageIndex,
          boundaryMs: musicBlend.boundaryMs,
          sourceMode: _musicBlendSession?.sourceMode || "",
        } : null,
      },
      steering:     _steering.snapshot(),
      automation:   { ..._automation },
      features:     { bass, energy },
      updatedAt:    Date.now(),
      error:        "",
    };

  } catch {
    // Transient exception — do NOT record skip-on-stop, do NOT resume Plexamp.
    // Same reasoning as the HTTP fail branch above. Plexamp resume fires only
    // in the parse-null branch where Plex genuinely reports no active session.
    _currentVideoPath = "";
    _prevPollTrack    = null;
    lastState = _idleState({ bass, energy, error: "plex_poll_failed" });
  } finally {
    _pollInFlight = false;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.get("/runtime-config.js", (_req, res) => {
  res.type("application/javascript");
  res.setHeader("Cache-Control", "no-store");
  res.send(`window.RSVP_RUNTIME_CONFIG = ${JSON.stringify({
    bgDay: cfg.BG_DAY,
    bgNight: cfg.BG_NIGHT,
    pollMs: cfg.POLL_MS,
    pollTimeoutMs: Math.min(cfg.POLL_MS, cfg.POLL_TIMEOUT_MS),
  })};`);
});

app.use("/", express.static(cfg.PUBLIC_DIR));

app.get("/state",  (_req, res) => {
  // Include config health so admin can surface critical configuration errors.
  // (empty PLEX_TOKEN is the big one — silently breaks everything).
  res.json({
    ...lastState,
    // Handoff ownership changes can occur between poll snapshots (for example,
    // an aborted Radio -> TV takeover). Always expose the live ownership flag
    // so Admin never shows a stale "paused by RSVP" state.
    plexamp: {
      ...(lastState.plexamp || {}),
      pausedByRsvpVideo: _plexampPausedByRsvp,
    },
    configHealth: {
      plexTokenSet: !!cfg.PLEX_TOKEN,
      lightsUrl:    cfg.LIGHTS_URL,
      mediaDir:     cfg.MEDIA_DIR,
      // Playlist wiring visibility — lets admin show which blocks are actually
      // configured vs silently observer-only. These are the keys that, when
      // empty, mean the music-switching layer does nothing for that block.
      playlists: {
        lofi: !!cfg.PLAYLIST_LOFI,
        lounge: !!cfg.PLAYLIST_LOUNGE,
        rap:  !!cfg.PLAYLIST_RAP,
        rnb:  !!cfg.PLAYLIST_RNB,
      },
      steeringLanes: _steering.snapshot().lanesPerMode,
      analyzer: featureHealth(),
      hue: {
        reachable: _lightsLastResultOk,
        enabled: _lightsEnabled,
        scene: _lightsScene,
        manualScene: _isManualLightsActive() ? _manualLights.mode : "",
        manualExpiresAt: _manualLights?.expiresAt || 0,
        lastAttemptAt: _lightsLastAttemptAt,
        lastOkAt: _lightsLastOkAt,
        error: _lightsLastError,
      },
    },
  });
});

app.get("/health", (_req, res) => {
  const staleMs = Date.now() - (lastState.updatedAt || 0);
  const assets = assetHealth();
  const ok = !lastState.error && staleMs <= cfg.HEALTH_STALE_MS && assets.ok;
  const analyzer = featureHealth();
  res.json({
    ok,
    mode: lastState.mode.current,
    updatedAt: lastState.updatedAt,
    staleMs,
    error: lastState.error || "",
    assetsOk: assets.ok,
    assetsMissing: assets.missing,
    analyzer,
    degraded: _lightsLastResultOk === false || !analyzer.fresh,
    hue: {
      reachable: _lightsLastResultOk,
      enabled: _lightsEnabled,
      scene: _lightsScene,
      lastAttemptAt: _lightsLastAttemptAt,
      lastOkAt: _lightsLastOkAt,
      error: _lightsLastError,
    },
  });
});

let _featureSignalInFlight = false;
let _lastFeatureSignalAt = 0;
let _lastForwardedFeatures = { bass: -1, energy: -1 };

function _relayFeaturesToLights(bass, energy) {
  const now = Date.now();
  const changed = Math.abs(bass - _lastForwardedFeatures.bass) >= 0.03 ||
    Math.abs(energy - _lastForwardedFeatures.energy) >= 0.03;
  const due = now - _lastFeatureSignalAt >= cfg.FEATURE_SIGNAL_RELAY_MS;
  if (_featureSignalInFlight || !due || !changed) return;

  _featureSignalInFlight = true;
  _lastFeatureSignalAt = now;
  _lastForwardedFeatures = { bass, energy };
  _forwardToLights("signal", { bass, energy })
    .catch(() => {})
    .finally(() => { _featureSignalInFlight = false; });
}

app.post("/features", (req, res) => {
  // The analyzer is a local Pi service. Keeping this endpoint loopback-only
  // prevents arbitrary LAN clients from driving the reactive Hue channel.
  if (!localOnlyRequest(req)) return res.status(403).json({ ok: false, error: "local_only" });

  const bass = clamp01(req.body?.bass ?? 0);
  const energy = clamp01(req.body?.energy ?? 0);
  const now = Date.now();
  lastFeatures = { bass, energy, updatedAt: now };

  // Reactive lighting belongs to the main runtime, not the kiosk browser.
  // The regular state poll also relays the decayed feature envelope so an
  // analyzer failure naturally returns Hue brightness to the scene baseline.
  _relayFeaturesToLights(bass, energy);

  res.json({ ok: true });
});

// ── Browser telemetry ────────────────────────────────────────────────────────
// The kiosk browser fires a small POST here on every notable event in the
// video player so the trail shows up in journalctl alongside the server logs.
// Without this, `[bg]` console messages from the browser never make it off
// the kiosk and intermittent video failures are impossible to debug remotely.
//
// Body shape (all optional except event):
//   { event: "ended" | "error" | "stalled" | "waiting" | ... ,
//     mediaUrl: string,
//     ratingKey: string,
//     currentTime: number,
//     duration:    number,
//     readyState:  number,
//     networkState: number,
//     errorCode:   number,
//     errorMsg:    string }
//
// Kiosk-only telemetry. Body capped by the global JSON limit.
app.post("/api/log", async (req, res) => {
  if (!localOnlyRequest(req)) return res.status(403).json({ ok: false, error: "local_only" });
  const b = req.body || {};
  const event = String(b.event || "").slice(0, 32);
  if (!event) return res.status(400).json({ ok: false, error: "missing_event" });
  // Auto-advance: the kiosk fires "ended" when a clip finishes. While admin
  // video mode is active, that is our cue to move to the next clip (loops).
  if (event === "ended" && _videoMode.active) {
    if (videoEvent.eventMatchesActiveVideo(b, _videoMode)) {
      await advanceVideoMode({ skipped: false });
    } else {
      console.warn("[browser] ignored stale/unidentified ended event");
    }
  }
  const parts = [`event=${event}`];
  if (b.mediaUrl)            parts.push(`url=${String(b.mediaUrl).slice(0, 200)}`);
  if (b.ratingKey)           parts.push(`ratingKey=${String(b.ratingKey).slice(0, 32)}`);
  if (Number.isFinite(b.currentTime))  parts.push(`t=${b.currentTime.toFixed(1)}`);
  if (Number.isFinite(b.duration))     parts.push(`dur=${b.duration.toFixed(1)}`);
  if (Number.isFinite(b.readyState))   parts.push(`ready=${b.readyState}`);
  if (Number.isFinite(b.networkState)) parts.push(`net=${b.networkState}`);
  if (Number.isFinite(b.errorCode))    parts.push(`errCode=${b.errorCode}`);
  if (b.errorMsg)            parts.push(`errMsg="${String(b.errorMsg).slice(0, 200)}"`);
  console.log(`[browser] ${parts.join(" ")}`);
  res.json({ ok: true });
});

// ── Admin dashboard ───────────────────────────────────────────────────────────
// Trusted-LAN control surface. Browser mutations are same-origin protected;
// direct LAN clients remain usable without a separate admin login. Do not
// expose port 3000 to the public internet.

const SKIP_DATA_PATH = process.env.SKIP_DATA_PATH || path.join(__dirname, "data", "skip-data.json");

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(cfg.PUBLIC_DIR, "admin.html"));
});

app.get("/admin/skip-data", (_req, res) => {
  try {
    if (!fs.existsSync(SKIP_DATA_PATH)) return res.json({ tracks: [] });
    const raw = JSON.parse(fs.readFileSync(SKIP_DATA_PATH, "utf8"));
    const tracks = Object.values(raw).map((entry) => ({
      ratingKey:   entry.ratingKey,
      title:       entry.title,
      artist:      entry.artist,
      strikes:     entry.strikes || 0,
      softStrikes: entry.softStrikes || 0,
      plays:       entry.plays || 0,
      rating:      plexSync.starsForStrikes(entry.strikes || 0, entry.softStrikes || 0),
      lastTs:      Array.isArray(entry.history) && entry.history.length
        ? entry.history[entry.history.length - 1].ts
        : 0,
    })).sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
    res.json({ tracks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Top songs endpoint — returns two lists: most played + most struck.
// Used by the admin dashboard's "Top 10" cards.
app.get("/admin/top-songs", (_req, res) => {
  try {
    if (!fs.existsSync(SKIP_DATA_PATH)) return res.json({ topPlayed: [], topStruck: [] });
    const raw = JSON.parse(fs.readFileSync(SKIP_DATA_PATH, "utf8"));
    const all = Object.values(raw).map((entry) => ({
      ratingKey: entry.ratingKey,
      title:     entry.title,
      artist:    entry.artist,
      plays:     entry.plays || 0,
      strikes:   entry.strikes || 0,
      softStrikes: entry.softStrikes || 0,
    }));
    const topPlayed = all
      .filter((t) => t.plays > 0)
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 10);
    const topStruck = all
      .filter((t) => t.strikes > 0 || t.softStrikes > 0)
      .sort((a, b) => {
        // Sort by full strikes first, then soft strikes as tiebreaker.
        if (b.strikes !== a.strikes) return b.strikes - a.strikes;
        return b.softStrikes - a.softStrikes;
      })
      .slice(0, 10);
    res.json({ topPlayed, topStruck });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/sync-ratings", async (req, res) => {
  // LAN-accessible by design so trusted devices can control the system.
  // already see and trigger lights via /admin/lights/*. Symmetric with that.
  // Do NOT expose port 3000 to the internet.
  try {
    await plexSync.syncAll(cfg.PLEX_BASE, cfg.PLEX_TOKEN);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/admin/plexamp/pause", async (req, res) => {
  // LAN-accessible by design for trusted local control devices.
  try {
    await plexampPauseIfPlaying();
    res.json({ ok: true, pausedByRsvp: _plexampPausedByRsvp });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -- Admin: local video mode (Pi-local, admin-triggered) --
app.get("/admin/video-playlists", async (_req, res) => {
  const playlists = await fetchVideoPlaylists();
  res.json({
    ok: true,
    playlists,    active: _videoMode.active ? {
      playlistKey: _videoMode.playlistKey,
      title:       _videoMode.playlistTitle,
      index:       _videoMode.index,
      total:       _videoMode.clips.length,
      mode:        _videoMode.mode,
      paused:      !!_videoMode.paused,
      manualUntil: Number(_videoMode.manualUntil) || 0,
    } : null,
  });
});

app.post("/admin/video/play/:playlistKey", async (req, res) => {
  const key = String(req.params.playlistKey || "");
  if (!/^\d+$/.test(key)) return res.status(400).json({ ok: false, error: "invalid_playlist_key" });
  const r = await enterVideoMode(key, { manualOverride: true });
  if (!r.ok) return res.status(400).json({ ok: false, error: r.reason });
  try { await pollSessions(); } catch (_) {}
  res.json({ ok: true, title: r.title, clips: r.clips, mode: r.mode, manualUntil: r.manualUntil });
});

app.post("/admin/video/stop", async (_req, res) => {
  await exitVideoMode("admin-stop");
  try { await pollSessions(); } catch (_) {}
  res.json({ ok: true });
});

app.post("/admin/video/next", async (_req, res) => {
  if (!_videoMode.active) return res.status(400).json({ ok: false, error: "video_not_active" });
  await advanceVideoMode({ skipped: true });
  try { await pollSessions(); } catch (_) {}
  const clip = _videoMode.clips[_videoMode.index] || {};
  res.json({ ok: true, index: _videoMode.index, total: _videoMode.clips.length, title: clip.title || "", paused: !!_videoMode.paused });
});

app.post("/admin/video/prev", async (_req, res) => {
  if (!_videoMode.active) return res.status(400).json({ ok: false, error: "video_not_active" });
  prevVideoMode();
  try { await pollSessions(); } catch (_) {}
  const clip = _videoMode.clips[_videoMode.index] || {};
  res.json({ ok: true, index: _videoMode.index, total: _videoMode.clips.length, title: clip.title || "", paused: !!_videoMode.paused });
});

app.post("/admin/video/pause", async (_req, res) => {
  if (!setVideoPaused(true)) return res.status(400).json({ ok: false, error: "video_not_active" });
  try { await pollSessions(); } catch (_) {}
  res.json({ ok: true, paused: true, index: _videoMode.index, total: _videoMode.clips.length });
});

app.post("/admin/video/resume", async (_req, res) => {
  if (!setVideoPaused(false)) return res.status(400).json({ ok: false, error: "video_not_active" });
  try { await pollSessions(); } catch (_) {}
  res.json({ ok: true, paused: false, index: _videoMode.index, total: _videoMode.clips.length });
});

app.post("/admin/plexamp/resume", async (req, res) => {
  // LAN-accessible by design for trusted local control devices.
  try {
    await plexampResumeIfWePaused();
    res.json({ ok: true, pausedByRsvp: _plexampPausedByRsvp });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/admin/automation/stop", async (_req, res) => {
  _stopAutomation();
  // Cancel any light-service fade already in flight and hold the scene that
  // belongs to the block where automation was stopped. Manual mode changes can
  // still replace this scene while automation remains stopped.
  await _applyLightsScene(_automation.stoppedMode).catch((err) =>
    console.warn("[lights] automation-stop hold failed:", err.message),
  );
  res.json({ ok:true, automation:{..._automation} });
});
app.post("/admin/automation/start", async (_req, res) => {
  _startAutomation();
  // Rejoin the live timeline directly. In an active handoff this preserves the
  // remaining Hue fade instead of snapping to the incoming block first.
  _lastScheduledLightsMode = "";
  _lastLightBlendKey = "";
  await _syncScheduledLights().catch((err) =>
    console.warn("[lights] automation-start sync failed:", err.message),
  );
  pollSessions().catch(() => {});
  res.json({ ok:true, automation:{..._automation} });
});

// ── Manual mode override ────────────────────────────────────────────────────
// POST /mode/clear  → clears the override. Returns to timeblock-driven mode and
//                     queues a playlist switch (waits for end of current track).
// POST /mode/:mode  → sets manual override. Auto-expires when the next scheduled
//                     20-minute handoff begins. Triggers an IMMEDIATE playlist switch if a
//                     playlist is configured for that mode (user explicit intent).
//
// Order matters: /mode/clear must register BEFORE /mode/:mode so the literal
// path doesn't get caught by the param matcher (which would reject "clear" as
// an invalid mode).

const _VALID_MODES = new Set(["lofi", "lounge", "rap", "rnb"]);

app.post("/mode/clear", async (_req, res) => {
  _clearManualMode();
  const scheduledMode = blockModeForNow();
  const blend = timeblocks.getMusicBlendState(new Date());
  _steering.onBoundaryOrModeChange(scheduledMode);

  if (_roomOwner === "tv") {
    // Rejoin TV automation without starting Radio underneath it. During an
    // active blend, clip-end weighting owns the next genre; outside the blend,
    // queue the canonical block for the next natural clip boundary.
    _pendingPlaylistSwitch = null;
    _pendingVideoMode = (blend || !_videoMode.active || _videoMode.mode === scheduledMode)
      ? null
      : scheduledMode;
  } else {
    if (blend) {
      // Explicitly clearing manual mode during a handoff rejoins the weighted
      // blend instead of forcing 100% of either side.
      _syncWeightedMusicBlend(blend, lastState.media?.ratingKey || "manual-clear");
    } else {
      _queuePlaylistSwitch(scheduledMode, "manual override cleared");
    }
  }

  await _syncScheduledLights().catch((err) =>
    console.warn("[lights] scheduled scene reconcile failed:", err.message),
  );
  pollSessions().catch(() => {});
  res.json({ ok: true });
});

app.post("/mode/:mode", async (req, res) => {
  // LAN-accessible by design for trusted local control devices. Lets admin from a Mac/phone set manual mode.
  const requestedMode = String(req.params.mode || "").toLowerCase();
  const mode = requestedMode === "wrap" ? "lounge" : requestedMode;
  if (!_VALID_MODES.has(mode)) return res.status(400).json({ ok: false, error: "invalid_mode" });
  _setManualMode(mode);
  _steering.onBoundaryOrModeChange(mode);
  // Poll before firing the switch so lastState reflects current
  // Plexamp playback. Without this, a manual-mode tap right after server
  // restart would no-op (lastState is still IDLE) and require a second tap.
  // Correlate browser completion to the active clip before mutating TV state.
  try { await pollSessions(); } catch (_) {}
  // Manual block selection acts on whichever medium owns playback. It never
  // changes Radio <-> TV ownership by itself.
  if (_roomOwner === "tv") {
    _pendingVideoMode = null;
    if (_videoMode.active) {
      const moved = await _switchVideoToMode(mode);
      if (!moved) console.warn(`[video-mode] no video lane configured for ${mode}`);
    } else {
      _pendingVideoMode = mode; // TV remains owner but silent.
    }
  } else {
    _fireImmediatePlaylistSwitch(mode, "manual override");
  }
  await _applyLightsScene(mode).catch((err) => console.warn("[lights] manual scene failed:", err.message));
  res.json({
    ok: true,
    mode,
    expiresAt: _manualMode ? _manualMode.expiresAt : 0,
  });
});

app.post("/admin/force-timeblock-sync", async (_req, res) => {
  // Explicit operator recovery: align the CURRENT media owner to the hard
  // timeblock immediately. This intentionally bypasses blend weighting.
  try { await pollSessions(); } catch (_) {}
  const mode = blockModeForNow();

  if (_roomOwner === "tv") {
    _pendingPlaylistSwitch = null;
    _pendingVideoMode = null;
    let moved = false;
    if (_videoMode.active) moved = await _switchVideoToMode(mode);
    else _pendingVideoMode = mode;
    await _applyLightsScene(mode).catch((err) =>
      console.warn("[lights] force-sync scene failed:", err.message),
    );
    return res.json({ ok: true, mode, owner: "tv", moved });
  }

  _fireImmediatePlaylistSwitch(mode, "admin force-sync");
  await _applyLightsScene(mode).catch((err) =>
    console.warn("[lights] force-sync scene failed:", err.message),
  );
  res.json({ ok: true, mode, owner: "radio" });
});

// ── Admin lights proxy ───────────────────────────────────────────────────────
// Browser controls always call this server, which is the single authority for
// light state. The server then forwards whitelisted commands to the loopback
// Hue adapter. This avoids a second browser-side scheduler and also lets admin
// controls work consistently from the Pi or another device on the LAN.
//
// Whitelisted actions only:
//   /on             /off
//   /mode/rnb /mode/rap /mode/lofi /mode/lounge
//   /signal         /transition

let _lightsEnabled = _persistedRuntime.lightsEnabled !== false;
let _lightsPowerSynced = false; // boot/retry guard for Hue on/off intent
let _lightsScene = _persistedRuntime.lightsScene || _manualMode?.mode || _automation.stoppedMode || blockModeForNow();
let _lightsLastResultOk = null;
let _lightsLastAttemptAt = 0;
let _lightsLastOkAt = 0;
let _lightsLastError = "";

async function _syncLightsPower() {
  if (_lightsPowerSynced) return { ok: true, status: 200, alreadySynced: true };
  try {
    const r = await _forwardToLights(_lightsEnabled ? "on" : "off", {});
    if (r.ok) _lightsPowerSynced = true;
    return r;
  } catch (err) {
    _lightsPowerSynced = false;
    throw err;
  }
}

async function _applyLightsScene(mode) {
  _lightsScene = mode;
  _persistRuntimeState();
  if (!_lightsEnabled) return { ok: true, status: 200, deferred: true };
  return _forwardToLights(`mode/${mode}`, {});
}

let _lastScheduledLightsMode = ""; // force one physical scene reconciliation on boot
let _lastLightBlendKey = "";
async function _syncScheduledLights() {
  // Power intent is independent of the music scheduler. Reconcile it first so
  // a failed Hue /on or /off command is retried even while automation/manual
  // mode prevents scene changes.
  const power = await _syncLightsPower();
  if (_lightsEnabled && !power.ok) return power;

  const now = new Date();
  const scheduled = blockModeForNow();
  if (_isManualActive() || !_automation.enabled) return;

  const blend = timeblocks.getMusicBlendState(now);
  const manualLights = _isManualLightsActive() ? _manualLights.mode : "";
  // Before the transition window, an explicit light-only choice wins over a
  // first-song seed. Once the -10m handoff begins, both expire from control and
  // Hue fades FROM whatever scene is physically active toward the next block.
  const automaticTarget = !blend && manualLights
    ? manualLights
    : (!blend && _isSeedActive()) ? _seedMode.mode : scheduled;

  const plan = lightTransition.planLightSync({
    nowMs: now.getTime(),
    scheduledMode: automaticTarget,
    blendState: blend,
    lastScheduledMode: _lastScheduledLightsMode,
    lightsScene: _lightsScene,
    lastBlendKey: _lastLightBlendKey,
    lightsEnabled: _lightsEnabled,
    blendHalfMin: timeblocks.MUSIC_BLEND_HALF_MIN,
  });

  if (plan.kind === "transition") {
    _lightsScene = plan.scene;
    const r = await _forwardToLights("transition", {
      from: plan.fromMode,
      to: plan.toMode,
      durMs: plan.durMs,
    });
    // Mark only after success so a transient light-service failure retries.
    if (r.ok) {
      _lastLightBlendKey = plan.key;
      _persistRuntimeState();
    }
    return r;
  }

  if (plan.kind === "defer") {
    _lightsScene = plan.scene; // destination intent advances while bulbs are off
    _persistRuntimeState();
    return { ok: true, status: 200, deferred: true };
  }

  if (plan.kind === "hold" || plan.kind === "none") return { ok: true, status: 200, held: true };

  _lastLightBlendKey = "";
  const applied = await _applyLightsScene(plan.mode);
  // Only acknowledge the scheduled scene after the Hue service accepted it.
  // If the service/bridge is temporarily unavailable, leave the previous
  // acknowledgement in place so the 30-second scheduler retries automatically.
  if (applied.ok) _lastScheduledLightsMode = automaticTarget;
  return applied;
}

async function _forwardToLights(action, body) {
  const url = `${cfg.LIGHTS_URL}/${action}`;
  _lightsLastAttemptAt = Date.now();
  try {
    const r = await fetchWithTimeout(url, 3000, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body || {}),
    });
    _lightsLastResultOk = r.ok;
    if (r.ok) {
      _lightsLastOkAt = Date.now();
      _lightsLastError = "";
    } else {
      _lightsLastError = `http_${r.status}`;
    }
    return { ok: r.ok, status: r.status };
  } catch (err) {
    _lightsLastResultOk = false;
    _lightsLastError = err && err.name === "AbortError" ? "timeout" : String(err?.message || "lights_unreachable");
    throw err;
  }
}

app.post("/admin/lights/off", async (_req, res) => {
  _lightsEnabled = false;
  _lightsPowerSynced = false;
  _persistRuntimeState();
  try {
    const r = await _syncLightsPower();
    res.status(r.ok ? 200 : 502).json({ ok: r.ok, action: "off", enabled: false, scene: _lightsScene });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

app.post("/admin/lights/on", async (_req, res) => {
  _lightsEnabled = true;
  _lightsPowerSynced = false;
  _persistRuntimeState();
  try {
    const on = await _syncLightsPower();
    if (!on.ok) return res.status(502).json({ ok: false, error: "lights_on_failed" });

    let sceneResult;
    if (_isManualActive()) {
      sceneResult = await _applyLightsScene(_manualMode.mode);
    } else if (!_automation.enabled) {
      sceneResult = await _applyLightsScene(_lightsScene || _automation.stoppedMode || blockModeForNow());
    } else {
      // Re-enter the live ambience timeline instead of snapping to the hard
      // timeblock. During a 20-minute handoff this sends only the remaining
      // Hue transition; outside a handoff it restores seed/scheduled intent.
      _lastScheduledLightsMode = "";
      _lastLightBlendKey = "";
      sceneResult = await _syncScheduledLights();
    }

    const ok = !sceneResult || sceneResult.ok !== false;
    res.status(ok ? 200 : 502).json({ ok, action: "on", enabled: true, scene: _lightsScene });
  } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
});

app.post("/admin/lights/mode/:mode", async (req, res) => {
  const requestedMode = String(req.params.mode || "").toLowerCase();
  const mode = requestedMode === "wrap" ? "lounge" : requestedMode;
  if (!_VALID_MODES.has(mode)) {
    return res.status(400).json({ ok: false, error: "invalid_mode" });
  }
  try {
    // Scene selection and physical power are independent. A mode change while
    // lights are OFF updates intent only; it must not turn the bulbs back on.
    // This is a Hue-only override: Radio/TV programming remains untouched.
    const expiresAt = _setManualLights(mode);
    _lastScheduledLightsMode = mode;
    _lastLightBlendKey = "";
    const r = await _applyLightsScene(mode);
    res.status(r.ok ? 200 : 502).json({
      ok: r.ok, action: `mode/${mode}`, status: r.status, enabled: _lightsEnabled,
      scene: _lightsScene, expiresAt,
    });
  } catch (err) {
    console.warn(`[admin] lights proxy /mode/${mode} failed:`, err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ── Video failure recovery ──────────────────────────────────────────────────
// Browser POSTs here when it cannot play /media/:ratingKey (404, codec, network,
// timeout, anything). Server immediately:
//   - Marks the video's ratingKey as suppressed so subsequent polls don't
//     flip back into video mode if Plex still reports the session.
//   - Resumes Plexamp if RSVP paused it (now playing again right away).
//   - Drops _wasVideoMode so the playing-branch logic doesn't re-pause.
// Without this endpoint the server would happily keep telling the browser
// "video active, ratingKey X" while the browser is showing the bg fallback —
// Plexamp would stay paused indefinitely and the music would never come back.
//
// Open to the kiosk only (local-only). Browser POSTs from the same origin.
app.post("/video-failed", async (req, res) => {
  if (!localOnlyRequest(req)) return res.status(403).json({ ok: false, error: "local_only" });
  // Best-effort body — browser sends { mediaUrl, ratingKey? }. We can derive
  // ratingKey from mediaUrl ("/media/<key>") if not provided explicitly.
  const body      = req.body || {};
  const mediaUrl  = String(body.mediaUrl || "");
  const ratingKey = String(body.ratingKey || videoEvent.ratingKeyFromMediaUrl(mediaUrl) || "");

  // A delayed failure beacon from the previous clip must never tear down the
  // clip that is playing now. Server-driven TV mode therefore requires the
  // browser event to identify the currently active clip.
  if (_videoMode.active && !videoEvent.eventMatchesActiveVideo({ mediaUrl, ratingKey }, _videoMode)) {
    console.warn(`[video] ignored stale/unidentified failure for ratingKey=${ratingKey || "(none)"}`);
    return res.json({ ok: true, ignored: true, ratingKey, suppressed: false });
  }

  if (_videoMode.active) {
    const recovered = videoRecovery.removeFailedActiveClip(_videoMode, ratingKey);
    if (recovered.ok && !recovered.empty) {
      _videoMode = recovered.state;
      _videoMeta = null;
      _bumpVideoHandoffToken();
      _persistRuntimeState();
      console.warn(`[video-mode] removed failed clip ${ratingKey}; continuing with ${_videoMode.clips[_videoMode.index]?.ratingKey || "next"}`);
      return res.json({ ok: true, ratingKey, removed: true, tvContinues: true });
    }
    if (recovered.ok && recovered.empty) {
      console.warn(`[video-mode] final playable clip failed (${ratingKey}); returning playback to Radio`);
      _videoMode = recovered.state;
      _wasVideoMode = false;
      _roomOwner = "radio";
      _videoMeta = null;
      _bumpVideoHandoffToken();
      _persistRuntimeState();
      await plexampResumeIfWePaused();
      return res.json({ ok: true, ratingKey, removed: true, tvContinues: false });
    }
  }

  // Outside server-driven TV mode, correlate against the last Plex video when
  // available. This retains recovery for ordinary Plex video playback without
  // allowing an old beacon to suppress an unrelated item.
  const lastVideoKey = lastState.media.type === "video" ? String(lastState.media.ratingKey || "") : "";
  if (!_videoMode.active && lastVideoKey && ratingKey && ratingKey !== lastVideoKey) {
    console.warn(`[video] ignored stale Plex-video failure for ratingKey=${ratingKey}`);
    return res.json({ ok: true, ignored: true, ratingKey, suppressed: false });
  }

  const effectiveKey = ratingKey || lastVideoKey;
  if (effectiveKey) {
    _suppressedVideoRatingKey = effectiveKey;
    console.log(`[video] browser reported failure for ratingKey=${effectiveKey} — suppressing and resuming Plexamp`);
  } else {
    console.log("[video] browser reported failure with no ratingKey — resuming Plexamp anyway");
  }

  // Bump the handoff token so any in-flight pause from the video-start path
  // becomes stale. If a pause lands after this, it issues a corrective resume.
  _bumpVideoHandoffToken();
  _wasVideoMode = false;
  plexampResumeIfWePaused();

  res.json({ ok: true, ratingKey: effectiveKey, suppressed: !!effectiveKey });
});

// Art proxy — locked to Plex host only
app.get("/art", async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).send("missing url");

  const upstream = plexArt.authenticatedSourceUrl(rawUrl, cfg.PLEX_BASE, cfg.PLEX_TOKEN);
  if (!upstream.ok) {
    return res.status(upstream.reason === "forbidden" ? 403 : 400).send(upstream.reason === "forbidden" ? "forbidden" : "invalid url");
  }

  try {
    const r = await fetchWithTimeout(upstream.url, 4000);
    if (!r.ok) return res.status(r.status).send("art_fetch_failed");
    res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.status(502).send("art_fetch_failed");
  }
});

// Media proxy — streams a Plex video file by ratingKey with HTTP range support.
// Looks up the file path from Plex, verifies it's within MEDIA_DIR, then streams it.

const VIDEO_MIME = {
  ".mp4":  "video/mp4",
  ".m4v":  "video/mp4",
  ".mkv":  "video/x-matroska",
  ".mov":  "video/quicktime",
  ".avi":  "video/x-msvideo",
  ".webm": "video/webm",
};

app.get("/media/:ratingKey", async (req, res) => {
  const { ratingKey } = req.params;
  if (!ratingKey || !/^\d+$/.test(ratingKey)) return res.status(400).send("invalid_key");

  // Look up file path from Plex via the parser module.
  let filePath = "";
  let xml      = "";
  try {
    const metaUrl = `${cfg.PLEX_BASE}/library/metadata/${ratingKey}?X-Plex-Token=${encodeURIComponent(cfg.PLEX_TOKEN)}`;
    const r = await fetchWithTimeout(metaUrl, 4000);
    if (!r.ok) {
      console.warn(`[media] Plex metadata returned HTTP ${r.status} for ratingKey=${ratingKey}`);
      return res.status(404).send("plex_metadata_not_found");
    }
    xml = await r.text();
    filePath = plexParser.parseMediaPart(xml);
    if (!filePath) {
      console.warn(`[media] No file path found in Plex metadata for ratingKey=${ratingKey}. XML head: ${xml.slice(0, 200)}`);
      return res.status(404).send("no_file_in_metadata");
    }
  } catch (err) {
    console.warn(`[media] Plex lookup failed for ratingKey=${ratingKey}:`, err.message);
    return res.status(502).send("plex_lookup_failed");
  }

  // Security — compare canonical filesystem paths, not just lexical paths.
  // This blocks a symlink planted inside MEDIA_DIR from escaping to another
  // part of the filesystem.
  let resolved;
  let mediaDir;
  try {
    resolved = fs.realpathSync(filePath);
    mediaDir = fs.realpathSync(cfg.MEDIA_DIR);
  } catch (pathErr) {
    console.warn(`[media] Unable to resolve media path: ${pathErr.message}`);
    return res.status(404).send("file_not_found");
  }
  if (!resolved.startsWith(mediaDir + path.sep) && resolved !== mediaDir) {
    console.warn(`[media] Blocked path outside MEDIA_DIR: resolved=${resolved} mediaDir=${mediaDir}`);
    return res.status(403).send("forbidden");
  }

  let stat;
  try { stat = fs.statSync(resolved); } catch (statErr) {
    console.warn(`[media] File not found at ${resolved}:`, statErr.message);
    return res.status(404).send("file_not_found");
  }
  if (!stat.isFile()) return res.status(404).send("file_not_found");

  const ext      = path.extname(resolved).toLowerCase();
  const mime     = VIDEO_MIME[ext] || "video/mp4";
  const fileSize = stat.size;
  const range    = req.headers.range;

  if (range) {
    const rangeStr = range.replace(/bytes=/, "").trim();
    let start, end;

    if (rangeStr.startsWith("-")) {
      // Suffix range: bytes=-500 (last 500 bytes)
      const suffixLen = parseInt(rangeStr.slice(1), 10);
      start = Number.isFinite(suffixLen) && suffixLen > 0
        ? Math.max(0, fileSize - suffixLen)
        : 0;
      end = fileSize - 1;
    } else {
      const [startStr, endStr] = rangeStr.split("-");
      start = parseInt(startStr, 10);
      end   = endStr ? parseInt(endStr, 10) : fileSize - 1;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= fileSize) {
      res.setHeader("Content-Range", `bytes */${fileSize}`);
      return res.status(416).send("range_not_satisfiable");
    }

    end = Math.min(end, fileSize - 1);
    const chunk = end - start + 1;
    res.writeHead(206, {
      "Content-Range":  `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges":  "bytes",
      "Content-Length": chunk,
      "Content-Type":   mime,
      "Cache-Control":  "no-store",
    });
    fs.createReadStream(resolved, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type":   mime,
      "Accept-Ranges":  "bytes",
      "Cache-Control":  "no-store",
    });
    fs.createReadStream(resolved).pipe(res);
  }
});

// Kiosk exit — stops Plexamp playback then kills Chromium
app.post("/api/exit", (req, res) => {
  const isLocal = localOnlyRequest(req);
  if (!isLocal) {
    const presented = req.get("x-exit-token") || "";
    if (!requestAuth.tokenMatches(cfg.EXIT_API_TOKEN, presented)) {
      return res.status(403).json({ ok: false, error: cfg.EXIT_API_TOKEN ? "forbidden" : "local_only" });
    }
  }

  // Use the resolved Plexamp client ID used by the rest of the handoff logic.
  // PLEXAMP_CLIENT_IDENTIFIER can override the general target ID, and every
  // Plexamp command must address the same client.
  const stopUrl = `${PLEXAMP_BASE}/player/playback/stop?X-Plex-Token=${encodeURIComponent(cfg.PLEX_TOKEN)}&X-Plex-Target-Client-Identifier=${encodeURIComponent(PLEXAMP_PI_ID)}&X-Plex-Client-Identifier=rsvp-radio&commandID=1`;
  fetchWithTimeout(stopUrl, 2000).catch(() => {});
  setTimeout(() => {
    exec('pkill -f "chromium.*--kiosk" || true', () => res.json({ ok: true }));
  }, 500);
});

// ── Plex webhook receiver ─────────────────────────────────────────────────────
// Handles media.scrobble only — marks song as played so poll skip detector
// doesn't count it as a skip. Also syncs rating to Plex.

function _parseWebhookBody(body) {
  try {
    const match = body.match(/name="payload"[\s\S]*?Content-Type: application\/json\s*\r?\n\r?\n({[\s\S]*?})\s*\r?\n-+/);
    if (match) return JSON.parse(match[1]);
    const jsonMatch = body.match(/({[\s\S]*"event"[\s\S]*})/);
    if (jsonMatch) return JSON.parse(jsonMatch[1]);
    return null;
  } catch { return null; }
}

app.post("/plex", (req, res) => {
  const presentedWebhookToken = String(req.get("x-rsvp-webhook-token") || req.query?.token || "");
  if (!requestAuth.webhookAllowed({
    remoteAddress: requestAddress(req),
    configuredToken: cfg.PLEX_WEBHOOK_TOKEN,
    presentedToken: presentedWebhookToken,
  })) {
    return res.status(403).json({ ok: false, error: "webhook_forbidden" });
  }

  let body = "";
  let tooLarge = false;

  req.setEncoding("utf8");
  req.on("data", chunk => {
    if (tooLarge) return;
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > cfg.PLEX_WEBHOOK_MAX_BYTES) {
      tooLarge = true;
      res.sendStatus(413);
      req.destroy();
    }
  });

  req.on("end", () => {
    if (tooLarge) return;

    const payload = _parseWebhookBody(body);
    if (!payload) return res.sendStatus(200);

    const event     = payload.event                      || "unknown";
    const title     = payload.Metadata?.title            || "";
    const artist    = payload.Metadata?.grandparentTitle || "";
    const ratingKey = payload.Metadata?.ratingKey        || "";

    if (event === "media.scrobble") {
      console.log(`[plex-webhook] scrobble | "${title}" by ${artist}`);
      if (_prevPollTrack && _prevPollTrack.ratingKey === ratingKey) {
        _prevPollTrack.scrobbled = true;
      }
      // Dedup against the poll's clean-play path so the same track-end isn't
      // counted (and a strike redeemed) twice.
      if (!_playAlreadyCounted(ratingKey)) {
        skipTracker.recordPlay({ ratingKey, title, artist });
        _markPlayCounted(ratingKey);
        // Use syncRating so Plex rating reflects actual remaining strikes,
        // not a blanket 5-star reset (which would corrupt DJ Intelligence)
        plexSync.syncRating(ratingKey, cfg.PLEX_BASE, cfg.PLEX_TOKEN);
      }
    }

    // Instant track change detection — triggers an immediate poll so the
    // UI and video layer update right away instead of waiting up to POLL_MS
    if (event === "media.play" || event === "media.resume") {
      console.log(`[plex-webhook] ${event} | "${title}" by ${artist}`);
      pollSessions().catch(() => {});
    }

    if (event === "media.pause") {
      console.log(`[plex-webhook] ${event} | "${title}" by ${artist}`);
      pollSessions().catch(() => {});
    }

    // For video stops, delay the poll so the frontend grace period has time to hold.
    // Audio stops poll immediately as before.
    if (event === "media.stop") {
      console.log(`[plex-webhook] ${event} | "${title}" by ${artist}`);
      if (lastState.media.type === "video") {
        // Delay poll by 6s — frontend grace is 12s, giving it time to catch the next video
        setTimeout(() => pollSessions().catch(() => {}), 6000);
      } else {
        pollSessions().catch(() => {});
      }
    }

    res.sendStatus(200);
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
const _httpServer = app.listen(cfg.PORT, () => {
  console.log(`[server] RSVP Radio on :${cfg.PORT}`);
  console.log(`[server] Plex: ${cfg.PLEX_BASE} | token: ${cfg.PLEX_TOKEN ? "set ✓" : "NOT SET ✗"}`);
  console.log(`[server] Serving: ${cfg.PUBLIC_DIR}`);
  // Make an empty Plex token impossible to miss: polling otherwise runs while every
  // request returns 401, lastState stays IDLE forever, lights auto-paths
  // never fire, and from the user's POV "everything is broken." Surface it
  // here so journalctl shows the smoking gun on every boot.
  if (!cfg.PLEX_TOKEN) {
    console.error("[server] ┌─────────────────────────────────────────────────────────┐");
    console.error("[server] │ FATAL CONFIG: PLEX_TOKEN is empty                       │");
    console.error("[server] │ Plex polling will return 401 on every call.             │");
    console.error("[server] │ Track detection, lights mode changes, and skip/play     │");
    console.error("[server] │ counters will all silently fail.                        │");
    console.error("[server] │ Fix: set PLEX_TOKEN in the project .env file         │");
    console.error("[server] │      then: sudo systemctl restart rsvp-radio            │");
    console.error("[server] └─────────────────────────────────────────────────────────┘");
  }
  const assets = assetHealth();
  if (!assets.ok) console.warn(`[server] Missing background assets: ${assets.missing.join(", ")}`);
  // Sync all existing skip data to Plex on startup
  plexSync.syncAll(cfg.PLEX_BASE, cfg.PLEX_TOKEN);
  pollSessions();
  // Reconcile Hue state immediately on boot. The browser is intentionally not
  // a second scheduler anymore, so waiting 30 seconds here would leave a stale
  // scene visible after a server restart.
  (async () => {
    try {
      await _syncLightsPower();
      if (!_lightsEnabled) return;
      if (_isManualActive()) {
        await _applyLightsScene(_manualMode.mode);
      } else if (!_automation.enabled) {
        await _applyLightsScene(_lightsScene || _automation.stoppedMode || blockModeForNow());
      } else {
        await _syncScheduledLights();
      }
    } catch (err) {
      console.warn("[lights] startup sync failed:", err.message);
    }
  })();
  _pollIntervalHandle = setInterval(pollSessions, cfg.POLL_MS);
  _lightsIntervalHandle = setInterval(() => _syncScheduledLights().catch((err) => console.warn("[lights] schedule sync failed:", err.message)), 30000);
});

let _pollIntervalHandle = null;
let _lightsIntervalHandle = null;

// Clean shutdown — clears the poll interval, closes the HTTP listener, and
// exits. Without this, SIGTERM from the test helper (or systemctl stop) can
// leave the process hanging on the open interval timer.
function _shutdown(signal) {
  console.log(`[server] received ${signal}, shutting down`);
  if (_pollIntervalHandle) clearInterval(_pollIntervalHandle);
  if (_lightsIntervalHandle) clearInterval(_lightsIntervalHandle);
  _httpServer.close(() => process.exit(0));
  // If close hangs (open keep-alive sockets), force-exit after 1s.
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGTERM", () => _shutdown("SIGTERM"));
process.on("SIGINT",  () => _shutdown("SIGINT"));