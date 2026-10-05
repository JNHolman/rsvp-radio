"use strict";
// Verifies the lights-seed fix: the first song of a session sets the lights
// mode from its GENRE even when the current timeblock HAS a playlist configured
// (the old code skipped the seed in that case -> the "Rap song but LOFI lights"
// bug). Also verifies the seed HOLDS on the next (non-new-session) track, and
// that lights are decoupled from the schedule/playlist mode.

const test   = require("node:test");
const assert = require("node:assert");
const http   = require("node:http");
const os     = require("node:os");
const path   = require("node:path");
const fs     = require("node:fs");
const { startServer, makePublicDir } = require("../helpers/server-test-helper");
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

test("lights seed: first song's Rap genre sets lights even with a playlist configured", async () => {
  const sessionFile = path.join(os.tmpdir(), `rsvp-sess-${Date.now()}.json`);
  try { fs.unlinkSync(sessionFile); } catch (_) {}

  const srv = http.createServer((req, res) => {
    const u = req.url || "";
    if (u.startsWith("/status/sessions")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end(
        '<MediaContainer size="1">' +
        '<Track type="track" title="I&apos;m a King" grandparentTitle="Various Artists" ' +
        'parentTitle="Hustle &amp; Flow" ratingKey="300" duration="200000" viewOffset="3000">' +
        '<Player product="Plexamp" state="playing" machineIdentifier="seed-test-client"/>' +
        '</Track></MediaContainer>');
    }
    if (u.startsWith("/library/metadata/300")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end('<MediaContainer size="1"><Track ratingKey="300" title="I&apos;m a King" grandparentTitle="Various Artists"><Genre tag="Rap"/></Track></MediaContainer>');
    }
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end('<MediaContainer size="0"></MediaContainer>');
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;

  const server = await startServer({
    PUBLIC_DIR:  makePublicDir({ withAssets: true }),
    PLEX_BASE:   base,
    POLL_MS:     "200",
    SESSION_DATA_PATH: sessionFile,
    PLEXAMP_CLIENT_IDENTIFIER: "seed-test-client",
    // Every block has a playlist — the condition under which the OLD code
    // skipped the seed entirely.
    PLAYLIST_LOFI: "111", PLAYLIST_WRAP: "222", PLAYLIST_RAP: "333", PLAYLIST_RNB: "444",
  });

  try {
    await delay(450);
    let st = await (await fetch(`${server.baseUrl}/state`)).json();
    assert.equal(st.media.type, "audio", "track is playing");
    assert.equal(st.mode.current, "rap", "lights follow the Rap genre seed, not the timeblock");
    assert.equal(st.mode.source, "seed", "source is seed");

    // Second poll: same session (not idle) — seed must HOLD, not revert.
    await delay(300);
    st = await (await fetch(`${server.baseUrl}/state`)).json();
    assert.equal(st.mode.current, "rap", "seed holds across tracks in the same session");
  } finally {
    await server.stop();
    await new Promise((r) => srv.close(r));
    try { fs.unlinkSync(sessionFile); } catch (_) {}
  }
});
