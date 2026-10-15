"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { bestTitleLayout } = require("../../public/app/title-fit.js");

// Approximate letter widths ONLY for deterministic algorithm invariants.
// Physical glyph widths are measured by Chromium's canvas at runtime.
const measure = (str, px) => str.length * px * .50;
const assertNoOrphans = layout => {
  if (layout.lines.length > 1) {
    for (const line of layout.lines) {
      assert.ok(line.trim().split(/\s+/).length >= 2, "no one-word (or numeral-only) line");
    }
  }
};

test("a short title remains a single large line", () => {
  const r = bestTitleLayout("Steal Away", 510, 56, measure);
  assert.deepEqual(r.lines, ["Steal Away"]);
  assert.equal(r.fontSize, 56);
});

test("medium title shrinks gently instead of orphaning a trailing numeral", () => {
  const r = bestTitleLayout("Dangerously in Love 2", 500, 56, measure);
  assert.deepEqual(r.lines, ["Dangerously in Love 2"]);
  assert.ok(r.fontSize >= 56 * .82 && r.fontSize <= 56);
});

test("a title with Heart ends on a meaningful line rather than alone", () => {
  const r = bestTitleLayout("Try Sleeping With a Broken Heart", 485, 56, measure);
  assert.ok(r.lines.length >= 2);
  assertNoOrphans(r);
  assert.ok(r.lines[r.lines.length - 1].endsWith("Heart"));
  assert.notEqual(r.lines[r.lines.length - 1], "Heart");
});

test("longer names wrap in balanced lines without single-word leftovers", () => {
  for (const name of ["He Wasn't Man Enough", "You Don't Know My Name", "I Never Loved a Man the Way I Love You"]) {
    const r = bestTitleLayout(name, 340, 56, measure);
    assert.ok(r.fontSize > 0);
    assertNoOrphans(r);
  }
});

test("available column size controls fitting, not length-only thresholds", () => {
  const large = bestTitleLayout("Dangerously in Love 2", 620, 56, measure);
  const small = bestTitleLayout("Dangerously in Love 2", 350, 56, measure);
  assert.equal(large.fontSize, 56);
  assert.ok(small.fontSize < large.fontSize || small.lines.length > 1);
});

test("empty or not-yet-laid-out title safely returns a string", () => {
  assert.deepEqual(bestTitleLayout("", 0, 56, measure).lines, [""]);
});
