const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function freshSessionModule(sessionDataPath) {
  process.env.SESSION_DATA_PATH = sessionDataPath;
  const target = require.resolve("../../intelligence/session");
  delete require.cache[target];
  return require("../../intelligence/session");
}

test("genreToMode maps elite seed genres correctly", () => {
  const tmp = path.join(os.tmpdir(), `rsvp-session-${Date.now()}-map.json`);
  const session = freshSessionModule(tmp);
  assert.equal(session.genreToMode(["Neo-Soul"]), "rnb");
  assert.equal(session.genreToMode(["Southern Hip Hop"]), "rap");
  assert.equal(session.genreToMode(["Jazz Lounge"]), "lofi");
  assert.equal(session.genreToMode(["Electronic Dance"]), "wrap");
  assert.equal(session.genreToMode(["Unknown"]), null);
});

test("checkSession returns a new seed mode only after a real idle gap", async () => {
  const tmp = path.join(os.tmpdir(), `rsvp-session-${Date.now()}-check.json`);
  let genre = "Hip Hop";
  global.fetch = async () => ({ ok: true, text: async () => `<MediaContainer><Track><Genre tag="${genre}"/></Track></MediaContainer>` });
  const session = freshSessionModule(tmp);

  const first = await session.checkSession({ ratingKey: "1", title: "A", artist: "B" }, "http://127.0.0.1:32400", "token", () => "wrap");
  assert.equal(first, "rap");

  const second = await session.checkSession({ ratingKey: "2", title: "C", artist: "D" }, "http://127.0.0.1:32400", "token", () => "wrap");
  assert.equal(second, null);

  const saved = JSON.parse(fs.readFileSync(tmp, "utf8"));
  saved.lastPlayedAt = Date.now() - (46 * 60 * 1000);
  fs.writeFileSync(tmp, JSON.stringify(saved));

  genre = "Jazz Lounge";
  const third = await session.checkSession({ ratingKey: "3", title: "E", artist: "F" }, "http://127.0.0.1:32400", "token", () => "wrap");
  assert.equal(third, "lofi");

  const updated = JSON.parse(fs.readFileSync(tmp, "utf8"));
  assert.equal(updated.seedMode, "lofi");
});


test("slow genre fetch does not double-count a new session", async () => {
  const tmp = path.join(os.tmpdir(), `rsvp-session-${Date.now()}-race.json`);
  let release;
  global.fetch = () => new Promise((resolve) => {
    release = () => resolve({ ok: true, text: async () => '<MediaContainer><Track><Genre tag="Hip Hop"/></Track></MediaContainer>' });
  });
  const session = freshSessionModule(tmp);

  const firstPromise = session.checkSession(
    { ratingKey: "1", title: "A", artist: "B" },
    "http://127.0.0.1:32400",
    "token",
    () => "wrap",
  );

  const second = await session.checkSession(
    { ratingKey: "1", title: "A", artist: "B" },
    "http://127.0.0.1:32400",
    "token",
    () => "wrap",
  );

  assert.equal(second, null);
  const midState = JSON.parse(fs.readFileSync(tmp, "utf8"));
  assert.equal(midState.sessionCount, 1);
  assert.equal(midState.seedMode, null);

  release();
  const first = await firstPromise;
  assert.equal(first, "rap");

  const finalState = JSON.parse(fs.readFileSync(tmp, "utf8"));
  assert.equal(finalState.sessionCount, 1);
  assert.equal(finalState.seedMode, "rap");
});