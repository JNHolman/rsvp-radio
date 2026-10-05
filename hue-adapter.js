"use strict";

try {
  require("dotenv").config();
} catch (_) {
  // systemd EnvironmentFile is the production source of environment values.
}

const http = require("http");
const https = require("https");
const {
  MODES,
  loadConfig,
  validateConfig,
  groupActionPath,
  groupResourcePath,
  configPath,
  scenePayload,
  powerPayload,
  brightnessPayload,
  groupBrightness,
  hueBodyHasError,
  verifyBridgeIdentity,
  readCa,
} = require("./hue/hue-client");
const { createReactiveLighting } = require("./hue/reactive-lighting");

const cfg = loadConfig();
const reactive = createReactiveLighting({ minIntervalMs: cfg.reactiveMinIntervalMs, range: cfg.reactiveRange });
const missing = validateConfig(cfg);
if (missing.length) {
  console.error(`[hue] missing required configuration: ${missing.join(", ")}`);
  process.exitCode = 78;
  throw new Error("Hue adapter configuration incomplete");
}

let ca;
try {
  ca = readCa(cfg);
} catch (err) {
  console.error(`[hue] unable to read HUE_CA_CERT_PATH: ${err.message}`);
  process.exitCode = 78;
  throw err;
}

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
    "cache-control": "no-store",
  });
  res.end(payload);
}

function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    let tooLarge = false;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        tooLarge = true;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) return reject(Object.assign(new Error("body_too_large"), { statusCode: 413 }));
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (_) {
        reject(Object.assign(new Error("invalid_json"), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function hueRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const options = {
      protocol: "https:",
      hostname: cfg.bridgeHost,
      port: 443,
      method,
      path,
      timeout: cfg.timeoutMs,
      rejectUnauthorized: true,
      servername: cfg.bridgeId,
      checkServerIdentity: (_hostname, cert) => verifyBridgeIdentity(cfg.bridgeId, cert),
      ...(ca ? { ca } : {}),
      headers: {
        accept: "application/json",
        ...(payload ? {
          "content-type": "application/json",
          "content-length": payload.length,
        } : {}),
      },
    };

    const request = https.request(options, (response) => {
      const chunks = [];
      let total = 0;
      response.on("data", (chunk) => {
        total += chunk.length;
        if (total <= 256 * 1024) chunks.push(chunk);
      });
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        if (text) {
          try { parsed = JSON.parse(text); } catch (_) { parsed = text; }
        }
        const ok = response.statusCode >= 200 && response.statusCode < 300 && !hueBodyHasError(parsed);
        resolve({ ok, status: response.statusCode || 502, body: parsed });
      });
    });

    request.on("timeout", () => request.destroy(new Error("hue_timeout")));
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function applyScene(mode, durMs) {
  const startedAt = Date.now();
  reactive.onSceneTransition(startedAt, durMs);
  try {
    const result = await hueRequest("PUT", groupActionPath(cfg), scenePayload(cfg, mode, durMs));
    if (!result.ok) reactive.onSceneTransition(Date.now(), 0);
    return result;
  } catch (err) {
    reactive.onSceneTransition(Date.now(), 0);
    throw err;
  }
}

async function applyPower(on) {
  const result = await hueRequest("PUT", groupActionPath(cfg), powerPayload(on));
  if (result.ok) reactive.onPower(on);
  return result;
}

async function readGroupBrightness() {
  const result = await hueRequest("GET", groupResourcePath(cfg));
  if (!result.ok) return null;
  const bri = groupBrightness(result.body);
  if (bri === null) return null;
  return reactive.setBaseBrightness(bri);
}

async function applyReactiveSignal(body) {
  if (!cfg.reactiveEnabled) {
    return { status: 200, body: { ok: true, action: "signal", applied: false, reason: "reactive_disabled" } };
  }

  const bass = Number(body?.bass);
  const energy = Number(body?.energy);
  if (!Number.isFinite(bass) || !Number.isFinite(energy) || bass < 0 || bass > 1 || energy < 0 || energy > 1) {
    return { status: 400, body: { ok: false, error: "invalid_signal" } };
  }

  let plan = reactive.plan({ bass, energy, nowMs: Date.now() });
  if (plan.kind === "need_base") {
    const base = await readGroupBrightness();
    if (base === null) {
      return { status: 200, body: { ok: true, action: "signal", applied: false, reason: "base_unavailable" } };
    }
    plan = reactive.plan({ bass, energy, nowMs: Date.now() });
  }

  if (plan.kind !== "apply") {
    return { status: 200, body: { ok: true, action: "signal", applied: false, reason: plan.reason || plan.kind } };
  }

  const result = await hueRequest(
    "PUT",
    groupActionPath(cfg),
    brightnessPayload(plan.brightness, cfg.reactiveTransitionMs),
  );
  if (!result.ok) reactive.markWriteFailed();
  return {
    status: result.ok ? 200 : 502,
    body: { ok: result.ok, action: "signal", applied: result.ok, brightness: plan.brightness, hueStatus: result.status },
  };
}

async function handler(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/health") {
    try {
      const bridge = await hueRequest("GET", configPath(cfg));
      return json(res, bridge.ok ? 200 : 503, {
        ok: bridge.ok,
        adapter: "philips-hue",
        bridgeReachable: bridge.ok,
        modes: MODES,
      });
    } catch (err) {
      return json(res, 503, { ok: false, adapter: "philips-hue", bridgeReachable: false, error: err.message });
    }
  }

  if (req.method !== "POST") return json(res, 405, { ok: false, error: "method_not_allowed" });

  try {
    const body = await readJson(req);

    if (url.pathname === "/on" || url.pathname === "/off") {
      const on = url.pathname === "/on";
      const result = await applyPower(on);
      return json(res, result.ok ? 200 : 502, { ok: result.ok, action: on ? "on" : "off", hueStatus: result.status });
    }

    const modeMatch = url.pathname.match(/^\/mode\/(lofi|lounge|wrap|rap|rnb)$/);
    if (modeMatch) {
      const mode = modeMatch[1] === "wrap" ? "lounge" : modeMatch[1];
      const result = await applyScene(mode, cfg.modeTransitionMs);
      return json(res, result.ok ? 200 : 502, { ok: result.ok, action: "mode", mode, hueStatus: result.status });
    }

    if (url.pathname === "/transition") {
      const to = String(body.to || "").toLowerCase();
      if (!MODES.includes(to)) return json(res, 400, { ok: false, error: "invalid_destination_mode" });
      const durMs = Number(body.durMs);
      if (!Number.isFinite(durMs) || durMs < 0 || durMs > 2 * 60 * 60 * 1000) {
        return json(res, 400, { ok: false, error: "invalid_duration" });
      }
      const result = await applyScene(to, durMs);
      return json(res, result.ok ? 200 : 502, {
        ok: result.ok,
        action: "transition",
        from: MODES.includes(String(body.from || "").toLowerCase()) ? String(body.from).toLowerCase() : null,
        to,
        durMs: Math.round(durMs),
        hueStatus: result.status,
      });
    }

    if (url.pathname === "/signal") {
      const result = await applyReactiveSignal(body);
      return json(res, result.status, result.body);
    }

    return json(res, 404, { ok: false, error: "not_found" });
  } catch (err) {
    const status = err.statusCode || 502;
    return json(res, status, { ok: false, error: err.message || "hue_request_failed" });
  }
}

const server = http.createServer((req, res) => {
  handler(req, res).catch((err) => {
    console.error(`[hue] request failed: ${err.message}`);
    if (!res.headersSent) json(res, 500, { ok: false, error: "internal_error" });
    else res.end();
  });
});

server.listen(cfg.port, cfg.bind, () => {
  console.log(`[hue] adapter listening on http://${cfg.bind}:${cfg.port}`);
  console.log(`[hue] bridge=${cfg.bridgeHost} bridgeId=${cfg.bridgeId} group=${cfg.groupId} tls=verified`);
});

function shutdown(signal) {
  console.log(`[hue] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));