/**
 * RSVP controls. The logo opens a LEFT drawer with four sections.
 * Music/lighting scheduling remains owned by the existing server.
 * In the isolated preview, all write controls are intentionally disabled.
 */
const _brand = document.getElementById("brand");
const _menu = document.getElementById("menu");
const _menuClose = document.getElementById("menuClose");
const _menuScrim = document.getElementById("menuScrim");
const _menuFeedback = document.getElementById("menuFeedback");
const _drawerHome = document.getElementById("drawerHome");
const _drawerDetails = document.getElementById("drawerDetails");
const _drawerBack = document.getElementById("drawerBack");
const _drawerTitle = document.getElementById("drawerTitle");
const _menuPreview = window.RSVP_PREVIEW_MODE === true;
let _menuTimer = null;

const _drawerNames = Object.freeze({
  radio: "RSVP RADIO",
  tv: "RSVP TV",
  vibe: "VIBE",
  lighting: "LIGHTING",
});

function _menuMessage(message, error = false) {
  _menuFeedback.textContent = message;
  _menuFeedback.classList.toggle("error", !!error);
}

function _toggleMenu(force) {
  const on = typeof force === "boolean" ? force : !_menu.classList.contains("on");
  _menu.classList.toggle("on", on);
  _menu.setAttribute("aria-hidden", String(!on));
  _menuScrim.classList.toggle("on", on);
  _brand.setAttribute("aria-expanded", String(on));
  clearTimeout(_menuTimer);
  // The drawer remains responsive without being left open indefinitely.
  if (on) _menuTimer = setTimeout(() => _toggleMenu(false), 60000);
}

function _resetDrawer() {
  _drawerHome.hidden = false;
  _drawerDetails.hidden = true;
  for (const panel of _menu.querySelectorAll(".drawerPanel")) panel.hidden = true;
  _menuMessage("");
}
function _showDrawerPanel(panel) {
  if (!_drawerNames[panel]) return;
  _drawerTitle.textContent = _drawerNames[panel];
  _drawerHome.hidden = true;
  _drawerDetails.hidden = false;
  for (const pane of _menu.querySelectorAll(".drawerPanel")) {
    pane.hidden = pane.dataset.panel !== panel;
  }
  _menuMessage(_menuPreview ? "Preview only — no changes will be sent." : "");
  _toggleMenu(true);
  if (panel === "tv") _refreshMenuVideos();
}

async function _menuPost(endpoint) {
  if (_menuPreview) {
    _menuMessage("Preview only — no changes sent to your live system.");
    return false;
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(data.error || "HTTP " + response.status);
    _menuMessage("Applied.");
    return true;
  } catch (err) {
    _menuMessage("Unable to apply: " + err.message, true);
    return false;
  }
}

async function _refreshMenuVideos() {
  const host = document.getElementById("menuVideoList");
  host.textContent = "Loading playlists…";
  try {
    const response = await fetch("/admin/video-playlists", { cache: "no-store" });
    if (!response.ok) throw new Error("Unavailable");
    const data = await response.json();
    host.replaceChildren();
    for (const playlist of data.playlists || []) {
      const id = String(playlist.ratingKey || "");
      if (!/^\d+$/.test(id)) continue;
      const button = document.createElement("button");
      button.className = "menuBtn";
      button.type = "button";
      button.dataset.videoPlaylist = id;
      button.textContent = playlist.title || "RSVP TV";
      host.appendChild(button);
    }
    if (!host.children.length) host.textContent = "No RSVP TV playlists configured.";
  } catch (_) {
    host.textContent = "Playlist list unavailable in this preview.";
  }
}

_brand.addEventListener("click", () => {
  if (_menu.classList.contains("on")) {
    _toggleMenu(false);
  } else {
    _resetDrawer();
    _toggleMenu(true);
  }
});
_brand.addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    _brand.click();
  }
});
_menuClose.addEventListener("click", () => _toggleMenu(false));
_menuScrim.addEventListener("click", () => _toggleMenu(false));
_drawerBack.addEventListener("click", () => {
  _resetDrawer();
  _toggleMenu(true);
});

_menu.addEventListener("click", async (e) => {
  const option = e.target.closest("[data-drawer-section]");
  if (option) {
    _showDrawerPanel(option.dataset.drawerSection);
    return;
  }
  const button = e.target.closest(".menuBtn");
  if (!button) return;
  _toggleMenu(true);
  if (button.dataset.videoPlaylist) {
    await _menuPost("/admin/video/play/" + button.dataset.videoPlaylist);
  } else if (button.dataset.vibe) {
    const mode = button.dataset.vibe;
    if (["lounge", "rnb", "rap", "lofi"].includes(mode)) await _menuPost("/mode/" + mode);
  } else if (button.dataset.api) {
    await _menuPost(button.dataset.api);
  } else if (button.dataset.action || button.dataset.mode) {
    if (_menuPreview) {
      _menuMessage("Preview only — lighting hasn't been changed.");
      return;
    }
    let ok = false;
    if (button.dataset.action === "on") ok = await setLightsOn();
    else if (button.dataset.action === "off") ok = await setLightsOff();
    else if (button.dataset.mode) ok = await setLightsMode(button.dataset.mode);
    _menuMessage(ok ? "Lighting command applied." : "Lighting command failed.", !ok);
  }
});

if (_menuPreview) {
  const foot = document.getElementById("drawerFoot");
  if (foot) foot.textContent = "RSVP RADIO · PREVIEW ONLY";
}

// Preserve the original kiosk's explicit exit action (button is hidden on TV).
document.getElementById("exitBtn").addEventListener("click", async () => {
  if (_menuPreview) return;
  try { await fetch("/api/exit", { method: "POST" }); } catch (_) {}
});

// Boot the existing display pipeline; NO extra media/Hue/schedule engine.
(async function boot() {
  await bootBackground();
  startBackgroundTimers();
  startPolling();
})();
