"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSingleFlight } = require("../../intelligence/single-flight");

test("concurrent calls share the same in-flight work and result", async () => {
  let calls = 0;
  let finish;
  const run = createSingleFlight((value) => {
    calls += 1;
    if (calls === 1) return new Promise((resolve) => { finish = () => resolve(value); });
    return Promise.resolve(value);
  });

  const first = run("first");
  const second = run("second");
  assert.strictEqual(second, first, "overlapping callers wait on the same promise");

  await Promise.resolve();
  assert.equal(calls, 1, "the work runs once");
  finish();
  assert.equal(await first, "first", "the first caller's input wins the shared run");

  assert.equal(await run("later"), "later", "a completed run permits a new call");
  assert.equal(calls, 2);
});

test("a rejected run clears the in-flight slot so later work can proceed", async () => {
  let calls = 0;
  const run = createSingleFlight(async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary failure");
    return "recovered";
  });

  await assert.rejects(run(), /temporary failure/);
  assert.equal(await run(), "recovered");
  assert.equal(calls, 2);
});

test("createSingleFlight rejects non-function work", () => {
  assert.throws(() => createSingleFlight(null), /must be a function/);
});
