const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// fetch with AbortController-driven timeout — bare fetch() can hang forever
// against an unreachable host, leaking handles on test exit.
async function fetchWithTimeout(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Wait for the spawned server to start serving /health, but abort early if the
// child exits in the meantime — otherwise tests hang for the full timeout.
async function waitForServer(baseUrl, child, timeoutMs = 5000) {
  const started = Date.now();
  let childExited = false;
  let childExitCode = null;
  child.once("exit", (code, signal) => {
    childExited = true;
    childExitCode = code !== null ? code : `signal:${signal}`;
  });

  while (Date.now() - started < timeoutMs) {
    if (childExited) {
      throw new Error(`server child exited before becoming ready (code: ${childExitCode})`);
    }
    try {
      const res = await fetchWithTimeout(`${baseUrl}/health`, 800);
      if (res.ok) return;
    } catch (_) {}
    await delay(100);
  }
  throw new Error(`server did not start within ${timeoutMs}ms`);
}

function makePublicDir({ withAssets = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-radio-public-"));
  const assetsDir = path.join(dir, "assets", "bg");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), "public", "index.html"), path.join(dir, "index.html"));
  fs.copyFileSync(path.join(process.cwd(), "public", "styles.css"), path.join(dir, "styles.css"));
  fs.cpSync(path.join(process.cwd(), "public", "app"), path.join(dir, "app"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), "public", "assets", "rsvp-icon.png"), path.join(dir, "assets", "rsvp-icon.png"));
  if (withAssets) {
    fs.writeFileSync(path.join(assetsDir, "rsvp_day_720_optimized.mp4"), "day");
    fs.writeFileSync(path.join(assetsDir, "rsvp_night_720.mp4"), "night");
  }
  return dir;
}

async function startServer(envOverrides = {}) {
  const port = envOverrides.PORT || String(3300 + Math.floor(Math.random() * 300));
  const env = {
    ...process.env,
    PORT: port,
    PLEX_TOKEN: envOverrides.PLEX_TOKEN || "test-token",
    PLEX_BASE: envOverrides.PLEX_BASE || "http://127.0.0.1:1",
    POLL_MS: envOverrides.POLL_MS || "10000",
    POLL_TIMEOUT_MS: envOverrides.POLL_TIMEOUT_MS || "100",
    PUBLIC_DIR: envOverrides.PUBLIC_DIR,
    LIGHTS_URL: envOverrides.LIGHTS_URL || "http://127.0.0.1:5005",
    EXIT_API_TOKEN: envOverrides.EXIT_API_TOKEN || "",
    PLEX_WEBHOOK_MAX_BYTES: envOverrides.PLEX_WEBHOOK_MAX_BYTES || "256",
    PLEX_WEBHOOK_TOKEN: envOverrides.PLEX_WEBHOOK_TOKEN || "",
    SESSION_DATA_PATH: envOverrides.SESSION_DATA_PATH || "",
    RUNTIME_STATE_PATH: envOverrides.RUNTIME_STATE_PATH || path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-radio-runtime-")), "runtime-state.json"),
    SESSION_GENRE_FETCH_TIMEOUT_MS: envOverrides.SESSION_GENRE_FETCH_TIMEOUT_MS || "",
    SKIP_DATA_PATH: envOverrides.SKIP_DATA_PATH || "",
    PLAYLIST_LOFI: envOverrides.PLAYLIST_LOFI || "",
    PLAYLIST_WRAP: envOverrides.PLAYLIST_WRAP || "",
    PLAYLIST_RAP:  envOverrides.PLAYLIST_RAP  || "",
    PLAYLIST_RNB:  envOverrides.PLAYLIST_RNB  || "",
    PLEXAMP_CLIENT_IDENTIFIER:     envOverrides.PLEXAMP_CLIENT_IDENTIFIER     || "",
    PLEX_TARGET_CLIENT_IDENTIFIER: envOverrides.PLEX_TARGET_CLIENT_IDENTIFIER || "",
    MEDIA_DIR:                     envOverrides.MEDIA_DIR                     || "",
    PLEXAMP_BASE:                  envOverrides.PLEXAMP_BASE                  || "",
  };

  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  child.stdout.on("data", () => {});
  // Prevent EPIPE from crashing parent if test exits while child still writing.
  child.stdout.on("error", () => {});
  child.stderr.on("error", () => {});

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(baseUrl, child);
  } catch (err) {
    try { child.kill("SIGTERM"); } catch (_) {}
    throw new Error(`${err.message}\n${stderr}`);
  }

  return {
    baseUrl,
    child,
    async stop() {
      // Send SIGTERM, wait for actual exit. Escalate to SIGKILL after 1.5s
      // if the child is being stubborn so npm test can finish cleanly.
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      try { child.kill("SIGTERM"); } catch (_) {}
      const escalate = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch (_) {}
      }, 1500);
      await exited;
      clearTimeout(escalate);
    },
  };
}

module.exports = { makePublicDir, startServer };