const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function freshTracker(dataPath) {
  process.env.SKIP_DATA_PATH = dataPath;
  const target = require.resolve("../../intelligence/skip-tracker");
  delete require.cache[target];
  return require("../../intelligence/skip-tracker");
}

function readData(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("two soft skips convert to one full strike", () => {
  const file = path.join(os.tmpdir(), `rsvp-skip-${process.pid}-soft.json`);
  fs.rmSync(file, { force: true });
  const tracker = freshTracker(file);
  const track = { ratingKey: "1", title: "Song", artist: "Artist" };

  tracker.recordSkip(track, 0.30);
  let entry = readData(file)["1"];
  assert.equal(entry.strikes, 0);
  assert.equal(entry.softStrikes, 0.5);

  tracker.recordSkip(track, 0.35);
  entry = readData(file)["1"];
  assert.equal(entry.strikes, 1);
  assert.equal(entry.softStrikes, 0);

  fs.rmSync(file, { force: true });
});

test("40 percent listen clears soft-skip debt without redeeming hard strikes", () => {
  const file = path.join(os.tmpdir(), `rsvp-skip-${process.pid}-listen.json`);
  fs.rmSync(file, { force: true });
  const tracker = freshTracker(file);
  const track = { ratingKey: "2", title: "Song", artist: "Artist" };

  tracker.recordSkip(track, 0.10);
  tracker.recordSkip(track, 0.30);
  tracker.recordSkip(track, 0.65);

  const entry = readData(file)["2"];
  assert.equal(entry.strikes, 1);
  assert.equal(entry.softStrikes, 0);
  assert.equal(entry.history.at(-1).type, "listen");

  fs.rmSync(file, { force: true });
});

test("scrobble redemption clears strikes and cooldown", () => {
  const file = path.join(os.tmpdir(), `rsvp-skip-${process.pid}-redeem.json`);
  fs.rmSync(file, { force: true });
  const tracker = freshTracker(file);
  const track = { ratingKey: "3", title: "Song", artist: "Artist" };

  tracker.recordSkip(track, 0.10);
  assert.equal(tracker.isOnCooldown("3"), true);

  tracker.recordPlay(track);
  const entry = readData(file)["3"];
  assert.equal(entry.strikes, 0);
  assert.equal(entry.softStrikes, 0);
  assert.equal(entry.cooldownUntil, 0);
  assert.equal(tracker.isOnCooldown("3"), false);

  fs.rmSync(file, { force: true });
});
