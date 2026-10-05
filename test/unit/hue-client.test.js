"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const hue = require("../../hue/hue-client");

function cfg() {
  return hue.loadConfig({
    HUE_BRIDGE_HOST: "192.0.2.10",
    HUE_USERNAME: "secret-user",
    HUE_BRIDGE_ID: "001788fffe123456",
    HUE_GROUP_ID: "3",
    HUE_SCENE_LOFI: "scene-lofi",
    HUE_SCENE_WRAP: "scene-wrap",
    HUE_SCENE_RAP: "scene-rap",
    HUE_SCENE_RNB: "scene-rnb",
  });
}

test("Hue config requires bridge, credential, group and all four scenes", () => {
  const missing = hue.validateConfig(hue.loadConfig({}));
  assert.deepEqual(missing, [
    "HUE_BRIDGE_HOST",
    "HUE_USERNAME",
    "HUE_BRIDGE_ID",
    "HUE_GROUP_ID",
    "HUE_SCENE_LOFI",
    "HUE_SCENE_WRAP",
    "HUE_SCENE_RAP",
    "HUE_SCENE_RNB",
  ]);
});

test("Hue config rejects untouched example placeholders", () => {
  const bad = hue.loadConfig({
    HUE_BRIDGE_HOST: "replace_with_hue_bridge_ip",
    HUE_USERNAME: "replace_with_hue_authorized_username",
    HUE_BRIDGE_ID: "replace_with_bridge_id",
    HUE_GROUP_ID: "",
    HUE_SCENE_LOFI: "replace_with_scene_id",
    HUE_SCENE_WRAP: "replace_with_scene_id",
    HUE_SCENE_RAP: "replace_with_scene_id",
    HUE_SCENE_RNB: "replace_with_scene_id",
  });
  const missing = hue.validateConfig(bad);
  assert.ok(missing.includes("HUE_BRIDGE_HOST"));
  assert.ok(missing.includes("HUE_USERNAME"));
  assert.ok(missing.includes("HUE_BRIDGE_ID"));
  assert.ok(missing.includes("HUE_GROUP_ID"));
  assert.ok(missing.includes("HUE_SCENE_LOFI"));
  assert.ok(missing.includes("HUE_SCENE_RNB"));
});

test("20-minute Hue transition is encoded as 12000 deciseconds", () => {
  assert.equal(hue.transitionDeciseconds(20 * 60 * 1000), 12000);
});

test("Hue transition clamps to bridge uint16 transitiontime", () => {
  assert.equal(hue.transitionDeciseconds(999999999), hue.MAX_TRANSITION_DS);
});

test("scene payload selects the configured RSVP mode and duration", () => {
  assert.deepEqual(hue.scenePayload(cfg(), "rap", 300000), {
    scene: "scene-rap",
    transitiontime: 3000,
  });
});

test("group paths URL-encode the Hue credential", () => {
  const c = cfg();
  c.username = "a/b token";
  assert.equal(hue.groupResourcePath(c), "/api/a%2Fb%20token/groups/3");
  assert.equal(hue.groupActionPath(c), "/api/a%2Fb%20token/groups/3/action");
});

test("Hue bridge certificate identity must match configured bridge ID", () => {
  assert.equal(hue.verifyBridgeIdentity("001788FFFE123456", { subject: { CN: "001788fffe123456" } }), undefined);
  assert.match(hue.verifyBridgeIdentity("001788fffe123456", { subject: { CN: "deadbeef" } }).message, /identity_mismatch/);
});

test("Hue HTTP 200 bodies containing API errors are failures", () => {
  assert.equal(hue.hueBodyHasError([{ success: { "/groups/3/action/on": true } }]), false);
  assert.equal(hue.hueBodyHasError([{ error: { type: 1, description: "unauthorized user" } }]), true);
});

test("Hue group brightness reads the active scene baseline", () => {
  assert.equal(hue.groupBrightness({ action: { bri: 147 } }), 147);
  assert.equal(hue.groupBrightness({ action: {} }), null);
});

test("reactive brightness payload changes brightness without touching color", () => {
  assert.deepEqual(hue.brightnessPayload(175, 1200), { bri: 175, transitiontime: 12 });
});

test("reactive Hue configuration is conservative by default and can be disabled", () => {
  const defaults = cfg();
  assert.equal(defaults.reactiveEnabled, true);
  assert.equal(defaults.reactiveRange, 36);
  assert.equal(defaults.reactiveMinIntervalMs, 1800);

  const disabled = hue.loadConfig({ HUE_REACTIVE_ENABLED: "false" });
  assert.equal(disabled.reactiveEnabled, false);
});


test("Hue adapter bind is restricted to loopback", () => {
  const base = {
    bridgeHost: "192.168.1.2", username: "u", bridgeId: "abcdef", groupId: "1",
    scenes: { lofi: "1", wrap: "2", rap: "3", rnb: "4" },
    bind: "0.0.0.0",
  };
  assert.ok(hue.validateConfig(base).some((x) => x.startsWith("HUE_ADAPTER_BIND")));
  assert.ok(hue.validateConfig({ ...base, bind: "localhost" }).some((x) => x.startsWith("HUE_ADAPTER_BIND")));
  assert.ok(hue.validateConfig({ ...base, bind: "::1" }).some((x) => x.startsWith("HUE_ADAPTER_BIND")));
  assert.equal(hue.validateConfig({ ...base, bind: "127.0.0.1" }).some((x) => x.startsWith("HUE_ADAPTER_BIND")), false);
});