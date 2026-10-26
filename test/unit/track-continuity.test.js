"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { assessPair, chooseCompatible, families, strongMood } =
  require("../../intelligence/track-continuity");

const song = (id, year, genre, mood = []) => ({
  ratingKey: id, year, genre: Array.isArray(genre) ? genre : [genre], mood,
});

test("same-era, shared-genre track is eligible and a closer era scores higher", () => {
  const now = song("1", 1996, "Contemporary R&B", ["Smooth"]);
  const near = song("2", 1998, "R&B", ["Smooth"]);
  const far = song("3", 2004, "Rhythm & Blues");
  assert.equal(assessPair(now, near).ok, true);
  assert.equal(assessPair(now, far).ok, true);
  assert.equal(chooseCompatible(now, [far, near]).profile.ratingKey, "2");
});

test("never jumps decades simply because the target playlist is approved", () => {
  const current = song("10", 1983, "Funk");
  const candidate = song("11", 2023, "Funk");
  assert.deepEqual(assessPair(current, candidate), {
    ok: false, reason: "era_jump", yearGap: 40,
  });
});

test("same decade is NOT enough to justify a funk-to-rap genre jump", () => {
  const result = assessPair(song("1", 1986, "Funk"), song("2", 1987, "Hip-Hop/Rap"));
  assert.equal(result.reason, "genre_jump");
  assert.equal(result.ok, false);
});

test("multi-genre tracks can provide a metadata-confirmed common genre", () => {
  const current = song("1", 2005, ["Contemporary R&B", "Hip Hop"]);
  const next = song("2", 2006, "Hip-Hop/Rap");
  assert.equal(assessPair(current, next).ok, true);
  assert.deepEqual([...families(current)].sort(), ["hiphop", "rnb"]);
});

test("a broad R&B tag does not prove a slow jam or compatible mood", () => {
  const slow = song("1", 2001, "R&B", ["Mellow", "Intimate"]);
  const party = song("2", 2003, "R&B", ["Raucous", "Urgent"]);
  assert.equal(assessPair(slow, party).reason, "contradictory_mood_tags");
  assert.equal(strongMood(slow.mood), "low-tagged");
  assert.equal(strongMood(party.mood), "high-tagged");
});

test("no metadata is not permission to guess genre, year or energy", () => {
  const current = song("1", 2000, "Soul");
  assert.equal(assessPair(current, song("2", null, "Soul")).reason, "unknown_year");
  assert.equal(assessPair(current, song("2", 2001, [])).reason, "unknown_genre");
  assert.equal(assessPair(null, song("2", 2001, "Soul")).reason, "same_or_missing_song");
  assert.equal(strongMood([]), "unknown");
});

test("pick best compatible track only; never fall back to a random rejected song", () => {
  const current = song("1", 2005, "Hip-Hop/Rap");
  const choices = [
    song("2", 1985, "Hip-Hop/Rap"),
    song("3", 2005, "Reggae"),
    song("4", 2006, "Hip Hop"),
  ];
  const ok = chooseCompatible(current, choices);
  assert.equal(ok.ok, true);
  assert.equal(ok.profile.ratingKey, "4");
  const no = chooseCompatible(current, choices.slice(0, 2));
  assert.equal(no.ok, false);
  assert.equal(no.reason, "no_compatible_song");
  assert.equal(no.rejected.era_jump, 1);
  assert.equal(no.rejected.genre_jump, 1);
});

test("recently selected songs never repeat during compatible selection", () => {
  const now = song("1", 2001, "R&B");
  const selections = [song("2", 2001, "R&B"), song("3", 2004, "R&B")];
  assert.equal(chooseCompatible(now, selections, { recent: ["2"] }).profile.ratingKey, "3");
  assert.equal(chooseCompatible(now, selections, { recent: ["2", "3"] }).ok, false);
});

test("year and explicit tags are metadata filters, not proof of matching BPM or groove", () => {
  const result = assessPair(song("a", 1991, "Soul"), song("b", 1993, "Soul"));
  assert.equal(result.ok, true);
  assert.equal(result.bpm, undefined);
  assert.equal(result.groove, undefined);
});
