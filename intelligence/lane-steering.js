"use strict";

/** Deterministic lateral steering across curator-owned Plex playlist lanes. */
function parseLanePool(rawPool, anchorName, anchorKey) {
  const lanes = [];
  const seen = new Set();
  const add = (name, key) => {
    name = String(name || "").trim();
    key = String(key || "").trim();
    if (!name || !key || seen.has(key)) return;
    seen.add(key);
    lanes.push({ name, key });
  };
  if (anchorKey) add(anchorName || "anchor", anchorKey);
  for (const part of String(rawPool || "").split(",")) {
    const i = part.lastIndexOf(":");
    if (i > 0) add(part.slice(0, i), part.slice(i + 1));
  }
  return lanes;
}

function buildLaneMap(cfg) {
  const out = {};
  for (const mode of ["lofi", "wrap", "rap", "rnb"]) {
    const u = mode.toUpperCase();
    out[mode] = parseLanePool(
      cfg?.[`LANES_${u}`],
      cfg?.[`LANE_NAME_${u}`] || mode,
      cfg?.[`PLAYLIST_${u}`] || "",
    );
  }
  return out;
}

/**
 * Optional Anthropic-backed lane picker. No key/fetch implementation means the
 * caller stays fully deterministic and uses round-robin fallback.
 */
function buildClaudePickFn({ apiKey, fetchImpl, model = "claude-sonnet-4-5", timeoutMs = 3000 } = {}) {
  if (!apiKey || typeof fetchImpl !== "function") return null;
  const timeout = Math.max(250, Math.min(15000, Number(timeoutMs) || 3000));

  return async ({ mode, currentLaneName, siblingNames, skipCount }) => {
    const choices = Array.isArray(siblingNames) ? siblingNames.filter(Boolean) : [];
    if (!choices.length) return "";

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let r;
    try {
      r = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 32,
          temperature: 0,
          messages: [{
            role: "user",
            content: `Choose one adjacent ${mode || "music"} lane after ${skipCount || 0} skips. Current lane: ${currentLaneName || "unknown"}. Allowed lanes: ${choices.join(", ")}. Reply with exactly one allowed lane name and nothing else.`,
          }],
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!r.ok) throw new Error(`lane_picker_http_${r.status}`);
    const data = await r.json();
    const text = Array.isArray(data?.content)
      ? data.content.find((part) => part?.type === "text")?.text
      : "";
    return String(text || "").trim();
  };
}

function createSteering(opts = {}) {
  const laneMap = opts.laneMap || {};
  const threshold = Number(opts.skipThreshold) || 2;
  const windowMs = Number(opts.skipWindowMs) || 600000;
  // Production passes an explicit dwell. Unit/library callers that omit it get
  // no artificial delay, which keeps this policy reusable and deterministic.
  const parsedDwell = Number(opts.minDwellMs);
  const minDwellMs = Number.isFinite(parsedDwell) ? Math.max(0, parsedDwell) : 0;
  const pickFn = typeof opts.pickFn === "function" ? opts.pickFn : null;
  const log = opts.log || (() => {});

  const idx = {};
  Object.keys(laneMap).forEach((m) => { idx[m] = 0; });
  let activeMode = null;
  let consecutiveSkips = 0;
  let lastSkipKey = null;
  let lastSkipAt = 0;
  let lastSteeredAt = 0;
  const laneStats = {};

  const lanesFor = (m) => laneMap[m] || [];
  const currentLane = (m) => lanesFor(m)[Math.min(idx[m] || 0, Math.max(0, lanesFor(m).length - 1))] || null;
  const stats = (name) => laneStats[name] ||= {
    plays: 0,
    skips: 0,
    successfulRuns: 0,
    failedThisSession: false,
    cleanStreak: 0,
  };

  function onBoundaryOrModeChange(mode) {
    activeMode = mode || null;
    if (mode in idx) idx[mode] = 0;
    consecutiveSkips = 0;
    lastSkipKey = null;
    lastSkipAt = 0;
    // A new programming block/session gives every sibling lane a fair shot.
    for (const value of Object.values(laneStats)) value.failedThisSession = false;
  }

  function onCleanPlay() {
    consecutiveSkips = 0;
    lastSkipKey = null;
    lastSkipAt = 0;
    const lane = currentLane(activeMode);
    if (!lane) return;
    const s = stats(lane.name);
    s.plays += 1;
    s.cleanStreak += 1;
    if (s.cleanStreak >= 2) {
      s.failedThisSession = false;
      s.successfulRuns += 1;
    }
  }

  async function onSkip(mode, ratingKey = "") {
    if (mode !== activeMode) {
      activeMode = mode;
      consecutiveSkips = 0;
      lastSkipKey = null;
      lastSkipAt = 0;
    }

    const lanes = lanesFor(mode);
    if (lanes.length <= 1) return null;

    const now = Date.now();
    if (lastSkipAt && now - lastSkipAt > windowMs) consecutiveSkips = 0;
    if (!ratingKey || ratingKey !== lastSkipKey) consecutiveSkips += 1;
    lastSkipKey = ratingKey || null;
    lastSkipAt = now;

    const cur = currentLane(mode);
    if (cur) {
      const s = stats(cur.name);
      s.skips += 1;
      s.cleanStreak = 0;
    }
    if (consecutiveSkips < threshold) return null;
    if (lastSteeredAt && now - lastSteeredAt < minDwellMs) return null;
    if (cur) stats(cur.name).failedThisSession = true;

    const start = idx[mode] || 0;
    let next = -1;

    if (pickFn) {
      const siblingNames = lanes.filter((_, i) => i !== start).map((lane) => lane.name);
      try {
        const picked = String(await pickFn({
          mode,
          currentLaneName: cur?.name || "",
          siblingNames,
          skipCount: consecutiveSkips,
        }) || "").trim().toLowerCase();
        if (picked) {
          const pickedIndex = lanes.findIndex((lane, i) => i !== start && lane.name.trim().toLowerCase() === picked);
          if (pickedIndex >= 0) next = pickedIndex;
        }
      } catch (err) {
        log(`[steering] picker failed: ${err.message}`);
      }
    }

    // Deterministic fallback: next not-failed sibling, then simple wrap if every
    // lane has already failed in this session.
    if (next < 0) {
      for (let off = 1; off <= lanes.length; off += 1) {
        const i = (start + off) % lanes.length;
        if (!stats(lanes[i].name).failedThisSession) {
          next = i;
          break;
        }
      }
    }
    if (next < 0) next = (start + 1) % lanes.length;

    idx[mode] = next;
    consecutiveSkips = 0;
    lastSkipKey = null;
    lastSkipAt = 0;
    lastSteeredAt = now;
    log(`[steering] ${mode}: ${cur?.name || "?"} -> ${lanes[next].name}`);
    return lanes[next];
  }

  function snapshot() {
    return {
      activeMode,
      consecutiveSkips,
      skipThreshold: threshold,
      currentLane: activeMode ? currentLane(activeMode) : null,
      lanesPerMode: Object.fromEntries(Object.entries(laneMap).map(([m, l]) => [m, l.length])),
      laneStats,
    };
  }

  return { onSkip, onCleanPlay, onBoundaryOrModeChange, currentLane, snapshot };
}

module.exports = { parseLanePool, buildLaneMap, buildClaudePickFn, createSteering };
