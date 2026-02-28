/**
 * public/app/main.js
 * Entry point — boots the app and wires up UI interactions.
 *
 * Boot order:
 *   1. Load background video (one video, done — no forced swap)
 *   2. Start background day/night check + reload timer
 *   3. Start Plex polling
 *   4. Start time-block boundary watcher
 */

// ── Light menu ────────────────────────────────────────────────────────────────

const _brand     = document.getElementById("brand");
const _menu      = document.getElementById("menu");
const _menuClose = document.getElementById("menuClose");
let   _menuTimer = null;

function _toggleMenu(force) {
  const on = typeof force === "boolean" ? force : !_menu.classList.contains("on");
  _menu.classList.toggle("on", on);
  _menu.setAttribute("aria-hidden", String(!on));
  clearTimeout(_menuTimer);
  if (on) _menuTimer = setTimeout(() => _toggleMenu(false), 10000);
}

_brand.addEventListener("pointerdown", (e) => { e.preventDefault(); _toggleMenu(); });
_menuClose.addEventListener("pointerdown", (e) => { e.preventDefault(); _toggleMenu(false); });

_menu.addEventListener("pointerdown", async (e) => {
  const btn  = e.target.closest(".menuBtn");
  if (!btn) return;
  const mode = btn.dataset.mode;
  const act  = btn.dataset.action;

  if      (act === "on")  { await setLightsOn();       _toggleMenu(false); }
  else if (act === "off") { await setLightsOff();       _toggleMenu(false); }
  else if (mode)          { await setLightsMode(mode);  _toggleMenu(false); }
});

// ── Exit button ───────────────────────────────────────────────────────────────

document.getElementById("exitBtn").addEventListener("pointerdown", async (e) => {
  e.preventDefault();
  try { await fetch("/api/exit", { method: "POST" }); } catch (_) {}
});

// ── Boot ──────────────────────────────────────────────────────────────────────

(async function boot() {
  await bootBackground();
  startBackgroundTimers();
  startPolling();
  startBoundaryTimer();
})();
