const test = require("node:test");
const assert = require("node:assert/strict");
const { makePublicDir, startServer } = require("../helpers/server-test-helper");

test("/runtime-config.js reflects LIGHTS_URL and shared schedule", async () => {
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    LIGHTS_URL: "http://127.0.0.1:5999",
  });
  try {
    const res = await fetch(`${server.baseUrl}/runtime-config.js`);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.match(text, /http:\/\/127\.0\.0\.1:5999/);
    assert.match(text, /timeBlocks/);
    assert.match(text, /preFadeMin/);
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

test("/api/exit requires token when EXIT_API_TOKEN is set", async () => {
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    EXIT_API_TOKEN: "secret-token",
  });
  try {
    const denied = await fetch(`${server.baseUrl}/api/exit`, { method: "POST" });
    assert.equal(denied.status, 403);

    const allowed = await fetch(`${server.baseUrl}/api/exit`, {
      method: "POST",
      headers: { "x-exit-token": "secret-token" },
    });
    const body = await allowed.json();
    assert.equal(allowed.status, 200);
    assert.equal(body.ok, true);
  } finally {
    await server.stop();
  }
});
