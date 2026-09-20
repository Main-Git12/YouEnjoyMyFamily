/**
 * The family's *local* calendar date as `YYYY-MM-DD`.
 *
 * Deliberately not `toISOString().slice(0, 10)`: that converts to UTC first,
 * so anywhere west of UTC it rolls over to tomorrow in the evening — exactly
 * when someone asks "what's for dinner". At 9:30pm in Ohio, UTC is already
 * the next day, and the dashboard would show tomorrow's meals as today's.
 */
export function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The next `count` local calendar dates, starting with today. */
export function localDaysFromToday(count: number, from: Date = new Date()): string[] {
  const days: string[] = [];
  for (let i = 0; i < count; i++) {
    const day = new Date(from);
    day.setDate(from.getDate() + i);
    days.push(toLocalIsoDate(day));
  }
  return days;
}

/**
 * A 7-day window, `offsetWeeks` weeks from today — 0 is the coming week,
 * 1 is the week after, -1 the one just gone. Anchored on today rather than
 * on a calendar Sunday, so "this week" always starts with today's meals
 * rather than burying them behind days that have already happened.
 */
export function weekFromOffset(offsetWeeks: number, from: Date = new Date()): string[] {
  const start = new Date(from);
  start.setDate(from.getDate() + offsetWeeks * 7);
  return localDaysFromToday(7, start);
}
