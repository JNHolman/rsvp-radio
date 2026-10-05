"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  parseLanePool,
  buildLaneMap,
  createSteering,
  buildClaudePickFn,
} = require("../../intelligence/lane-steering");

// ── parseLanePool ───────────────────────────────────────────────────────────

test("parseLanePool: anchor first, then declared lanes", () => {
  const lanes = parseLanePool("Memphis Trap:222, Southern Bounce:333", "Anchor Rap", "111");
  assert.deepEqual(lanes, [
    { name: "Anchor Rap", key: "111" },
    { name: "Memphis Trap", key: "222" },
    { name: "Southern Bounce", key: "333" },
  ]);
});

test("parseLanePool: dedups by ratingKey, anchor wins", () => {
  const lanes = parseLanePool("Dupe:111, Real:222", "Anchor", "111");
  assert.equal(lanes.length, 2);
  assert.equal(lanes[0].key, "111");
});

test("parseLanePool: ratingKey containing colon handled via lastIndexOf", () => {
  const lanes = parseLanePool("Weird:a:b:c", "Anchor", "111");
  assert.equal(lanes[1].name, "Weird:a:b");
  assert.equal(lanes[1].key, "c");
});

test("parseLanePool: empty pool yields anchor only", () => {
  assert.deepEqual(parseLanePool("", "Anchor", "111"), [{ name: "Anchor", key: "111" }]);
});

test("parseLanePool: no anchor + empty pool yields empty", () => {
  assert.deepEqual(parseLanePool("", "Anchor", ""), []);
});

// ── buildLaneMap ──────────────────────────────────────────────────────────────

test("buildLaneMap: assembles four modes from cfg", () => {
  const cfg = {
    PLAYLIST_RAP: "r0", LANE_NAME_RAP: "Trap Anchor", LANES_RAP: "Memphis:r1, Bounce:r2",
    PLAYLIST_RNB: "b0", LANES_RNB: "Slow Jams:b1",
    PLAYLIST_LOFI: "", PLAYLIST_WRAP: "",
  };
  const map = buildLaneMap(cfg);
  assert.equal(map.rap.length, 3);
  assert.equal(map.rap[0].name, "Trap Anchor");
  assert.equal(map.rnb.length, 2);
  assert.equal(map.lofi.length, 0);
});

test("buildLaneMap: tolerates missing cfg keys", () => {
  const map = buildLaneMap({});
  assert.equal(map.rap.length, 0);
  assert.equal(map.lofi.length, 0);
});

// ── steering core ─────────────────────────────────────────────────────────────

function rapMap() {
  return { rap: [
    { name: "Trap Anchor", key: "r0" },
    { name: "Memphis", key: "r1" },
    { name: "Bounce", key: "r2" },
  ] };
}

test("steering: one skip below threshold returns null", async () => {
  const s = createSteering({ laneMap: rapMap(), skipThreshold: 2 });
  s.onBoundaryOrModeChange("rap");
  assert.equal(await s.onSkip("rap"), null);
});

test("steering: threshold skips with no pickFn → round-robin step", async () => {
  const s = createSteering({ laneMap: rapMap(), skipThreshold: 2 });
  s.onBoundaryOrModeChange("rap");
  assert.equal(await s.onSkip("rap"), null);
  const next = await s.onSkip("rap");
  assert.equal(next.name, "Memphis");
});

test("steering: clean play resets the streak", async () => {
  const s = createSteering({ laneMap: rapMap(), skipThreshold: 2 });
  s.onBoundaryOrModeChange("rap");
  await s.onSkip("rap");
  s.onCleanPlay();
  assert.equal(await s.onSkip("rap"), null);
});

test("steering: boundary reset returns to anchor", async () => {
  const s = createSteering({ laneMap: rapMap(), skipThreshold: 2 });
  s.onBoundaryOrModeChange("rap");
  await s.onSkip("rap"); await s.onSkip("rap");
  assert.equal(s.currentLane("rap").name, "Memphis");
  s.onBoundaryOrModeChange("rap");
  assert.equal(s.currentLane("rap").name, "Trap Anchor");
});

test("steering: single-lane mode never steers", async () => {
  const s = createSteering({ laneMap: { rnb: [{ name: "Only", key: "b0" }] }, skipThreshold: 2 });
  s.onBoundaryOrModeChange("rnb");
  assert.equal(await s.onSkip("rnb"), null);
  assert.equal(await s.onSkip("rnb"), null);
});

test("steering: walks through all lanes then wraps", async () => {
  const s = createSteering({ laneMap: rapMap(), skipThreshold: 1 });
  s.onBoundaryOrModeChange("rap");
  assert.equal((await s.onSkip("rap")).name, "Memphis");
  assert.equal((await s.onSkip("rap")).name, "Bounce");
  assert.equal((await s.onSkip("rap")).name, "Trap Anchor"); // wrap
});

// ── model pick path ───────────────────────────────────────────────────────────

test("steering: model pick selects the named lane", async () => {
  const pickFn = async ({ siblingNames }) => {
    assert.ok(siblingNames.includes("Bounce"));
    return "Bounce";
  };
  const s = createSteering({ laneMap: rapMap(), skipThreshold: 2, pickFn });
  s.onBoundaryOrModeChange("rap");
  await s.onSkip("rap");
  assert.equal((await s.onSkip("rap")).name, "Bounce");
});

test("steering: model pick is case/space-insensitive", async () => {
  const s = createSteering({ laneMap: rapMap(), skipThreshold: 2, pickFn: async () => "  memphis " });
  s.onBoundaryOrModeChange("rap");
  await s.onSkip("rap");
  assert.equal((await s.onSkip("rap")).name, "Memphis");
});

test("steering: model failure falls back to round-robin", async () => {
  const s = createSteering({ laneMap: rapMap(), skipThreshold: 2, pickFn: async () => { throw new Error("net down"); } });
  s.onBoundaryOrModeChange("rap");
  await s.onSkip("rap");
  assert.equal((await s.onSkip("rap")).name, "Memphis");
});

test("steering: model returning current lane nudges forward", async () => {
  const s = createSteering({ laneMap: rapMap(), skipThreshold: 2, pickFn: async () => "Trap Anchor" });
  s.onBoundaryOrModeChange("rap");
  await s.onSkip("rap");
  assert.notEqual((await s.onSkip("rap")).name, "Trap Anchor");
});

test("steering: model returning unknown name falls back to round-robin", async () => {
  const s = createSteering({ laneMap: rapMap(), skipThreshold: 2, pickFn: async () => "Polka" });
  s.onBoundaryOrModeChange("rap");
  await s.onSkip("rap");
  assert.equal((await s.onSkip("rap")).name, "Memphis");
});

test("steering: snapshot reports active mode + lane counts", () => {
  const s = createSteering({ laneMap: rapMap(), skipThreshold: 3 });
  s.onBoundaryOrModeChange("rap");
  const snap = s.snapshot();
  assert.equal(snap.activeMode, "rap");
  assert.equal(snap.skipThreshold, 3);
  assert.equal(snap.lanesPerMode.rap, 3);
});

// ── buildClaudePickFn ─────────────────────────────────────────────────────────

test("buildClaudePickFn: returns null with no api key (forces round-robin)", () => {
  assert.equal(buildClaudePickFn({ apiKey: "", fetchImpl: () => {} }), null);
});

test("buildClaudePickFn: returns null with no fetch impl", () => {
  assert.equal(buildClaudePickFn({ apiKey: "k", fetchImpl: null }), null);
});

test("buildClaudePickFn: parses model text response", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: "Memphis" }] }) });
  const pick = buildClaudePickFn({ apiKey: "k", fetchImpl });
  const out = await pick({ mode: "rap", currentLaneName: "Trap Anchor", siblingNames: ["Memphis"], skipCount: 2 });
  assert.equal(out, "Memphis");
});

test("buildClaudePickFn: throws on http error (caller falls back)", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 });
  const pick = buildClaudePickFn({ apiKey: "k", fetchImpl });
  await assert.rejects(() => pick({ mode: "rap", currentLaneName: "x", siblingNames: ["y"], skipCount: 2 }));
});

test("buildClaudePickFn: aborts a stalled picker request", async () => {
  const pick = buildClaudePickFn({
    apiKey: "test-key",
    timeoutMs: 250,
    fetchImpl: (_url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  await assert.rejects(
    pick({ mode: "rap", currentLaneName: "A", siblingNames: ["B"], skipCount: 2 }),
    /aborted/,
  );
});