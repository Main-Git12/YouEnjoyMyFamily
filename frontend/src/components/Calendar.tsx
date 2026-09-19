import type { ScheduleEntry } from "../types";

interface CalendarProps {
  entries: ScheduleEntry[];
}

export default function Calendar({ entries }: CalendarProps) {
  if (!entries.length) {
    return <p className="text-olive-700 italic">Nothing scheduled.</p>;
  }

  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <li key={entry.scheduleId} className="flex items-center gap-4 bg-olive-50 rounded-lg px-4 py-3">
          <span className="font-semibold text-olive-700 w-20 shrink-0">{entry.startTime ?? "All day"}</span>
          <span className="text-lg">{entry.title}</span>
        </li>
      ))}
    </ul>
  );
}
