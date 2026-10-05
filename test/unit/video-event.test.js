"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeMediaPath,
  activeVideoIdentity,
  eventMatchesActiveVideo,
  ratingKeyFromMediaUrl,
} = require("../../intelligence/video-event");

function mode(index = 1) {
  return {
    active: true,
    index,
    clips: [{ ratingKey: "100" }, { ratingKey: "200" }],
  };
}

test("active video identity uses the current clip only", () => {
  assert.deepEqual(activeVideoIdentity(mode()), { ratingKey: "200", mediaPath: "/media/200" });
});

test("ended/failure event must identify the active clip", () => {
  assert.equal(eventMatchesActiveVideo({ mediaUrl: "/media/200" }, mode()), true);
  assert.equal(eventMatchesActiveVideo({ ratingKey: "200" }, mode()), true);
  assert.equal(eventMatchesActiveVideo({}, mode()), false);
});

test("stale event for previous clip is rejected", () => {
  assert.equal(eventMatchesActiveVideo({ mediaUrl: "/media/100" }, mode()), false);
  assert.equal(eventMatchesActiveVideo({ ratingKey: "100" }, mode()), false);
});

test("query strings and absolute same-path URLs normalize for comparison", () => {
  assert.equal(normalizeMediaPath("http://localhost:3000/media/200?x=1"), "/media/200");
  assert.equal(eventMatchesActiveVideo({ mediaUrl: "/media/200?cache=1" }, mode()), true);
});

test("ratingKey can be derived only from a media route", () => {
  assert.equal(ratingKeyFromMediaUrl("/media/abc%20123?x=1"), "abc 123");
  assert.equal(ratingKeyFromMediaUrl("/art?url=/media/200"), "");
});
