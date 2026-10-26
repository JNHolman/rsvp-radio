"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { auditTracks } = require("../../scripts/audit-track-programming");

test("read-only track audit counts available music metadata without inferring neighborhoods", () => {
  const xml = '<MediaContainer size="2" totalSize="2">' +
    '<Track ratingKey="10" title="Example A" grandparentTitle="Artist" year="1996" userRating="8">' +
    '<Genre tag="Hip-Hop"/><Style tag="Bass"/><Mood tag="Upbeat"/></Track>' +
    '<Track ratingKey="11" title="Example &amp; B" year="1997"/></MediaContainer>';
  const r = auditTracks(xml);
  assert.equal(r.count, 2);
  assert.equal(r.genres, 1);
  assert.equal(r.styles, 1);
  assert.equal(r.moods, 1);
  assert.equal(r.years, 2);
  assert.equal(r.stars, 1);
  assert.deepEqual(r.topGenres, [["Hip-Hop", 1]]);
  assert.equal(r.samples[1].title, "Example & B");
});

test("track audit refuses incomplete or malformed playlist responses", () => {
  assert.equal(auditTracks('<MediaContainer totalSize="4"><Track ratingKey="2"/></MediaContainer>'), null);
  assert.equal(auditTracks("<broken"), null);
});
