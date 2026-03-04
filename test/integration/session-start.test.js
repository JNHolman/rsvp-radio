const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { makePublicDir, startServer } = require("../helpers/server-test-helper");
const timeblocks = require("../../shared/timeblocks");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startPlexStub({ metadataDelayMs, genre }) {
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith("/status/sessions")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(
        '<MediaContainer size="1"><Track type="track" title="Seed Song" grandparentTitle="Artist" parentTitle="Album" ratingKey="123" duration="200000" viewOffset="1000"><Player product="Plexamp" state="playing" /></Track></MediaContainer>',
      );
      return;
    }

    if (req.url.startsWith("/library/metadata/123")) {
      await delay(metadataDelayMs);
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(`<MediaContainer><Track><Genre tag="${genre}"/></Track></MediaContainer>`);
      return;
    }

    res.writeHead(404);
    res.end("not_found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test("first playing state uses seed genre mode, not an intermediate time-block mode", async () => {
  const currentBlock = timeblocks.blockModeForDate(new Date());
  const genre = currentBlock === "rap" ? "Neo-Soul" : "Hip Hop";
  const expectedMode = genre === "Neo-Soul" ? "rnb" : "rap";

  const plex = await startPlexStub({ metadataDelayMs: 700, genre });
  const sessionPath = path.join(os.tmpdir(), `rsvp-session-${Date.now()}-atomic.json`);
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    PLEX_BASE: plex.baseUrl,
    PLEX_TOKEN: "test-token",
    SESSION_DATA_PATH: sessionPath,
    SESSION_GENRE_FETCH_TIMEOUT_MS: "1500",
    POLL_MS: "10000",
    POLL_TIMEOUT_MS: "1500",
  });

  try {
    const observed = [];
    const started = Date.now();
    let firstPlaying = null;

    while (Date.now() - started < 4000) {
      const res = await fetch(`${server.baseUrl}/state`, { cache: "no-store" });
      const body = await res.json();
      observed.push({ event: body.event, mode: body.mode });
      if (body.event === "media.play") {
        firstPlaying = body;
        break;
      }
      await delay(100);
    }

    assert.ok(firstPlaying, "expected a playing state to appear");
    assert.equal(firstPlaying.mode, expectedMode);
    assert.ok(
      observed.slice(0, -1).every((state) => state.event === "idle"),
      `expected only idle states before first playing state, saw ${JSON.stringify(observed)}`,
    );
  } finally {
    await server.stop();
    await plex.stop();
    fs.rmSync(sessionPath, { force: true });
  }
});
