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
