"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { samples, renderReview, ART } = require("../../scripts/review-hue-spectrum");

test("review samples real deterministic AUTO sequences without changing any services", () => {
  const now = Date.UTC(2026, 9, 19, 18);
  for (const phase of ["day", "night"]) {
    const selected = samples(phase, 25, now);
    assert.deepEqual(selected, samples(phase, 25, now));
    assert.equal(selected.length, 25);
    assert.ok(new Set(selected.map(s => s.color)).size >= 22);
    assert.ok(new Set(selected.map(s => s.family)).size >= 7);
    assert.ok(selected.every(s => /^#[0-9A-F]{6}$/.test(s.color)));
  }
  assert.deepEqual(ART, {
    day: "rsvp_day_art.webp", night: "rsvp_night_art.webp",
  });
});

test("review embeds actual approved artwork and colored destination swatches", () => {
  const day = samples("day", 2, Date.UTC(2026, 9, 19, 12));
  const night = samples("night", 2, Date.UTC(2026, 9, 19, 12));
  const html = renderReview({
    day, night,
    dayImage: "REFDAY=",
    nightImage: "REFNIGHT=",
  });
  assert.match(html, /data:image\/webp;base64,REFDAY=/);
  assert.match(html, /data:image\/webp;base64,REFNIGHT=/);
  assert.match(html, /No Hue commands are sent/);
  for (const entry of [...day, ...night]) {
    assert.ok(html.includes(entry.color));
    assert.ok(html.includes(entry.family));
  }
});

test("review tool never sends commands to Hue or writes into TV production assets", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../scripts/review-hue-spectrum.js"), "utf8");
  assert.doesNotMatch(source, /\bfetch\(/);
  assert.doesNotMatch(source, /\bhueRequest\(/);
  assert.doesNotMatch(source, /systemctl|chromium --|plexamp --/);
  assert.match(source, /os\.tmpdir\(\)/);
  assert.match(source, /fs\.readFileSync\(location\)/);
});
