import type { SchoolMenu, SchoolProfile } from "../types";
import { lunchOn, menuSource, schoolDayNotes, horizonFor } from "../lib/schoolDay";

interface SchoolDayProps {
  profiles: SchoolProfile[];
  /** Keyed by memberId. A child with no published menu simply isn't in here. */
  menus: Record<string, SchoolMenu | undefined>;
  now?: Date;
}

/**
 * The school day — the next one, not today's if today's is over.
 *
 * Two things go on this panel and they are not equally important. The
 * specials subject is context; the line underneath it is a job. "Library"
 * tells you nothing you can act on, and "have your student bring in their
 * library book to return" is the difference between a calm Thursday and
 * turning the house over at twenty to eight. So the note is set in the
 * larger type and the subject is the label above it, which is the opposite
 * of how the school's own sheet does it and the right way round for a
 * kitchen wall.
 *
 * The notes are quoted exactly as the school wrote them, typos included.
 * A parent who has the paper on the fridge should recognise the sentence.
 */
export default function SchoolDay({ profiles, menus, now = new Date() }: SchoolDayProps) {
  const notes = schoolDayNotes(profiles, now);
  const { horizon, date } = horizonFor(now);

  if (!notes.length) {
    return (
      <p className="text-olive-700 italic">
        No school day coming up — this fills in again the evening before the next one.
      </p>
    );
  }

  const when = horizon === "today" ? "Today" : "Tomorrow";

  return (
    <div className="space-y-4">
      {notes.map((note) => {
        const menu = menus[note.memberId];
        const lunch = lunchOn(menu, date);
        const source = menuSource(menu, now);
        const [entrees, ...rest] = lunch?.groups ?? [];

        return (
          <div key={note.memberId} className="bg-olive-50 rounded-card px-4 py-3">
            <p className="text-sm text-olive-700">
              {when} for {note.memberId} — <span className="font-semibold">{note.subject}</span>
            </p>

            {note.prepNote ? (
              <p className="text-olive-900 text-lg leading-snug mt-1">{note.prepNote}</p>
            ) : (
              <p className="text-olive-700 mt-1">Nothing to bring.</p>
            )}
            <p className="text-sm text-olive-600 mt-0.5">{note.because}</p>

            {lunch && (
              <div className="mt-3 pt-3 border-t border-olive-100">
                <p className="text-sm text-olive-700">Lunch</p>
                {entrees && (
                  <p className="text-olive-900 leading-snug">{entrees.items.join(" · ")}</p>
                )}
                {/*
                  The rest of the tray — vegetables, fruit, the three kinds of
                  milk — in one muted line each. It is genuinely useful to a
                  child who will only eat the fruit, and it is not what anyone
                  walking past the screen is reading, so it is not competing
                  with the entrées for the glance.
                */}
                {rest.map((group) => (
                  <p key={group.heading ?? "unlabelled"} className="text-sm text-olive-600">
                    {group.heading ? `${group.heading}: ` : ""}
                    {group.items.join(", ")}
                  </p>
                ))}
                {source && <p className="text-sm text-olive-600 mt-1">{source}</p>}
              </div>
            )}

            {!lunch && menu && (
              <p className="text-sm text-olive-600 mt-2">
                {menu.stale
                  ? "The lunch menu couldn't be refreshed just now."
                  : "No lunch published for this day."}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
