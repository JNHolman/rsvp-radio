"use strict";

/**
 * Integration test — locks in the /state shape contract.
 * Asserts every namespace and required field are present and well-typed.
 */

const test   = require("node:test");
const assert = require("node:assert/strict");
const { makePublicDir, startServer } = require("../helpers/server-test-helper");

test("/state returns the complete nested runtime shape", async () => {
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
  });
  try {
    const r = await fetch(`${server.baseUrl}/state`);
    assert.equal(r.status, 200);
    const body = await r.json();

    // Top-level scalars
    assert.equal(typeof body.appState,  "string", "appState present and string");
    assert.equal(typeof body.updatedAt, "number", "updatedAt present and number");
    assert.equal(typeof body.error,     "string", "error present and string");

    // appState is one of the documented values
    const validAppStates = new Set(["IDLE", "AUDIO_PLAYING", "AUDIO_PAUSED", "VIDEO_PLAYING", "VIDEO_PAUSED"]);
    assert.ok(validAppStates.has(body.appState), `appState ${body.appState} must be one of ${[...validAppStates].join("|")}`);

    // media namespace
    assert.equal(typeof body.media,              "object", "media object present");
    assert.equal(typeof body.media.type,         "string", "media.type present");
    assert.equal(typeof body.media.playerState,  "string", "media.playerState present");
    assert.equal(typeof body.media.title,        "string", "media.title present");
    assert.equal(typeof body.media.artist,       "string", "media.artist present");
    assert.equal(typeof body.media.album,        "string", "media.album present");
    assert.equal(typeof body.media.ratingKey,    "string", "media.ratingKey present");
    assert.equal(typeof body.media.artUrl,       "string", "media.artUrl present");
    assert.equal(typeof body.media.mediaUrl,     "string", "media.mediaUrl present");
    assert.equal(typeof body.media.viewOffsetMs, "number", "media.viewOffsetMs present");
    assert.equal(typeof body.media.durationMs,   "number", "media.durationMs present");

    // mode namespace
    assert.equal(typeof body.mode,                  "object", "mode object present");
    assert.equal(typeof body.mode.current,          "string", "mode.current present");
    assert.equal(typeof body.mode.source,           "string", "mode.source present");
    assert.equal(typeof body.mode.manualExpiresAt,  "number", "mode.manualExpiresAt present");
    assert.ok(["timeblock", "seed", "manual"].includes(body.mode.source), "mode.source is a valid value");

    // video namespace
    assert.equal(typeof body.video,       "object", "video object present");
    assert.equal(typeof body.video.phase, "string", "video.phase present");
    assert.ok(["none", "playing", "paused"].includes(body.video.phase), "video.phase is a valid value");

    // intelligence namespace
    assert.equal(typeof body.intelligence,             "object", "intelligence object present");
    assert.equal(typeof body.intelligence.strikes,     "number", "intelligence.strikes present");
    assert.equal(typeof body.intelligence.softStrikes, "number", "intelligence.softStrikes present");
    assert.equal(typeof body.intelligence.rating,      "number", "intelligence.rating present");
    assert.ok(
      body.intelligence.lastPlayPercent === null || typeof body.intelligence.lastPlayPercent === "number",
      "intelligence.lastPlayPercent present — null or number",
    );

    // music namespace
    assert.equal(typeof body.music,                       "object",  "music object present");
    assert.equal(typeof body.music.desiredPlaylist,       "string",  "music.desiredPlaylist present");
    assert.equal(typeof body.music.lastCommandedPlaylist, "string",  "music.lastCommandedPlaylist present");
    assert.equal(typeof body.music.commandAligned,        "boolean", "music.commandAligned present");

    // steering namespace
    assert.equal(typeof body.steering,               "object",  "steering object present");
    assert.equal(typeof body.steering.skipThreshold, "number",  "steering.skipThreshold present");
    assert.equal(typeof body.steering.lanesPerMode,  "object",  "steering.lanesPerMode present");

    // plexamp namespace
    assert.equal(typeof body.plexamp,                    "object",  "plexamp object present");
    assert.equal(typeof body.plexamp.pausedByRsvpVideo,  "boolean", "plexamp.pausedByRsvpVideo present");

    // features namespace
    assert.equal(typeof body.features,        "object", "features object present");
    assert.equal(typeof body.features.bass,   "number", "features.bass present");
    assert.equal(typeof body.features.energy, "number", "features.energy present");
  } finally {
    await server.stop();
  }
});

test("/state idle defaults: appState IDLE, media.type 'idle', mode source 'timeblock'", async () => {
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
  });
  try {
    const r = await fetch(`${server.baseUrl}/state`);
    const body = await r.json();
    // Plex isn't reachable in tests so we expect to be in IDLE
    assert.equal(body.appState,         "IDLE");
    assert.equal(body.media.type,       "idle");
    assert.equal(body.media.playerState, "");
    assert.equal(body.mode.source,       "timeblock");
    assert.equal(body.video.phase,       "none");
  } finally {
    await server.stop();
  }
});

test("/admin/skip-data returns a tracks array (empty when no data)", async () => {
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    SKIP_DATA_PATH: "/tmp/rsvp-skip-data-nonexistent.json",
  });
  try {
    const r = await fetch(`${server.baseUrl}/admin/skip-data`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body.tracks), "tracks is an array");
  } finally {
    await server.stop();
  }
});