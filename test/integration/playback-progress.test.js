const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { makePublicDir, startServer } = require("../helpers/server-test-helper");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startPlexSequenceStub() {
  let sessionPolls = 0;

  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/status/sessions")) {
      sessionPolls++;
      res.writeHead(200, { "Content-Type": "application/xml" });

      if (sessionPolls <= 2) {
        res.end('<MediaContainer size="1"><Track type="track" title="First" grandparentTitle="Artist" ratingKey="1" duration="200000" viewOffset="150000"><Player product="Plexamp" state="playing" /></Track></MediaContainer>');
      } else if (sessionPolls <= 4) {
        res.end('<MediaContainer size="0"></MediaContainer>');
      } else {
        res.end('<MediaContainer size="1"><Track type="track" title="Second" grandparentTitle="Artist" ratingKey="2" duration="200000" viewOffset="1000"><Player product="Plexamp" state="playing" /></Track></MediaContainer>');
      }
      return;
    }

    if (req.url.startsWith("/library/metadata/")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end('<MediaContainer><Track><Genre tag="Hip Hop"/></Track></MediaContainer>');
      return;
    }

    if (req.url.startsWith("/:/rate")) {
      res.writeHead(200);
      res.end("ok");
      return;
    }

    res.writeHead(404);
    res.end("not_found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async stop() { await new Promise((resolve) => server.close(resolve)); },
  };
}

test("idle gap between tracks does not turn a mostly-played song into a hard skip", async () => {
  const plex = await startPlexSequenceStub();
  const skipPath = path.join(os.tmpdir(), `rsvp-skip-${Date.now()}-progress.json`);
  const sessionPath = path.join(os.tmpdir(), `rsvp-session-${Date.now()}-progress.json`);
  fs.rmSync(skipPath, { force: true });
  fs.rmSync(sessionPath, { force: true });

  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    PLEX_BASE: plex.baseUrl,
    PLEX_TOKEN: "test-token",
    POLL_MS: "80",
    POLL_TIMEOUT_MS: "500",
    SKIP_DATA_PATH: skipPath,
    SESSION_DATA_PATH: sessionPath,
  });

  try {
    const started = Date.now();
    let reachedSecond = false;
    while (Date.now() - started < 3000) {
      const state = await (await fetch(`${server.baseUrl}/state`)).json();
      if (state.title === "Second") {
        reachedSecond = true;
        break;
      }
      await delay(60);
    }

    assert.equal(reachedSecond, true);
    assert.equal(fs.existsSync(skipPath), false, "mostly-played first track must not receive a skip record");
  } finally {
    await server.stop();
    await plex.stop();
    fs.rmSync(skipPath, { force: true });
    fs.rmSync(sessionPath, { force: true });
  }
});
