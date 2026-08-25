export type DatedMarketSession = { date: string };

export function isoWeekStart(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const day = date.getUTCDay();
  const daysFromMonday = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + daysFromMonday);
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Selects the most recent exchange-local ISO week that has finished its regular
 * session. Every provider-returned session is retained, including holiday-shortened
 * weeks, while the in-progress week remains hidden until Friday's regular close.
 */
export function latestCompletedWeekStart(
  weekGroups: Iterable<[string, DatedMarketSession[]]>,
  exchangeLocalToday: string,
  marketState: string,
): string | undefined {
  const dayOfWeek = new Date(`${exchangeLocalToday}T00:00:00.000Z`).getUTCDay();
  const currentWeekStart = isoWeekStart(exchangeLocalToday);
  const afterRegularClose = ["POST", "POSTPOST", "CLOSED"].includes(marketState.toUpperCase());
  const completedWeekCutoff = (
    dayOfWeek === 0
    || dayOfWeek === 6
    || (dayOfWeek === 5 && afterRegularClose)
  )
    ? addDays(currentWeekStart, 7)
    : currentWeekStart;

  return [...weekGroups]
    .filter(([weekStart, sessions]) => sessions.length > 0 && weekStart < completedWeekCutoff)
    .map(([weekStart]) => weekStart)
    .sort()
    .at(-1);
}