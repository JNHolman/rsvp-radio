"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "../../public/app/background.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../../public/tv-refined.css"), "utf8");

function harness() {
  const timers = new Map(), frames = new Map();
  let id = 0;
  const node = () => {
    const classes = new Set();
    let src = null;
    return {
      classList: {
        add(...names) { names.forEach(x => classes.add(x)); },
        remove(...names) { names.forEach(x => classes.delete(x)); },
        contains(name) { return classes.has(name); },
        toggle(name, on) {
          if (on === undefined) on = !classes.has(name);
          if (on) classes.add(name); else classes.delete(name);
        },
      },
      style: { removeProperty(name) { delete this[name]; } },
      naturalWidth: 100,
      readyState: 4,
      getAttribute(name) { return name === "src" ? src : null; },
      setAttribute(name, value) { if (name === "src") src = value; },
      removeAttribute(name) { if (name === "src") src = null; },
      load() {}, pause() {}, play() { return Promise.resolve(); },
      addEventListener() {},
    };
  };
  const day = node(), night = node(), bgA = node(), bgB = node();
  const stage = node();
  const elements = { bgA, bgB, artDay: day, artNight: night, musicVideo: node(), blackHold: node() };
  const context = vm.createContext({
    document: {
      getElementById: id => elements[id] || node(),
      querySelector: () => stage,
    },
    window: { matchMedia: () => ({ matches: false }) },
    BG_DAY: "day.mp4", BG_NIGHT: "night.mp4", BG_CROSSFADE_MS: 1200,
    BG_RELOAD_MS: 1800000, isDayTime: () => true,
    setTimeout(fn, delay) { const key = ++id; timers.set(key, { fn, delay }); return key; },
    clearTimeout(key) { timers.delete(key); },
    setInterval() { return 0; },
    requestAnimationFrame(fn) { const key = ++id; frames.set(key, fn); return key; },
    cancelAnimationFrame(key) { frames.delete(key); },
    console,
  });
  vm.runInContext(script, context);
  function runFrame() {
    const next = [...frames.values()];
    frames.clear();
    next.forEach(fn => fn());
  }
  function runTimer(delay) {
    const match = [...timers].find(([, t]) => t.delay === delay);
    assert.ok(match, "expected scheduled timer " + delay);
    timers.delete(match[0]);
    match[1].fn();
  }
  return { context, stage, day, night, bgA, bgB, timers, runFrame, runTimer };
}

test("solar reveal keeps old phase and water until new artwork is fully exposed", () => {
  const h = harness();
  vm.runInContext("_artReady = true", h.context);
  h.context._setArtworkForSource("day.mp4");
  assert.equal(h.stage.classList.contains("art-phase-day"), true);

  h.context._setArtworkForSource("night.mp4");
  assert.equal(h.stage.classList.contains("art-phase-day"), true);
  assert.equal(h.stage.classList.contains("art-phase-night"), false);
  assert.equal(h.night.classList.contains("horizon-incoming"), true);
  assert.equal(h.night.classList.contains("horizon-reveal"), false);

  h.runFrame();
  assert.equal(h.night.classList.contains("horizon-reveal"), false);
  h.runFrame();
  assert.equal(h.night.classList.contains("horizon-reveal"), true);

  h.runTimer(10100);
  assert.equal(h.stage.classList.contains("art-phase-day"), false);
  assert.equal(h.stage.classList.contains("art-phase-night"), true);
  assert.equal(h.night.classList.contains("on"), true);
  assert.equal(h.day.classList.contains("on"), false);
});

test("incoming image is masked before reveal animation is applied", () => {
  assert.match(css, /\.artBg\.horizon-incoming\s*\{[^}]*mask-position:0 100%;/s);
  assert.match(css, /\.artBg\.horizon-incoming\.horizon-reveal\s*\{[^}]*animation:rsvp-horizon-reveal 10s/s);
});

test("failed incoming background never hides the working background", async () => {
  const h = harness();
  vm.runInContext('_currentSrc = BG_DAY; _front.classList.add("on")', h.context);
  h.bgB.play = () => Promise.reject(new Error("decode failed"));
  await h.context._crossfadeTo("night.mp4");
  assert.equal(vm.runInContext("_currentSrc", h.context), "day.mp4");
  assert.equal(h.bgA.classList.contains("on"), true);
  assert.equal(h.bgB.classList.contains("on"), false);
});

test("overlapping background requests serialize and keep the latest requested phase", async () => {
  const h = harness();
  vm.runInContext('_currentSrc = BG_DAY; _front.classList.add("on")', h.context);
  const first = h.context._crossfadeTo("night.mp4");
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const second = h.context._crossfadeTo("day.mp4");
  assert.equal([...h.timers.values()].filter(t => t.delay === 1250).length, 1);

  h.runTimer(1250);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal([...h.timers.values()].filter(t => t.delay === 1250).length, 1);
  h.runTimer(1250);
  await Promise.all([first, second]);
  assert.equal(vm.runInContext("_currentSrc", h.context), "day.mp4");
  assert.equal(h.bgA.classList.contains("on"), true);
  assert.equal(h.bgB.classList.contains("on"), false);
});
