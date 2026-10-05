"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCommandLane } = require("../../intelligence/command-lane");

test("commands run in issue order without overlapping", async () => {
  const lane = createCommandLane();
  const events = [];
  let finishFirst;

  const first = lane.enqueue(() => new Promise((resolve) => {
    events.push("first-start");
    finishFirst = () => { events.push("first-end"); resolve("one"); };
  }));
  const second = lane.enqueue(async () => {
    events.push("second-start");
    events.push("second-end");
    return "two";
  });

  await Promise.resolve();
  assert.deepEqual(events, ["first-start"]);
  finishFirst();
  assert.deepEqual(await Promise.all([first, second]), ["one", "two"]);
  assert.deepEqual(events, ["first-start", "first-end", "second-start", "second-end"]);
});

test("a failed command does not block later commands", async () => {
  const lane = createCommandLane();
  const first = lane.enqueue(async () => { throw new Error("temporary failure"); });
  const second = lane.enqueue(async () => "recovered");

  await assert.rejects(first, /temporary failure/);
  assert.equal(await second, "recovered");
});

test("newer intent invalidates an older command result", () => {
  const lane = createCommandLane();
  const oldIntent = lane.issueIntent();
  const newIntent = lane.issueIntent();

  assert.equal(lane.isCurrent(oldIntent), false);
  assert.equal(lane.isCurrent(newIntent), true);
});

test("rejecting invalid work does not poison the command lane", async () => {
  const lane = createCommandLane();
  await assert.rejects(lane.enqueue(null), /must be a function/);
  assert.equal(await lane.enqueue(async () => "ready"), "ready");
});
