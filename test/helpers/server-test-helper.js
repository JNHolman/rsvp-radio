const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`, { cache: "no-store" });
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
    SESSION_DATA_PATH: envOverrides.SESSION_DATA_PATH || "",
    SESSION_GENRE_FETCH_TIMEOUT_MS: envOverrides.SESSION_GENRE_FETCH_TIMEOUT_MS || "",
    SESSION_PERSIST_INTERVAL_MS: envOverrides.SESSION_PERSIST_INTERVAL_MS || "",
    SKIP_DATA_PATH: envOverrides.SKIP_DATA_PATH || "",
  };

  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  child.stdout.on("data", () => {});

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(baseUrl);
  } catch (err) {
    child.kill("SIGTERM");
    throw new Error(`${err.message}
${stderr}`);
  }

  return {
    baseUrl,
    child,
    async stop() {
      child.kill("SIGTERM");
      await delay(150);
    },
  };
}

module.exports = { makePublicDir, startServer };
