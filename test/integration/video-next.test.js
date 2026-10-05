"use strict";
const test   = require("node:test");
const assert = require("node:assert");
const http   = require("node:http");
const { startServer, makePublicDir } = require("../helpers/server-test-helper");
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

test("video Next Clip: manual advance moves to the next clip", async () => {
  const srv = http.createServer((req, res) => {
    const u = req.url || "";
    if (u.startsWith("/status/sessions")) { res.writeHead(200,{ "Content-Type":"application/xml"}); return res.end('<MediaContainer size="0"></MediaContainer>'); }
    if (u.startsWith("/playlists/") && u.includes("/items")) { res.writeHead(200,{ "Content-Type":"application/xml"}); return res.end('<MediaContainer size="3"><Video ratingKey="201" title="One"/><Video ratingKey="202" title="Two"/><Video ratingKey="203" title="Three"/></MediaContainer>'); }
    if (u.startsWith("/playlists")) { res.writeHead(200,{ "Content-Type":"application/xml"}); return res.end('<MediaContainer size="1"><Playlist ratingKey="41" title="Lounge Videos" playlistType="video"/></MediaContainer>'); }
    if (u.includes("/player/playback/pause")) { res.writeHead(200); return res.end("ok"); }
    if (u.includes("/player/timeline/poll")) { res.writeHead(200,{ "Content-Type":"text/xml"}); return res.end('<MediaContainer><Timeline type="music" state="paused"/></MediaContainer>'); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const server = await startServer({ PUBLIC_DIR: makePublicDir({ withAssets:true }), PLEX_BASE: base, PLEXAMP_BASE: base, POLL_MS:"200", PLEXAMP_CLIENT_IDENTIFIER:"vn-client" });
  try {
    await fetch(`${server.baseUrl}/admin/video/play/41`, { method:"POST" });
    await delay(300);
    let st = await (await fetch(`${server.baseUrl}/state`)).json();
    assert.equal(st.media.mediaUrl, "/media/201", "starts on clip 1");
    const r = await (await fetch(`${server.baseUrl}/admin/video/next`, { method:"POST" })).json();
    assert.equal(r.ok, true);
    assert.equal(r.index, 1, "advanced to index 1");
    await delay(300);
    st = await (await fetch(`${server.baseUrl}/state`)).json();
    assert.equal(st.media.mediaUrl, "/media/202", "now on clip 2");
  } finally {
    await server.stop(); await new Promise((r) => srv.close(r));
  }
});
