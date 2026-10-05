"use strict";

const fs = require("fs");
const path = require("path");
const { writeJsonAtomic } = require("./atomic-json");

const DEFAULT_PATH = process.env.RUNTIME_STATE_PATH || path.join(__dirname, "..", "data", "runtime-state.json");
const MODES = new Set(["lofi", "wrap", "rap", "rnb"]);

const DEFAULT_STATE = Object.freeze({
  version: 4,
  plexampPausedByRsvp: false,
  wasVideoMode: false,
  lightsEnabled: true,
  lightsScene: "",
  seedMode: null,
  manualMode: null,
  manualLights: null,
  automation: { enabled: true, manualStop: false, stoppedMode: null, stoppedAt: 0 },
  videoMode: null,
  videoResumeIndex: {},
});

function normalize(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const vm = src.videoMode && typeof src.videoMode === "object" && src.videoMode.active
    ? {
        active: true,
        playlistKey: String(src.videoMode.playlistKey || ""),
        playlistTitle: String(src.videoMode.playlistTitle || ""),
        clips: Array.isArray(src.videoMode.clips)
          ? src.videoMode.clips
              .filter((c) => c && /^\d+$/.test(String(c.ratingKey || "")))
              .map((c) => ({ ratingKey: String(c.ratingKey), title: String(c.title || "") }))
          : [],
        index: Number.isInteger(src.videoMode.index) ? Math.max(0, src.videoMode.index) : 0,
        mode: MODES.has(src.videoMode.mode) ? src.videoMode.mode : "",
        startedAt: Number.isFinite(Number(src.videoMode.startedAt)) ? Number(src.videoMode.startedAt) : 0,
        paused: !!src.videoMode.paused,
      }
    : null;

  const resume = {};
  if (src.videoResumeIndex && typeof src.videoResumeIndex === "object") {
    for (const [key, value] of Object.entries(src.videoResumeIndex)) {
      if (/^\d+$/.test(String(key)) && Number.isInteger(value) && value >= 0) resume[String(key)] = value;
    }
  }

  const seedMode = src.seedMode && typeof src.seedMode === "object" && MODES.has(src.seedMode.mode)
    && Number.isFinite(Number(src.seedMode.expiresAt)) && Number(src.seedMode.expiresAt) > 0
    ? { mode: src.seedMode.mode, expiresAt: Number(src.seedMode.expiresAt) }
    : null;

  const mm = src.manualMode && typeof src.manualMode === "object" && MODES.has(src.manualMode.mode)
    && Number.isFinite(Number(src.manualMode.expiresAt)) && Number(src.manualMode.expiresAt) > 0
    ? { mode: src.manualMode.mode, expiresAt: Number(src.manualMode.expiresAt) }
    : null;

  const ml = src.manualLights && typeof src.manualLights === "object" && MODES.has(src.manualLights.mode)
    && Number.isFinite(Number(src.manualLights.expiresAt)) && Number(src.manualLights.expiresAt) > 0
    ? { mode: src.manualLights.mode, expiresAt: Number(src.manualLights.expiresAt) }
    : null;

  const a = src.automation && typeof src.automation === "object" ? src.automation : {};
  const manualStop = !!a.manualStop;
  const automation = manualStop
    ? {
        enabled: false,
        manualStop: true,
        stoppedMode: MODES.has(a.stoppedMode) ? a.stoppedMode : null,
        stoppedAt: Number.isFinite(Number(a.stoppedAt)) ? Math.max(0, Number(a.stoppedAt)) : 0,
      }
    : { enabled: true, manualStop: false, stoppedMode: null, stoppedAt: 0 };

  return {
    version: 4,
    plexampPausedByRsvp: !!src.plexampPausedByRsvp,
    wasVideoMode: !!src.wasVideoMode || !!vm,
    lightsEnabled: src.lightsEnabled !== false,
    lightsScene: MODES.has(src.lightsScene) ? src.lightsScene : "",
    seedMode,
    manualMode: mm,
    manualLights: ml,
    automation,
    videoMode: vm && vm.playlistKey && vm.clips.length ? vm : null,
    videoResumeIndex: resume,
  };
}

function createStore(dataPath = DEFAULT_PATH) {
  function load() {
    try {
      if (!fs.existsSync(dataPath)) return normalize(DEFAULT_STATE);
      return normalize(JSON.parse(fs.readFileSync(dataPath, "utf8")));
    } catch (err) {
      console.warn(`[runtime-state] load failed: ${err.message}`);
      return normalize(DEFAULT_STATE);
    }
  }

  function save(state) {
    const next = normalize(state);
    try {
      writeJsonAtomic(dataPath, next);
      return true;
    } catch (err) {
      console.warn(`[runtime-state] save failed: ${err.message}`);
      return false;
    }
  }

  return { load, save, path: dataPath };
}

const defaultStore = createStore();
module.exports = { ...defaultStore, createStore, normalize };