"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SCENES, ids, hasScene, sceneTarget } = require("../../intelligence/lighting-scenes");
const { approachAmbient } = require("../../intelligence/ambient-light");

test("exactly six independent club scenes have valid day/night targets", () => {
  assert.deepEqual(ids, [
    "yin-yang-cafe", "40-40-club", "republic-gardens",
    "the-tunnel", "club-crucial", "boom-boom-room",
  ]);
  for (const id of ids) {
    assert.equal(hasScene(id), true);
    const day = sceneTarget(id, "day", 1e9, 1e9);
    const night = sceneTarget(id, "night", 1e9, 1e9);
    assert.notDeepEqual(day.xy, night.xy, id + " must have unique solar moods");
    assert.ok(day.xy.every(v => v > 0 && v < 1));
    assert.ok(night.xy.every(v => v > 0 && v < 1));
    assert.ok(day.bri >= 60 && day.bri <= 120);
    assert.ok(night.bri >= 60 && night.bri <= 120);
    assert.equal(SCENES[id].day.length, 6);
    assert.equal(SCENES[id].night.length, 6);
  }
});

test("scene invalid ID, phase and timestamp are rejected", () => {
  assert.throws(() => sceneTarget("not-a-club", "night", 1), /invalid_club_scene/);
  assert.throws(() => sceneTarget("the-tunnel", "morning", 1), /invalid_solar_phase/);
  assert.throws(() => sceneTarget("the-tunnel", "day", Infinity), /invalid_scene_time/);
});

test("club fades are gentle and loop without discontinuities", () => {
  for (const id of ids) {
    const scene = SCENES[id], duration = scene.minutes * 60000;
    for (const phase of ["day", "night"]) {
      for (let n = 1; n <= 4; n++) {
        const before = sceneTarget(id, phase, n * duration - 1, 0);
        const after = sceneTarget(id, phase, n * duration + 1, 0);
        assert.ok(Math.hypot(before.xy[0] - after.xy[0], before.xy[1] - after.xy[1]) < 0.001, id);
        assert.ok(Math.hypot(
          ...(approachAmbient(before, after).xy.map((v, i) => v - before.xy[i]))
        ) < 0.027);
      }
    }
  }
});

test("scene starts on selection and maintains its drift after restart", () => {
  const start = Date.now() - 180000;
  const a = sceneTarget("club-crucial", "night", start + 60000, start);
  const b = sceneTarget("club-crucial", "night", start + 60000, start);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.xy, sceneTarget("club-crucial", "night", start, start).xy);
});

test("lighting slide-out contains club controls, Auto and independent power", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../public/index.html"), "utf8");
  const panel = html.split('data-panel="lighting"')[1].split('</div>\n        </div>')[0];
  for (const id of ids) assert.ok(panel.includes('data-light-scene="' + id + '"'), id);
  assert.match(panel, /data-light-auto="true"/);
  assert.match(panel, /data-action="on"/);
  assert.match(panel, /data-action="off"/);
});

test("TV drawer uses couch-distance type, a wider layout and high-contrast club controls", () => {
  const css = fs.readFileSync(path.join(__dirname, "../../public/tv-refined.css"), "utf8");
  const couch = css.split("/* RSVP couch-distance menu:")[1];
  assert.ok(couch, "the TV couch legibility treatment must be present");
  assert.match(couch, /width:min\(680px,50vw\)/);
  assert.match(couch, /\.drawerPanel \.lightSceneBtn span \{\s*font-size:clamp\(21px,1\.35vw,27px\)/);
  assert.match(couch, /\.drawerPanel \.lightSceneBtn small \{\s*font-size:16px/);
  assert.match(couch, /\.drawerPanel \.menuBtn \{[\s\S]*?min-height:76px/);
  assert.match(couch, /\.drawerPanel \.lightAutoBtn \{min-height:82px/);
  const html = fs.readFileSync(path.join(__dirname, "../../public/index.html"), "utf8");
  assert.match(html, /tv-refined\.css\?v=[^\"]+/);
});
