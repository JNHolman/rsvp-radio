"use strict";

/**
 * Video handoff resilience integration tests.
 *
 * Covers:
 *  - corrective resume after late pause checks response.ok and
 *              preserves _plexampPausedByRsvp = true on failure so the normal
 *              resume path can retry instead of leaving Plexamp silently paused.
 *  - structured parser and regex fallback agree on "missing state =
 *              active video" for video sessions (parity test).
 *
 */

const test   = require("node:test");
const assert = require("node:assert/strict");
const http   = require("node:http");
const { makePublicDir, startServer } = require("../helpers/server-test-helper");

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// ── Corrective resume failure path ───────────────────────────────────────────

test("corrective resume failure: pausedByRsvpVideo flag is set true so retry path can fire", async () => {
  // Stub: pause succeeds slowly, resume always returns 500.
  // Sequence we want to exercise:
  //   1. Server polls Plex → sees a playing video → fires pause (in flight, slow)
  //   2. We POST /video-failed → bumps handoff token, fires resume
  //      (no-op because _plexampPausedByRsvp is still false, pause hasn't landed)
  //   3. Pause finally lands → token now stale → corrective resume fires
  //   4. Corrective resume returns 500 → _plexampPausedByRsvp set to true
  //   5. /state must reflect plexamp.pausedByRsvpVideo === true so the next
  //      retry trigger (poll, /video-failed, manual mode) can re-attempt.

  const FAKE_CLIENT = "test-plexamp-client-uuid";

  const plex = http.createServer(async (req, res) => {
    // Sessions endpoint — always shows the video session and a Plexamp track
    // tagged with our test client ID so isPlexampPlaying() detects it.
    if (req.url.startsWith("/status/sessions")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(
        '<MediaContainer size="2">' +
          '<Video type="movie" title="V" grandparentTitle="A" ' +
          'ratingKey="555" duration="100000" viewOffset="5000">' +
          `<Player state="playing" product="Plex" machineIdentifier="${FAKE_CLIENT}" />` +
          '<Media><Part file="/tmp/v.mp4" /></Media>' +
        '</Video>' +
        '<Track type="track" title="T" grandparentTitle="A2" parentTitle="X" ' +
        'ratingKey="100" duration="200000" viewOffset="1000">' +
        `<Player product="Plexamp" state="playing" machineIdentifier="${FAKE_CLIENT}" />` +
        '</Track></MediaContainer>',
      );
      return;
    }
    // Pause: succeed but slowly so the corrective race window opens.
    if (req.url.includes("/playback/pause")) {
      await delay(1200);
      res.writeHead(200); res.end("ok");
      return;
    }
    // Resume (play): always fail 500 to exercise corrective recovery.
    if (req.url.includes("/playback/play")) {
      res.writeHead(500); res.end("server error");
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => plex.listen(0, "127.0.0.1", r));
  const plexBase = `http://127.0.0.1:${plex.address().port}`;

  const server = await startServer({
    PUBLIC_DIR:   makePublicDir({ withAssets: true }),
    PLEX_BASE:    plexBase,
    PLEXAMP_BASE: plexBase,
    POLL_MS:      "200",
    PLEX_TARGET_CLIENT_IDENTIFIER: FAKE_CLIENT,
  });

  try {
    // Wait for the video poll → pause initiated. Pause stub will take 1.2s.
    await delay(400);

    // Trigger /video-failed mid-pause. This bumps the handoff token.
    await fetch(`${server.baseUrl}/video-failed`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ mediaUrl: "/media/555" }),
    });

    // Now wait for the slow pause to complete + the corrective resume attempt.
    // Pause: ~1.2s after poll fired. Then corrective resume fires (500).
    // Give it generous time.
    await delay(2500);

    const r = await fetch(`${server.baseUrl}/state`);
    const state = await r.json();

    // When corrective resume fails, the ownership flag must remain true
    // so the next normal trigger can retry. Don't silently abandon.
    assert.equal(
      state.plexamp.pausedByRsvpVideo,
      true,
      "corrective resume failure must leave pausedByRsvpVideo=true for retry",
    );
  } finally {
    await server.stop();
    await new Promise((r) => plex.close(r));
  }
});

// ── Structured parser and fallback agree on missing-state video ──────────────

test("plex-parser: structured path treats video with missing state as active (parity with regex fallback)", () => {
  const { parseSessions } = require("../../intelligence/plex-parser");
  // Structured path is exercised when fast-xml-parser is installed (it is).
  // We feed XML where Player has no state attribute at all.
  const xml =
    '<MediaContainer size="1">' +
      '<Video type="movie" title="V" grandparentTitle="A" ' +
      'ratingKey="900" duration="100000" viewOffset="5000">' +
      '<Player product="Plex" />' +
      '<Media><Part file="/tmp/v.mp4" /></Media>' +
      '</Video>' +
    '</MediaContainer>';
  const result = parseSessions(xml);
  assert.ok(result, "should not return null");
  assert.equal(result.isVideo, true, "missing state must be treated as active video");
  assert.equal(result.ratingKey, "900");
});

test("plex-parser: structured path treats video with empty-string state as active", () => {
  const { parseSessions } = require("../../intelligence/plex-parser");
  const xml =
    '<MediaContainer size="1">' +
      '<Video type="movie" title="V" grandparentTitle="A" ' +
      'ratingKey="901" duration="100000" viewOffset="5000">' +
      '<Player product="Plex" state="" />' +
      '<Media><Part file="/tmp/v.mp4" /></Media>' +
      '</Video>' +
    '</MediaContainer>';
  const result = parseSessions(xml);
  assert.ok(result, "should not return null");
  assert.equal(result.isVideo, true, "empty-string state must be treated as active video");
});

test("plex-parser: structured path still rejects paused/buffering/stopped video (no regression)", () => {
  const { parseSessions } = require("../../intelligence/plex-parser");
  for (const state of ["paused", "buffering", "stopped"]) {
    const xml =
      '<MediaContainer size="1">' +
        '<Video type="movie" title="V" grandparentTitle="A" ' +
        'ratingKey="902" duration="100000" viewOffset="5000">' +
        `<Player product="Plex" state="${state}" />` +
        '<Media><Part file="/tmp/v.mp4" /></Media>' +
      '</Video>' +
      '</MediaContainer>';
    const result = parseSessions(xml);
    assert.ok(!result || result.isVideo !== true,
      `state="${state}" must NOT be treated as active video`);
  }
});
