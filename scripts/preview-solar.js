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
let plexQueue = null, plexArt = null, dotenv = null;
try {
  plexQueue = require("../intelligence/plex-queue");
  plexArt = require("../intelligence/plex-art");
  dotenv = require("dotenv");
} catch (_) {
  console.warn("[solar-preview] Run npm ci in the test worktree to enable read-only queue lookup.");
}

async function liveGet(pathname) {
  const response = await fetch("http://127.0.0.1:3000" + pathname, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error("Live RSVP GET failed: " + response.status);
  return response;
}

function previewPlexConfig() {
  if (!dotenv) return null;
  try {
    // Only read the original Pi's local .env; never send its token to the browser.
    const envPath = path.resolve(__dirname, "../../rsvp-radio/.env");
    const vars = dotenv.parse(fs.readFileSync(envPath));
    const token = vars.PLEX_TOKEN || "";
    if (!token) return null;
    return {
      token,
      base: vars.PLEX_BASE || "http://127.0.0.1:32400",
      clientId: vars.PLEXAMP_CLIENT_IDENTIFIER || vars.PLEX_TARGET_CLIENT_IDENTIFIER || "",
      plexampBase: vars.PLEXAMP_BASE || "http://127.0.0.1:32500",
    };
  } catch (_) { return null; }
}

async function previewQueue() {
  const none = (reason) => ({available:false, tracks:[], reason});
  const cfg = previewPlexConfig();
  if (!cfg || !plexQueue || !plexArt) return none("plex_config_unavailable");
  try {
    const live = await (await liveGet("/state")).json();
    const currentKey = String(live?.media?.ratingKey || "");
    if (live?.media?.type !== "audio" || !currentKey) return none("not_playing");
    const sessionsUrl = new URL("/status/sessions", cfg.base);
    sessionsUrl.searchParams.set("X-Plex-Token", cfg.token);
    const sessions = await fetch(sessionsUrl, { signal: AbortSignal.timeout(3000) });
    let context = sessions.ok ? plexQueue.parseCurrentQueueContext(await sessions.text(), cfg.clientId) : null;
    if ((!context || context.ratingKey !== currentKey) && cfg.clientId) {
      try {
        const localUrl = new URL("/player/timeline/poll", cfg.plexampBase);
        localUrl.searchParams.set("wait", "0");
        localUrl.searchParams.set("commandID", String(Date.now()));
        localUrl.searchParams.set("X-Plex-Client-Identifier", "rsvp-radio");
        localUrl.searchParams.set("X-Plex-Target-Client-Identifier", cfg.clientId);
        const local = await fetch(localUrl, { signal: AbortSignal.timeout(1800) });
        if (local.ok) context = plexQueue.parseTimelineQueueContext(await local.text());
      } catch (_) {}
    }
    if (!context || context.ratingKey !== currentKey) return none("play_queue_not_reported");
    const queueUrl = new URL("/playQueues/" + context.queueId, cfg.base);
    queueUrl.searchParams.set("X-Plex-Token", cfg.token);
    queueUrl.searchParams.set("window", "8");
    if (context.itemId) queueUrl.searchParams.set("center", context.itemId);
    const response = await fetch(queueUrl, { signal: AbortSignal.timeout(3000), headers:{Accept:"application/json"} });
    if (!response.ok) return none("queue_unavailable");
    const queue = plexQueue.parseUpcomingQueue(await response.json(), context);
    if (!queue.available) return queue;
    return { available:true, reason:"", tracks:queue.tracks.map(t => {
      const art = plexArt.browserSafeSourceUrl(t.thumb, cfg.base);
      return { title:t.title, artist:t.artist, album:t.album, artUrl:art ? "/art?url=" + encodeURIComponent(art) : "" };
    }) };
  } catch (_) { return none("queue_unavailable"); }
}


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

const server = http.createServer(async (req, res) => {
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
  if (pathname === "/state" || pathname === "/art") {
    try {
      const upstream = await liveGet(pathname + url.search);
      const body = Buffer.from(await upstream.arrayBuffer());
      const type = pathname === "/state" ? "application/json" : (upstream.headers.get("content-type") || "image/jpeg");
      return send(res, 200, type, body);
    } catch (_) {
      return pathname === "/state"
        ? send(res, 200, "application/json", JSON.stringify({ media: { type: "idle", playerState: "" } }))
        : send(res, 404, "text/plain", "Artwork unavailable");
    }
  }
  if (pathname === "/api/up-next") {
    return send(res, 200, "application/json", JSON.stringify(await previewQueue()));
  }
  if (pathname === "/api/weather") {
    try {
      const api = "https://api.open-meteo.com/v1/forecast?latitude=38.2527&longitude=-85.7585&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America%2FKentucky%2FLouisville";
      const result = await fetch(api, { signal: AbortSignal.timeout(4000) });
      if (!result.ok) throw new Error("Weather unavailable");
      const json = await result.json();
      const temp = json?.current?.temperature_2m;
      if (!Number.isFinite(temp)) throw new Error("Temperature unavailable");
      const code = Number(json?.current?.weather_code);
      const summary = ({0:"Clear",1:"Mostly Clear",2:"Partly Cloudy",3:"Cloudy",45:"Fog",48:"Fog",51:"Drizzle",53:"Drizzle",55:"Drizzle",61:"Rain",63:"Rain",65:"Heavy Rain",71:"Snow",73:"Snow",75:"Heavy Snow",80:"Showers",81:"Showers",82:"Heavy Showers",95:"Thunderstorm"})[code] || "Conditions unavailable";
      return send(res, 200, "application/json", JSON.stringify({available:true,temperatureF:temp,description:summary}));
    } catch (_) { return send(res, 200, "application/json", JSON.stringify({available:false})); }
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