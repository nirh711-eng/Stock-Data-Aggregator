import assert from "node:assert/strict";
import test from "node:test";
import {
  candleDateKey,
  exchangeLocalDateKey,
  isHammerCandle,
  selectPreviousCompletedCandle,
  PERSISTENT_AVAILABILITY_FAILURE_THRESHOLD,
  updateAvailabilityTracker,
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

test("only promotes repeated availability failures to maintenance candidates", () => {
  const tracker = new Map();
  const symbol = "STALE";
  const observation = [{ symbol, quoteAvailable: false, candlesAvailable: false }];

  const first = updateAvailabilityTracker(tracker, observation, new Date("2026-08-25T10:00:00.000Z"));
  assert.equal(first.unavailableSymbols.length, 2);
  assert.equal(first.persistentUnavailableSymbols.length, 0);

  updateAvailabilityTracker(tracker, observation, new Date("2026-08-25T11:00:00.000Z"));
  const third = updateAvailabilityTracker(tracker, observation, new Date("2026-08-25T12:00:00.000Z"));
  assert.equal(PERSISTENT_AVAILABILITY_FAILURE_THRESHOLD, 3);
  assert.deepEqual(
    third.persistentUnavailableSymbols.map(({ symbol, reason, consecutiveFailures }) => ({
      symbol,
      reason,
      consecutiveFailures,
    })),
    [
      { symbol, reason: "quote", consecutiveFailures: 3 },
      { symbol, reason: "candles", consecutiveFailures: 3 },
    ],
  );

  const recovered = updateAvailabilityTracker(
    tracker,
    [{ symbol, quoteAvailable: true, candlesAvailable: true }],
    new Date("2026-08-25T13:00:00.000Z"),
  );
  assert.deepEqual(recovered.unavailableSymbols, []);
  assert.deepEqual(recovered.persistentUnavailableSymbols, []);
  assert.equal(tracker.size, 0);
});