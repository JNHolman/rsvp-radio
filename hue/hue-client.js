"use strict";

const fs = require("fs");

const MODES = Object.freeze(["lofi", "wrap", "rap", "rnb"]);
const MAX_TRANSITION_DS = 65535; // Hue v1 transitiontime: deciseconds, uint16.

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function configured(value) {
  return nonEmpty(value) && !/^replace_with/i.test(value.trim());
}

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function envBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function transitionDeciseconds(durMs) {
  return clampInt(Number(durMs) / 100, 0, MAX_TRANSITION_DS);
}

function loadConfig(env = process.env) {
  const scenes = {
    lofi: String(env.HUE_SCENE_LOFI || "").trim(),
    wrap: String(env.HUE_SCENE_WRAP || "").trim(),
    rap: String(env.HUE_SCENE_RAP || "").trim(),
    rnb: String(env.HUE_SCENE_RNB || "").trim(),
  };

  return {
    bridgeHost: String(env.HUE_BRIDGE_HOST || env.HUE_BRIDGE_IP || "").trim(),
    username: String(env.HUE_USERNAME || env.HUE_APPLICATION_KEY || "").trim(),
    bridgeId: String(env.HUE_BRIDGE_ID || "").trim().toLowerCase(),
    groupId: String(env.HUE_GROUP_ID || "").trim(),
    scenes,
    port: clampInt(env.HUE_ADAPTER_PORT || 5005, 1, 65535),
    bind: String(env.HUE_ADAPTER_BIND || "127.0.0.1").trim() || "127.0.0.1",
    timeoutMs: clampInt(env.HUE_REQUEST_TIMEOUT_MS || 2500, 250, 30000),
    modeTransitionMs: clampInt(env.HUE_MODE_TRANSITION_MS || 800, 0, 60000),
    reactiveEnabled: envBool(env.HUE_REACTIVE_ENABLED, true),
    reactiveMinIntervalMs: clampInt(env.HUE_REACTIVE_MIN_INTERVAL_MS || 1800, 250, 60000),
    reactiveTransitionMs: clampInt(env.HUE_REACTIVE_TRANSITION_MS || 1200, 0, 10000),
    reactiveRange: clampInt(env.HUE_REACTIVE_RANGE || 36, 0, 120),
    caCertPath: String(env.HUE_CA_CERT_PATH || "").trim(),
  };
}

function validateConfig(cfg) {
  const missing = [];
  if (!configured(cfg.bridgeHost)) missing.push("HUE_BRIDGE_HOST");
  if (!configured(cfg.username)) missing.push("HUE_USERNAME");
  if (!configured(cfg.bridgeId) || !/^[0-9a-f]+$/i.test(String(cfg.bridgeId || ""))) missing.push("HUE_BRIDGE_ID");
  if (!/^\d+$/.test(String(cfg.groupId || ""))) missing.push("HUE_GROUP_ID");
  if (String(cfg.bind || "").trim() !== "127.0.0.1") {
    missing.push("HUE_ADAPTER_BIND(loopback_only)");
  }
  for (const mode of MODES) {
    if (!configured(cfg.scenes?.[mode])) missing.push(`HUE_SCENE_${mode.toUpperCase()}`);
  }
  return missing;
}

function sceneForMode(cfg, mode) {
  if (!MODES.includes(mode)) throw new Error(`invalid_mode:${mode}`);
  const id = cfg.scenes?.[mode];
  if (!nonEmpty(id)) throw new Error(`scene_not_configured:${mode}`);
  return id;
}

function _groupBasePath(cfg) {
  if (!/^\d+$/.test(String(cfg.groupId || ""))) throw new Error("invalid_group_id");
  if (!nonEmpty(cfg.username)) throw new Error("missing_hue_username");
  return `/api/${encodeURIComponent(cfg.username)}/groups/${cfg.groupId}`;
}

function groupActionPath(cfg) {
  return `${_groupBasePath(cfg)}/action`;
}

function groupResourcePath(cfg) {
  return _groupBasePath(cfg);
}

function configPath(cfg) {
  if (!nonEmpty(cfg.username)) throw new Error("missing_hue_username");
  return `/api/${encodeURIComponent(cfg.username)}/config`;
}

function scenePayload(cfg, mode, durMs = cfg.modeTransitionMs) {
  return {
    scene: sceneForMode(cfg, mode),
    transitiontime: transitionDeciseconds(durMs),
  };
}

function powerPayload(on) {
  return { on: !!on };
}

function brightnessPayload(brightness, durMs) {
  return {
    bri: clampInt(brightness, 1, 254),
    transitiontime: transitionDeciseconds(durMs),
  };
}

function groupBrightness(body) {
  const value = Number(body?.action?.bri);
  return Number.isFinite(value) ? clampInt(value, 1, 254) : null;
}

function hueBodyHasError(body) {
  if (!Array.isArray(body)) return false;
  return body.some((entry) => entry && typeof entry === "object" && entry.error);
}

function verifyBridgeIdentity(expectedBridgeId, cert) {
  const expected = String(expectedBridgeId || "").trim().toLowerCase();
  const actual = String(cert?.subject?.CN || "").trim().toLowerCase();
  if (!expected || !actual || actual !== expected) {
    return new Error(`hue_bridge_identity_mismatch:${actual || "missing_cn"}`);
  }
  return undefined;
}

function readCa(cfg) {
  if (!cfg.caCertPath) return undefined;
  return fs.readFileSync(cfg.caCertPath);
}

module.exports = {
  MODES,
  MAX_TRANSITION_DS,
  transitionDeciseconds,
  loadConfig,
  validateConfig,
  sceneForMode,
  groupActionPath,
  groupResourcePath,
  configPath,
  scenePayload,
  powerPayload,
  brightnessPayload,
  groupBrightness,
  hueBodyHasError,
  verifyBridgeIdentity,
  readCa,
};