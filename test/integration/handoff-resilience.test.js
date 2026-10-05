"use strict";

/**
 * Video handoff resilience integration tests.
 *
 * Covers:
 *  - admin-owned TV takeover does not publish TV until Plexamp confirms
 *    a non-playing state after RSVP sends Pause.
 *  - structured parser and regex fallback agree on "missing state =
 *    active video" for video sessions (parser parity; parser is reused elsewhere).
 *
 */

const test   = require("node:test");
const assert = require("node:assert/strict");
const http   = require("node:http");
const { makePublicDir, startServer } = require("../helpers/server-test-helper");

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// ── Corrective resume failure path ───────────────────────────────────────────

test("TV takeover aborts cleanly when Plexamp never confirms the pause", async () => {
  const FAKE_CLIENT = "test-plexamp-client-uuid";

  const plex = http.createServer((req, res) => {
    const u = req.url || "";

    if (u.startsWith("/status/sessions")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end('<MediaContainer size="0"></MediaContainer>');
    }

    if (u.startsWith("/playlists/41/items")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end(
        '<MediaContainer size="1">' +
        '<Video ratingKey="555" title="Test Clip"><Media><Part file="/tmp/v.mp4"/></Media></Video>' +
        '</MediaContainer>',
      );
    }

    if (u.startsWith("/playlists")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end(
        '<MediaContainer size="1">' +
        '<Playlist ratingKey="41" title="Rap Videos" playlistType="video"/>' +
        '</MediaContainer>',
      );
    }

    if (u.includes("/player/playback/pause")) {
      res.writeHead(200);
      return res.end("ok");
    }

    // Simulate a receiver that acknowledges Pause but never actually leaves
    // playing state. RSVP must NOT publish TV ownership in this condition.
    if (u.includes("/player/timeline/poll")) {
      res.writeHead(200, { "Content-Type": "text/xml" });
      return res.end(
        '<MediaContainer><Timeline type="music" state="playing" ratingKey="100"/></MediaContainer>',
      );
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((r) => plex.listen(0, "127.0.0.1", r));
  const plexBase = `http://127.0.0.1:${plex.address().port}`;

  const server = await startServer({
    PUBLIC_DIR:   makePublicDir({ withAssets: true }),
    PLEX_BASE:    plexBase,
    PLEXAMP_BASE: plexBase,
    POLL_MS:      "200",
    PLEXAMP_CLIENT_IDENTIFIER: FAKE_CLIENT,
  });

  try {
    const r = await fetch(`${server.baseUrl}/admin/video/play/41`, { method: "POST" });
    assert.equal(r.status, 400, "TV takeover must fail when Plexamp never confirms non-playing");
    const body = await r.json();
    assert.equal(body.error, "plexamp_pause_unconfirmed");

    const state = await (await fetch(`${server.baseUrl}/state`)).json();
    assert.notEqual(state.media.type, "video", "failed takeover must not publish TV ownership");
    assert.equal(
      state.plexamp.pausedByRsvpVideo,
      false,
      "receiver still reports playing, so RSVP must not claim it owns a pause",
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