import assert from "node:assert/strict";
import test from "node:test";
import {
  isoWeekStart,
  latestCompletedWeekStart,
} from "./stock-week-completion.ts";

function sessions(...dates) {
  return dates.map((date) => ({ date }));
}

test("accepts the Friday week after the regular session closes", () => {
  const groups = new Map([
    ["2026-08-17", sessions("2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21")],
    ["2026-08-24", sessions("2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28")],
  ]);
  assert.equal(latestCompletedWeekStart(groups, "2026-08-28", "POST"), "2026-08-24");
});

test("keeps the latest holiday-shortened week instead of falling back", () => {
  const groups = new Map([
    ["2026-08-24", sessions("2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28")],
    ["2026-08-31", sessions("2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04")],
  ]);
  assert.equal(latestCompletedWeekStart(groups, "2026-09-07", "PRE"), "2026-08-31");
});

test("hides an in-progress current week", () => {
  const groups = new Map([
    ["2026-08-17", sessions("2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21")],
    ["2026-08-24", sessions("2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27")],
  ]);
  assert.equal(latestCompletedWeekStart(groups, "2026-08-27", "REGULAR"), "2026-08-17");
});

test("treats the Friday week as complete over the weekend", () => {
  const groups = new Map([
    ["2026-08-17", sessions("2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21")],
  ]);
  assert.equal(latestCompletedWeekStart(groups, "2026-08-23", "CLOSED"), "2026-08-17");
});

test("calculates the exchange-local ISO week boundary", () => {
  assert.equal(isoWeekStart("2026-08-23"), "2026-08-17");
  assert.equal(isoWeekStart("2026-08-24"), "2026-08-24");
});

test("keeps a Friday holiday or early-close week when the provider marks the market closed", () => {
  const goodFriday = new Map([
    ["2026-03-30", sessions("2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02")],
  ]);
  const earlyCloseFriday = new Map([
    ["2026-11-23", sessions("2026-11-23", "2026-11-24", "2026-11-25", "2026-11-27")],
  ]);
  assert.equal(latestCompletedWeekStart(goodFriday, "2026-04-03", "CLOSED"), "2026-03-30");
  assert.equal(latestCompletedWeekStart(earlyCloseFriday, "2026-11-27", "CLOSED"), "2026-11-23");
});