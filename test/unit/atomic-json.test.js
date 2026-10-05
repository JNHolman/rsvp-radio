"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeJsonAtomic } = require("../../intelligence/atomic-json");

test("atomic JSON persistence replaces destination cleanly and leaves no temp file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-atomic-json-"));
  const target = path.join(dir, "state.json");
  fs.writeFileSync(target, '{"old":true}\n');

  assert.equal(writeJsonAtomic(target, { old: false, count: 2 }), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { old: false, count: 2 });
  assert.equal(fs.readdirSync(dir).some((name) => name.includes(".tmp-")), false);
});
