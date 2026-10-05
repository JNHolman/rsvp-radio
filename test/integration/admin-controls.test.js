"use strict";

/**
 * Admin control integration tests.
 *  - /admin/top-songs returns played + struck rankings
 *  - /admin/lights/* proxies through to the lights service (so admin works
 *    from any LAN device, not just the Pi-local browser)
 */

const test   = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const os     = require("node:os");
const path   = require("node:path");
const http   = require("node:http");
const { makePublicDir, startServer } = require("../helpers/server-test-helper");

// ── /admin/top-songs ─────────────────────────────────────────────────────────

test("/admin/top-songs returns empty arrays when no skip data", async () => {
  const server = await startServer({
    PUBLIC_DIR:     makePublicDir({ withAssets: true }),
    SKIP_DATA_PATH: "/tmp/rsvp-nonexistent-" + Date.now() + ".json",
  });
  try {
    const r = await fetch(`${server.baseUrl}/admin/top-songs`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual(body, { topPlayed: [], topStruck: [] });
  } finally {
    await server.stop();
  }
});

test("/admin/top-songs: topPlayed sorted desc by plays, capped at 10", async () => {
  const skipPath = path.join(os.tmpdir(), `rsvp-skip-${Date.now()}.json`);
  // Plant 12 entries with varying plays.
  const data = {};
  for (let i = 1; i <= 12; i++) {
    data[String(i)] = {
      ratingKey: String(i),
      title:     `Song ${i}`,
      artist:    `Artist ${i}`,
      plays:     i * 2, // 2, 4, 6, ... 24
      strikes:   0,
      softStrikes: 0,
      history:   [],
    };
  }
  fs.writeFileSync(skipPath, JSON.stringify(data));
  const server = await startServer({
    PUBLIC_DIR:     makePublicDir({ withAssets: true }),
    SKIP_DATA_PATH: skipPath,
  });
  try {
    const r = await fetch(`${server.baseUrl}/admin/top-songs`);
    const body = await r.json();
    assert.equal(body.topPlayed.length, 10, "topPlayed capped at 10");
    assert.equal(body.topPlayed[0].plays, 24, "sorted desc — highest first");
    assert.equal(body.topPlayed[9].plays, 6,  "tenth entry has plays:6");
    // Songs with 0 plays excluded
    for (const t of body.topPlayed) assert.ok(t.plays > 0);
  } finally {
    await server.stop();
    fs.rmSync(skipPath, { force: true });
  }
});

test("/admin/top-songs: topStruck sorted desc by strikes, capped at 10, excludes zero-strike", async () => {
  const skipPath = path.join(os.tmpdir(), `rsvp-skip-${Date.now()}.json`);
  const data = {};
  // 5 with strikes, 3 with only soft, 4 clean.
  for (let i = 1; i <= 5;  i++) data[`s${i}`]  = { ratingKey: `s${i}`,  title: `Strike ${i}`,  artist: "X", plays: 0, strikes: i,   softStrikes: 0, history: [] };
  for (let i = 1; i <= 3;  i++) data[`ss${i}`] = { ratingKey: `ss${i}`, title: `SoftOnly ${i}`, artist: "X", plays: 0, strikes: 0,   softStrikes: 0.5, history: [] };
  for (let i = 1; i <= 4;  i++) data[`c${i}`]  = { ratingKey: `c${i}`,  title: `Clean ${i}`,    artist: "X", plays: 5, strikes: 0,   softStrikes: 0, history: [] };
  fs.writeFileSync(skipPath, JSON.stringify(data));
  const server = await startServer({
    PUBLIC_DIR:     makePublicDir({ withAssets: true }),
    SKIP_DATA_PATH: skipPath,
  });
  try {
    const r = await fetch(`${server.baseUrl}/admin/top-songs`);
    const body = await r.json();
    // 5 with strikes + 3 soft-only = 8 entries
    assert.equal(body.topStruck.length, 8, "8 entries with any strikes");
    assert.equal(body.topStruck[0].strikes, 5, "highest strikes first");
    // Clean songs excluded
    for (const t of body.topStruck) {
      assert.ok(t.strikes > 0 || t.softStrikes > 0, "no fully-clean songs in topStruck");
    }
  } finally {
    await server.stop();
    fs.rmSync(skipPath, { force: true });
  }
});

// ── /admin/lights/* proxy ────────────────────────────────────────────────────

async function startLightsStub() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      calls.push({ method: req.method, path: req.url, body });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, mock: true }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    calls,
    async stop() { await new Promise((r) => server.close(r)); },
  };
}

test("/admin/lights/on forwards to lights service", async () => {
  const lights = await startLightsStub();
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    LIGHTS_URL: lights.baseUrl,
  });
  try {
    const r = await fetch(`${server.baseUrl}/admin/lights/on`, { method: "POST" });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok,     true);
    assert.equal(body.action, "on");
    assert.ok(lights.calls.some((c) => c.path === "/on"), "lights stub received /on");
  } finally {
    await server.stop();
    await lights.stop();
  }
});

test("/admin/lights/off forwards to lights service", async () => {
  const lights = await startLightsStub();
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    LIGHTS_URL: lights.baseUrl,
  });
  try {
    const r = await fetch(`${server.baseUrl}/admin/lights/off`, { method: "POST" });
    assert.equal(r.status, 200);
    assert.ok(lights.calls.some((c) => c.path === "/off"));
  } finally {
    await server.stop();
    await lights.stop();
  }
});

test("/admin/lights/mode/:mode forwards correct path", async () => {
  const lights = await startLightsStub();
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    LIGHTS_URL: lights.baseUrl,
  });
  try {
    const r = await fetch(`${server.baseUrl}/admin/lights/mode/rnb`, { method: "POST" });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.action, "mode/rnb");
    assert.ok(lights.calls.some((c) => c.path === "/mode/rnb"));
  } finally {
    await server.stop();
    await lights.stop();
  }
});

test("/admin/lights/mode/:mode rejects invalid mode with 400", async () => {
  const lights = await startLightsStub();
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    LIGHTS_URL: lights.baseUrl,
  });
  try {
    const r = await fetch(`${server.baseUrl}/admin/lights/mode/notreal`, { method: "POST" });
    assert.equal(r.status, 400);
    assert.equal(lights.calls.length, 0, "lights stub should not be called for invalid mode");
  } finally {
    await server.stop();
    await lights.stop();
  }
});

test("/admin/lights/* returns 502 when lights service is down", async () => {
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    LIGHTS_URL: "http://127.0.0.1:1", // unreachable port
  });
  try {
    const r = await fetch(`${server.baseUrl}/admin/lights/on`, { method: "POST" });
    assert.equal(r.status, 502);
    const body = await r.json();
    assert.equal(body.ok, false);
  } finally {
    await server.stop();
  }
});

test("/features updates analyzer health and relays reactive signal without Chromium", async () => {
  const lights = await startLightsStub();
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    LIGHTS_URL: lights.baseUrl,
  });
  try {
    const featureRes = await fetch(`${server.baseUrl}/features`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bass: 0.72, energy: 0.44 }),
    });
    assert.equal(featureRes.status, 200);

    for (let i = 0; i < 20 && !lights.calls.some((c) => c.path === "/signal"); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(lights.calls.some((c) => c.path === "/signal"), "server relayed analyzer features to Hue adapter");

    const health = await (await fetch(`${server.baseUrl}/health`)).json();
    assert.equal(health.analyzer.fresh, true);
    assert.ok(Number.isFinite(health.analyzer.ageMs));
  } finally {
    await server.stop();
    await lights.stop();
  }
});
