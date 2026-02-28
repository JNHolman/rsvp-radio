/**
 * public/app/player.js
 * Plex polling and UI updates.
 *
 * - 2000ms poll interval
 * - In-flight guard: skips if previous fetch still running
 * - Change detection: only touches DOM when values actually changed
 * - Uses AbortController + setTimeout for timeout (safe on all Chromium versions)
 */

// ── DOM refs (resolved once at load, not on every poll) ───────────────────────
const _el = {
  status:  document.getElementById("statusText"),
  card:    document.getElementById("nowCard"),
  img:     document.getElementById("artImg"),
  ph:      document.getElementById("ph"),
  title:   document.getElementById("tTitle"),
  artist:  document.getElementById("tArtist"),
  album:   document.getElementById("tAlbum"),
};

// ── Change detection cache ────────────────────────────────────────────────────
let _prev = { playing: null, title: null, artist: null, album: null, artUrl: null };

// ── In-flight guard ───────────────────────────────────────────────────────────
let _busy = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _decode(str) {
  if (!str) return "";
  const t = document.createElement("textarea");
  t.innerHTML = str;
  return t.value;
}

function _artUrl(state) {
  if (!state) return "";
  if (state.artUrl) {
    if (state.artUrl.startsWith("http")) return state.artUrl;
    if (state.artUrl.startsWith("/"))    return "http://127.0.0.1:3000" + state.artUrl;
    try { return new URL(state.artUrl, location.origin).href; } catch (_) {}
  }
  if (state.thumb) return "http://127.0.0.1:32400" + state.thumb;
  return "";
}

// Safe fetch with timeout — works on all Chromium versions (no AbortSignal.timeout)
function _fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { cache: "no-store", signal: ctrl.signal })
    .finally(() => clearTimeout(t));
}

// ── DOM writers (only called when value changed) ──────────────────────────────

function _setStatus(playing) {
  _el.status.textContent = playing ? "NOW PLAYING" : "IDLE";
}

function _showCard(on) {
  _el.card.classList.toggle("on", !!on);
}

function _setArt(url) {
  if (url) {
    _el.img.src          = url;
    _el.img.style.display = "block";
    _el.ph.style.display  = "none";
  } else {
    _el.img.removeAttribute("src");
    _el.img.style.display = "none";
    _el.ph.style.display  = "grid";
  }
}

function _setMeta(title, artist, album) {
  _el.title.textContent  = _decode(title)  || "—";
  _el.artist.textContent = _decode(artist) || "—";
  _el.album.textContent  = _decode(album)  || "—";
}

// ── Poll ──────────────────────────────────────────────────────────────────────

async function poll() {
  if (_busy) return;
  _busy = true;

  try {
    let state = null;
    try {
      const r = await _fetchWithTimeout(STATE_URL, POLL_TIMEOUT);
      if (r.ok) state = await r.json();
    } catch (_) { /* network error → treat as idle */ }

    const playing = !!(
      state?.type        === "track" &&
      state?.playerState === "playing"
    );

    _setStatus(playing);

    if (!playing) {
      _showCard(false);
      if (_prev.playing !== false) {
        _prev.playing = false;
        await onPlaybackStop();
      }
      return;
    }

    // ── Playing ───────────────────────────────────────────────────────────────
    if (_prev.playing !== true) {
      _prev.playing = true;
      await onPlaybackStart();
    }

    _showCard(true);

    // Metadata — write only on change
    const title  = state.title  || "";
    const artist = state.artist || "";
    const album  = state.album  || "";
    if (title !== _prev.title || artist !== _prev.artist || album !== _prev.album) {
      _prev.title  = title;
      _prev.artist = artist;
      _prev.album  = album;
      _setMeta(title, artist, album);
    }

    // Artwork — write only on change
    const url = _artUrl(state);
    if (url !== _prev.artUrl) {
      _prev.artUrl = url;
      _setArt(url);
    }

    // Signal — throttled inside sendSignal()
    await sendSignal(Number(state.bass || 0), Number(state.energy || 0));

  } finally {
    _busy = false;
  }
}

function startPolling() {
  poll();
  setInterval(poll, POLL_MS);
}
