"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { removeFailedActiveClip } = require("../../intelligence/video-recovery");

function state(index = 1) {
  return { active: true, index, clips: [{ratingKey:"10"},{ratingKey:"20"},{ratingKey:"30"}], playlistKey:"p" };
}

test("failed active TV clip is removed and playback advances without replaying it", () => {
  const r = removeFailedActiveClip(state(1), "20");
  assert.equal(r.ok, true);
  assert.equal(r.empty, false);
  assert.deepEqual(r.state.clips.map(c => c.ratingKey), ["10","30"]);
  assert.equal(r.state.index, 1);
  assert.equal(r.state.clips[r.state.index].ratingKey, "30");
});

test("failed last-index clip wraps to remaining first clip", () => {
  const r = removeFailedActiveClip(state(2), "30");
  assert.equal(r.state.index, 0);
  assert.equal(r.state.clips[0].ratingKey, "10");
});

test("single failed clip ends the TV session", () => {
  const r = removeFailedActiveClip({active:true,index:0,clips:[{ratingKey:"9"}]}, "9");
  assert.equal(r.ok, true);
  assert.equal(r.empty, true);
  assert.equal(r.state.active, false);
});

test("stale failure cannot remove the current clip", () => {
  const s = state(1);
  const r = removeFailedActiveClip(s, "10");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "stale_video");
  assert.equal(r.state, s);
});