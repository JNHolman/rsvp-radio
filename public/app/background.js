/**
 * public/app/background.js
 * Background video crossfade and memory-safe reload.
 *
 * Rules:
 *   1. Always load into the BACK buffer first.
 *   2. Only detach the FRONT buffer after back is playing and faded in.
 *   3. Boot: one load, one play, done — no swap on startup.
 *   4. Reload uses the same crossfade path as a day/night swap — no gap, no flash.
 */

const _bgA = document.getElementById("bgA");
const _bgB = document.getElementById("bgB");

let _front      = _bgA;
let _back       = _bgB;
let _currentSrc = null;
let _lastReload = Date.now();

// ── Internals ─────────────────────────────────────────────────────────────────

function _setSrc(video, src) {
  if (video.getAttribute("src") !== src) {
    video.setAttribute("src", src);
    video.load();
  }
}

function _detach(video) {
  try { video.pause(); } catch (_) {}
  video.classList.remove("on");
  video.removeAttribute("src");
  try { video.load(); } catch (_) {}
}

async function _crossfadeTo(src) {
  const oldFront = _front;
  const oldBack  = _back;

  _setSrc(oldBack, src);
  try { await oldBack.play(); } catch (_) {}

  oldBack.classList.add("on");
  oldFront.classList.remove("on");

  // Detach old front after CSS transition finishes
  setTimeout(() => {
    _detach(oldFront);
    _front      = oldBack;
    _back       = oldFront;
    _currentSrc = src;
  }, BG_CROSSFADE_MS + 50);
}

// ── Public API ────────────────────────────────────────────────────────────────

async function bootBackground() {
  _currentSrc = isDayTime() ? BG_DAY : BG_NIGHT;
  _setSrc(_front, _currentSrc);
  _front.classList.add("on");
  try { await _front.play(); } catch (_) {}
  _detach(_back);
}

async function swapBackgroundIfNeeded(force = false) {
  const want = isDayTime() ? BG_DAY : BG_NIGHT;
  if (!force && want === _currentSrc) return;
  await _crossfadeTo(want);
}

async function reloadCurrentVideoIfDue() {
  if (Date.now() - _lastReload < BG_RELOAD_MS) return;
  _lastReload = Date.now();
  console.log("[bg] Reloading video through back buffer");
  await _crossfadeTo(_currentSrc);
}

function startBackgroundTimers() {
  setInterval(() => swapBackgroundIfNeeded(false), BG_CHECK_MS);
  setInterval(reloadCurrentVideoIfDue, 60 * 1000);
}
