"use strict";

const fs = require("fs");
const path = require("path");

const envPath = process.argv[2] || path.join(process.cwd(), ".env");
if (!fs.existsSync(envPath)) {
  console.error(`Missing ${envPath}`);
  process.exit(1);
}

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, i).trim()] = value;
  }
  return out;
}

const env = parseEnv(fs.readFileSync(envPath, "utf8"));
const required = [
  "TZ",
  "PLEX_TOKEN",
  "PLEX_TARGET_CLIENT_IDENTIFIER",
  "PLAYLIST_LOFI",
  "PLAYLIST_WRAP",
  "PLAYLIST_RAP",
  "PLAYLIST_RNB",
  "HUE_BRIDGE_HOST",
  "HUE_BRIDGE_ID",
  "HUE_USERNAME",
  "HUE_GROUP_ID",
  "HUE_SCENE_LOFI",
  "HUE_SCENE_WRAP",
  "HUE_SCENE_RAP",
  "HUE_SCENE_RNB",
];

const errors = [];
for (const key of required) {
  const value = String(env[key] || "").trim();
  if (!value || /^replace_with/i.test(value)) errors.push(`${key} is not configured`);
}
if (env.TZ) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: env.TZ }).format(new Date()); }
  catch (_) { errors.push("TZ must be a valid IANA timezone"); }
}
if (env.HUE_GROUP_ID && !/^\d+$/.test(env.HUE_GROUP_ID)) errors.push("HUE_GROUP_ID must be numeric");
for (const key of ["PLAYLIST_LOFI", "PLAYLIST_WRAP", "PLAYLIST_RAP", "PLAYLIST_RNB"]) {
  if (env[key] && !/^\d+$/.test(env[key])) errors.push(`${key} must be a numeric Plex ratingKey`);
}
if (env.HUE_BRIDGE_ID && !/^replace_with/i.test(env.HUE_BRIDGE_ID) && !/^[0-9a-f]+$/i.test(env.HUE_BRIDGE_ID)) errors.push("HUE_BRIDGE_ID must be hexadecimal");
let lightsUrl = null;
if (env.LIGHTS_URL) {
  try {
    lightsUrl = new URL(env.LIGHTS_URL);
    if (lightsUrl.protocol !== "http:" || lightsUrl.hostname !== "127.0.0.1" || lightsUrl.username || lightsUrl.password || lightsUrl.search || lightsUrl.hash || !["", "/"].includes(lightsUrl.pathname)) {
      errors.push("LIGHTS_URL must be plain loopback HTTP at 127.0.0.1 with no path/query/credentials");
    }
  } catch (_) {
    errors.push("LIGHTS_URL must be a valid loopback URL");
  }
}

if (env.HUE_ADAPTER_BIND && String(env.HUE_ADAPTER_BIND).trim() !== "127.0.0.1") {
  errors.push("HUE_ADAPTER_BIND must be exactly 127.0.0.1");
}

const hueAdapterPort = Number(env.HUE_ADAPTER_PORT || 5005);
if (!Number.isInteger(hueAdapterPort) || hueAdapterPort < 1 || hueAdapterPort > 65535) {
  errors.push("HUE_ADAPTER_PORT must be an integer from 1 to 65535");
}
if (lightsUrl && lightsUrl.hostname === "127.0.0.1" && Number.isInteger(hueAdapterPort)) {
  const lightsPort = Number(lightsUrl.port || 80);
  if (lightsPort !== hueAdapterPort) errors.push("LIGHTS_URL port must match HUE_ADAPTER_PORT");
}

for (const key of ["ANALYZER_SERVER_URL"]) {
  if (!env[key]) continue;
  try {
    const u = new URL(env[key]);
    const loopback = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(u.hostname);
    if (u.protocol !== "http:" || !loopback || u.pathname !== "/features" || u.search || u.hash || u.username || u.password) {
      errors.push(`${key} must be loopback HTTP ending exactly in /features`);
    }
  } catch (_) {
    errors.push(`${key} must be a valid URL`);
  }
}

const analyzerInts = {
  ANALYZER_SAMPLE_RATE: [8000, 192000],
  ANALYZER_CHUNK_FRAMES: [256, 32768],
  ANALYZER_CHANNELS: [1, 2],
};
for (const [key, [min, max]] of Object.entries(analyzerInts)) {
  if (!env[key]) continue;
  const n = Number(env[key]);
  if (!Number.isInteger(n) || n < min || n > max) errors.push(`${key} must be an integer from ${min} to ${max}`);
}
for (const [key, min, max] of [
  ["ANALYZER_POST_INTERVAL_SECONDS", 0.1, 5],
  ["ANALYZER_STATUS_LOG_INTERVAL_SECONDS", 0, 3600],
]) {
  if (!env[key]) continue;
  const n = Number(env[key]);
  if (!Number.isFinite(n) || n < min || n > max) errors.push(`${key} must be between ${min} and ${max}`);
}

const relayMs = Number(env.FEATURE_SIGNAL_RELAY_MS || 2000);
const hueReactiveMinMs = Number(env.HUE_REACTIVE_MIN_INTERVAL_MS || 1800);
if (!Number.isFinite(relayMs) || relayMs < 250) {
  errors.push("FEATURE_SIGNAL_RELAY_MS must be at least 250 ms");
}
if (!Number.isFinite(hueReactiveMinMs) || hueReactiveMinMs < 250) {
  errors.push("HUE_REACTIVE_MIN_INTERVAL_MS must be at least 250 ms");
}
if (Number.isFinite(relayMs) && Number.isFinite(hueReactiveMinMs) && relayMs < hueReactiveMinMs) {
  errors.push("FEATURE_SIGNAL_RELAY_MS must be >= HUE_REACTIVE_MIN_INTERVAL_MS so final Hue updates are not rate-limited away");
}

if (errors.length) {
  console.error("RSVP Pi preflight failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log("RSVP Pi environment preflight passed.");
