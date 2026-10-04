"use strict";

/**
 * server.js — RSVP Radio Server
 *
 * Does exactly this, nothing more:
 *   GET  /state      → current Plex session + audio features
 *   GET  /art        → album art proxy (locked to Plex host only)
 *   POST /features   → audio analyzer posts bass/energy here
 *   GET  /health     → liveness check
 *   POST /api/exit   → kiosk-only: kills Chromium (local Pi use only)
 *   static /         → serves public/ folder
 */

const express  = require("express");
const { exec } = require("child_process");
const { URL }  = require("url");
const cfg         = require("./config");
const skipTracker = require("./intelligence/skip-tracker");
const plexSync    = require("./intelligence/plex-sync");
const session     = require("./intelligence/session");
const steering    = require("./intelligence/steering");
const plexControl = require("./intelligence/plex-control");
const timeblocks  = require("./shared/timeblocks");

// ── XML parser ────────────────────────────────────────────────────────────────
// Uses fast-xml-parser when available, falls back to regex shim.
// Run `npm install` after deploying to get the real parser.
let xmlParse = null;
try {
  const { XMLParser } = require("fast-xml-parser");
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  xmlParse = (xml) => parser.parse(xml);
} catch {
  console.warn("[server] fast-xml-parser not installed — using regex fallback. Run: npm install");
}

// ── Express setup ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "64kb" }));

const fetch =
  global.fetch ||
  ((...args) => import("node-fetch").then(({ default: f }) => f(...args)));

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
// Structured parse (fast-xml-parser) with regex shim fallback.

function _attr(openTag, name) {
  const m = openTag.match(new RegExp("\\s" + name + '="([^"]*)"', "i"));
  return m ? m[1] : "";
}

function _first(str, re) {
  const m = str.match(re);
  return m ? m[0] : "";
}

function _trackBlocks(xml) {
  const full = xml.match(/<Track\b[^>]*>[\s\S]*?<\/Track>/gi) || [];
  const self = xml.match(/<Track\b[^>]*\/>/gi) || [];
  return full.length ? full : self;
}

function parseSessions(xml) {
  // Structured path
  if (xmlParse) {
    try {
      const doc    = xmlParse(xml);
      const mc     = doc?.MediaContainer;
      if (!mc) return null;

      let tracks = mc.Track;
      if (!tracks) return null;
      if (!Array.isArray(tracks)) tracks = [tracks];

      const track =
        tracks.find((t) => t?.Player?.["@_product"] === "Plexamp") || tracks[0];
      if (!track) return null;

      const a = (k) => track[`@_${k}`] || "";
      const p = track.Player || {};

      return {
        type:         a("type")             || "track",
        title:        a("title"),
        artist:       a("grandparentTitle") || a("originalTitle") || "",
        album:        a("parentTitle")      || "",
        thumb:        a("thumb")            || a("parentThumb") || a("grandparentThumb") || "",
        ratingKey:    a("ratingKey")        || a("key") || "",
        viewOffsetMs: Number(a("viewOffset")) || 0,
        durationMs:   Number(a("duration"))   || 0,
        playerState:  (p["@_state"] || "playing").toLowerCase(),
      };
    } catch (err) {
      console.warn("[plex] XML parse error, falling back to regex:", err.message);
    }
  }

  // Regex shim fallback
  const blocks = _trackBlocks(xml);
  if (!blocks.length) return null;

  const block   = blocks.find((b) => /<Player\b[^>]*product="Plexamp"/i.test(b)) || blocks[0];
  const openTag = _first(block, /<Track\b[^>]*\/?>/i);
  if (!openTag) return null;

  let playerTag = _first(block, /<Player\b[^>]*>/i);
  if (!playerTag) playerTag = _first(xml, /<Player\b[^>]*product="Plexamp"[^>]*>/i);

  return {
    type:         _attr(openTag, "type")             || "track",
    title:        _attr(openTag, "title"),
    artist:       _attr(openTag, "grandparentTitle") || _attr(openTag, "originalTitle") || "",
    album:        _attr(openTag, "parentTitle")      || "",
    thumb:        _attr(openTag, "thumb")            || _attr(openTag, "parentThumb") || _attr(openTag, "grandparentThumb") || "",
    ratingKey:    _attr(openTag, "ratingKey")        || _attr(openTag, "key") || "",
    viewOffsetMs: Number(_attr(openTag, "viewOffset")) || 0,
    durationMs:   Number(_attr(openTag, "duration"))   || 0,
    playerState:  (playerTag ? _attr(playerTag, "state") : "playing").toLowerCase(),
  };
}

function buildPlexArtUrl(thumb) {
  if (!thumb) return "";
  let url = (thumb.startsWith("http://") || thumb.startsWith("https://"))
    ? thumb
    : `${cfg.PLEX_BASE}${thumb}`;
  if (!url.includes("X-Plex-Token=")) {
    url += (url.includes("?") ? "&" : "?") + `X-Plex-Token=${encodeURIComponent(cfg.PLEX_TOKEN)}`;
  }
  return url;
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

function localOnlyRequest(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || "");
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

// ── UI state ──────────────────────────────────────────────────────────────────
let lastState = {
  event: "idle", mode: blockModeForNow(),
  type: "", title: "", artist: "", album: "",
  playerState: "", viewOffsetMs: 0, durationMs: 0,
  thumb: "", artUrl: "",
  bass: 0, energy: 0,
  updatedAt: Date.now(), error: "",
};

// ── Skip detection state ──────────────────────────────────────────────────────
let _prevPollTrack = null; // { ratingKey, title, artist, scrobbled, viewOffsetMs, durationMs }
let _pollInFlight  = false;
let _lastTimeBlockMode = blockModeForNow();

const _steeringState = steering.createState();
let _laneConfig = {};
let _resolvedLanes = {};
let _plexMachineIdentifier = "";
let _steeringCommandId = 1;
let _steeringInFlight = false;
let _pendingModeSwitch = null;

try {
  _laneConfig = steering.parseLaneConfig(cfg.RSVP_LANES_JSON);
} catch (err) {
  console.warn("[steering]", err.message);
}

async function refreshSteeringLanes() {
  if (!Object.values(_laneConfig).some((lanes) => lanes.length)) {
    _resolvedLanes = _laneConfig;
    return;
  }

  try {
    const resolved = await plexControl.resolveConfiguredLanes({
      plexBase: cfg.PLEX_BASE,
      plexToken: cfg.PLEX_TOKEN,
    }, _laneConfig);
    _resolvedLanes = resolved.lanes;

    for (const [mode, configured] of Object.entries(_laneConfig)) {
      const found = new Set((_resolvedLanes[mode] || []).map((lane) => lane.title));
      const missing = configured.filter((lane) => !found.has(lane.title)).map((lane) => lane.title);
      if (missing.length) console.warn(`[steering] missing ${mode} playlists: ${missing.join(", ")}`);
    }
  } catch (err) {
    console.warn("[steering] playlist discovery failed:", err.message);
    _resolvedLanes = {};
  }
}

async function switchToModeAnchor(mode) {
  if (_steeringInFlight) return false;
  const lanes = _resolvedLanes?.[mode] || [];
  const lane = lanes[0];
  if (!lane?.ratingKey) return false;

  _steeringInFlight = true;
  try {
    if (!_plexMachineIdentifier) {
      _plexMachineIdentifier = await plexControl.serverIdentity({
        plexBase: cfg.PLEX_BASE,
        plexToken: cfg.PLEX_TOKEN,
      });
    }

    const queue = await plexControl.createPlaylistQueue({
      plexBase: cfg.PLEX_BASE,
      plexToken: cfg.PLEX_TOKEN,
      playlistRatingKey: lane.ratingKey,
    });

    if (_prevPollTrack) _prevPollTrack.scrobbled = true;

    await plexControl.playQueueOnPlexamp({
      plexampBase: cfg.PLEXAMP_BASE,
      plexBase: cfg.PLEX_BASE,
      plexToken: cfg.PLEX_TOKEN,
      machineIdentifier: _plexMachineIdentifier,
      targetClientIdentifier: cfg.PLEX_TARGET_CLIENT_IDENTIFIER,
      queueId: queue.queueId,
      selectedKey: queue.selectedKey,
      commandId: _steeringCommandId++,
    });

    steering.resetForMode(_steeringState, mode, lane.title);
    _steeringState.lastSteeredAt = Date.now();
    console.log(`[mode] switched Plex lane → ${mode} / "${lane.title}"`);
    return true;
  } catch (err) {
    console.warn("[mode] playlist boundary switch failed:", err.message);
    return false;
  } finally {
    _steeringInFlight = false;
  }
}

async function steerIfNeeded(mode) {
  if (_steeringInFlight) return false;
  if (!steering.shouldSteer({
    consecutiveSkips: _steeringState.consecutiveSkips,
    threshold: cfg.STEERING_SKIP_THRESHOLD,
    lastSteeredAt: _steeringState.lastSteeredAt,
    minDwellMs: cfg.STEERING_MIN_DWELL_MS,
  })) return false;

  const lane = steering.nextLane({
    mode,
    currentTitle: _steeringState.currentLaneTitle,
    lanes: _resolvedLanes,
    laneStats: _steeringState.laneStats,
  });
  if (!lane?.ratingKey) return false;

  _steeringInFlight = true;
  try {
    if (!_plexMachineIdentifier) {
      _plexMachineIdentifier = await plexControl.serverIdentity({
        plexBase: cfg.PLEX_BASE,
        plexToken: cfg.PLEX_TOKEN,
      });
    }

    const queue = await plexControl.createPlaylistQueue({
      plexBase: cfg.PLEX_BASE,
      plexToken: cfg.PLEX_TOKEN,
      playlistRatingKey: lane.ratingKey,
    });

    // This upcoming playback change is system-directed, not a crowd skip.
    if (_prevPollTrack) _prevPollTrack.scrobbled = true;

    await plexControl.playQueueOnPlexamp({
      plexampBase: cfg.PLEXAMP_BASE,
      plexBase: cfg.PLEX_BASE,
      plexToken: cfg.PLEX_TOKEN,
      machineIdentifier: _plexMachineIdentifier,
      targetClientIdentifier: cfg.PLEX_TARGET_CLIENT_IDENTIFIER,
      queueId: queue.queueId,
      selectedKey: queue.selectedKey,
      commandId: _steeringCommandId++,
    });

    if (_steeringState.currentLaneTitle) {
      steering.markLaneResult(_steeringState, _steeringState.currentLaneTitle, "failed");
    }
    _steeringState.currentLaneTitle = lane.title;
    _steeringState.consecutiveSkips = 0;
    _steeringState.lastSteeredAt = Date.now();
    console.log(`[steering] ${mode} → "${lane.title}"`);
    return true;
  } catch (err) {
    console.warn("[steering] lane switch failed:", err.message);
    return false;
  } finally {
    _steeringInFlight = false;
  }
}

// ── Plex poll ─────────────────────────────────────────────────────────────────
async function pollSessions() {
  if (_pollInFlight) return;
  _pollInFlight = true;

  const { bass, energy } = featuresNow();
  const timeBlockMode    = blockModeForNow();

  try {
    const url = `${cfg.PLEX_BASE}/status/sessions?X-Plex-Token=${encodeURIComponent(cfg.PLEX_TOKEN)}`;
    const r   = await fetchWithTimeout(url, cfg.POLL_TIMEOUT_MS);

    if (!r.ok) {
      lastState = { ...lastState, event: "idle", mode: timeBlockMode, bass, energy, updatedAt: Date.now(), error: `plex_http_${r.status}` };
      return;
    }

    const t = parseSessions(await r.text());

    if (!t || (!t.title && !t.thumb && !t.artist && !t.album)) {
      lastState = {
        ...lastState, event: "idle", mode: timeBlockMode,
        type: "", title: "", artist: "", album: "",
        playerState: "", viewOffsetMs: 0, durationMs: 0,
        thumb: "", artUrl: "", bass, energy, updatedAt: Date.now(), error: "",
      };
      return;
    }

    const plexArt = buildPlexArtUrl(t.thumb);

    // ── Skip detection ────────────────────────────────────────────────────────
    const trackChanged = Boolean(_prevPollTrack && _prevPollTrack.ratingKey !== t.ratingKey);

    if (_prevPollTrack && trackChanged) {
      if (!_prevPollTrack.scrobbled) {
        const pct = _prevPollTrack.durationMs > 0
          ? _prevPollTrack.viewOffsetMs / _prevPollTrack.durationMs
          : 0;

        if (pct < 0.40) {
          skipTracker.recordSkip(_prevPollTrack, pct);
          plexSync.syncRating(_prevPollTrack.ratingKey, cfg.PLEX_BASE, cfg.PLEX_TOKEN);
          steering.noteSkip(_steeringState, {
            mode: lastState.mode || timeBlockMode,
            ratingKey: _prevPollTrack.ratingKey,
            windowMs: cfg.STEERING_SKIP_WINDOW_MS,
          });
          steering.markLaneResult(_steeringState, _steeringState.currentLaneTitle, "skip");
          await steerIfNeeded(lastState.mode || timeBlockMode);
        } else {
          // A track transition after 40% is not a steering vote against the lane.
          steering.notePlay(_steeringState, { mode: lastState.mode || timeBlockMode });
          steering.markLaneResult(_steeringState, _steeringState.currentLaneTitle, "play");
        }
      }
    }

    // Keep progress with the track itself rather than relying on lastState.
    // lastState can legitimately go idle between Plex sessions, which used to
    // zero the offset and make a completed song look like a 0% hard skip.
    if (!_prevPollTrack || _prevPollTrack.ratingKey !== t.ratingKey) {
      _prevPollTrack = {
        ratingKey: t.ratingKey,
        title: t.title,
        artist: t.artist,
        scrobbled: false,
        viewOffsetMs: t.viewOffsetMs,
        durationMs: t.durationMs,
      };
    } else {
      _prevPollTrack.viewOffsetMs = t.viewOffsetMs;
      _prevPollTrack.durationMs = t.durationMs;
      _prevPollTrack.title = t.title;
      _prevPollTrack.artist = t.artist;
    }

    // Apply a scheduled mode change only at a natural track boundary.
    // The just-started old-lane track is marked system-directed before it is
    // replaced, so it cannot become a false crowd skip on the next poll.
    if (trackChanged && _pendingModeSwitch) {
      const pending = _pendingModeSwitch;
      _pendingModeSwitch = null;
      await switchToModeAnchor(pending);
    }

    // ── Session / seed detection ──────────────────────────────────────────────
    const boundaryChanged = timeBlockMode !== _lastTimeBlockMode;
    if (boundaryChanged) _lastTimeBlockMode = timeBlockMode;

    const effectiveMode = (lastState.event === "idle" ? timeBlockMode : lastState.mode) || timeBlockMode;
    let resolvedMode = boundaryChanged ? timeBlockMode : effectiveMode;

    if (boundaryChanged) {
      _pendingModeSwitch = timeBlockMode;
      console.log(`[mode] time block boundary queued → ${timeBlockMode}`);
    }

    try {
      const seedMode = await session.checkSession(
        { ratingKey: t.ratingKey, title: t.title, artist: t.artist },
        cfg.PLEX_BASE, cfg.PLEX_TOKEN, blockModeForNow,
      );
      if (seedMode) {
        console.log(`[session] Broadcasting mode → ${seedMode}`);
        steering.resetLaneStatsForSession(_steeringState);
        steering.resetForMode(_steeringState, seedMode);
        resolvedMode = seedMode;
      }
    } catch (_) {}

    lastState = {
      event: t.playerState === "paused" ? "media.pause" : "media.play",
      mode: resolvedMode,
      type: t.type, title: t.title, artist: t.artist, album: t.album,
      playerState: t.playerState,
      viewOffsetMs: t.viewOffsetMs, durationMs: t.durationMs,
      thumb: t.thumb,
      artUrl: plexArt ? `/art?url=${encodeURIComponent(plexArt)}` : "",
      bass, energy, updatedAt: Date.now(), error: "",
    };

  } catch {
    lastState = { ...lastState, event: "idle", mode: timeBlockMode, bass, energy, updatedAt: Date.now(), error: "plex_poll_failed" };
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
    lightsUrl: cfg.LIGHTS_URL,
    pollMs: cfg.POLL_MS,
    pollTimeoutMs: Math.min(cfg.POLL_MS, cfg.POLL_TIMEOUT_MS),
    timeBlocks: timeblocks.TIME_BLOCKS,
    preFadeMin: timeblocks.PRE_FADE_MIN,
    transitionMsDefault: timeblocks.TRANSITION_MS_DEFAULT,
  })};`);
});

app.use("/", express.static(cfg.PUBLIC_DIR));

app.get("/state",  (_req, res) => res.json(lastState));

app.get("/health", (_req, res) => {
  const staleMs = Date.now() - (lastState.updatedAt || 0);
  const assets = assetHealth();
  const ok = !lastState.error && staleMs <= cfg.HEALTH_STALE_MS && assets.ok;
  res.json({
    ok,
    mode: lastState.mode,
    updatedAt: lastState.updatedAt,
    staleMs,
    error: lastState.error || "",
    assetsOk: assets.ok,
    assetsMissing: assets.missing,
  });
});

app.post("/features", (req, res) => {
  lastFeatures = {
    bass:      clamp01(req.body?.bass   ?? 0),
    energy:    clamp01(req.body?.energy ?? 0),
    updatedAt: Date.now(),
  };
  res.json({ ok: true });
});

// Art proxy — locked to Plex host only
app.get("/art", async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).send("missing url");

  let parsed;
  try { parsed = new URL(rawUrl); } catch { return res.status(400).send("invalid url"); }

  if (parsed.host !== new URL(cfg.PLEX_BASE).host) {
    return res.status(403).send("forbidden");
  }

  try {
    const r = await fetchWithTimeout(rawUrl, 4000);
    if (!r.ok) return res.status(r.status).send("art_fetch_failed");
    res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.status(502).send("art_fetch_failed");
  }
});

// Kiosk exit — stops Plexamp playback then kills Chromium
app.post("/api/exit", (req, res) => {
  if (!localOnlyRequest(req) && !cfg.EXIT_API_TOKEN) {
    return res.status(403).json({ ok: false, error: "local_only" });
  }
  if (cfg.EXIT_API_TOKEN) {
    const presented = req.get("x-exit-token") || "";
    if (presented !== cfg.EXIT_API_TOKEN) return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const stopUrl = `${cfg.PLEX_BASE}/player/playback/stop?X-Plex-Token=${encodeURIComponent(cfg.PLEX_TOKEN)}&X-Plex-Target-Client-Identifier=${encodeURIComponent(cfg.PLEX_TARGET_CLIENT_IDENTIFIER)}&X-Plex-Client-Identifier=rsvp-radio&commandID=1`;
  exec(`curl -s -X GET "${stopUrl}" || true`, () => {
    setTimeout(() => {
      exec('pkill -f "chromium.*--kiosk" || true', () => res.json({ ok: true }));
    }, 500);
  });
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
      skipTracker.recordPlay({ ratingKey, title, artist });
      steering.notePlay(_steeringState, { mode: lastState.mode || blockModeForNow() });
      steering.markLaneResult(_steeringState, _steeringState.currentLaneTitle, "play");
      plexSync.syncCleanPlay(ratingKey, title, cfg.PLEX_BASE, cfg.PLEX_TOKEN);
    }

    res.sendStatus(200);
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
app.listen(cfg.PORT, () => {
  console.log(`[server] RSVP Radio on :${cfg.PORT}`);
  console.log(`[server] Plex: ${cfg.PLEX_BASE} | token: ${cfg.PLEX_TOKEN ? "set ✓" : "NOT SET ✗"}`);
  console.log(`[server] Serving: ${cfg.PUBLIC_DIR}`);
  const assets = assetHealth();
  if (!assets.ok) console.warn(`[server] Missing background assets: ${assets.missing.join(", ")}`);
  // Sync all existing skip data to Plex and resolve curated steering lanes.
  plexSync.syncAll(cfg.PLEX_BASE, cfg.PLEX_TOKEN);
  refreshSteeringLanes();
  pollSessions();
  setInterval(pollSessions, cfg.POLL_MS);
});
