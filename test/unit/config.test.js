const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function freshConfig(env = {}) {
  const keys = ["RSVP_LANES_JSON", "RSVP_LANES_PATH"];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);

  const target = require.resolve("../../config");
  delete require.cache[target];
  const cfg = require("../../config");

  for (const k of keys) {
    if (old[k] === undefined) delete process.env[k];
    else process.env[k] = old[k];
  }
  return cfg;
}

test("lane config loads from local JSON file", () => {
  const file = path.join(os.tmpdir(), `rsvp-lanes-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify({ rap: ["RSVP RAP - Main"] }));
  const cfg = freshConfig({ RSVP_LANES_PATH: file });

  assert.match(cfg.RSVP_LANES_JSON, /RSVP RAP - Main/);
  assert.equal(cfg.RSVP_LANES_PATH, file);
  fs.rmSync(file, { force: true });
});

test("RSVP_LANES_JSON overrides the lane file", () => {
  const file = path.join(os.tmpdir(), `rsvp-lanes-${process.pid}-override.json`);
  fs.writeFileSync(file, JSON.stringify({ rap: ["from-file"] }));
  const cfg = freshConfig({
    RSVP_LANES_PATH: file,
    RSVP_LANES_JSON: JSON.stringify({ rap: ["from-env"] }),
  });

  assert.match(cfg.RSVP_LANES_JSON, /from-env/);
  assert.doesNotMatch(cfg.RSVP_LANES_JSON, /from-file/);
  fs.rmSync(file, { force: true });
});
