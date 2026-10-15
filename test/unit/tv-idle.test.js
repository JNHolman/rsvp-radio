"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fakeNode() {
  const classes = new Set();
  return {
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name); else classes.delete(name);
        return on;
      },
    },
    style: {},
    textContent: "",
    title: "",
    hidden: false,
    src: "",
    removeAttribute(name) { if (name === "src") this.src = ""; },
    appendChild() {},
    replaceChildren() {},
  };
}

test("idle shows artwork only; active audio restores player, paused keeps it, video remains separate", () => {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, fakeNode());
    return elements.get(id);
  };
  const stage = fakeNode();
  stage.classList.add("radio-idle");
  const context = {
    document: {
      getElementById: el,
      querySelector: selector => selector === ".stage" ? stage : null,
      createElement: () => fakeNode(),
    },
    window: {},
    Intl,
    Date,
    console,
    AbortController,
    setInterval() { return 0; }, // don't start unattended intervals in tests
    setTimeout,
    clearTimeout,
    fetch: async path => ({
      ok: true,
      json: async () => path === "/api/up-next"
        ? {available: false, tracks: []}
        : {available: false},
    }),
  };

  const code = fs.readFileSync(path.join(__dirname, "../../public/app/tv-overlay.js"), "utf8");
  vm.runInNewContext(code, context, { filename: "tv-overlay.js" });
  const render = context.window.renderTvOverlayState;

  render({media:{type:"idle",playerState:""}});
  assert.equal(stage.classList.contains("radio-idle"), true);
  assert.equal(el("upNext").classList.contains("on"), false);
  assert.equal(el("nowExtras").classList.contains("on"), false);

  render({media:{type:"audio",playerState:"playing",ratingKey:"51",durationMs:200000}});
  assert.equal(stage.classList.contains("radio-idle"), false);
  assert.equal(el("upNext").classList.contains("on"), true);
  assert.equal(el("nowExtras").classList.contains("on"), true);

  render({media:{type:"audio",playerState:"paused",ratingKey:"51",durationMs:200000}});
  assert.equal(stage.classList.contains("radio-idle"), false);
  assert.equal(el("upNext").classList.contains("on"), true);

  render({media:{type:"video",playerState:"playing",ratingKey:"video1"}});
  assert.equal(stage.classList.contains("radio-idle"), false);
  assert.equal(el("upNext").classList.contains("on"), false);

  render({media:{type:"idle",playerState:""}});
  assert.equal(stage.classList.contains("radio-idle"), true);
  assert.equal(el("upNext").classList.contains("on"), false);
  assert.equal(el("nowExtras").classList.contains("on"), false);
});
