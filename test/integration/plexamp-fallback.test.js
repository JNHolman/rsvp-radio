"use strict";
// Verifies the now-playing card fallback: when /status/sessions is empty but
// the Plexamp :32500 timeline reports a playing track, the server builds the
// card from /library/metadata instead of going idle.

const test   = require("node:test");
const assert = require("node:assert");
const http   = require("node:http");
const { startServer, makePublicDir } = require("../helpers/server-test-helper");
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

test("cached-playback fallback: empty sessions + playing timeline => card shows", async () => {
  const state = { timelinePlaying: true };
  const srv = http.createServer((req, res) => {
    const u = req.url || "";
    if (u.startsWith("/status/sessions")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end('<MediaContainer size="0"></MediaContainer>');
    }
    if (u.includes("/player/timeline/poll")) {
      const st = state.timelinePlaying ? "playing" : "stopped";
      res.writeHead(200, { "Content-Type": "text/xml" });
      return res.end(`<MediaContainer><Timeline type="music" state="${st}" ratingKey="100" time="5000" duration="200000"/></MediaContainer>`);
    }
    if (u.startsWith("/library/metadata/100")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end('<MediaContainer size="1"><Track ratingKey="100" title="Cached Song" grandparentTitle="The Artist" parentTitle="The Album" thumb="/library/x/thumb" duration="200000"/></MediaContainer>');
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;

  const server = await startServer({
    PUBLIC_DIR:   makePublicDir({ withAssets: true }),
    PLEX_BASE:    base,
    PLEXAMP_BASE: base,
    POLL_MS:      "200",
    PLEXAMP_CLIENT_IDENTIFIER: "fb-test-client",
  });

  try {
    await delay(400);
    let st = await (await fetch(`${server.baseUrl}/state`)).json();
    assert.equal(st.media.type, "audio", "card shows audio from timeline fallback");
    assert.equal(st.media.title, "Cached Song");
    assert.equal(st.media.artist, "The Artist");
    assert.equal(st.media.album, "The Album");
    assert.equal(st.plexampFallback, true);

    // When the timeline stops, we go back to idle (no false card)
    state.timelinePlaying = false;
    await delay(400);
    st = await (await fetch(`${server.baseUrl}/state`)).json();
    assert.equal(st.media.type, "idle", "truly stopped => idle, no phantom card");
  } finally {
    await server.stop();
    await new Promise((r) => srv.close(r));
  }
});