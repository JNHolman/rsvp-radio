"use strict";

/**
 * LAN control integration tests.
 *
 * Admin endpoints are intentionally reachable from trusted LAN devices such as a
 * Mac or phone. `/api/exit` remains separately protected because it kills Chromium.
 *
 *  * These tests verify the endpoints respond 200 (or correct non-403 for
 * invalid input) when called over the loopback. Calling from a non-loopback
 * IP can't be cleanly simulated in a unit test without network plumbing,
 * so the strongest guarantee here is that no 403 response comes back.
 */

const test   = require("node:test");
const assert = require("node:assert/strict");
const { makePublicDir, startServer } = require("../helpers/server-test-helper");

const ADMIN_ENDPOINTS = [
  { method: "POST", path: "/admin/sync-ratings"        },
  { method: "POST", path: "/admin/plexamp/pause"       },
  { method: "POST", path: "/admin/plexamp/resume"      },
  { method: "POST", path: "/admin/force-timeblock-sync" },
  { method: "POST", path: "/mode/clear"                },
  { method: "POST", path: "/mode/rnb"                  },
];

for (const { method, path } of ADMIN_ENDPOINTS) {
  test(`${method} ${path} does not return 403 (trusted LAN)`, async () => {
    const server = await startServer({
      PUBLIC_DIR: makePublicDir({ withAssets: true }),
    });
    try {
      const r = await fetch(`${server.baseUrl}${path}`, { method });
      // The endpoint may legitimately return 200 (success), 500 (Plex
      // unreachable in test env), or 502 (downstream service down). The
      // Room controls are intentionally available to trusted LAN clients.
      assert.notEqual(r.status, 403,
        `${path} must NOT return 403 — trusted-LAN control must remain reachable`);
    } finally {
      await server.stop();
    }
  });
}

test("POST /video-failed accepts the local kiosk recovery beacon", async () => {
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
  });
  try {
    const r = await fetch(`${server.baseUrl}/video-failed`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ mediaUrl: "/media/999" }),
    });
    assert.equal(r.status, 200);
  } finally {
    await server.stop();
  }
});

test("POST /api/exit stays usable by the local kiosk when a remote token is configured", async () => {
  const server = await startServer({
    PUBLIC_DIR:     makePublicDir({ withAssets: true }),
    EXIT_API_TOKEN: "secret-token-xyz",
  });
  try {
    const r = await fetch(`${server.baseUrl}/api/exit`, { method: "POST" });
    assert.equal(r.status, 200, "local kiosk exit must not require the remote token");
  } finally {
    await server.stop();
  }
});
