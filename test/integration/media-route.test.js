"use strict";

/**
 * /media/:ratingKey integration tests.
 *
 * End-to-end coverage for full/range streaming and filesystem containment.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs   = require("node:fs");
const os   = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { makePublicDir, startServer } = require("../helpers/server-test-helper");

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Spawn a Plex stub. Each test gets a fresh stub with a route map.
async function startPlexStub(handlers) {
  const server = http.createServer((req, res) => {
    for (const [pattern, fn] of handlers) {
      if (typeof pattern === "string" ? req.url.startsWith(pattern) : pattern.test(req.url)) {
        return fn(req, res);
      }
    }
    res.writeHead(404); res.end("not_found");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async stop() { await new Promise((r) => server.close(r)); },
  };
}

// Make a real on-disk file inside a temp MEDIA_DIR so we can stream it.
function makeMediaFile() {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-media-"));
  const subdir = path.join(mediaDir, "RSVP Radio", "Videos");
  fs.mkdirSync(subdir, { recursive: true });
  const filePath = path.join(subdir, "test video.mp4");
  // Plant a small but non-trivial payload so range requests have something to chew on.
  fs.writeFileSync(filePath, Buffer.alloc(2048, 0x61)); // 2KB of 'a'
  return { mediaDir, filePath };
}

function metadataXml(filePath) {
  return '<MediaContainer size="1">' +
    '<Video ratingKey="110" title="Test Video">' +
      '<Media>' +
        `<Part file="${filePath.replace(/&/g, "&amp;")}" />` +
      '</Media>' +
    '</Video>' +
  '</MediaContainer>';
}

// ── 200 OK + 206 Partial Content ──────────────────────────────────────────────

test("/media/:ratingKey returns 200 with full file when no Range header sent", async () => {
  const { mediaDir, filePath } = makeMediaFile();
  const plex = await startPlexStub([
    [/^\/library\/metadata\/110/, (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(metadataXml(filePath));
    }],
  ]);
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    PLEX_BASE:  plex.baseUrl,
    MEDIA_DIR:  mediaDir,
  });
  try {
    const r = await fetch(`${server.baseUrl}/media/110`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "video/mp4");
    const body = await r.arrayBuffer();
    assert.equal(body.byteLength, 2048);
  } finally {
    await server.stop();
    await plex.stop();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
});

test("/media/:ratingKey returns 206 Partial Content when Range header sent", async () => {
  const { mediaDir, filePath } = makeMediaFile();
  const plex = await startPlexStub([
    [/^\/library\/metadata\/110/, (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(metadataXml(filePath));
    }],
  ]);
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    PLEX_BASE:  plex.baseUrl,
    MEDIA_DIR:  mediaDir,
  });
  try {
    const r = await fetch(`${server.baseUrl}/media/110`, {
      headers: { Range: "bytes=0-99" },
    });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get("content-range"), "bytes 0-99/2048");
    assert.equal(r.headers.get("content-length"), "100");
    const body = await r.arrayBuffer();
    assert.equal(body.byteLength, 100);
  } finally {
    await server.stop();
    await plex.stop();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
});

test("/media/:ratingKey handles suffix range (last N bytes)", async () => {
  const { mediaDir, filePath } = makeMediaFile();
  const plex = await startPlexStub([
    [/^\/library\/metadata\/110/, (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(metadataXml(filePath));
    }],
  ]);
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    PLEX_BASE:  plex.baseUrl,
    MEDIA_DIR:  mediaDir,
  });
  try {
    const r = await fetch(`${server.baseUrl}/media/110`, {
      headers: { Range: "bytes=-200" },
    });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get("content-range"), "bytes 1848-2047/2048");
  } finally {
    await server.stop();
    await plex.stop();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
});

// ── 403: file path is outside MEDIA_DIR ───────────────────────────────────────

test("/media/:ratingKey returns 403 when Plex reports a file path outside MEDIA_DIR", async () => {
  const { mediaDir } = makeMediaFile();
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-other-"));
  const escapeFile = path.join(otherDir, "evil.mp4");
  fs.writeFileSync(escapeFile, Buffer.alloc(64));
  const plex = await startPlexStub([
    [/^\/library\/metadata\/110/, (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(metadataXml(escapeFile));
    }],
  ]);
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    PLEX_BASE:  plex.baseUrl,
    MEDIA_DIR:  mediaDir,
  });
  try {
    const r = await fetch(`${server.baseUrl}/media/110`);
    assert.equal(r.status, 403);
  } finally {
    await server.stop();
    await plex.stop();
    fs.rmSync(mediaDir,  { recursive: true, force: true });
    fs.rmSync(otherDir,  { recursive: true, force: true });
  }
});

// ── 404: file missing on disk ─────────────────────────────────────────────────

test("/media/:ratingKey returns 404 when file path is inside MEDIA_DIR but file is missing", async () => {
  const { mediaDir } = makeMediaFile();
  const ghostFile = path.join(mediaDir, "RSVP Radio", "Videos", "ghost.mp4");
  // Don't create the file.
  const plex = await startPlexStub([
    [/^\/library\/metadata\/110/, (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(metadataXml(ghostFile));
    }],
  ]);
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    PLEX_BASE:  plex.baseUrl,
    MEDIA_DIR:  mediaDir,
  });
  try {
    const r = await fetch(`${server.baseUrl}/media/110`);
    assert.equal(r.status, 404);
  } finally {
    await server.stop();
    await plex.stop();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
});

// ── 404: Plex metadata response has no <Part> ─────────────────────────────────

test("/media/:ratingKey returns 404 when Plex metadata has no Part element", async () => {
  const { mediaDir } = makeMediaFile();
  const plex = await startPlexStub([
    [/^\/library\/metadata\/110/, (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end('<MediaContainer size="1"><Video ratingKey="110" title="X" /></MediaContainer>');
    }],
  ]);
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    PLEX_BASE:  plex.baseUrl,
    MEDIA_DIR:  mediaDir,
  });
  try {
    const r = await fetch(`${server.baseUrl}/media/110`);
    assert.equal(r.status, 404);
    const body = await r.text();
    assert.match(body, /no_file_in_metadata/i);
  } finally {
    await server.stop();
    await plex.stop();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
});

// ── 502: only when Plex fetch actually throws ─────────────────────────────────

test("/media/:ratingKey returns 502 only when Plex fetch fails (server unreachable)", async () => {
  const { mediaDir } = makeMediaFile();
  // Point at a bogus port — fetch should fail to connect.
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    PLEX_BASE:  "http://127.0.0.1:1",  // reserved/unreachable
    MEDIA_DIR:  mediaDir,
    POLL_TIMEOUT_MS: "200",
  });
  try {
    const r = await fetch(`${server.baseUrl}/media/110`);
    assert.equal(r.status, 502);
    const body = await r.text();
    assert.match(body, /plex_lookup_failed/i);
  } finally {
    await server.stop();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
});

// ── 404 when Plex returns non-2xx (NOT 502 — those are different cases) ──────

test("/media/:ratingKey returns 404 (not 502) when Plex returns 401 unauthorized", async () => {
  const { mediaDir } = makeMediaFile();
  const plex = await startPlexStub([
    [/^\/library\/metadata\/110/, (_req, res) => { res.writeHead(401); res.end("unauthorized"); }],
  ]);
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    PLEX_BASE:  plex.baseUrl,
    MEDIA_DIR:  mediaDir,
  });
  try {
    const r = await fetch(`${server.baseUrl}/media/110`);
    // Plex said no but the request didn't throw — that's plex_metadata_not_found, not plex_lookup_failed.
    assert.equal(r.status, 404);
    const body = await r.text();
    assert.match(body, /plex_metadata_not_found/i);
  } finally {
    await server.stop();
    await plex.stop();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
});

// ── 400 on malformed ratingKey (non-numeric) ──────────────────────────────────

test("/media/:ratingKey returns 400 on non-numeric ratingKey", async () => {
  const { mediaDir } = makeMediaFile();
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    MEDIA_DIR:  mediaDir,
  });
  try {
    const r = await fetch(`${server.baseUrl}/media/notakey`);
    assert.equal(r.status, 400);
  } finally {
    await server.stop();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
});

test("/media/:ratingKey blocks symlink escape from inside MEDIA_DIR", async () => {
  const { mediaDir } = makeMediaFile();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-media-outside-"));
  const outsideFile = path.join(outsideDir, "outside.mp4");
  fs.writeFileSync(outsideFile, Buffer.alloc(64, 0x62));
  const symlinkPath = path.join(mediaDir, "RSVP Radio", "Videos", "linked.mp4");
  fs.symlinkSync(outsideFile, symlinkPath);

  const plex = await startPlexStub([
    [/^\/library\/metadata\/110/, (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(metadataXml(symlinkPath));
    }],
  ]);
  const server = await startServer({
    PUBLIC_DIR: makePublicDir({ withAssets: true }),
    PLEX_BASE: plex.baseUrl,
    MEDIA_DIR: mediaDir,
  });
  try {
    const r = await fetch(`${server.baseUrl}/media/110`);
    assert.equal(r.status, 403);
  } finally {
    await server.stop();
    await plex.stop();
    fs.rmSync(mediaDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});
