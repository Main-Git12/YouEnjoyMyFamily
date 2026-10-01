import { describe, it, expect } from "vitest";
import { tallyJobs, readTheLoad, JOB_CATALOG } from "./houseJobs";
import type { HouseholdJob, HouseholdMember, JobKind } from "../types";

const member = (displayName: string, role: "adult" | "child" = "adult"): HouseholdMember => ({
  memberId: displayName.toLowerCase(),
  displayName,
  role,
  note: null,
});

let seq = 0;
const job = (kind: JobKind, ownerId: string | null, title = `job ${(seq += 1)}`): HouseholdJob => ({
  jobId: `j${seq}`,
  title,
  kind,
  ownerId,
  note: null,
});

const PEALS = [member("Andrew"), member("Paige"), member("Sheliah"), member("Parker", "child")];

describe("the job catalog", () => {
  it("leans on the half households don't write down unprompted", () => {
    // Asked to list the jobs, people produce the visible ones and stop. The
    // catalog is deliberately weighted the other way.
    const all = JOB_CATALOG.flatMap((group) => group.jobs);
    const arranging = all.filter((entry) => entry.kind === "arranging").length;
    expect(arranging).toBeGreaterThan(all.length / 3);
  });

  it("describes jobs, never the people who might do them", () => {
    for (const group of JOB_CATALOG) {
      for (const entry of group.jobs) {
        expect(entry.title).not.toMatch(/\b(mum|mom|dad|wife|husband|grandma|grandmother|she|he|her job|his job)\b/i);
      }
    }
  });

  it("has no duplicate titles across groups", () => {
    const titles = JOB_CATALOG.flatMap((group) => group.jobs.map((entry) => entry.title));
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("tallyJobs", () => {
  it("counts the doing and the arranging apart", () => {
    const tally = tallyJobs(
      [job("doing", "Andrew"), job("arranging", "Paige"), job("arranging", "Paige")],
      PEALS
    );

    expect(tally.shares.find((s) => s.displayName === "Paige")).toMatchObject({ arranging: 2, doing: 0, total: 2 });
    expect(tally.shares.find((s) => s.displayName === "Andrew")).toMatchObject({ doing: 1, arranging: 0 });
    expect(tally.arrangingTotal).toBe(2);
    expect(tally.doingTotal).toBe(1);
  });

  it("keeps the jobs nobody has taken separate from everyone's count", () => {
    const tally = tallyJobs([job("doing", null, "Bins"), job("doing", "Andrew")], PEALS);

    expect(tally.unclaimed.map((j) => j.title)).toEqual(["Bins"]);
    expect(tally.doingTotal).toBe(1);
  });
});

describe("reading the load", () => {
  it("says out loud when a job is nobody's", () => {
    const [first] = readTheLoad([job("arranging", null, "Booking the dentist")], PEALS);

    expect(first?.title).toContain("Booking the dentist");
    expect(first?.question).toMatch(/whose is it/i);
  });

  it("counts a lopsided list, and says where the number came from", () => {
    const jobs = [
      ...Array.from({ length: 5 }, () => job("arranging", "Paige")),
      job("arranging", "Andrew"),
      job("arranging", "Sheliah"),
    ];

    const load = readTheLoad(jobs, PEALS).find((o) => o.id === "load:arranging");

    expect(load?.title).toBe("5 of the 7 noticing-and-booking jobs are down to Paige.");
    // Checkable against the rows above it, not something to be believed.
    expect(load?.because).toContain("7 jobs");
    expect(load?.question).toMatch(/\?$/);
  });

  it("stays quiet on a list too short to mean anything", () => {
    const jobs = [job("arranging", "Paige"), job("arranging", "Paige"), job("arranging", "Andrew")];
    expect(readTheLoad(jobs, PEALS).some((o) => o.id === "load:arranging")).toBe(false);
  });

  it("stays quiet when the list is actually shared", () => {
    const jobs = [
      ...Array.from({ length: 3 }, () => job("arranging", "Paige")),
      ...Array.from({ length: 3 }, () => job("arranging", "Andrew")),
    ];
    expect(readTheLoad(jobs, PEALS).some((o) => o.id === "load:arranging")).toBe(false);
  });

  it("says nothing about a split when only one adult is on the roster", () => {
    // One adult holding everything is not a finding, it's a household.
    const jobs = Array.from({ length: 8 }, () => job("arranging", "Paige"));
    expect(readTheLoad(jobs, [member("Paige"), member("Parker", "child")]).some((o) => o.id.startsWith("load:"))).toBe(
      false
    );
  });

  it("leaves children out of how the adults split the house", () => {
    // A seven-year-old with six chores must not read as carrying the house.
    const jobs = [
      ...Array.from({ length: 6 }, () => job("doing", "Parker")),
      job("doing", "Andrew"),
      job("doing", "Paige"),
    ];

    const load = readTheLoad(jobs, PEALS).find((o) => o.id === "load:doing");
    expect(load).toBeUndefined();
  });

  it("never passes judgement, only arithmetic and a question", () => {
    const jobs = [
      ...Array.from({ length: 6 }, () => job("arranging", "Paige")),
      job("arranging", "Andrew"),
    ];

    for (const observation of readTheLoad(jobs, PEALS)) {
      const text = `${observation.title} ${observation.because} ${observation.question}`;
      expect(text).not.toMatch(/unfair|should|ought|too much|lazy|needs to|isn't pulling|carrying the/i);
      expect(observation.question).toMatch(/\?$/);
    }
  });
});
