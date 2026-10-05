/**
 * Hue light controls.
 *
 * Automatic Hue scheduling and reactive lighting are server-owned. The kiosk
 * only sends explicit human control actions.
 */
const _VALID_MODES = new Set(["lounge", "lofi", "rap", "rnb"]);

function normalizeMode(mode) {
  const value = String(mode || "").toLowerCase();
  return _VALID_MODES.has(value) ? value : "";
}

async function _roomPost(path, payload = {}) {
  try {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return r.ok;
  } catch (err) {
    console.warn("[lights] POST", path, "failed:", err.message);
    return false;
  }
}

async function setLightsMode(mode) {
  const next = normalizeMode(mode);
  if (!next) return false;
  return _roomPost("/admin/lights/mode/" + next);
}

async function setLightsOn() {
  return _roomPost("/admin/lights/on");
}

async function setLightsOff() {
  return _roomPost("/admin/lights/off");
}