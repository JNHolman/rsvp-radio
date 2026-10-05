const test = require("node:test");
const assert = require("node:assert/strict");
const { makePublicDir, startServer } = require("../helpers/server-test-helper");

test("/runtime-config.js exposes browser settings but not server scheduling or Hue endpoints", async () => {
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    LIGHTS_URL: "http://127.0.0.1:5999",
    POLL_MS: "1777",
  });
  try {
    const res = await fetch(`${server.baseUrl}/runtime-config.js`);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.match(text, /1777/);
    assert.doesNotMatch(text, /127\.0\.0\.1:5999/);
    assert.doesNotMatch(text, /timeBlocks/);
    assert.doesNotMatch(text, /preFadeMin/);
  } finally {
    await server.stop();
  }
});

test("/health turns not ok when required background assets are missing", async () => {
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: false }),
  });
  try {
    const res = await fetch(`${server.baseUrl}/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.assetsOk, false);
    assert.equal(body.ok, false);
    assert.ok(body.assetsMissing.length >= 1);
  } finally {
    await server.stop();
  }
});

test("/plex rejects oversized webhook payloads", async () => {
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    PLEX_WEBHOOK_MAX_BYTES: "64",
  });
  try {
    const res = await fetch(`${server.baseUrl}/plex`, {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=test" },
      body: "x".repeat(200),
    });
    assert.equal(res.status, 413);
  } finally {
    await server.stop();
  }
});

test("/api/exit allows the local kiosk even when EXIT_API_TOKEN is set", async () => {
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    EXIT_API_TOKEN: "secret-token",
  });
  try {
    const allowed = await fetch(`${server.baseUrl}/api/exit`, { method: "POST" });
    const body = await allowed.json();
    assert.equal(allowed.status, 200);
    assert.equal(body.ok, true);
  } finally {
    await server.stop();
  }
});