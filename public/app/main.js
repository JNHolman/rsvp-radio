/**
 * RSVP TV kiosk controls. Scheduling and ownership remain server-side.
 * Opening the menu never changes the active media or Hue scene by itself.
 */
const _brand = document.getElementById("brand");
const _menu = document.getElementById("menu");
const _menuClose = document.getElementById("menuClose");
const _menuFeedback = document.getElementById("menuFeedback");
let _menuTimer = null;

function _toggleMenu(force) {
  const on = typeof force === "boolean" ? force : !_menu.classList.contains("on");
  _menu.classList.toggle("on", on);
  _menu.setAttribute("aria-hidden", String(!on));
  clearTimeout(_menuTimer);
  if (on) _menuTimer = setTimeout(() => _toggleMenu(false), 25000);
}
function _menuMessage(message, error = false) {
  _menuFeedback.textContent = message;
  _menuFeedback.classList.toggle("error", !!error);
}
async function _menuPost(endpoint) {
  try {
    const response = await fetch(endpoint, { method: "POST" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    _menuMessage("Command accepted.");
    return true;
  } catch (error) {
    _menuMessage("Command failed: " + error.message, true);
    return false;
  }
}

async function _refreshMenuQueue() {
  const host = document.getElementById("menuQueueList");
  host.textContent = "Checking queue…";
  try {
    const response = await fetch("/api/up-next", { cache: "no-store" });
    if (!response.ok) throw new Error("Queue unavailable");
    const data = await response.json();
    const items = Array.isArray(data.tracks) ? data.tracks : [];
    host.replaceChildren();
    if (!data.available || !items.length) {
      host.textContent = data.available ? "Nothing queued" : "Queue unavailable";
      return;
    }
    for (const [index, item] of items.entries()) {
      const row = document.createElement("div");
      row.className = "menuQueueTrack";
      row.textContent = (index + 1) + ". " + (item.title || "—") + (item.artist ? " — " + item.artist : "");
      host.appendChild(row);
    }
  } catch (_) {
    host.textContent = "Queue unavailable";
  }
}

async function _refreshMenuVideos() {
  const host = document.getElementById("menuVideoList");
  host.textContent = "Loading playlists…";
  try {
    const response = await fetch("/admin/video-playlists", { cache: "no-store" });
    if (!response.ok) throw new Error("Video playlists unavailable");
    const payload = await response.json();
    host.replaceChildren();
    for (const item of payload.playlists || []) {
      const key = String(item.ratingKey || "");
      if (!/^\d+$/.test(key)) continue;
      const button = document.createElement("button");
      button.className = "menuBtn";
      button.dataset.videoPlaylist = key;
      button.textContent = item.title || "RSVP TV";
      host.appendChild(button);
    }
    if (!host.children.length) host.textContent = "No RSVP TV playlists configured.";
  } catch (_) {
    host.textContent = "Video playlists unavailable";
  }
}

function _showMenuPanel(panel) {
  for (const button of _menu.querySelectorAll("[data-panel-target]")) {
    button.classList.toggle("active", button.dataset.panelTarget === panel);
  }
  for (const pane of _menu.querySelectorAll("[data-panel]")) {
    pane.classList.toggle("on", pane.dataset.panel === panel);
  }
  _menuMessage("");
  _toggleMenu(true);
  if (panel === "queue") _refreshMenuQueue();
  if (panel === "tv") _refreshMenuVideos();
}

// The always-visible sidebar mirrors the approved mockup, but each item
// opens a real section of the existing functional controls panel.
document.getElementById("sideNav")?.addEventListener("pointerdown", e => {
  const button = e.target.closest("[data-sidebar]");
  if (!button) return;
  e.preventDefault();
  const target = button.dataset.sidebar;
  for (const item of document.querySelectorAll(".sideNavItem")) {
    item.classList.toggle("selected", item === button);
  }
  if (target === "playing") {
    _toggleMenu(false);
  } else {
    _showMenuPanel(target);
  }
});

_brand.addEventListener("pointerdown", e => { e.preventDefault(); _toggleMenu(); });
_menuClose.addEventListener("pointerdown", e => { e.preventDefault(); _toggleMenu(false); });

_menu.addEventListener("pointerdown", async e => {
  const tab = e.target.closest("[data-panel-target]");
  if (tab) { e.preventDefault(); _showMenuPanel(tab.dataset.panelTarget); return; }
  const btn = e.target.closest(".menuBtn");
  if (!btn) return;
  e.preventDefault();
  _toggleMenu(true);

  if (btn.dataset.fx) {
    const off = btn.dataset.fx === "off";
    document.querySelector(".stage").classList.toggle("fxOff", off);
    _menuMessage(off ? "Artwork effects off." : "Artwork effects on.");
    return;
  }
  if (btn.dataset.videoPlaylist) {
    await _menuPost("/admin/video/play/" + btn.dataset.videoPlaylist);
    return;
  }
  if (btn.dataset.api) {
    await _menuPost(btn.dataset.api);
    return;
  }
  let ok = false;
  if (btn.dataset.action === "on") ok = await setLightsOn();
  else if (btn.dataset.action === "off") ok = await setLightsOff();
  else if (btn.dataset.mode) ok = await setLightsMode(btn.dataset.mode);
  _menuMessage(ok ? "Lighting command accepted." : "Lighting command failed.", !ok);
});

// Exit is explicitly requested by the operator, never a timer/navigation side effect.
document.getElementById("exitBtn").addEventListener("pointerdown", async e => {
  e.preventDefault();
  try { await fetch("/api/exit", { method: "POST" }); } catch (_) {}
});

// Boot the existing background/polling pipeline. No second scheduling clock.
(async function boot() {
  await bootBackground();
  startBackgroundTimers();
  startPolling();
})();
