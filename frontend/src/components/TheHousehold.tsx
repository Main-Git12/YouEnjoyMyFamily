import { useMemo, useState } from "react";
import type { Household, HouseholdJob, HouseholdMember, HouseholdRole, JobKind } from "../types";
import { JOB_CATALOG, tallyJobs, readTheLoad } from "../lib/houseJobs";

interface TheHouseholdProps {
  household: Household;
  onSaveMember: (memberId: string, member: Omit<HouseholdMember, "memberId">) => Promise<void>;
  onRemoveMember: (memberId: string) => Promise<void>;
  onSaveJob: (jobId: string, job: Omit<HouseholdJob, "jobId">) => Promise<void>;
  onRemoveJob: (jobId: string) => Promise<void>;
}

const ROLE_LABELS: Record<HouseholdRole, string> = { adult: "Adult", child: "Child" };
const KIND_LABELS: Record<JobKind, string> = { doing: "hands-on", arranging: "noticing & booking" };

/** A stable id from a name or title, so the same job typed twice is one row. */
const slug = (text: string): string =>
  text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/**
 * Who is in the house, and who carries what.
 *
 * Two things the app had no way to hold. There was no roster at all, so the
 * only way to include a grandmother was to type her name onto a chore —
 * which quietly handed her a gem balance, a prize goal and a place in a game
 * built for a seven-year-old. And there was no list of the standing jobs, so
 * the half of the work that is noticing and booking rather than doing simply
 * did not exist anywhere a family could look at it.
 *
 * The counts underneath are arithmetic over rows the family typed in, shown
 * with where each number came from, and every one of them ends in a
 * question. The app does not get an opinion about how a household splits its
 * work; it gets to make the split visible, which is the part that is
 * genuinely hard to do from inside it.
 */
export default function TheHousehold({
  household,
  onSaveMember,
  onRemoveMember,
  onSaveJob,
  onRemoveJob,
}: TheHouseholdProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<HouseholdRole>("adult");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const { members, jobs } = household;
  const tally = useMemo(() => tallyJobs(jobs, members), [jobs, members]);
  const observations = useMemo(() => readTheLoad(jobs, members, tally), [jobs, members, tally]);
  const owners = members.map((member) => member.displayName);
  const onTheList = new Set(jobs.map((job) => job.title.toLowerCase()));

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    const displayName = name.trim();
    if (!displayName || busy) return;
    setBusy(true);
    try {
      await onSaveMember(slug(displayName), { displayName, role, note: note.trim() || null });
      setName("");
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-display text-lg text-olive-800 mb-1">Who's in the house</h3>
        <p className="text-sm text-olive-700 mb-3">
          Adults can own any number of jobs, and none of them pay. Gems, prizes and the castle are for the
          children — that's the only thing this choice changes.
        </p>

        <ul className="space-y-2 mb-4">
          {members.map((member) => (
            <li
              key={member.memberId}
              className="flex items-center justify-between gap-3 rounded-lg bg-olive-50 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="text-lg text-olive-900">{member.displayName}</span>
                <span className="block text-xs uppercase tracking-wide text-olive-600">
                  {ROLE_LABELS[member.role]}
                  {member.note ? ` · ${member.note}` : ""}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void onRemoveMember(member.memberId)}
                className="min-h-11 shrink-0 rounded-lg px-3 text-sm text-olive-700 underline"
              >
                Remove
              </button>
            </li>
          ))}
          {members.length === 0 && <li className="text-olive-700 italic">Nobody added yet.</li>}
        </ul>

        <form onSubmit={addMember} className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[10rem] text-sm text-olive-700">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full min-h-11 rounded-lg border border-olive-300 px-3"
              placeholder="Sheliah"
            />
          </label>
          <label className="text-sm text-olive-700">
            In the house as
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as HouseholdRole)}
              className="mt-1 block min-h-11 rounded-lg border border-olive-300 px-3"
            >
              <option value="adult">Adult</option>
              <option value="child">Child</option>
            </select>
          </label>
          <label className="flex-1 min-w-[12rem] text-sm text-olive-700">
            Anything worth noting
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-1 w-full min-h-11 rounded-lg border border-olive-300 px-3"
              placeholder="Picks Parker up on Tuesdays"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="min-h-11 rounded-lg bg-olive-600 px-4 text-white disabled:opacity-60"
          >
            Add to the house
          </button>
        </form>
      </section>

      <section>
        <h3 className="font-display text-lg text-olive-800 mb-1">What keeps this house running</h3>
        <p className="text-sm text-olive-700 mb-3">
          Not the daily chores — the standing jobs. Half of them are the kind nobody sees until they don't
          happen, which is exactly why they're worth writing down.
        </p>

        {observations.length > 0 && (
          <ul className="space-y-2 mb-4">
            {observations.map((observation) => (
              <li key={observation.id} className="rounded-lg bg-sand-100 px-3 py-2">
                <p className="text-olive-900">{observation.title}</p>
                <p className="text-xs text-olive-600">{observation.because}</p>
                <p className="text-sm text-olive-800 mt-1">{observation.question}</p>
              </li>
            ))}
          </ul>
        )}

        {tally.shares.length > 0 && (
          <ul className="flex flex-wrap gap-2 mb-4">
            {tally.shares.map((share) => (
              <li key={share.ownerId} className="rounded-full bg-olive-100 px-3 py-1 text-sm text-olive-800">
                {share.displayName} · {share.total} ({share.arranging} noticing, {share.doing} hands-on)
              </li>
            ))}
          </ul>
        )}

        <ul className="space-y-2 mb-5">
          {jobs.map((job) => (
            <li
              key={job.jobId}
              className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${
                job.ownerId ? "bg-olive-50" : "bg-clay-100"
              }`}
            >
              <span className="min-w-0">
                <span className="text-olive-900">{job.title}</span>
                <span className="block text-xs uppercase tracking-wide text-olive-600">{KIND_LABELS[job.kind]}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <select
                  aria-label={`Who has "${job.title}"`}
                  value={job.ownerId ?? ""}
                  onChange={(event) =>
                    void onSaveJob(job.jobId, {
                      title: job.title,
                      kind: job.kind,
                      // Explicitly null, never omitted: handing a job back to
                      // nobody is a decision, not an absence of one.
                      ownerId: event.target.value || null,
                      note: job.note,
                    })
                  }
                  className="min-h-11 rounded-lg border border-olive-300 px-2 text-sm"
                >
                  <option value="">Nobody yet</option>
                  {owners.map((owner) => (
                    <option key={owner} value={owner}>
                      {owner}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void onRemoveJob(job.jobId)}
                  className="min-h-11 rounded-lg px-2 text-sm text-olive-700 underline"
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
          {jobs.length === 0 && <li className="text-olive-700 italic">Nothing on the list yet.</li>}
        </ul>

        <div className="space-y-2">
          {JOB_CATALOG.map((group) => {
            const open = openGroup === group.heading;
            return (
              <div key={group.heading} className="rounded-lg border border-olive-200">
                <button
                  type="button"
                  onClick={() => setOpenGroup(open ? null : group.heading)}
                  className="w-full min-h-11 px-3 py-2 text-left"
                >
                  <span className="font-display text-olive-800">{group.heading}</span>
                  <span className="block text-xs text-olive-600">{group.blurb}</span>
                </button>
                {open && (
                  <ul className="flex flex-wrap gap-2 px-3 pb-3">
                    {group.jobs.map((suggestion) => {
                      const already = onTheList.has(suggestion.title.toLowerCase());
                      return (
                        <li key={suggestion.title}>
                          <button
                            type="button"
                            disabled={already}
                            onClick={() =>
                              void onSaveJob(slug(suggestion.title), {
                                title: suggestion.title,
                                kind: suggestion.kind,
                                ownerId: null,
                                note: null,
                              })
                            }
                            className="min-h-11 rounded-full border border-olive-300 px-3 text-sm text-olive-800 disabled:opacity-50"
                          >
                            {already ? `${suggestion.title} ✓` : `+ ${suggestion.title}`}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
