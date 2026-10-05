"use strict";

const fs = require("fs");
const path = require("path");
const { writeJsonAtomic } = require("./atomic-json");

const DEFAULT_PATH = process.env.RUNTIME_STATE_PATH || path.join(__dirname, "..", "data", "runtime-state.json");
const MODES = new Set(["lofi", "lounge", "rap", "rnb"]);

const DEFAULT_STATE = Object.freeze({
  version: 6,
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

function normalizeMode(value) {
  const mode = String(value || "").toLowerCase();
  if (mode === "wrap") return "lounge"; // one-release migration from the old label
  return MODES.has(mode) ? mode : "";
}

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
        mode: normalizeMode(src.videoMode.mode),
        startedAt: Number.isFinite(Number(src.videoMode.startedAt)) ? Number(src.videoMode.startedAt) : 0,
        paused: !!src.videoMode.paused,
        manualUntil: Number.isFinite(Number(src.videoMode.manualUntil))
          ? Math.max(0, Number(src.videoMode.manualUntil))
          : 0,
      }
    : null;

  const resume = {};
  if (src.videoResumeIndex && typeof src.videoResumeIndex === "object") {
    for (const [key, value] of Object.entries(src.videoResumeIndex)) {
      if (/^\d+$/.test(String(key)) && Number.isInteger(value) && value >= 0) resume[String(key)] = value;
    }
  }

  const seedModeValue = normalizeMode(src.seedMode?.mode);
  const seedMode = src.seedMode && typeof src.seedMode === "object" && seedModeValue
    && Number.isFinite(Number(src.seedMode.expiresAt)) && Number(src.seedMode.expiresAt) > 0
    ? { mode: seedModeValue, expiresAt: Number(src.seedMode.expiresAt) }
    : null;

  const manualModeValue = normalizeMode(src.manualMode?.mode);
  const mm = src.manualMode && typeof src.manualMode === "object" && manualModeValue
    && Number.isFinite(Number(src.manualMode.expiresAt)) && Number(src.manualMode.expiresAt) > 0
    ? { mode: manualModeValue, expiresAt: Number(src.manualMode.expiresAt) }
    : null;

  const manualLightsValue = normalizeMode(src.manualLights?.mode);
  const ml = src.manualLights && typeof src.manualLights === "object" && manualLightsValue
    && Number.isFinite(Number(src.manualLights.expiresAt)) && Number(src.manualLights.expiresAt) > 0
    ? { mode: manualLightsValue, expiresAt: Number(src.manualLights.expiresAt) }
    : null;

  const a = src.automation && typeof src.automation === "object" ? src.automation : {};
  const manualStop = !!a.manualStop;
  const automation = manualStop
    ? {
        enabled: false,
        manualStop: true,
        stoppedMode: normalizeMode(a.stoppedMode) || null,
        stoppedAt: Number.isFinite(Number(a.stoppedAt)) ? Math.max(0, Number(a.stoppedAt)) : 0,
      }
    : { enabled: true, manualStop: false, stoppedMode: null, stoppedAt: 0 };

  return {
    version: 6,
    plexampPausedByRsvp: !!src.plexampPausedByRsvp,
    wasVideoMode: !!src.wasVideoMode || !!vm,
    lightsEnabled: src.lightsEnabled !== false,
    lightsScene: normalizeMode(src.lightsScene),
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