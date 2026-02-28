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
const cfg      = require("./config");

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
// Keep in sync with public/app/config.js and rsvp_lights_service.py
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function blockModeForNow() {
  const m = nowMinutes();
  if (m >= 4  * 60 && m < 12 * 60) return "lofi";
  if (m >= 12 * 60 && m < 17 * 60) return "wrap";
  if (m >= 17 * 60 && m < 23 * 60) return "rap";
  return "rnb";
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

// ── UI state ──────────────────────────────────────────────────────────────────
let lastState = {
  event: "idle", mode: blockModeForNow(),
  type: "", title: "", artist: "", album: "",
  playerState: "", viewOffsetMs: 0, durationMs: 0,
  thumb: "", artUrl: "",
  bass: 0, energy: 0,
  updatedAt: Date.now(), error: "",
};

// ── Plex poll ─────────────────────────────────────────────────────────────────
async function pollSessions() {
  const { bass, energy } = featuresNow();
  const mode             = blockModeForNow();

  try {
    const url = `${cfg.PLEX_BASE}/status/sessions?X-Plex-Token=${encodeURIComponent(cfg.PLEX_TOKEN)}`;
    const r   = await fetchWithTimeout(url, 2500);

    if (!r.ok) {
      lastState = { ...lastState, event: "idle", mode, bass, energy, updatedAt: Date.now(), error: `plex_http_${r.status}` };
      return;
    }

    const t = parseSessions(await r.text());

    if (!t || (!t.title && !t.thumb && !t.artist && !t.album)) {
      lastState = {
        ...lastState, event: "idle", mode,
        type: "", title: "", artist: "", album: "",
        playerState: "", viewOffsetMs: 0, durationMs: 0,
        thumb: "", artUrl: "", bass, energy, updatedAt: Date.now(), error: "",
      };
      return;
    }

    const plexArt = buildPlexArtUrl(t.thumb);
    lastState = {
      event: t.playerState === "paused" ? "media.pause" : "media.play",
      mode,
      type: t.type, title: t.title, artist: t.artist, album: t.album,
      playerState: t.playerState,
      viewOffsetMs: t.viewOffsetMs, durationMs: t.durationMs,
      thumb: t.thumb,
      artUrl: plexArt ? `/art?url=${encodeURIComponent(plexArt)}` : "",
      bass, energy, updatedAt: Date.now(), error: "",
    };

  } catch {
    lastState = { ...lastState, event: "idle", mode, bass, energy, updatedAt: Date.now(), error: "plex_poll_failed" };
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/", express.static(cfg.PUBLIC_DIR));

app.get("/state",  (_req, res) => res.json(lastState));

app.get("/health", (_req, res) =>
  res.json({ ok: true, mode: lastState.mode, updatedAt: lastState.updatedAt })
);

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

// Kiosk exit — local Pi only, intentionally simple
app.post("/api/exit", (_req, res) => {
  exec('pkill -f "chromium.*--kiosk" || true', () => res.json({ ok: true }));
});

// ── Plex webhook receiver ─────────────────────────────────────────────────────
// Plex sends multipart/form-data — the JSON payload is in a field called "payload"
// We parse it manually since express.json() won't touch multipart.
// Phase 1: log everything so we can see exactly what events Plex fires.
// Nothing else in the system is affected.

app.post("/plex", (req, res) => {
  let body = "";
  req.on("data", chunk => { body += chunk.toString(); });
  req.on("end", () => {
    try {
      // Extract the JSON from the multipart payload field
      const match = body.match(/"payload"\s*[\r\n]+([^\r\n]+[\r\n]+)*?({[\s\S]*?})\s*[-]+/);
      const jsonStr = match ? match[2] : null;

      if (!jsonStr) {
        console.log("[plex-webhook] received but could not parse payload");
        return res.sendStatus(200);
      }

      const payload = JSON.parse(jsonStr);
      const event   = payload.event        || "unknown";
      const title   = payload.Metadata?.title           || "";
      const artist  = payload.Metadata?.grandparentTitle || "";
      const ratingKey = payload.Metadata?.ratingKey     || "";

      console.log(`[plex-webhook] ${event} | "${title}" by ${artist} | key:${ratingKey}`);

    } catch (err) {
      console.log("[plex-webhook] parse error:", err.message);
    }
    res.sendStatus(200);
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
app.listen(cfg.PORT, () => {
  console.log(`[server] RSVP Radio on :${cfg.PORT}`);
  console.log(`[server] Plex: ${cfg.PLEX_BASE} | token: ${cfg.PLEX_TOKEN ? "set ✓" : "NOT SET ✗"}`);
  console.log(`[server] Serving: ${cfg.PUBLIC_DIR}`);
  pollSessions();
  setInterval(pollSessions, cfg.POLL_MS);
});
