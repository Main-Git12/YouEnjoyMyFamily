import { useState } from "react";
import type { SchoolProfile, SchoolSpecial } from "../types";
import MemberPicker from "./MemberPicker";

const WEEKDAYS = [1, 2, 3, 4, 5];
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface SchoolSetupProps {
  members: string[];
  profiles: SchoolProfile[];
  onSave: (memberId: string, profile: Omit<SchoolProfile, "memberId">) => Promise<void>;
}

type Draft = { schoolName: string; teacher: string; rows: Record<number, { subject: string; prepNote: string }> };

const emptyRows = (): Draft["rows"] =>
  Object.fromEntries(WEEKDAYS.map((day) => [day, { subject: "", prepNote: "" }]));

function draftFrom(profile: SchoolProfile | null): Draft {
  const rows = emptyRows();
  for (const special of profile?.specials ?? []) {
    rows[special.dayOfWeek] = { subject: special.subject, prepNote: special.prepNote ?? "" };
  }
  return { schoolName: profile?.schoolName ?? "", teacher: profile?.teacher ?? "", rows };
}

/**
 * Typing the sheet from the fridge into the app.
 *
 * The form is laid out as the school's own sheet is — a row per weekday,
 * subject on the left, the small print under it — so somebody copying it
 * across is reading one line and typing one line rather than translating.
 *
 * Only the parts that change are editable. A specials rotation changes
 * every school year and a teacher changes with it; which published menu
 * belongs to a school does not, so `menuSource` is carried through
 * untouched rather than being a row of three integers for a parent to get
 * wrong. That carry-through is load-bearing: saving replaces the whole
 * profile, so a form that forgot it would silently switch the lunch menu
 * off the first time anyone corrected a typo. There is a test.
 *
 * A day left blank is a day with no special, not an error. Most schools
 * have five and some have three.
 */
export default function SchoolSetup({ members, profiles, onSave }: SchoolSetupProps) {
  const byMember = new Map(profiles.map((profile) => [profile.memberId, profile]));
  const [memberId, setMemberId] = useState(() => profiles[0]?.memberId ?? members[0] ?? "");
  const [draft, setDraft] = useState<Draft>(() => draftFrom(byMember.get(memberId) ?? null));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function chooseMember(name: string) {
    setMemberId(name);
    setDraft(draftFrom(byMember.get(name) ?? null));
    setSaved(false);
  }

  const setRow = (day: number, patch: Partial<{ subject: string; prepNote: string }>) => {
    setDraft((prev) => ({
      ...prev,
      rows: { ...prev.rows, [day]: { ...(prev.rows[day] ?? { subject: "", prepNote: "" }), ...patch } },
    }));
    setSaved(false);
  };

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!memberId || !draft.schoolName.trim() || saving) return;

    const specials: SchoolSpecial[] = WEEKDAYS.flatMap((day) => {
      const row = draft.rows[day];
      const subject = row?.subject.trim() ?? "";
      if (!subject) return [];
      const prepNote = row?.prepNote.trim() ?? "";
      return [{ dayOfWeek: day, subject, prepNote: prepNote ? prepNote : null }];
    });

    const existing = byMember.get(memberId) ?? null;
    setSaving(true);
    try {
      await onSave(memberId, {
        schoolName: draft.schoolName.trim(),
        teacher: draft.teacher.trim() || null,
        gradeLabel: existing?.gradeLabel ?? null,
        specials,
        // Carried through, never rebuilt from the form. Saving replaces the
        // whole profile; dropping this would turn the lunch menu off the
        // first time somebody fixed a spelling.
        menuSource: existing?.menuSource ?? null,
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (!members.length) {
    return <p className="text-olive-700 italic">Add a chore for someone first, so the app knows who is at school.</p>;
  }

  const existing = byMember.get(memberId) ?? null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <MemberPicker members={members} value={memberId} onChange={chooseMember} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-sm text-olive-700 mb-1">School</span>
          <input
            value={draft.schoolName}
            onChange={(event) => {
              setDraft((prev) => ({ ...prev, schoolName: event.target.value }));
              setSaved(false);
            }}
            placeholder="Violet Elementary"
            className="w-full rounded-card border-2 border-olive-100 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="block text-sm text-olive-700 mb-1">Teacher</span>
          <input
            value={draft.teacher}
            onChange={(event) => {
              setDraft((prev) => ({ ...prev, teacher: event.target.value }));
              setSaved(false);
            }}
            placeholder="Miss Hineline"
            className="w-full rounded-card border-2 border-olive-100 px-3 py-2"
          />
        </label>
      </div>

      <ul className="space-y-3">
        {WEEKDAYS.map((day) => (
          <li key={day} className="bg-olive-50 rounded-card px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-olive-700">{DAY_LABELS[day]}</span>
              <input
                aria-label={`${DAY_LABELS[day]} special`}
                value={draft.rows[day]?.subject ?? ""}
                onChange={(event) => setRow(day, { subject: event.target.value })}
                placeholder="—"
                className="flex-1 min-w-0 rounded-card border-2 border-olive-100 px-3 py-2"
              />
            </div>
            <input
              aria-label={`${DAY_LABELS[day]} — what to bring`}
              value={draft.rows[day]?.prepNote ?? ""}
              onChange={(event) => setRow(day, { prepNote: event.target.value })}
              placeholder="Anything that has to be brought — copy it as the school wrote it"
              className="w-full mt-2 rounded-card border-2 border-olive-100 px-3 py-2 text-sm"
            />
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="submit"
          disabled={saving || !draft.schoolName.trim()}
          className="rounded-full px-5 py-2 font-body bg-olive-500 text-white hover:bg-olive-600 disabled:opacity-50"
        >
          {saving ? "Saving…" : existing ? "Save the sheet" : "Add this school"}
        </button>
        {saved && <span className="text-olive-700">Saved.</span>}
        {existing?.menuSource && (
          <span className="text-sm text-olive-600">
            Lunch menu already set up for {existing.schoolName}, and left as it is.
          </span>
        )}
      </div>
    </form>
  );
}
