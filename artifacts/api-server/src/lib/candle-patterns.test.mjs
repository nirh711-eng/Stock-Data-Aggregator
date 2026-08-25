import assert from "node:assert/strict";
import test from "node:test";
import {
  candleDateKey,
  exchangeLocalDateKey,
  isHammerCandle,
  selectPreviousCompletedCandle,
} from "./candle-patterns.ts";

test("recognizes a hammer and rejects a doji or short lower shadow", () => {
  assert.equal(isHammerCandle(105, 106.3, 95, 106), true);
  assert.equal(isHammerCandle(100, 105, 99, 100.1), false);
  assert.equal(isHammerCandle(100, 101, 99, 100), false);
});

test("excludes today's in-progress candle and selects the previous session", () => {
  const candle = selectPreviousCompletedCandle(
    [
      { date: "2026-08-25", open: 105, high: 107, low: 95, close: 106 },
      { date: "2026-08-22", open: 100, high: 101, low: 99, close: 100.5 },
      { date: "2026-08-21", open: 95, high: 98, low: 90, close: 97 },
    ],
    "2026-08-25",
  );
  assert.equal(candle?.date, "2026-08-22");
});

test("uses the latest provider candle before a weekend or holiday", () => {
  const candle = selectPreviousCompletedCandle(
    [
      { date: "2026-09-08", open: 10, high: 11, low: 9, close: 10.5 },
      { date: "2026-09-04", open: 10, high: 11, low: 9, close: 10.5 },
    ],
    "2026-09-08",
  );
  assert.equal(candle?.date, "2026-09-04");
});

test("formats exchange-local dates and provider date values consistently", () => {
  assert.equal(candleDateKey("2026-08-25T04:00:00.000Z"), "2026-08-25");
  assert.equal(
    exchangeLocalDateKey(new Date("2026-08-25T02:00:00.000Z")),
    "2026-08-24",
  );
});