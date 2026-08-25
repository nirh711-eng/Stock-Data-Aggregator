export type OHLC = {
  date: string | Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
};

export function exchangeLocalDateKey(
  date: Date,
  timeZone = "America/New_York",
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function candleDateKey(date: string | Date): string {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date)) {
    return date.slice(0, 10);
  }
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * A hammer must have a real body, a lower shadow at least twice its body,
 * and an upper shadow no larger than 35% of its body.
 */
export function isHammerCandle(
  open: number | null,
  high: number | null,
  low: number | null,
  close: number | null,
): boolean {
  if (
    open == null ||
    high == null ||
    low == null ||
    close == null ||
    ![open, high, low, close].every(Number.isFinite) ||
    high <= low
  ) {
    return false;
  }
  const body = Math.abs(close - open);
  const range = high - low;
  if (body / range < 0.03) return false;
  const lowerShadow = Math.min(open, close) - low;
  const upperShadow = high - Math.max(open, close);
  return lowerShadow >= 2 * body && upperShadow <= 0.35 * body;
}

/**
 * Yahoo can return an in-progress candle for the exchange-local calendar day.
 * Selecting the greatest provider date strictly before today also handles
 * weekends and holidays without maintaining a separate holiday calendar.
 */
export function selectPreviousCompletedCandle<T extends OHLC>(
  candles: readonly T[],
  exchangeLocalToday: string,
): T | undefined {
  return candles
    .filter((candle) => candleDateKey(candle.date) < exchangeLocalToday)
    .filter((candle) => isCompleteOHLC(candle))
    .sort((a, b) => candleDateKey(b.date).localeCompare(candleDateKey(a.date)))[0];
}

function isCompleteOHLC(candle: OHLC): boolean {
  return [candle.open, candle.high, candle.low, candle.close].every(
    (value) => value != null && Number.isFinite(value),
  );
}