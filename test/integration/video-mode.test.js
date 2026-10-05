"use strict";
// Verifies the admin-triggered local video mode end-to-end against a stub that
// plays BOTH the Plex (:32400) and Plexamp (:32500) roles. PLEX_BASE and
// PLEXAMP_BASE both point at the stub; it routes by path.

const test   = require("node:test");
const assert = require("node:assert");
const http   = require("node:http");
const { startServer, makePublicDir } = require("../helpers/server-test-helper");
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function makeStub() {
  const state = { plexampPlaying: false };
  const srv = http.createServer((req, res) => {
    const u = req.url || "";
    if (u.startsWith("/status/sessions")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end('<MediaContainer size="0"></MediaContainer>');
    }
    if (u.startsWith("/library/metadata/")) {
      const rk = u.split("/library/metadata/")[1].split("?")[0];
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end(`<MediaContainer size="1"><Track ratingKey="${rk}" title="Clip ${rk}" grandparentTitle="Real Artist ${rk}" parentTitle="Real Album" thumb="/library/x/${rk}"/></MediaContainer>`);
    }
    if (u.startsWith("/playlists/") && u.includes("/items")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end(
        '<MediaContainer size="2">' +
        '<Video ratingKey="201" title="Clip One"><Media><Part file="/tmp/a.mp4"/></Media></Video>' +
        '<Video ratingKey="202" title="Clip Two"><Media><Part file="/tmp/b.mp4"/></Media></Video>' +
        '</MediaContainer>');
    }
    if (u.startsWith("/playlists")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end(
        '<MediaContainer size="2">' +
        '<Playlist ratingKey="41" title="Lounge Videos" playlistType="video" smart="0"/>' +
        '<Playlist ratingKey="36" title="All Music" playlistType="audio" smart="1"/>' +
        '</MediaContainer>');
    }
    if (u.includes("/player/playback/pause")) { res.writeHead(200); return res.end("ok"); }
    if (u.includes("/player/playback/play"))  { res.writeHead(200); return res.end("ok"); }
    if (u.includes("/player/timeline/poll")) {
      const st = state.plexampPlaying ? "playing" : "paused";
      res.writeHead(200, { "Content-Type": "text/xml" });
      return res.end(`<MediaContainer><Timeline type="music" state="${st}" ratingKey="100"/></MediaContainer>`);
    }
    res.writeHead(404); res.end();
  });
  return { srv, state };
}

test("video mode: list playlists, play, auto-advance, and Plexamp override", async () => {
  const { srv, state } = makeStub();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;

  const server = await startServer({
    PUBLIC_DIR:   makePublicDir({ withAssets: true }),
    PLEX_BASE:    base,
    PLEXAMP_BASE: base,
    POLL_MS:      "200",
    PLEXAMP_CLIENT_IDENTIFIER: "vid-test-client",
  });

  try {
    // 1. Video playlists are listed (video type only)
    let r = await fetch(`${server.baseUrl}/admin/video-playlists`);
    let j = await r.json();
    assert.equal(j.ok, true);
    assert.equal(j.playlists.length, 1, "only the video-type playlist is listed");
    assert.equal(j.playlists[0].ratingKey, "41");

    // 2. Play it → enters video mode; /state synthesizes the first clip
    r = await fetch(`${server.baseUrl}/admin/video/play/41`, { method: "POST" });
    j = await r.json();
    assert.equal(j.ok, true);
    assert.equal(j.clips, 2);

    await delay(400); // let a poll run
    let st = await (await fetch(`${server.baseUrl}/state`)).json();
    assert.equal(st.media.type, "video");
    assert.equal(st.media.mediaUrl, "/media/201", "first clip is active");
    assert.equal(st.media.artist, "Real Artist 201", "video card shows real clip metadata, not playlist name");

    // 3. Clip ends → server advances to clip two
    await fetch(`${server.baseUrl}/api/log`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "ended", mediaUrl: "/media/201" }),
    });
    await delay(400);
    st = await (await fetch(`${server.baseUrl}/state`)).json();
    assert.equal(st.media.mediaUrl, "/media/202", "advanced to second clip");

    // 4. Plexamp starts playing → video mode exits (music wins, sticky)
    state.plexampPlaying = true;
    await delay(500);
    st = await (await fetch(`${server.baseUrl}/state`)).json();
    assert.notEqual(st.media.type, "video", "Plexamp override exits video mode");
  } finally {
    await server.stop();
    await new Promise((r) => srv.close(r));
  }
});

test("manual admin video may play outside the current block and holds until the next boundary", async () => {
  const timeblocks = require("../../shared/timeblocks");
  const modes = ["lofi", "lounge", "rap", "rnb"];
  const currentMode = timeblocks.blockModeForDate(new Date());
  const manualMode = modes.find((m) => m !== currentMode);
  const titleByMode = {
    lofi: "LoFi Videos",
    lounge: "Lounge Videos",
    rap: "Rap Videos",
    rnb: "R&B Videos",
  };

  const srv = http.createServer((req, res) => {
    const u = req.url || "";
    if (u.startsWith("/status/sessions")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end('<MediaContainer size="0"></MediaContainer>');
    }
    if (u.startsWith("/playlists/99/items")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end('<MediaContainer size="1"><Video ratingKey="901" title="Manual Clip"><Media><Part file="/tmp/manual.mp4"/></Media></Video></MediaContainer>');
    }
    if (u.startsWith("/playlists")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end(`<MediaContainer size="1"><Playlist ratingKey="99" title="${titleByMode[manualMode]}" playlistType="video"/></MediaContainer>`);
    }
    if (u.startsWith("/library/metadata/901")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end('<MediaContainer size="1"><Track ratingKey="901" title="Manual Clip" grandparentTitle="Manual Artist" thumb="/library/x/901"/></MediaContainer>');
    }
    if (u.includes("/player/timeline/poll")) {
      res.writeHead(200, { "Content-Type": "text/xml" });
      return res.end('<MediaContainer><Timeline type="music" state="paused"/></MediaContainer>');
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;

  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    PLEX_BASE: base,
    PLEXAMP_BASE: base,
    POLL_MS: "200",
    PLEXAMP_CLIENT_IDENTIFIER: "manual-video-client",
  });

  try {
    const before = Date.now();
    const r = await fetch(`${server.baseUrl}/admin/video/play/99`, { method: "POST" });
    assert.equal(r.status, 200, "explicit admin video selection must bypass the current block");
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.mode, manualMode);
    assert.ok(body.manualUntil > before, "manual video selection gets a future boundary expiry");

    const st = await (await fetch(`${server.baseUrl}/state`)).json();
    assert.equal(st.media.type, "video");
    assert.equal(st.mode.current, manualMode);
    assert.equal(st.mode.source, "manual");
    assert.equal(st.mode.manualExpiresAt, body.manualUntil);
  } finally {
    await server.stop();
    await new Promise((r) => srv.close(r));
  }
});

test("Radio-to-TV handoff waits for Plexamp pause to settle before arming Radio takeover", async () => {
  let pauseCalls = 0;
  let settlePolls = 0;
  let explicitRadioRestart = false;

  const srv = http.createServer((req, res) => {
    const u = req.url || "";
    if (u.startsWith("/status/sessions")) {
      // Deliberately empty: takeover must use the direct Plexamp receiver state,
      // not stale/absent PMS session data.
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end('<MediaContainer size="0"></MediaContainer>');
    }
    if (u.startsWith("/playlists/41/items")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end('<MediaContainer size="1"><Video ratingKey="201" title="Clip One"><Media><Part file="/tmp/a.mp4"/></Media></Video></MediaContainer>');
    }
    if (u.startsWith("/playlists")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end('<MediaContainer size="1"><Playlist ratingKey="41" title="Rap Videos" playlistType="video"/></MediaContainer>');
    }
    if (u.startsWith("/library/metadata/201")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end('<MediaContainer size="1"><Track ratingKey="201" title="Clip One" grandparentTitle="Artist" thumb="/library/x/201"/></MediaContainer>');
    }
    if (u.includes("/player/playback/pause")) {
      pauseCalls += 1;
      settlePolls = 0;
      res.writeHead(200);
      return res.end("ok");
    }
    if (u.includes("/player/timeline/poll")) {
      let state = "playing";
      if (explicitRadioRestart) {
        state = "playing";
      } else if (pauseCalls > 0) {
        // Simulate the real receiver lag: three direct polls still report the
        // old playing state after Pause, then the receiver settles to paused.
        state = settlePolls++ < 3 ? "playing" : "paused";
      }
      res.writeHead(200, { "Content-Type": "text/xml" });
      return res.end(`<MediaContainer><Timeline type="music" state="${state}" ratingKey="100"/></MediaContainer>`);
    }
    if (u.includes("/player/playback/play")) {
      res.writeHead(200); return res.end("ok");
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;

  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    PLEX_BASE: base,
    PLEXAMP_BASE: base,
    POLL_MS: "100",
    PLEXAMP_CLIENT_IDENTIFIER: "handoff-client",
  });

  try {
    const r = await fetch(`${server.baseUrl}/admin/video/play/41`, { method: "POST" });
    assert.equal(r.status, 200);
    assert.equal(pauseCalls, 1, "TV takeover must send one direct Plexamp pause");

    await delay(350);
    let st = await (await fetch(`${server.baseUrl}/state`)).json();
    assert.equal(st.media.type, "video",
      "residual playing reports from RSVP's own pause must not immediately kill TV");

    explicitRadioRestart = true;
    await delay(350);
    st = await (await fetch(`${server.baseUrl}/state`)).json();
    assert.notEqual(st.media.type, "video",
      "a new Plexamp playing transition after takeover is armed must reclaim the room for Radio");
  } finally {
    await server.stop();
    await new Promise((r) => srv.close(r));
  }
});
