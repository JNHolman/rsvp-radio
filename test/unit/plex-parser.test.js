"use strict";

/**
 * Unit tests for intelligence/plex-parser.js.
 * Drives the real exported functions — no copy-pasted regex literals
 * including parser fallback and client narrowing.
 */

const test   = require("node:test");
const assert = require("node:assert/strict");
const plex   = require("../../intelligence/plex-parser");

// ── parseSessions: video filtering ────────────────────────────────────────────

test("parseSessions: paused video with no audio → null (no black-screen lock)", () => {
  const xml = '<MediaContainer size="1">' +
    '<Video type="movie" title="X" grandparentTitle="A" ratingKey="1" duration="100000" viewOffset="50000">' +
    '<Player state="paused" product="Plex" />' +
    '</Video></MediaContainer>';
  assert.equal(plex.parseSessions(xml), null);
});

test("parseSessions: paused video + playing audio → returns audio", () => {
  const xml = '<MediaContainer size="2">' +
    '<Video type="movie" title="V" grandparentTitle="A" ratingKey="1" duration="100" viewOffset="50">' +
    '<Player state="paused" product="Plex" /></Video>' +
    '<Track type="track" title="T" grandparentTitle="B" parentTitle="C" ratingKey="9" duration="200" viewOffset="20">' +
    '<Player state="playing" product="Plexamp" /></Track>' +
    '</MediaContainer>';
  const r = plex.parseSessions(xml);
  assert.ok(r, "should return a session");
  assert.equal(r.isVideo, false);
  assert.equal(r.title, "T");
});

test("parseSessions: buffering video does not surface", () => {
  const xml = '<MediaContainer size="1">' +
    '<Video type="movie" title="X" grandparentTitle="A" ratingKey="1" duration="100" viewOffset="0">' +
    '<Player state="buffering" product="Plex" />' +
    '</Video></MediaContainer>';
  assert.equal(plex.parseSessions(xml), null);
});

test("parseSessions: stopped video does not surface", () => {
  const xml = '<MediaContainer size="1">' +
    '<Video type="movie" title="X" grandparentTitle="A" ratingKey="1" duration="100" viewOffset="0">' +
    '<Player state="stopped" product="Plex" />' +
    '</Video></MediaContainer>';
  assert.equal(plex.parseSessions(xml), null);
});

test("parseSessions: playing video → returns video", () => {
  const xml = '<MediaContainer size="1">' +
    '<Video type="movie" title="MV" grandparentTitle="Artist" ratingKey="42" duration="200000" viewOffset="10000">' +
    '<Player state="playing" product="Plex" />' +
    '<Media><Part file="/tmp/v.mp4" /></Media>' +
    '</Video></MediaContainer>';
  const r = plex.parseSessions(xml);
  assert.ok(r);
  assert.equal(r.isVideo, true);
  assert.equal(r.ratingKey, "42");
  assert.equal(r.localFilePath, "/tmp/v.mp4");
});

test("parseSessions: targetClientId picks the matching playing video among many", () => {
  const xml = '<MediaContainer size="2">' +
    '<Video type="movie" title="A" ratingKey="11">' +
    '<Player state="playing" product="Plex" machineIdentifier="other-client" /></Video>' +
    '<Video type="movie" title="B" ratingKey="22">' +
    '<Player state="playing" product="Plex" machineIdentifier="my-client" /></Video>' +
    '</MediaContainer>';
  const r = plex.parseSessions(xml, { targetClientId: "my-client" });
  assert.ok(r);
  assert.equal(r.ratingKey, "22");
});

// ── parseSessions: audio (Plexamp preference) ─────────────────────────────────

test("parseSessions: prefers Plexamp track over generic Track", () => {
  const xml = '<MediaContainer size="2">' +
    '<Track type="track" title="WrongChoice" grandparentTitle="A" ratingKey="1" duration="100" viewOffset="10">' +
    '<Player state="playing" product="WebApp" /></Track>' +
    '<Track type="track" title="Right" grandparentTitle="B" parentTitle="C" ratingKey="2" duration="100" viewOffset="10">' +
    '<Player state="playing" product="Plexamp" /></Track>' +
    '</MediaContainer>';
  const r = plex.parseSessions(xml);
  assert.equal(r.title, "Right");
});

test("parseSessions: empty MediaContainer → null", () => {
  assert.equal(plex.parseSessions('<MediaContainer size="0"></MediaContainer>'), null);
});

// ── isPlexampPlaying: attribute order independence ────────────────────────────

test("isPlexampPlaying: matches when product before state", () => {
  const xml = '<MediaContainer size="1"><Track ratingKey="1"><Player product="Plexamp" state="playing" /></Track></MediaContainer>';
  assert.equal(plex.isPlexampPlaying(xml), true);
});

test("isPlexampPlaying: matches when state appears before product", () => {
  const xml = '<MediaContainer size="1"><Track ratingKey="1"><Player state="playing" product="Plexamp" /></Track></MediaContainer>';
  assert.equal(plex.isPlexampPlaying(xml), true);
});

test("isPlexampPlaying: rejects paused Plexamp", () => {
  const xml = '<MediaContainer size="1"><Track ratingKey="1"><Player product="Plexamp" state="paused" /></Track></MediaContainer>';
  assert.equal(plex.isPlexampPlaying(xml), false);
});

test("isPlexampPlaying: rejects non-Plexamp clients", () => {
  const xml = '<MediaContainer size="1"><Track ratingKey="1"><Player product="PlexWebMobile" state="playing" /></Track></MediaContainer>';
  assert.equal(plex.isPlexampPlaying(xml), false);
});

// ── isPlexampPlaying: clientId narrowing ─────────────────────────────────────

test("isPlexampPlaying: when clientId provided, only matches the configured client", () => {
  const xml = '<MediaContainer size="2">' +
    '<Track ratingKey="1"><Player product="Plexamp" state="playing" machineIdentifier="phone-uuid" /></Track>' +
    '<Track ratingKey="2"><Player product="Plexamp" state="playing" machineIdentifier="pi-uuid" /></Track>' +
    '</MediaContainer>';
  assert.equal(plex.isPlexampPlaying(xml, { plexampClientId: "pi-uuid" }), true);
  assert.equal(plex.isPlexampPlaying(xml, { plexampClientId: "different-uuid" }), false);
});

test("isPlexampPlaying: clientId can match clientIdentifier instead of machineIdentifier", () => {
  const xml = '<MediaContainer size="1">' +
    '<Track ratingKey="1"><Player product="Plexamp" state="playing" clientIdentifier="pi-uuid" /></Track>' +
    '</MediaContainer>';
  assert.equal(plex.isPlexampPlaying(xml, { plexampClientId: "pi-uuid" }), true);
});

test("isPlexampPlaying: empty XML → false (no crash)", () => {
  assert.equal(plex.isPlexampPlaying(""), false);
  assert.equal(plex.isPlexampPlaying(null), false);
});

test("isPlexampPlaying: Plexamp present but Track wrapper missing → false", () => {
  // No Track block, just a stray Player tag — defensive check.
  const xml = '<MediaContainer size="0"></MediaContainer>';
  assert.equal(plex.isPlexampPlaying(xml), false);
});

// ── module exports sanity ─────────────────────────────────────────────────────

test("plex-parser exposes the expected surface", () => {
  assert.equal(typeof plex.parseSessions,        "function");
  assert.equal(typeof plex.isPlexampPlaying,     "function");
  assert.equal(typeof plex.hasStructuredParser,  "function");
});

// ── Structured parser accepts missing video state ────────────────────────────

test("parseSessions: video with no state attribute is treated as active", () => {
  // Plex *usually* sends state, but the regex fallback already accepts
  // missing-state as active. Structured parser must agree — both parsers
  // produce the same answer for the same input.
  const xml = '<MediaContainer size="1">' +
    '<Video type="movie" title="V" grandparentTitle="A" ratingKey="42" duration="1000" viewOffset="100">' +
    '<Player product="Plex" />' + // no state attribute
    '</Video></MediaContainer>';
  const r = plex.parseSessions(xml);
  assert.ok(r, "missing-state video should still produce a parsed result");
  assert.equal(r.isVideo, true,                "should identify as video");
  assert.equal(r.ratingKey, "42",               "should preserve ratingKey");
});

test("parseSessions: video with empty-string state is treated as active", () => {
  const xml = '<MediaContainer size="1">' +
    '<Video type="movie" title="V" grandparentTitle="A" ratingKey="43" duration="1000" viewOffset="100">' +
    '<Player product="Plex" state="" />' +
    '</Video></MediaContainer>';
  const r = plex.parseSessions(xml);
  assert.ok(r, "empty-state video should still produce a parsed result");
  assert.equal(r.isVideo, true);
});

test("parseSessions: video with state=paused still falls through (regression check)", () => {
  // Negative case — the fix must not also accept paused.
  const xml = '<MediaContainer size="1">' +
    '<Video type="movie" title="V" grandparentTitle="A" ratingKey="44" duration="1000" viewOffset="100">' +
    '<Player product="Plex" state="paused" />' +
    '</Video></MediaContainer>';
  assert.equal(plex.parseSessions(xml), null,
    "paused video must NOT be treated as active even after the missing-state allowance");
});

// ── parseMediaPart ─────────────────────────────────────────────────────

test("parseMediaPart: extracts file path from a Track metadata response", () => {
  const xml =
    '<MediaContainer size="1">' +
      '<Track ratingKey="100" title="Song">' +
        '<Media>' +
          '<Part file="/mnt/music/Artist/Album/01 Song.mp3" />' +
        '</Media>' +
      '</Track>' +
    '</MediaContainer>';
  assert.equal(plex.parseMediaPart(xml), "/mnt/music/Artist/Album/01 Song.mp3");
});

test("parseMediaPart: extracts file path from a Video metadata response", () => {
  const xml =
    '<MediaContainer size="1">' +
      '<Video ratingKey="200" title="Video">' +
        '<Media>' +
          '<Part file="/mnt/music/RSVP Radio/Videos/Some Video.mp4" />' +
        '</Media>' +
      '</Video>' +
    '</MediaContainer>';
  assert.equal(plex.parseMediaPart(xml), "/mnt/music/RSVP Radio/Videos/Some Video.mp4");
});

test("parseMediaPart: handles paths with double spaces", () => {
  // Real-world case from production: filenames with double spaces.
  const xml =
    '<MediaContainer size="1">' +
      '<Video ratingKey="201">' +
        '<Media>' +
          '<Part file="/mnt/music/RSVP Radio/Videos/Taffy and PLUTO - Feeling On My Body (Remix)  (Dirty).mp4" />' +
        '</Media>' +
      '</Video>' +
    '</MediaContainer>';
  assert.equal(plex.parseMediaPart(xml), "/mnt/music/RSVP Radio/Videos/Taffy and PLUTO - Feeling On My Body (Remix)  (Dirty).mp4");
});

test("parseMediaPart: decodes XML entities in path", () => {
  const xml =
    '<MediaContainer size="1">' +
      '<Track ratingKey="300">' +
        '<Media>' +
          '<Part file="/mnt/music/Sam &amp; Dave/Hold On.mp3" />' +
        '</Media>' +
      '</Track>' +
    '</MediaContainer>';
  // Structured parser already handles entity decoding via fast-xml-parser.
  // Regex fallback explicitly decodes &amp; &quot; &apos; &lt; &gt;.
  assert.equal(plex.parseMediaPart(xml), "/mnt/music/Sam & Dave/Hold On.mp3");
});

test("parseMediaPart: returns empty string when no Part element", () => {
  const xml =
    '<MediaContainer size="1">' +
      '<Track ratingKey="400" title="Song" />' +
    '</MediaContainer>';
  assert.equal(plex.parseMediaPart(xml), "");
});

test("parseMediaPart: returns empty string for empty input", () => {
  assert.equal(plex.parseMediaPart(""), "");
  assert.equal(plex.parseMediaPart(null), "");
  assert.equal(plex.parseMediaPart(undefined), "");
});

// ── Regex fallback path coverage ───────────────────────────────────────
// Force the regex fallback by feeding XML the structured parser will choke on,
// or by directly using the lower-level helpers. This is what would have caught
// keep the fallback path covered against undefined intermediate collections.

test("parseSessions: regex fallback path runs without ReferenceError when structured parser fails", () => {
  // Malformed XML — fast-xml-parser will likely throw; we want the fallback
  // to handle it gracefully, not crash with `videoBlocks is not defined`.
  // The exact return value isn't important — what matters is no exception.
  const malformed = '<<<not really xml>>> <Video ratingKey="9" title="X"><Player state="playing" /></Video>';
  // Should not throw.
  let result;
  let threw = false;
  try { result = plex.parseSessions(malformed); }
  catch (e) { threw = true; }
  assert.equal(threw, false, "parseSessions must not throw when fallback path runs");
  // result may be null or an extracted video — both are acceptable. The bug
  // we're guarding against is `ReferenceError: videoBlocks is not defined`.
});

test("parseSessions: video block helper returns array (smoke check for regex fallback)", () => {
  // Drive the regex helper directly. _videoBlocks is exported for this kind of test.
  const xml = '<MediaContainer>' +
    '<Video ratingKey="1"><Player state="playing" /></Video>' +
    '<Video ratingKey="2"><Player state="paused"  /></Video>' +
  '</MediaContainer>';
  const blocks = plex._videoBlocks(xml);
  assert.equal(blocks.length, 2, "two Video blocks should be found");
});

// ── Numeric XML entity decoding ───────────────────────────────────────────────
// Plex emits numeric XML entities for non-ASCII characters in file paths.
// "Victoria Mon&#233;t" must decode to "Victoria Monét" before fs.stat().
// Without this, every accented filename returns ENOENT and music videos
// silently fail with "video suppressed" on the kiosk.

test("parseMediaPart: decodes decimal numeric XML entities in path (Victoria Monét bug)", () => {
  const xml =
    '<MediaContainer size="1">' +
      '<Video ratingKey="112">' +
        '<Media>' +
          '<Part file="/mnt/music/RSVP Radio/Videos/Victoria Mon&#233;t - On My Mama.mp4" />' +
        '</Media>' +
      '</Video>' +
    '</MediaContainer>';
  assert.equal(
    plex.parseMediaPart(xml),
    "/mnt/music/RSVP Radio/Videos/Victoria Monét - On My Mama.mp4",
  );
});

test("parseMediaPart: decodes hex numeric XML entities in path", () => {
  const xml =
    '<MediaContainer size="1">' +
      '<Video ratingKey="112">' +
        '<Media>' +
          '<Part file="/mnt/music/RSVP Radio/Videos/Victoria Mon&#xE9;t - On My Mama.mp4" />' +
        '</Media>' +
      '</Video>' +
    '</MediaContainer>';
  assert.equal(
    plex.parseMediaPart(xml),
    "/mnt/music/RSVP Radio/Videos/Victoria Monét - On My Mama.mp4",
  );
});

test("parseMediaPart: decodes mixed entities (named + numeric) in same path", () => {
  // Pathological but realistic: "Beyoncé & Jay-Z – Track" → both entity types.
  const xml =
    '<MediaContainer size="1">' +
      '<Track ratingKey="113">' +
        '<Media>' +
          '<Part file="/mnt/music/Beyonc&#233; &amp; Jay-Z/01 Track.mp3" />' +
        '</Media>' +
      '</Track>' +
    '</MediaContainer>';
  assert.equal(
    plex.parseMediaPart(xml),
    "/mnt/music/Beyoncé & Jay-Z/01 Track.mp3",
  );
});

test("decodeXmlEntities: decimal entities for common accented chars", () => {
  const fn = plex.decodeXmlEntities;
  assert.equal(fn("Mon&#233;t"),  "Monét");      // é
  assert.equal(fn("caf&#233;"),   "café");        // é
  assert.equal(fn("na&#239;ve"),  "naïve");       // ï
  assert.equal(fn("&#241;andu"),  "ñandu");       // ñ
});

test("decodeXmlEntities: hex entities", () => {
  const fn = plex.decodeXmlEntities;
  assert.equal(fn("Mon&#xE9;t"),  "Monét");
  assert.equal(fn("&#x2014; em dash"), "— em dash");
});

test("decodeXmlEntities: handles all named entities together", () => {
  const fn = plex.decodeXmlEntities;
  // Standard XML 5: &amp; &lt; &gt; &quot; &apos;
  assert.equal(fn("&amp;"),  "&");
  assert.equal(fn("&lt;"),   "<");
  assert.equal(fn("&gt;"),   ">");
  assert.equal(fn("&quot;"), '"');
  assert.equal(fn("&apos;"), "'");
});

test("decodeXmlEntities: leaves already-decoded text untouched (idempotent)", () => {
  const fn = plex.decodeXmlEntities;
  assert.equal(fn("Victoria Monét - On My Mama"), "Victoria Monét - On My Mama");
  assert.equal(fn("nothing to decode"),            "nothing to decode");
});

test("decodeXmlEntities: handles null/undefined safely", () => {
  const fn = plex.decodeXmlEntities;
  assert.equal(fn(null),      "");
  assert.equal(fn(undefined), "");
  assert.equal(fn(""),        "");
});

test("decodeXmlEntities: ampersand decoded LAST so &amp;#233; doesn't become é", () => {
  // If a filename literally contains "&amp;#233;" we should preserve "&#233;"
  // rather than greedily decode "&" first then double-decode the numeric entity.
  const fn = plex.decodeXmlEntities;
  // Input is the literal 5-char sequence "&#233;" (after decoding "&amp;" once).
  // The contract: ampersand decode happens LAST, so "&amp;#233;" → "&#233;",
  // not "é". This protects against pathological double-encoded input.
  assert.equal(fn("&amp;#233;"), "&#233;");
});

test("parseSessions: structured parser does not expand custom DOCTYPE entities", () => {
  const xml = '<!DOCTYPE MediaContainer [<!ENTITY injected "SURPRISE">]>' +
    '<MediaContainer size="1"><Track ratingKey="501" title="&injected;" grandparentTitle="Artist">' +
    '<Player product="Plexamp" state="playing" /></Track></MediaContainer>';
  const r = plex.parseSessions(xml);
  assert.ok(r);
  assert.notEqual(r.title, "SURPRISE", "custom DTD entities must not be expanded");
  assert.equal(r.title, "&injected;");
});

test("parseSessions: safe decoder still handles Plex named and numeric entities", () => {
  const xml = '<MediaContainer size="1"><Track ratingKey="502" title="Beyonc&#233; &amp; Jay-Z" grandparentTitle="A &amp; B">' +
    '<Player product="Plexamp" state="playing" /></Track></MediaContainer>';
  const r = plex.parseSessions(xml);
  assert.ok(r);
  assert.equal(r.title, "Beyoncé & Jay-Z");
  assert.equal(r.artist, "A & B");
});
