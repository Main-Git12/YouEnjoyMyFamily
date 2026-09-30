import type { ScheduleEntry } from "../types";
import type { SchoolCalendarEntry } from "../lib/schoolDay";

interface CalendarProps {
  entries: ScheduleEntry[];
  /**
   * The school's specials for this day, merged in rather than stored.
   *
   * These are not calendar rows and are not shown as if they were: a
   * rotation is a rule the school published, not a hundred and eighty
   * events somebody typed. They sit under the timed entries, in a different
   * colour, each naming the sheet it came from — so nobody goes hunting for
   * an entry they think they created and nobody tries to edit one here.
   */
  school?: SchoolCalendarEntry[];
}

export default function Calendar({ entries, school = [] }: CalendarProps) {
  if (!entries.length && !school.length) {
    return <p className="italic opacity-90">Nothing scheduled.</p>;
  }

  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <li key={entry.scheduleId} className="flex items-center gap-4 bg-olive-50 rounded-lg px-4 py-3">
          <span className="font-semibold text-olive-700 w-20 shrink-0">{entry.startTime ?? "All day"}</span>
          <span className="text-lg text-bark">{entry.title}</span>
        </li>
      ))}
      {school.map((entry) => (
        <li
          key={`school:${entry.memberId}`}
          className="flex items-start gap-4 bg-clay-100 rounded-lg px-4 py-3"
        >
          <span className="font-semibold text-clay-900 w-20 shrink-0">School</span>
          <span className="min-w-0">
            <span className="text-lg text-bark">
              {entry.subject} — {entry.memberId}
            </span>
            {entry.prepNote && <p className="text-bark leading-snug mt-0.5">{entry.prepNote}</p>}
            <p className="text-sm text-clay-900/80 mt-0.5">{entry.because}</p>
          </span>
        </li>
      ))}
    </ul>
  );
}
