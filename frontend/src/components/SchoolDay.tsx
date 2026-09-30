import type { SchoolMenu, SchoolPrep, SchoolProfile } from "../types";
import type { SchoolDayNote } from "../lib/schoolDay";
import { horizonFor, isStillOpen, lunchOn, menuSource, schoolDayNotes, stillOpenThisMorning } from "../lib/schoolDay";

interface SchoolDayProps {
  profiles: SchoolProfile[];
  /** Keyed by memberId. A child with no published menu simply isn't in here. */
  menus: Record<string, SchoolMenu | undefined>;
  /** What has already been ticked off. */
  prep?: SchoolPrep[];
  onPacked?: (note: SchoolDayNote) => Promise<void>;
  onUnpacked?: (note: SchoolDayNote) => Promise<void>;
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
 * kitchen wall. The notes are quoted exactly as the school wrote them,
 * typos included, so a parent recognises the sentence.
 *
 * The tick is what makes it a job rather than a poster. Without one this
 * panel said the same thing every Wednesday evening whether or not anyone
 * had acted on it, and a prompt that cannot be answered is one people learn
 * to walk past.
 *
 * What the tick is *not* is a claim about the schoolbag. The app cannot see
 * inside one. So an untouched Thursday reads "still not ticked off" — a fact
 * about the records — and never "forgotten", which would be a guess about a
 * child, on a screen that child can read.
 */
export default function SchoolDay({
  profiles,
  menus,
  prep = [],
  onPacked,
  onUnpacked,
  now = new Date(),
}: SchoolDayProps) {
  const notes = schoolDayNotes(profiles, now, prep);
  const { horizon, date } = horizonFor(now);
  // Whose note is still open at an hour when doing something about it is
  // still possible. Empty by nine, and empty all evening — the panel is
  // already asking for tomorrow's, so calling that outstanding would be
  // nagging about a job nobody is late for.
  const urgent = new Set(stillOpenThisMorning(profiles, now, prep).map((note) => note.memberId));

  if (!notes.length) {
    return (
      <p className="text-olive-700 italic">
        No school day coming up — this fills in again the evening before the next one.
      </p>
    );
  }

  const when = horizon === "today" ? "Today" : "Tomorrow";
  const packedTime = (at: string): string =>
    new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return (
    <div className="space-y-4">
      {notes.map((note) => {
        const menu = menus[note.memberId];
        const lunch = lunchOn(menu, date);
        const source = menuSource(menu, now);
        const [entrees, ...rest] = lunch?.groups ?? [];
        const open = isStillOpen(note);
        const pressing = urgent.has(note.memberId);

        return (
          <div
            key={note.memberId}
            className={
              pressing
                ? "bg-clay-100 border-2 border-clay-300 rounded-card px-4 py-3"
                : "bg-olive-50 rounded-card px-4 py-3"
            }
          >
            <p className="text-sm text-olive-700">
              {when} for {note.memberId} — <span className="font-semibold">{note.subject}</span>
            </p>

            {note.prepNote ? (
              <p className="text-olive-900 text-lg leading-snug mt-1">{note.prepNote}</p>
            ) : (
              <p className="text-olive-700 mt-1">Nothing to bring.</p>
            )}
            <p className="text-sm text-olive-600 mt-0.5">{note.because}</p>

            {note.prepNote && (
              <div className="mt-2 flex items-center gap-3 flex-wrap">
                {open ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void onPacked?.(note)}
                      className="rounded-full px-4 py-2 font-body bg-olive-500 text-white hover:bg-olive-600"
                    >
                      Packed
                    </button>
                    {/* Said only while it is still actionable, and said about
                        the record rather than about the child. */}
                    {pressing && <span className="text-sm text-clay-900">Still not ticked off.</span>}
                  </>
                ) : (
                  <>
                    <span className="text-olive-700">
                      <span aria-hidden="true">✓ </span>
                      Ticked off at {packedTime(note.packedAt as string)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void onUnpacked?.(note)}
                      className="text-olive-700 underline underline-offset-2 py-1"
                    >
                      Undo
                    </button>
                  </>
                )}
              </div>
            )}

            {lunch && (
              <div className="mt-3 pt-3 border-t border-olive-100">
                <p className="text-sm text-olive-700">Lunch</p>
                {entrees && <p className="text-olive-900 leading-snug">{entrees.items.join(" · ")}</p>}
                {/*
                  The rest of the tray — vegetables, fruit, the three kinds of
                  milk — in one muted line each. Genuinely useful to a child
                  who will only eat the fruit, and not what anyone walking
                  past is reading, so it is not competing for the glance.
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
