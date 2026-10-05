"use strict";

/** Shared item reputation policy for Radio and TV. */
const fs = require("fs");
const path = require("path");
const { writeJsonAtomic } = require("./atomic-json");

function createTracker(dataPath) {
  const DATA_PATH = dataPath;
  const load = () => {
    try { return fs.existsSync(DATA_PATH) ? JSON.parse(fs.readFileSync(DATA_PATH, "utf8")) : {}; }
    catch (e) { console.warn("[reputation] load failed:", e.message); return {}; }
  };
  const save = (data) => {
    try {
      writeJsonAtomic(DATA_PATH, data);
    } catch (e) { console.warn("[reputation] save failed:", e.message); }
  };
  const ensure = (data, track) => data[track.ratingKey] ||= {
    ratingKey: String(track.ratingKey),
    title: track.title || "",
    artist: track.artist || "",
    strikes: 0,
    softStrikes: 0,
    cooldownUntil: 0, // legacy field retained; Plex rating is the rotation gate
    plays: 0,
    history: [],
  };
  const trim = (e) => { if (e.history.length > 20) e.history = e.history.slice(-20); };

  function recordPlay(track) {
    if (!track?.ratingKey) return;
    const data = load();
    const e = ensure(data, track);
    e.plays = (e.plays || 0) + 1;
    e.title = track.title || e.title;
    e.artist = track.artist || e.artist;
    e.cooldownUntil = 0;

    if (e.strikes < 5) { // five strikes is permanent exile
      if (e.softStrikes > 0) e.softStrikes = 0;
      else if (e.strikes > 0) e.strikes = Math.max(0, e.strikes - 1);
      e.history.push({ type: "redemption", ts: Date.now(), strikes: e.strikes });
    } else {
      e.history.push({ type: "play_exiled", ts: Date.now(), strikes: e.strikes });
    }
    trim(e);
    save(data);
  }

  function recordSkip(track, pct) {
    if (!track?.ratingKey) return;
    const played = Number(pct);
    if (!Number.isFinite(played)) return;

    // 70%+ is a clean play: count it, redeem reputation, and keep the same
    // behavior whether completion came from polling or a scrobble event.
    if (played >= 0.70) {
      recordPlay(track);
      return;
    }

    // 40-69% is neutral. It may clear only unfinished soft debt on an existing
    // entry, but it neither creates a record nor changes hard strikes/plays.
    if (played >= 0.40) {
      const data = load();
      const e = data[track.ratingKey];
      if (e?.softStrikes) {
        e.softStrikes = 0;
        e.cooldownUntil = 0;
        e.history.push({ type: "listen", pct: Math.round(played * 100), ts: Date.now(), strikes: e.strikes });
        trim(e);
        save(data);
      }
      return;
    }

    const data = load();
    const e = ensure(data, track);
    if (played < 0.25) {
      e.strikes += 1;
    } else {
      e.softStrikes += 0.5;
      if (e.softStrikes >= 1) {
        e.strikes += 1;
        e.softStrikes = 0;
      }
    }

    // Do not write time-based cooldowns. Plex ratings/strikes are the
    // rotation mechanism; keep the legacy field at zero for data compatibility.
    e.cooldownUntil = 0;
    e.title = track.title || e.title;
    e.artist = track.artist || e.artist;
    e.history.push({
      type: played < 0.25 ? "hard" : "soft",
      pct: Math.round(played * 100),
      ts: Date.now(),
      strikes: e.strikes,
    });
    trim(e);
    save(data);
  }

  const getStatus = (key) => load()[key] || null;
  // Legacy method name: callers/tests use this as "rotation suppressed". The
  // field cooldownUntil is no longer authoritative; strike reputation is.
  const isOnCooldown = (key) => {
    const e = getStatus(key);
    return !!e && Number(e.strikes || 0) > 0;
  };
  const getAllExiled = () => Object.values(load()).filter((e) => e.strikes >= 5);
  return { recordSkip, recordPlay, getStatus, isOnCooldown, getAllExiled };
}

const defaultPath = process.env.SKIP_DATA_PATH || path.join(__dirname, "..", "data", "skip-data.json");
const defaultTracker = createTracker(defaultPath);
module.exports = { ...defaultTracker, createTracker };