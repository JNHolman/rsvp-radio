"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseDetail } = require("../../scripts/check-full-track-metadata");

test("full Plex track details expose year and optional moods/styles when present", () => {
  const xml = '<MediaContainer size="1"><Track ratingKey="65" title="A &amp; B" ' +
    'grandparentTitle="Group" parentYear="1996" userRating="8">' +
    '<Genre tag="Hip-Hop"/><Style tag="Party Rap"/><Mood tag="Upbeat"/>' +
    '</Track></MediaContainer>';
  const result = parseDetail(xml);
  assert.equal(result.title, "A & B");
  assert.equal(result.year, "1996");
  assert.equal(result.userRating, 8);
  assert.deepEqual(result.genre, ["Hip-Hop"]);
  assert.deepEqual(result.style, ["Party Rap"]);
  assert.deepEqual(result.mood, ["Upbeat"]);
});
test("full Plex track details handle absent and invalid release information", () => {
  const absent = parseDetail('<MediaContainer size="1"><Track ratingKey="2" title="Unknown" year="0"/></MediaContainer>');
  assert.equal(absent.year, "");
  assert.deepEqual(absent.mood, []);
  assert.deepEqual(absent.style, []);
  assert.equal(parseDetail("<invalid"), null);
  assert.equal(parseDetail('<MediaContainer size="0"/>'), null);
});