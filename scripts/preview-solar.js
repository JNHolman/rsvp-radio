"use strict";

/**
 * Isolated, read-only preview for approved artwork and solar transitions.
 * No Plex, Hue, scheduler, or RSVP orchestration code is started.
 * Start on the Pi:
 *   TZ=America/Kentucky/Louisville node scripts/preview-solar.js
 * Viewer:  http://rsvp-radio.local:3001/
 * Control: http://rsvp-radio.local:3001/preview-controls
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { getSolarPhase } = require("../shared/solar-phase");

const ROOT = path.resolve(__dirname, "../public");
const PORT = Number(process.env.PREVIEW_PORT || 3001);
const LATITUDE = Number(process.env.SOLAR_LATITUDE ?? "38.2527");
const LONGITUDE = Number(process.env.SOLAR_LONGITUDE ?? "-85.7585");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp4": "video/mp4",
};
let forcedPhase = null;

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...extra });
  res.end(body);
}

function controlsPage() {
  const selected = forcedPhase || "auto";
  const link = (phase, label) => '<a href="/preview/force/' + phase + '" style="display:inline-block;padding:14px 18px;border:1px solid #999;border-radius:9px;margin:7px;color:#fff;text-decoration:none;background:' + (selected === phase ? "#456" : "#222") + '">' + label + '</a>';
  return '<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><title>RSVP Solar Preview Controls</title><body style="font:20px system-ui;background:#111;color:white;padding:28px"><h1>RSVP Solar Preview</h1><p>Current test setting: <strong>' + selected.toUpperCase() + '</strong></p><p>Open the viewer in another tab or on the TV. Changing the setting below will update its background within 20 seconds, using the real crossfade.</p>' + link("day", "Force DAY") + link("night", "Force NIGHT") + link("auto", "Follow sunrise/dusk") + '<p><a style="color:#aaf" href="/">Open preview viewer</a></p><p>Preview only — no music, Plexamp, or Hue controls.</p></body></html>';
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "text/plain", "GET only");

  let url;
  try { url = new URL(req.url, "http://localhost"); }
  catch (_) { return send(res, 400, "text/plain", "Invalid URL"); }
  const pathname = url.pathname;

  if (pathname === "/api/solar-state") {
    try {
      const result = getSolarPhase(new Date(), LATITUDE, LONGITUDE);
      if (!result.phase) return send(res, 503, "application/json", JSON.stringify({ error: "solar_phase_unavailable" }));
      return send(res, 200, "application/json", JSON.stringify({
        phase: forcedPhase || result.phase,
        actualPhase: result.phase,
        previewOverride: forcedPhase,
        sunrise: result.sunrise.toISOString(),
        dusk: result.dusk.toISOString(),
        nextTransition: result.nextTransition ? result.nextTransition.toISOString() : null,
      }));
    } catch (_) {
      return send(res, 503, "application/json", JSON.stringify({ error: "solar_phase_unavailable" }));
    }
  }
  if (pathname === "/preview-controls") return send(res, 200, "text/html; charset=utf-8", controlsPage());
  if (pathname.startsWith("/preview/force/")) {
    const phase = pathname.slice("/preview/force/".length);
    if (!["day", "night", "auto"].includes(phase)) return send(res, 404, "text/plain", "Unknown preview mode");
    forcedPhase = phase === "auto" ? null : phase;
    res.writeHead(302, { Location: "/preview-controls", "Cache-Control": "no-store" });
    return res.end();
  }
  if (pathname === "/runtime-config.js") {
    return send(res, 200, "text/javascript; charset=utf-8", "window.RSVP_RUNTIME_CONFIG={pollMs:2000,pollTimeoutMs:2000};");
  }
  if (pathname === "/state") {
    return send(res, 200, "application/json", JSON.stringify({ media: { type: "idle", playerState: "" } }));
  }

  // Serve only public/ and never expose .env or other local files.
  let filename;
  try { filename = decodeURIComponent(pathname === "/" ? "/index.html" : pathname); }
  catch (_) { return send(res, 400, "text/plain", "Invalid path"); }
  const resolved = path.resolve(ROOT, "." + filename);
  if (!resolved.startsWith(ROOT + path.sep)) return send(res, 403, "text/plain", "Forbidden");
  const type = MIME[path.extname(resolved).toLowerCase()];
  if (!type) return send(res, 404, "text/plain", "Not found");

  fs.stat(resolved, (error, stats) => {
    if (error || !stats.isFile()) return send(res, 404, "text/plain", "Not found");
    res.writeHead(200, { "Content-Type": type, "Content-Length": stats.size, "Cache-Control": "no-store" });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(resolved).pipe(res);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("[solar-preview] VIEWER   http://rsvp-radio.local:" + PORT + "/");
  console.log("[solar-preview] CONTROLS http://rsvp-radio.local:" + PORT + "/preview-controls");
  console.log("[solar-preview] Isolated preview only: no Plex, Hue, or automation commands");
});