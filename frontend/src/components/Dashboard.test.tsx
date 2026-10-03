import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import Dashboard from "./Dashboard";
import { weekFromOffset, toLocalIsoDate } from "../lib/dates";
import { threatForChore } from "../lib/gemThreats";
import { api } from "../lib/api";
import type { Task } from "../types";

vi.mock("../lib/api", () => ({
  // The real class, so `err instanceof ApiError` behaves as it does in the app.
  ApiError: class ApiError extends Error {
    status: number | null;
    constructor(message: string, status: number | null) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
  api: {
    listTasks: vi.fn(),
    listTaskCompletions: vi.fn(),
    createTask: vi.fn(),
    listSchedules: vi.fn(),
    completeTask: vi.fn(),
    listStatedPreferences: vi.fn(),
    addStatedPreference: vi.fn(),
    removeStatedPreference: vi.fn(),
    listMealPlan: vi.fn(),
    upsertMealPlanEntry: vi.fn(),
    removeMealPlanEntry: vi.fn(),
    generateGroceryListFromMealPlan: vi.fn(),
    listCartItems: vi.fn(),
    addCartItem: vi.fn(),
    markCartItemUnavailable: vi.fn(),
    confirmCartItemSubstitute: vi.fn(),
    removeCartItem: vi.fn(),
    checkoutGroceryCart: vi.fn(),
    listRewardGoals: vi.fn(),
    listGemBalances: vi.fn(),
    updateTask: vi.fn(),
    claimRewardGoal: vi.fn(),
    setRewardGoal: vi.fn(),
    listRoutines: vi.fn(),
    listRoutineRuns: vi.fn(),
    createRoutine: vi.fn(),
    updateRoutine: vi.fn(),
    saveRoutineRun: vi.fn(),
    listFocusBlocks: vi.fn(),
    recordFocusBlock: vi.fn(),
    listSchoolProfiles: vi.fn(),
    getHousehold: vi.fn(),
    saveHouseholdMember: vi.fn(),
    removeHouseholdMember: vi.fn(),
    saveHouseholdJob: vi.fn(),
    removeHouseholdJob: vi.fn(),
    getSchoolMenu: vi.fn(),
    listSchoolPrep: vi.fn(),
    getWeather: vi.fn(),
    getFamilySettings: vi.fn(),
    saveHouseholdLocation: vi.fn(),
    searchPlaces: vi.fn(),
    markSchoolPrepPacked: vi.fn(),
    undoSchoolPrepPacked: vi.fn(),
  },
}));

describe("Dashboard", () => {
  beforeEach(() => {
    // Defaults so tests that don't touch meal planning / grocery don't have
    // to stub every call in the dashboard's initial Promise.all.
    vi.mocked(api.listMealPlan).mockResolvedValue([]);
    vi.mocked(api.listCartItems).mockResolvedValue([]);
    vi.mocked(api.listRewardGoals).mockResolvedValue([]);
    vi.mocked(api.listTaskCompletions).mockResolvedValue([]);
    vi.mocked(api.listGemBalances).mockResolvedValue({ balances: [], family: { earned: 0, spent: 0, balance: 0 } });
    vi.mocked(api.listRoutines).mockResolvedValue([]);
    vi.mocked(api.listRoutineRuns).mockResolvedValue([]);
    vi.mocked(api.listFocusBlocks).mockResolvedValue([]);
    vi.mocked(api.listSchoolProfiles).mockResolvedValue([]);
    vi.mocked(api.listSchoolPrep).mockResolvedValue([]);
    vi.mocked(api.getHousehold).mockResolvedValue({ members: [], jobs: [] });
    // 404 is the ordinary answer until a household says where it is.
    vi.mocked(api.getWeather).mockRejectedValue(new Error("no location set"));
    vi.mocked(api.getFamilySettings).mockResolvedValue({ familyId: "fam_1", name: null, location: null, createdAt: "2026-01-01T00:00:00.000Z" });
  });

  /**
   * The dashboard now commits to a few panels at a time and puts the rest
   * one tap away (see lib/dashboardLayout.ts). Tests that exercise a panel
   * open it the way a person would rather than asserting against a screen
   * nobody actually sees.
   */
  async function openPanel(title: string | RegExp) {
    if (screen.queryByRole("heading", { name: title })) return;
    const drawer = screen.queryByRole("button", { name: /Everything else/ });
    if (drawer) {
      fireEvent.click(drawer);
      await waitFor(() => expect(screen.getByRole("heading", { name: title })).toBeInTheDocument());
    }
  }

  /** The meal plan and the shopping list share one panel, behind tabs. */
  async function openKitchenTab(tab: "This week" | "Shopping list") {
    await openPanel("Kitchen");
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(tab) }));
  }

  afterEach(() => {
    // Restore here rather than at the end of each test, so a failing
    // assertion can't leave the next test frozen at somebody else's clock.
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  // --- The care shift ----------------------------------------------------
  //
  // Built, tested, and for a while not reachable from anywhere on the
  // screen. These tests are the ones that would have said so.

  /** A Wednesday, so Kimmie is on and the shift is mid-morning. */
  const WEDNESDAY = new Date(2026, 9, 7, 11, 0);

  function careRoutine() {
    return {
      routineId: "r-care",
      kind: "care" as const,
      name: "Sheliah's day",
      anchorTime: "09:00",
      daysOfWeek: [1, 2, 3, 4, 5],
      active: true,
      steps: [
        { stepId: "s1", title: "Coffee", targetMinutes: 5, memberId: null },
        { stepId: "s2", title: "Breakfast", targetMinutes: 20, memberId: null },
        { stepId: "s3", title: "Shower", targetMinutes: 30, memberId: null },
      ],
    };
  }

  const kimmie = {
    memberId: "kimmie",
    displayName: "Kimmie",
    role: "carer" as const,
    note: null,
    daysOfWeek: [2, 3, 4],
    startsAt: "09:00",
    endsAt: "13:00",
  };

  async function renderWithCare(overrides: { members?: typeof kimmie[] } = {}) {
    vi.setSystemTime(WEDNESDAY);
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.listRoutines).mockResolvedValue([careRoutine()]);
    vi.mocked(api.getHousehold).mockResolvedValue({
      members: overrides.members ?? [kimmie],
      jobs: [],
    });
    render(<Dashboard />);
    await waitFor(() => expect(api.getHousehold).toHaveBeenCalled());
  }

  it("puts today's care shift on the screen, with who is on and when", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderWithCare();
    await openPanel(/Today's shift/);

    await screen.findByRole("heading", { name: /Today's shift/ });
    // The hours as agreed with that person, from the rota — not the
    // routine's own anchor, which is only the fallback. Kimmie is 9–1 and
    // the routine's own anchor is 09:00, so the end time is the tell.
    // Kimmie is 9–1 and the routine's own anchor is 09:00, so the end
    // time is what tells the rota from the fallback.
    expect(screen.getAllByText(/Kimmie · 9:00\s*(AM)?\s*–\s*1:00/).length).toBeGreaterThan(0);
    expect(await screen.findByText("Coffee")).toBeInTheDocument();
    expect(screen.getByText("Shower")).toBeInTheDocument();
  });

  it("marks every care step as an estimate until it has been timed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderWithCare();
    await openPanel(/Today's shift/);

    // A plan nobody can check is a plan that can only be obeyed, and this
    // one is handed to somebody who wasn't in the room when it was written.
    const estimates = await screen.findAllByText(/still an estimate/);
    expect(estimates.length).toBe(3);
  });

  it("says plainly when nobody is down to come in", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderWithCare({ members: [] });
    await openPanel(/Today's shift/);

    // The steps still lay out from the routine's own anchor; what's absent
    // is a named person, and the panel says so rather than inventing one.
    await screen.findByRole("heading", { name: /Today's shift/ });
    expect(screen.getByText(/nobody down for today/)).toBeInTheDocument();
  });

  it("never says anything about the person the care is for", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderWithCare();
    await openPanel(/Today's shift/);
    await screen.findByText("Coffee");

    // This panel is read off a kitchen wall by a paid worker, and the
    // person it is about walks past it too.
    const banned = /\b(frail|decline|confus|unable|struggl|patient|poor|difficult|incontinen)\b/i;
    expect(document.body.textContent ?? "").not.toMatch(banned);
  });

  it("records a shift from when it was signed in, not from when it was signed out", async () => {
    // The bug this is here for: a shift signs in before any step is
    // ticked, so deriving the start from the first step stamped the
    // finish time over it and every shift came out zero minutes long —
    // which is exactly the number somebody would have been confronted
    // with.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderWithCare();
    await openPanel(/Today's shift/);

    vi.mocked(api.saveRoutineRun).mockResolvedValue(undefined as never);
    fireEvent.click(await screen.findByRole("button", { name: "I'm here" }));
    await waitFor(() => expect(api.saveRoutineRun).toHaveBeenCalled());
    const signedIn = vi.mocked(api.saveRoutineRun).mock.calls[0]?.[2];

    // Seventy minutes later, the carer taps out.
    vi.setSystemTime(new Date(WEDNESDAY.getTime() + 70 * 60_000));
    fireEvent.click(await screen.findByRole("button", { name: "That's me done" }));
    await waitFor(() => expect(api.saveRoutineRun).toHaveBeenCalledTimes(2));

    const signedOut = vi.mocked(api.saveRoutineRun).mock.calls[1]?.[2];
    expect(signedOut?.startedAt).toBe(signedIn?.startedAt);
    expect(signedOut?.finishedAt).not.toBeNull();
    const minutes =
      (new Date(signedOut?.finishedAt as string).getTime() - new Date(signedOut?.startedAt as string).getTime()) / 60_000;
    expect(Math.round(minutes)).toBe(70);
  });

  it("doesn't offer to sign a shift in on a day nobody is down to come in", async () => {
    // A sign-in button on an empty day is an invitation to record a
    // shift that didn't happen.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderWithCare({ members: [] });
    await openPanel(/Today's shift/);
    await screen.findByText("Coffee");
    expect(screen.queryByRole("button", { name: "I'm here" })).not.toBeInTheDocument();
  });

  it("renders fetched tasks and schedule entries", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([
      { scheduleId: "s1", date: toLocalIsoDate(new Date()), title: "Soccer practice", startTime: null, endTime: null, memberIds: [] },
    ]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText("Pack soccer bag")).toBeInTheDocument());
    expect(screen.getByText("Soccer practice")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't reach the backend/i)).not.toBeInTheDocument();
  });

  it("shows an error message when the backend is unreachable", async () => {
    vi.mocked(api.listTasks).mockRejectedValue(new Error("The family account is having a moment."));
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);

    // The message says what actually happened, in words a family can read —
    // no status codes, no URLs.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/having a moment/i));
    expect(screen.queryByText(/families\/fam_demo/)).not.toBeInTheDocument();
  });

  it("shows the gem celebration and updated total after completing a task", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.completeTask).mockResolvedValue({
      taskId: "t1",
      title: "Pack soccer bag",
      assignedTo: null,
      dueDate: null,
      gemValue: 10,
      dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null,
      status: "done",
      gemsAwarded: 10, createdAt: "2020-01-01T00:00:00.000Z",
    });

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText("Pack soccer bag")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Mark "Pack soccer bag" done'));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(within(screen.getByRole("alert")).getByText("+10 gems")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Visit the Gem Castle — 10 gems/ })).toBeInTheDocument();
  });

  it("adds a stated preference a family member says out loud", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.addStatedPreference).mockResolvedValue({
      preferenceId: "p1",
      memberId: "Isla",
      category: "meal",
      statement: "prefers penne over spaghetti",
    });

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Today's chores" })).toBeInTheDocument());
    await openPanel("Family favorites");
    expect(screen.getByText("Nothing remembered yet.")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Who said it?"), { target: { value: "Isla" } });
    fireEvent.change(screen.getByPlaceholderText(/what did they say/i), {
      target: { value: "prefers penne over spaghetti" },
    });
    fireEvent.click(screen.getByRole("button", { name: /remember this/i }));

    await waitFor(() => expect(screen.getByText(/prefers penne over spaghetti/)).toBeInTheDocument());
    expect(api.addStatedPreference).toHaveBeenCalledWith("fam_demo", {
      memberId: "Isla",
      category: "meal",
      statement: "prefers penne over spaghetti",
    });
  });

  it("raises a gem-threat scenario once a chore's part of the day has passed", async () => {
    // Half nine at night: the after-dinner window closed hours ago. The app
    // knows only the clock and the window someone chose for this chore.
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 21, 30) });
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "after_dinner", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.completeTask).mockResolvedValue({
      taskId: "t1",
      title: "Wipe Table",
      assignedTo: "Parker",
      dueDate: null,
      gemValue: 10,
      dueWindow: "after_dinner", date: "2026-09-23", recurrence: "daily", completedOn: null,
      status: "done",
      gemsAwarded: 10, createdAt: "2020-01-01T00:00:00.000Z",
    });

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeInTheDocument());
    const scenario = within(screen.getByRole("alertdialog"));
    expect(scenario.getByText("Your gems are in danger!")).toBeInTheDocument();
    expect(scenario.getByText(/Parker/)).toBeInTheDocument();
    expect(scenario.getByText(/Wipe Table/)).toBeInTheDocument();

    fireEvent.click(scenario.getByRole("button", { name: threatForChore("Wipe Table").callToAction }));

    await waitFor(() =>
      expect(api.completeTask).toHaveBeenCalledWith("fam_demo", "t1", toLocalIsoDate(new Date()))
    );
    // The victory beat has to survive the chore going green — the scenario
    // closes itself a moment later, it isn't yanked off screen.
    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByText("Gems saved!")).toBeInTheDocument());
  });

  it("doesn't summon a monster over a chore carried in from an earlier day", async () => {
    // One-offs stay on the list until they're done, so without this the
    // same monster arrives over the same name every night until somebody
    // returns the book.
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 21, 30) });
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t_library", title: "Return the library book", assignedTo: "Parker", dueDate: "2026-09-21", gemValue: 5, dueWindow: "after_school", date: "2026-09-23", recurrence: "none", completedOn: null, status: "pending", gemsAwarded: 0, createdAt: "2020-01-01T00:00:00.000Z" },
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);

    // The chore is still on the list, and still says where it came from.
    await waitFor(() => expect(screen.getAllByText("Return the library book").length).toBeGreaterThan(0));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("does not raise a scenario while the chore's part of the day is still open", async () => {
    // Seven in the morning: a bedtime chore is not late, it's early.
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 7, 0) });
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Sleep in my own bed", assignedTo: "Parker", dueDate: null, gemValue: 20, dueWindow: "bedtime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText("Sleep in my own bed")).toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("waving one away ends the game for that part of the day, rather than queueing the next", async () => {
    // This test used to assert the opposite — that the next chore "steps
    // up" — and it was wrong in the room. Seen at 1280x800 on an evening
    // with several chores left, each "not now" swapped one full-screen
    // monster for another: not a game, a queue of interruptions, on a
    // screen that hangs on a kitchen wall and can't be walked away from.
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 21, 30) });
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "after_dinner", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
      { taskId: "t2", title: "Put on pajamas", assignedTo: "Isla", dueDate: null, gemValue: 5, dueWindow: "bedtime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);

    // The most overdue chore goes first.
    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByText(/Wipe Table/)).toBeInTheDocument());
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /not now/i }));

    // And that is the end of it for now — the pyjamas don't step up, and
    // nothing cycles back to the first either.
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("doesn't offer an adult a way into the children's gem screen", async () => {
    // The roster's one job. Before it existed, every name on a chore got a
    // chip through to gems, a prize and a castle — including a grandmother's.
    vi.mocked(api.getHousehold).mockResolvedValue({
      members: [
        { memberId: "sheliah", displayName: "Sheliah", role: "adult", note: null },
        { memberId: "parker", displayName: "Parker", role: "child", note: null },
      ],
      jobs: [],
    });
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "The school run", assignedTo: "Sheliah", dueDate: null, gemValue: 0, dueWindow: "morning", date: "2026-09-23", recurrence: "weekdays", completedOn: null, status: "pending", gemsAwarded: 0, createdAt: "2020-01-01T00:00:00.000Z" },
      { taskId: "t2", title: "Feed the cat", assignedTo: "Parker", dueDate: null, gemValue: 5, dueWindow: "morning", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0, createdAt: "2020-01-01T00:00:00.000Z" },
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByLabelText("Parker's gems and chores")).toBeInTheDocument());
    expect(screen.queryByLabelText("Sheliah's gems and chores")).not.toBeInTheDocument();
    // She is still on the chore, and still shown against it.
    expect(screen.getAllByText("The school run").length).toBeGreaterThan(0);
  });

  it("adds a chore from the library with the gem value the family already uses", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.createTask).mockResolvedValue({
      taskId: "t9",
      title: "Wipe Table",
      assignedTo: "Parker",
      dueDate: null,
      gemValue: 10,
      dueWindow: "after_dinner", date: "2026-09-23", recurrence: "daily", completedOn: null,
      status: "pending",
      gemsAwarded: 0, createdAt: "2020-01-01T00:00:00.000Z",
    });

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText("Today's chores")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add a chore/i }));
    fireEvent.change(screen.getByPlaceholderText(/leave blank for anyone/i), { target: { value: "Parker" } });
    fireEvent.click(screen.getByRole("button", { name: /^Wipe Table/ }));

    await waitFor(() =>
      expect(api.createTask).toHaveBeenCalledWith(
        "fam_demo",
        {
          title: "Wipe Table",
          gemValue: 10,
          dueWindow: "after_dinner",
          recurrence: "daily",
          assignedTo: "Parker",
        },
        toLocalIsoDate(new Date())
      )
    );
  });

  it("shows how close each child is to the prize they picked", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    // Three days of the same daily chore — the point being that a recurring
    // chore pays out again each day, which today's list can't tell you.
    vi.mocked(api.listGemBalances).mockResolvedValue({
      balances: [{ memberId: "Parker", earned: 30, spent: 0, balance: 30 }],
      family: { earned: 30, spent: 0, balance: 30 },
    });
    vi.mocked(api.listRewardGoals).mockResolvedValue([
      { memberId: "Parker", title: "LEGO set", gemCost: 50, note: null },
    ]);

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText("LEGO set")).toBeInTheDocument());
    expect(screen.getByText("20 more gems to go!")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /Parker's progress toward LEGO set/ })).toHaveAttribute(
      "aria-valuenow",
      "60"
    );
  });

  it("renders the planned meal plan and generates a grocery list from it", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    const today = weekFromOffset(0)[0] as string;
    vi.mocked(api.listMealPlan).mockResolvedValue([
      { date: today, slot: "dinner", mealName: "Tacos", ingredients: ["Tortillas", "Ground beef"] },
    ]);
    vi.mocked(api.generateGroceryListFromMealPlan).mockResolvedValue({ added: 2, skipped: 0 });
    vi.mocked(api.listCartItems)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          itemId: "c1",
          description: "Tortillas",
          quantity: 1,
          status: "pending",
          substituteDescription: null,
          orderedAt: null,
          source: "meal_plan",
        },
      ]);

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Today's chores" })).toBeInTheDocument());
    await openKitchenTab("This week");
    expect(screen.getByText("Tacos (2)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /generate grocery list for this week/i }));

    await waitFor(() => expect(screen.getByText(/Added 2 ingredients/)).toBeInTheDocument());
    // The generated lines land on the other tab of the same panel.
    fireEvent.click(screen.getByRole("tab", { name: /Shopping list/ }));
    expect(screen.getByText("Tortillas")).toBeInTheDocument();
  });

  it("adds a manual grocery item to the cart", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.addCartItem).mockResolvedValue({
      itemId: "c1",
      description: "Milk",
      quantity: 1,
      status: "pending",
      substituteDescription: null,
      orderedAt: null,
      source: "manual",
    });

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Today's chores" })).toBeInTheDocument());
    await openKitchenTab("Shopping list");
    expect(screen.getByText("Nothing in the cart yet.")).toBeInTheDocument();


    fireEvent.change(screen.getByPlaceholderText("Add an item"), { target: { value: "Milk" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => expect(screen.getByText("Milk")).toBeInTheDocument());
    expect(api.addCartItem).toHaveBeenCalledWith("fam_demo", { description: "Milk", quantity: 1 });
  });

  it("removes a grocery item from the cart", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.listCartItems).mockResolvedValue([
      {
        itemId: "c1",
        description: "Spaghetti",
        quantity: 1,
        status: "pending",
        substituteDescription: null,
        orderedAt: null,
        source: "manual",
      },
    ]);
    vi.mocked(api.removeCartItem).mockResolvedValue({ deleted: "c1" });

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Today's chores" })).toBeInTheDocument());
    await openKitchenTab("Shopping list");
    expect(screen.getByText("Spaghetti")).toBeInTheDocument();
    // Removal takes a deliberate second tap.
    fireEvent.click(screen.getByLabelText('Remove "Spaghetti" from the cart'));
    fireEvent.click(screen.getByLabelText('Tap again to remove "Spaghetti" from the cart'));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Today's chores" })).toBeInTheDocument());
    await openKitchenTab("Shopping list");
    expect(screen.getByText("Nothing in the cart yet.")).toBeInTheDocument();

    expect(api.removeCartItem).toHaveBeenCalledWith("fam_demo", "c1");
  });

  it("re-fetches for the new date range when the family pages to another week", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Today's chores" })).toBeInTheDocument());
    await openKitchenTab("This week");

    // The fetch reaches back over the insight window so rhythms are
    // visible, but it has to extend to the end of whatever week is shown.
    const thisWeek = weekFromOffset(0);
    expect(api.listMealPlan).toHaveBeenLastCalledWith("fam_demo", expect.any(String), thisWeek[6]);

    fireEvent.click(screen.getByRole("button", { name: /show the next week/i }));

    // Without a re-fetch the label would change while the meals on screen
    // still belonged to the previous week.
    const nextWeek = weekFromOffset(1);
    await waitFor(() => expect(api.listMealPlan).toHaveBeenLastCalledWith("fam_demo", expect.any(String), nextWeek[6]));
    expect(screen.getByText(/^Week of /)).toBeInTheDocument();
  });

  it("does not let a slow background sync undo a chore someone just completed", async () => {
    const pending: Task = {
      taskId: "t1",
      title: "Feed the dog",
      assignedTo: null,
      dueDate: null,
      gemValue: 10,
      dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null,
      status: "pending",
      gemsAwarded: 0, createdAt: "2020-01-01T00:00:00.000Z",
    };
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.listTasks).mockResolvedValue([pending]);

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("Feed the dog")).toBeInTheDocument());

    // A sync starts and is still in flight, holding a pre-completion snapshot.
    let releaseStaleSync: (tasks: Task[]) => void = () => {};
    vi.mocked(api.listTasks).mockReturnValueOnce(
      new Promise<Task[]>((resolve) => {
        releaseStaleSync = resolve;
      })
    );
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Mid-flight, a child ticks the chore off and sees the gems land.
    vi.mocked(api.completeTask).mockResolvedValue({ ...pending, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "done", gemsAwarded: 10 , createdAt: "2020-01-01T00:00:00.000Z"});
    fireEvent.click(screen.getByLabelText('Mark "Feed the dog" done'));
    await waitFor(() => expect(screen.getByRole("button", { name: /Visit the Gem Castle — 10 gems/ })).toBeInTheDocument());

    // Now the stale snapshot finally lands, still showing the chore as pending.
    await act(async () => {
      releaseStaleSync([pending]);
    });

    // It must not un-tick the chore or roll the gem total backwards.
    expect(screen.getByRole("button", { name: /Visit the Gem Castle — 10 gems/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Mark "Feed the dog" done')).not.toBeInTheDocument();
  });

  it("picks up an edit made on another device when the screen becomes visible again", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    const today = weekFromOffset(0)[0] as string;
    // First load: nothing planned. Then someone adds Tacos on their phone.
    vi.mocked(api.listMealPlan)
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ date: today, slot: "dinner", mealName: "Tacos", ingredients: [] }]);

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Today's chores" })).toBeInTheDocument());
    await openKitchenTab("This week");
    expect(screen.queryByText("Tacos")).not.toBeInTheDocument();

    // The phone wakes up / the tab is refocused.
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(screen.getByText("Tacos")).toBeInTheDocument());
  });

  it("polls for other devices' changes on an interval", async () => {
    vi.useFakeTimers();
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);

    await vi.waitFor(() => expect(api.listMealPlan).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(api.listMealPlan).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(api.listMealPlan).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it("keeps showing the last good data when a background sync fails", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("Pack soccer bag")).toBeInTheDocument());

    // The phone drops off the network mid-sync.
    vi.mocked(api.listTasks).mockRejectedValue(new Error("Can't reach the family account — check the wi-fi."));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Pack soccer bag")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces the failure when someone asks for a refresh themselves", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("Today's chores")).toBeInTheDocument());

    vi.mocked(api.listTasks).mockRejectedValue(new Error("Can't reach the family account — check the wi-fi."));
    fireEvent.click(screen.getByRole("button", { name: /refresh from the family's other devices/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/check the wi-fi/i));
  });

  it("shows a loading state until the first fetch resolves, instead of flashing empty cards", async () => {
    let resolveTasks: (tasks: Task[]) => void = () => {};
    vi.mocked(api.listTasks).mockReturnValue(
      new Promise<Task[]>((resolve) => {
        resolveTasks = resolve;
      })
    );
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);

    expect(screen.getByText(/loading your family's day/i)).toBeInTheDocument();
    expect(screen.queryByText("Today's chores")).not.toBeInTheDocument();

    resolveTasks([]);

    await waitFor(() => expect(screen.getByText("Today's chores")).toBeInTheDocument());
    expect(screen.queryByText(/loading your family's day/i)).not.toBeInTheDocument();
  });

  it("asks for today's chores by the screen's own date, not the server's", async () => {
    // A kitchen screen in Ohio asking at 9pm means *its* today. If the
    // server were left to guess from a UTC clock it would answer with
    // tomorrow's list, and every chore would read as undone.
    vi.stubEnv("TZ", "America/Chicago");
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-09-24T02:30:00Z") });
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);

    // 02:30 UTC on the 24th is 21:30 on the 23rd in Chicago.
    await waitFor(() => expect(api.listTasks).toHaveBeenCalledWith("fam_demo", "2026-09-23"));
  });

  it("counts gems from every day a chore was done, not just today's list", async () => {
    // The regression this model change exists to prevent: yesterday's gems
    // must still be in the total when today's chores reset to pending.
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.listTaskCompletions).mockResolvedValue([
      { taskId: "t1", date: "2026-09-21", title: "Wipe Table", memberId: "Parker", gemsAwarded: 10 },
      { taskId: "t1", date: "2026-09-22", title: "Wipe Table", memberId: "Parker", gemsAwarded: 10 },
    ]);
    vi.mocked(api.listGemBalances).mockResolvedValue({
      balances: [{ memberId: "Parker", earned: 20, spent: 0, balance: 20 }],
      family: { earned: 20, spent: 0, balance: 20 },
    });

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Visit the Gem Castle — 20 gems/ })).toBeInTheDocument());
    // Today's chore is waiting again, with nothing awarded yet.
    expect(screen.getByLabelText('Mark "Wipe Table" done')).toBeInTheDocument();
  });

  it("moves the gem total the moment a chore is ticked, not on the next sync", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.listTaskCompletions).mockResolvedValue([]);
    vi.mocked(api.completeTask).mockResolvedValue({
      taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10,
      dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null,
      status: "done", gemsAwarded: 10, createdAt: "2020-01-01T00:00:00.000Z",
    });

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Visit the Gem Castle — 0 gems/ })).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Mark "Wipe Table" done'));

    await waitFor(() => expect(screen.getByRole("button", { name: /Visit the Gem Castle — 10 gems/ })).toBeInTheDocument());
  });

  it("claims a prize, spending the gems and clearing the board", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.listTaskCompletions).mockResolvedValue([
      { taskId: "t1", date: "2026-09-22", title: "Homework", memberId: "Parker", gemsAwarded: 60 },
    ]);
    vi.mocked(api.listGemBalances).mockResolvedValue({
      balances: [{ memberId: "Parker", earned: 60, spent: 0, balance: 60 }],
      family: { earned: 60, spent: 0, balance: 60 },
    });
    vi.mocked(api.listRewardGoals).mockResolvedValue([
      { memberId: "Parker", title: "LEGO set", gemCost: 50, note: null },
    ]);
    vi.mocked(api.claimRewardGoal).mockResolvedValue({
      claim: { title: "LEGO set", gemCost: 50 },
      balance: { memberId: "Parker", earned: 60, spent: 50, balance: 10 },
    });

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Visit the Gem Castle — 60 gems/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Claim LEGO set" }));

    // The gems are spent, so the total comes down and the prize leaves the board.
    await waitFor(() => expect(screen.getByRole("button", { name: /Visit the Gem Castle — 10 gems/ })).toBeInTheDocument());
    expect(screen.queryByText("LEGO set")).not.toBeInTheDocument();
    expect(screen.getByText(/no prizes set yet/i)).toBeInTheDocument();
  });

  it("ticks a chore off instantly, before the server has answered", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.listTaskCompletions).mockResolvedValue([]);
    vi.mocked(api.listGemBalances).mockResolvedValue({ balances: [], family: { earned: 0, spent: 0, balance: 0 } });
    vi.mocked(api.listRoutines).mockResolvedValue([]);
    vi.mocked(api.listRoutineRuns).mockResolvedValue([]);
    vi.mocked(api.listFocusBlocks).mockResolvedValue([]);

    // A slow write, still in flight.
    let settle: (task: Task) => void = () => {};
    vi.mocked(api.completeTask).mockReturnValue(new Promise<Task>((resolve) => { settle = resolve; }));

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("Wipe Table")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Mark "Wipe Table" done'));

    // A child taps and the gems land. No pause, no dead-looking button.
    await waitFor(() => expect(screen.getByRole("button", { name: /Visit the Gem Castle — 10 gems/ })).toBeInTheDocument());
    expect(screen.queryByLabelText('Mark "Wipe Table" done')).not.toBeInTheDocument();

    await act(async () => {
      settle({ taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "done", gemsAwarded: 10 , createdAt: "2020-01-01T00:00:00.000Z"});
    });
    expect(screen.getByRole("button", { name: /Visit the Gem Castle — 10 gems/ })).toBeInTheDocument();
  });

  it("puts a chore back exactly as it was when the write fails", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.listTaskCompletions).mockResolvedValue([]);
    vi.mocked(api.listGemBalances).mockResolvedValue({ balances: [], family: { earned: 0, spent: 0, balance: 0 } });
    vi.mocked(api.listRoutines).mockResolvedValue([]);
    vi.mocked(api.listRoutineRuns).mockResolvedValue([]);
    vi.mocked(api.listFocusBlocks).mockResolvedValue([]);
    vi.mocked(api.completeTask).mockRejectedValue(new Error("Can't reach the family account — check the wi-fi."));

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Visit the Gem Castle — 0 gems/ })).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Mark "Wipe Table" done'));

    // The gems go back and the chore is waiting again, with the reason shown.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/check the wi-fi/i));
    expect(screen.getByRole("button", { name: /Visit the Gem Castle — 0 gems/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Mark "Wipe Table" done')).toBeInTheDocument();
    // And no celebration for something that didn't happen.
    expect(screen.queryByText("+10 gems")).not.toBeInTheDocument();
  });

  it("notices a chore that keeps getting left, and opens the question without answering it", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "bedtime", date: toLocalIsoDate(new Date()), recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    // Set daily for weeks, done once.
    vi.mocked(api.listTaskCompletions).mockResolvedValue([
      { taskId: "t1", date: "2026-09-10", title: "Wipe Table", memberId: "Parker", gemsAwarded: 10 },
    ]);
    vi.mocked(api.updateTask).mockResolvedValue({
      taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10,
      dueWindow: "after_dinner", date: toLocalIsoDate(new Date()), recurrence: "daily", completedOn: null,
      status: "pending", gemsAwarded: 0, createdAt: "2020-01-01T00:00:00.000Z",
    });

    render(<Dashboard />);

    await waitFor(() =>
      expect(screen.getByText("Wipe Table is the one that keeps getting left.")).toBeInTheDocument()
    );
    // The observation names the chore, not the child.
    expect(screen.getByText(/keeps getting left/)).not.toHaveTextContent("Parker");

    fireEvent.click(screen.getByRole("button", { name: /try a different time of day/i }));

    // It opens the question. Picking the answer is the family's.
    await waitFor(() => expect(screen.getByText("When should Wipe Table happen?")).toBeInTheDocument());
    expect(api.updateTask).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "After dinner" }));

    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith("fam_demo", "t1", { dueWindow: "after_dinner" }));
  });

  it("celebrates a run of a chore, naming the child who earned it", async () => {
    const today = toLocalIsoDate(new Date());
    const dayBefore = (n: number) => toLocalIsoDate(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "anytime", date: today, recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.listTaskCompletions).mockResolvedValue(
      [1, 2, 3].map((n) => ({ taskId: "t1", date: dayBefore(n), title: "Wipe Table", memberId: "Parker", gemsAwarded: 10 , createdAt: "2020-01-01T00:00:00.000Z"}))
    );

    render(<Dashboard />);

    await waitFor(() =>
      expect(screen.getByText("Parker has done Wipe Table 3 days running.")).toBeInTheDocument()
    );
  });

  it("asks the backend only for the recent window, not every record ever", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);

    await waitFor(() => expect(api.listTaskCompletions).toHaveBeenCalled());
    const [, start, end] = vi.mocked(api.listTaskCompletions).mock.calls[0] ?? [];
    expect(end).toBe(toLocalIsoDate(new Date()));
    // Four weeks back — bounded, so this doesn't grow without limit.
    expect(start).toBe(toLocalIsoDate(new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)));
  });
  it("keeps a panel's state when the layout moves it", async () => {
    // Adding a grocery line changes a signal the layout reads, so the
    // Kitchen panel can move between the rail and the drawer while
    // someone is using it. Every panel but the lead lives in one list
    // with a stable key precisely so that is a reorder and not an
    // unmount — otherwise the tab this person is on is thrown away
    // underneath them.
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.listCartItems).mockResolvedValue([]);
    vi.mocked(api.addCartItem).mockResolvedValue({
      itemId: "c9",
      description: "Milk",
      quantity: 1,
      status: "pending",
      substituteDescription: null,
      orderedAt: null,
      source: "manual",
    });

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Today's chores" })).toBeInTheDocument());
    await openKitchenTab("Shopping list");

    fireEvent.change(screen.getByLabelText(/add an item/i), { target: { value: "Milk" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => expect(screen.getByText("Milk")).toBeInTheDocument());
    // Still on the tab we were on, in the panel we opened.
    expect(screen.getByRole("tab", { name: /Shopping list/ })).toHaveAttribute("aria-selected", "true");
  });

  describe("a child's own screen", () => {
    function stubFamily() {
      vi.mocked(api.listTasks).mockResolvedValue([
        { taskId: "beds", title: "Make your bed", assignedTo: "Parker", dueDate: null, gemValue: 3, dueWindow: "morning", date: toLocalIsoDate(new Date()), recurrence: "daily", completedOn: null, status: "done", gemsAwarded: 3 , createdAt: "2020-01-01T00:00:00.000Z"},
        { taskId: "dishes", title: "Load the dishwasher", assignedTo: "Parker", dueDate: null, gemValue: 5, dueWindow: "after_dinner", date: toLocalIsoDate(new Date()), recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
        { taskId: "teeth", title: "Brush teeth", assignedTo: "Wren", dueDate: null, gemValue: 2, dueWindow: "morning", date: toLocalIsoDate(new Date()), recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
      ]);
      vi.mocked(api.listSchedules).mockResolvedValue([]);
      vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
      vi.mocked(api.listRewardGoals).mockResolvedValue([
        { memberId: "Parker", title: "Skate park trip", gemCost: 400, note: null },
        { memberId: "Wren", title: "New art set", gemCost: 80, note: null },
      ]);
      vi.mocked(api.listGemBalances).mockResolvedValue({
        balances: [
          { memberId: "Parker", earned: 337, spent: 40, balance: 297 },
          { memberId: "Wren", earned: 191, spent: 0, balance: 191 },
        ],
        family: { earned: 528, spent: 40, balance: 488 },
      });
    }

    it("opens from a tap on the name, and shows their gems and prize", async () => {
      stubFamily();
      render(<Dashboard />);
      await waitFor(() => expect(screen.getByRole("heading", { name: "Today's chores" })).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: "Parker's gems and chores" }));

      const panel = within(await screen.findByRole("dialog", { name: "Parker's gems and chores" }));
      expect(panel.getByText("297")).toBeInTheDocument();
      expect(panel.getByText("Skate park trip")).toBeInTheDocument();
      expect(panel.getByText("Load the dishwasher")).toBeInTheDocument();
    });

    it("shows no trace of a sibling on it", async () => {
      stubFamily();
      render(<Dashboard />);
      await waitFor(() => expect(screen.getByRole("heading", { name: "Today's chores" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Parker's gems and chores" }));

      const dialog = await screen.findByRole("dialog", { name: "Parker's gems and chores" });
      const text = dialog.textContent ?? "";
      // A wall-mounted leaderboard is how a seven-year-old learns their
      // sibling is better at being good.
      expect(text).not.toContain("Wren");
      expect(text).not.toContain("art set");
      expect(text).not.toContain("191");
      expect(text).not.toContain("Brush teeth");
    });

    it("says what is left and what it is worth", async () => {
      stubFamily();
      render(<Dashboard />);
      await waitFor(() => expect(screen.getByRole("heading", { name: "Today's chores" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Parker's gems and chores" }));

      const panel = within(await screen.findByRole("dialog", { name: "Parker's gems and chores" }));
      expect(panel.getByText(/1 left today · 5 gems still to earn/)).toBeInTheDocument();
    });

    it("closes on Escape like the other overlays", async () => {
      stubFamily();
      render(<Dashboard />);
      await waitFor(() => expect(screen.getByRole("heading", { name: "Today's chores" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Parker's gems and chores" }));
      await screen.findByRole("dialog", { name: "Parker's gems and chores" });

      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Parker's gems and chores" })).not.toBeInTheDocument()
      );
    });
  });

  describe("the morning", () => {
    const MORNING_ROUTINE = {
      routineId: "r1",
      name: "The bus",
      kind: "morning" as const,
      anchorTime: "07:52",
      // 2026-09-23 is a Wednesday.
      daysOfWeek: [1, 2, 3, 4, 5],
      active: true,
      steps: [
        { stepId: "s1", title: "Get dressed", targetMinutes: 10, memberId: "Parker" },
        { stepId: "s2", title: "Breakfast", targetMinutes: 15, memberId: null },
      ],
    };

    function stubQuietDay() {
      vi.mocked(api.listTasks).mockResolvedValue([]);
      vi.mocked(api.listSchedules).mockResolvedValue([]);
      vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    }

    it("takes over the screen when the morning is actually due", async () => {
      // 07:15 on a Wednesday. 25 minutes of routine + 20 minutes of lead
      // means the launch screen is open from 07:07.
      vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 7, 15) });
      stubQuietDay();
      vi.mocked(api.listRoutines).mockResolvedValue([MORNING_ROUTINE]);

      render(<Dashboard />);

      await waitFor(() => expect(screen.getByRole("dialog", { name: /The bus at/ })).toBeInTheDocument());
      const launch = within(screen.getByRole("dialog", { name: /The bus at/ }));
      expect(launch.getByRole("heading", { name: "Get dressed" })).toBeInTheDocument();
      // 37 minutes to the bus, 25 minutes of routine left.
      expect(launch.getByText("12 min spare")).toBeInTheDocument();
    });

    it("stays out of the way the rest of the day", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 16, 0) });
      stubQuietDay();
      vi.mocked(api.listRoutines).mockResolvedValue([MORNING_ROUTINE]);

      render(<Dashboard />);

      await waitFor(() => expect(screen.getByText("The morning")).toBeInTheDocument());
      expect(screen.queryByRole("dialog", { name: /The bus at/ })).not.toBeInTheDocument();
    });

    it("does not run at the weekend", async () => {
      // 2026-09-26 is a Saturday, at the same time of the morning.
      vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 26, 7, 15) });
      stubQuietDay();
      vi.mocked(api.listRoutines).mockResolvedValue([MORNING_ROUTINE]);

      render(<Dashboard />);

      await waitFor(() => expect(screen.getByText("The morning")).toBeInTheDocument());
      expect(screen.queryByRole("dialog", { name: /The bus at/ })).not.toBeInTheDocument();
    });

    it("records the step against the family's own date when it's ticked", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 7, 15) });
      stubQuietDay();
      vi.mocked(api.listRoutines).mockResolvedValue([MORNING_ROUTINE]);
      vi.mocked(api.saveRoutineRun).mockResolvedValue({
        routineId: "r1",
        date: "2026-09-23",
        startedAt: null,
        finishedAt: null,
        steps: [],
      });

      render(<Dashboard />);
      await waitFor(() => expect(screen.getByRole("dialog", { name: /The bus at/ })).toBeInTheDocument());
      fireEvent.click(within(screen.getByRole("dialog", { name: /The bus at/ })).getByRole("button", { name: "Done" }));

      await waitFor(() => expect(api.saveRoutineRun).toHaveBeenCalled());
      const [, routineId, run] = vi.mocked(api.saveRoutineRun).mock.calls[0] ?? [];
      expect(routineId).toBe("r1");
      expect(run?.date).toBe("2026-09-23");
      expect(run?.steps).toHaveLength(1);
      expect(run?.steps[0]?.stepId).toBe("s1");
      expect(run?.steps[0]?.finishedAt).not.toBeNull();
      // Two steps in the routine, one ticked — the morning isn't over.
      expect(run?.finishedAt).toBeNull();
    });

    it("records a real start for the first step, not a zero-length one", async () => {
      // The screen opens at 07:15; the first step is ticked at 07:24. That
      // step took nine minutes. Recording start == finish here is what
      // taught the plan that getting dressed was free.
      vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 7, 15) });
      stubQuietDay();
      vi.mocked(api.listRoutines).mockResolvedValue([MORNING_ROUTINE]);
      vi.mocked(api.saveRoutineRun).mockResolvedValue({
        routineId: "r1",
        date: "2026-09-23",
        startedAt: null,
        finishedAt: null,
        steps: [],
      });

      render(<Dashboard />);
      await waitFor(() => expect(screen.getByRole("dialog", { name: /The bus at/ })).toBeInTheDocument());

      // Nine minutes pass with the screen open before anyone ticks anything.
      vi.setSystemTime(new Date(2026, 8, 23, 7, 24));
      fireEvent.click(within(screen.getByRole("dialog", { name: /The bus at/ })).getByRole("button", { name: "Done" }));

      await waitFor(() => expect(api.saveRoutineRun).toHaveBeenCalled());
      const run = vi.mocked(api.saveRoutineRun).mock.calls[0]?.[2];
      const first = run?.steps[0];
      expect(first).toBeDefined();
      expect(first?.startedAt).not.toBe(first?.finishedAt);
      const minutes = (Date.parse(first?.finishedAt ?? "") - Date.parse(first?.startedAt ?? "")) / 60_000;
      expect(minutes).toBeCloseTo(9, 1);
    });

    it("moves on to the next step once one is ticked", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 7, 15) });
      stubQuietDay();
      vi.mocked(api.listRoutines).mockResolvedValue([MORNING_ROUTINE]);
      vi.mocked(api.saveRoutineRun).mockResolvedValue({
        routineId: "r1",
        date: "2026-09-23",
        startedAt: null,
        finishedAt: null,
        steps: [],
      });

      render(<Dashboard />);
      await waitFor(() => expect(screen.getByRole("dialog", { name: /The bus at/ })).toBeInTheDocument());
      fireEvent.click(within(screen.getByRole("dialog", { name: /The bus at/ })).getByRole("button", { name: "Done" }));

      await waitFor(() =>
        expect(
          within(screen.getByRole("dialog", { name: /The bus at/ })).getByRole("heading", { name: "Breakfast" })
        ).toBeInTheDocument()
      );
    });

    it("can be put away, and stays away for the rest of that morning", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 7, 15) });
      stubQuietDay();
      vi.mocked(api.listRoutines).mockResolvedValue([MORNING_ROUTINE]);

      render(<Dashboard />);
      await waitFor(() => expect(screen.getByRole("dialog", { name: /The bus at/ })).toBeInTheDocument());
      fireEvent.click(
        within(screen.getByRole("dialog", { name: /The bus at/ })).getByRole("button", { name: /back to the dashboard/i })
      );

      await waitFor(() => expect(screen.queryByRole("dialog", { name: /The bus at/ })).not.toBeInTheDocument());
      // The clock ticks on; it must not reassert itself over whatever the
      // parent went to the dashboard to look at.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(screen.queryByRole("dialog", { name: /The bus at/ })).not.toBeInTheDocument();
    });

    it("stays up to say they made it, rather than vanishing under the hand that finished it", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 7, 15) });
      stubQuietDay();
      vi.mocked(api.listRoutines).mockResolvedValue([MORNING_ROUTINE]);
      vi.mocked(api.saveRoutineRun).mockResolvedValue({
        routineId: "r1",
        date: "2026-09-23",
        startedAt: null,
        finishedAt: null,
        steps: [],
      });

      render(<Dashboard />);
      await waitFor(() => expect(screen.getByRole("dialog", { name: /The bus at/ })).toBeInTheDocument());

      // Both steps.
      for (let step = 0; step < 2; step++) {
        fireEvent.click(
          within(screen.getByRole("dialog", { name: /The bus at/ })).getByRole("button", { name: "Done" })
        );
        await act(async () => {
          await Promise.resolve();
        });
      }

      // isRoutineDue goes false the moment the routine is finished, so
      // without the celebration window the screen would be gone by now.
      await waitFor(() =>
        expect(within(screen.getByRole("dialog", { name: /The bus at/ })).getByText("Out the door")).toBeInTheDocument()
      );
      expect(
        within(screen.getByRole("dialog", { name: /The bus at/ })).getByText(/minutes to spare/)
      ).toBeInTheDocument();
    });

    it("lets the morning go once the moment has passed", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 7, 15) });
      stubQuietDay();
      vi.mocked(api.listRoutines).mockResolvedValue([MORNING_ROUTINE]);
      vi.mocked(api.saveRoutineRun).mockResolvedValue({
        routineId: "r1",
        date: "2026-09-23",
        startedAt: null,
        finishedAt: null,
        steps: [],
      });

      render(<Dashboard />);
      await waitFor(() => expect(screen.getByRole("dialog", { name: /The bus at/ })).toBeInTheDocument());
      for (let step = 0; step < 2; step++) {
        fireEvent.click(
          within(screen.getByRole("dialog", { name: /The bus at/ })).getByRole("button", { name: "Done" })
        );
        await act(async () => {
          await Promise.resolve();
        });
      }
      await waitFor(() => expect(screen.getByText("Out the door")).toBeInTheDocument());

      // Two minutes on, the family are in the car and the screen has no
      // business still showing a countdown.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });
      expect(screen.queryByRole("dialog", { name: /The bus at/ })).not.toBeInTheDocument();
    });

    const BEDTIME_ROUTINE = {
      routineId: "r2",
      name: "Bedtime",
      kind: "bedtime" as const,
      anchorTime: "20:00",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      active: true,
      steps: [
        { stepId: "b1", title: "Pyjamas", targetMinutes: 8, memberId: "Wren" },
        { stepId: "b2", title: "Story", targetMinutes: 12, memberId: null },
      ],
    };

    it("runs bedtime off the same engine, against its own deadline", async () => {
      // 19:35 on a Wednesday: 20 minutes of bedtime + 20 of lead opens it
      // at 19:20. The morning routine is nowhere near due.
      vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 19, 35) });
      stubQuietDay();
      vi.mocked(api.listRoutines).mockResolvedValue([MORNING_ROUTINE, BEDTIME_ROUTINE]);

      render(<Dashboard />);

      await waitFor(() => expect(screen.getByRole("dialog", { name: /Bedtime at/ })).toBeInTheDocument());
      const launch = within(screen.getByRole("dialog", { name: /Bedtime at/ }));
      expect(launch.getByRole("heading", { name: "Pyjamas" })).toBeInTheDocument();
      // 25 minutes to lights out, 20 minutes of routine.
      expect(launch.getByText("5 min spare")).toBeInTheDocument();
    });

    it("puts the morning on screen in the morning and bedtime at night", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 7, 15) });
      stubQuietDay();
      vi.mocked(api.listRoutines).mockResolvedValue([MORNING_ROUTINE, BEDTIME_ROUTINE]);

      render(<Dashboard />);

      await waitFor(() => expect(screen.getByRole("dialog", { name: /The bus at/ })).toBeInTheDocument());
      expect(screen.queryByRole("dialog", { name: /Bedtime at/ })).not.toBeInTheDocument();
    });

    it("keeps each routine's run to itself", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 19, 35) });
      stubQuietDay();
      vi.mocked(api.listRoutines).mockResolvedValue([MORNING_ROUTINE, BEDTIME_ROUTINE]);
      // The morning already ran today and is finished.
      vi.mocked(api.listRoutineRuns).mockImplementation(async (_family, routineId) =>
        routineId === "r1"
          ? [
              {
                routineId: "r1",
                date: "2026-09-23",
                startedAt: "2026-09-23T11:00:00.000Z",
                finishedAt: "2026-09-23T11:20:00.000Z",
                steps: [
                  { stepId: "s1", title: "Get dressed", startedAt: "2026-09-23T11:00:00.000Z", finishedAt: "2026-09-23T11:10:00.000Z" },
                  { stepId: "s2", title: "Breakfast", startedAt: "2026-09-23T11:10:00.000Z", finishedAt: "2026-09-23T11:20:00.000Z" },
                ],
              },
            ]
          : []
      );
      vi.mocked(api.saveRoutineRun).mockResolvedValue({
        routineId: "r2",
        date: "2026-09-23",
        startedAt: null,
        finishedAt: null,
        steps: [],
      });

      render(<Dashboard />);

      // Bedtime must start at its own first step, not inherit the
      // morning's finished ones.
      await waitFor(() => expect(screen.getByRole("dialog", { name: /Bedtime at/ })).toBeInTheDocument());
      const launch = within(screen.getByRole("dialog", { name: /Bedtime at/ }));
      expect(launch.getByRole("heading", { name: "Pyjamas" })).toBeInTheDocument();
      expect(launch.queryByText(/done/)).not.toBeInTheDocument();

      fireEvent.click(launch.getByRole("button", { name: "Done" }));
      await waitFor(() => expect(api.saveRoutineRun).toHaveBeenCalled());
      const [, routineId, run] = vi.mocked(api.saveRoutineRun).mock.calls[0] ?? [];
      expect(routineId).toBe("r2");
      expect(run?.steps).toHaveLength(1);
      expect(run?.steps[0]?.stepId).toBe("b1");
    });

    it("ticking one routine doesn't wipe the other's run for the same day", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 19, 35) });
      stubQuietDay();
      vi.mocked(api.listRoutines).mockResolvedValue([MORNING_ROUTINE, BEDTIME_ROUTINE]);
      // This morning ran and finished. Both runs are on the same date, so
      // a local cache keyed on date alone would drop one when the other
      // is written.
      vi.mocked(api.listRoutineRuns).mockImplementation(async (_family, routineId) =>
        routineId === "r1"
          ? [
              {
                routineId: "r1",
                date: "2026-09-23",
                startedAt: "2026-09-23T11:00:00.000Z",
                finishedAt: "2026-09-23T11:20:00.000Z",
                steps: [
                  { stepId: "s1", title: "Get dressed", startedAt: "2026-09-23T11:00:00.000Z", finishedAt: "2026-09-23T11:10:00.000Z" },
                  { stepId: "s2", title: "Breakfast", startedAt: "2026-09-23T11:10:00.000Z", finishedAt: "2026-09-23T11:20:00.000Z" },
                ],
              },
            ]
          : []
      );
      vi.mocked(api.saveRoutineRun).mockResolvedValue({
        routineId: "r2",
        date: "2026-09-23",
        startedAt: null,
        finishedAt: null,
        steps: [],
      });

      render(<Dashboard />);
      await waitFor(() => expect(screen.getByRole("dialog", { name: /Bedtime at/ })).toBeInTheDocument());

      fireEvent.click(within(screen.getByRole("dialog", { name: /Bedtime at/ })).getByRole("button", { name: "Done" }));
      await act(async () => {
        await Promise.resolve();
      });

      // Put bedtime away and look at the morning: it must still know it
      // finished, rather than offering "Get dressed" again at half seven
      // in the evening.
      fireEvent.click(
        within(screen.getByRole("dialog", { name: /Bedtime at/ })).getByRole("button", { name: /back to the dashboard/i })
      );
      await waitFor(() => expect(screen.queryByRole("dialog", { name: /Bedtime at/ })).not.toBeInTheDocument());

      await openPanel("The morning");
      fireEvent.click(
        within(screen.getByRole("heading", { name: "The morning" }).closest("section") as HTMLElement).getByRole(
          "button",
          { name: "Start now" }
        )
      );
      await waitFor(() => expect(screen.getByRole("dialog", { name: /The bus at/ })).toBeInTheDocument());
      expect(within(screen.getByRole("dialog", { name: /The bus at/ })).getByText("Out the door")).toBeInTheDocument();
    });

    it("lets Start now open a routine on a day it doesn't normally run", async () => {
      // Saturday. The school morning is weekdays only, but someone tapping
      // "Start now" means it.
      vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 26, 9, 0) });
      stubQuietDay();
      vi.mocked(api.listRoutines).mockResolvedValue([MORNING_ROUTINE]);

      render(<Dashboard />);
      await waitFor(() => expect(screen.getByText("The morning")).toBeInTheDocument());
      expect(screen.queryByRole("dialog", { name: /The bus at/ })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Start now" }));
      await waitFor(() => expect(screen.getByRole("dialog", { name: /The bus at/ })).toBeInTheDocument());
    });

    it("keeps a chore scenario off the screen while the morning is running", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 7, 15) });
      // A chore whose window closed — normally this raises a scenario.
      vi.mocked(api.listTasks).mockResolvedValue([
        { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "bedtime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 , createdAt: "2020-01-01T00:00:00.000Z"},
      ]);
      vi.mocked(api.listSchedules).mockResolvedValue([]);
      vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
      vi.mocked(api.listRoutines).mockResolvedValue([MORNING_ROUTINE]);

      render(<Dashboard />);

      await waitFor(() => expect(screen.getByRole("dialog", { name: /The bus at/ })).toBeInTheDocument());
      // Getting out of the door outranks a raccoon.
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });

  /**
   * The school panel. The thing worth asserting at this level is not the
   * wording — SchoolDay.test.tsx covers that — but that the dashboard asks
   * for the data, survives a child whose school publishes no menu, and does
   * not fall over when the whole school API is unreachable.
   */
  describe("Dashboard — school", () => {
    beforeEach(() => {
      // The three the outer beforeEach leaves to each test, because most
      // tests here are about them. These ones are not.
      vi.mocked(api.listTasks).mockResolvedValue([]);
      vi.mocked(api.listSchedules).mockResolvedValue([]);
      vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    });

    const PARKER = {
      memberId: "Parker",
      schoolName: "Maple Street Elementary",
      teacher: "Mr Alder",
      gradeLabel: null,
      specials: [
        { dayOfWeek: 1, subject: "Art", prepNote: null },
        { dayOfWeek: 2, subject: "Gym", prepNote: "Have students wear closed toed shoes or bring in a pair to change into." },
        { dayOfWeek: 3, subject: "Technology", prepNote: "Make sure computers are fulled charged." },
        { dayOfWeek: 4, subject: "Library", prepNote: "Have your student bring in their library book to return." },
        { dayOfWeek: 5, subject: "Music", prepNote: null },
      ],
      menuSource: { provider: "myschoolmenus" as const, organizationId: 40000, siteId: 40001, menuId: 40002 },
    };

    it("asks for a menu only for the children whose school publishes one", async () => {
      const noMenu = { ...PARKER, memberId: "Rowan", menuSource: null };
      vi.mocked(api.listSchoolProfiles).mockResolvedValue([PARKER, noMenu]);
      vi.mocked(api.getSchoolMenu).mockResolvedValue({
        memberId: "Parker",
        schoolName: "Maple Street Elementary",
        menuId: 40002,
        days: [],
        stale: false,
        fetchedAt: null,
        missingMonths: [],
      });

      render(<Dashboard />);

      await waitFor(() => expect(api.getSchoolMenu).toHaveBeenCalled());
      // A set rather than a call count: the dashboard is free to re-read,
      // and what matters is that Rowan is never asked for at all.
      const asked = new Set(vi.mocked(api.getSchoolMenu).mock.calls.map((call) => call[1]));
      expect([...asked]).toEqual(["Parker"]);
    });

    it("still renders the whole dashboard when the school API is unreachable", async () => {
      vi.mocked(api.listSchoolProfiles).mockRejectedValue(new Error("network"));

      render(<Dashboard />);

      await waitFor(() => expect(screen.getByRole("heading", { name: /Today.s chores/i })).toBeInTheDocument());
      // A school menu that will not load is not worth an error banner over
      // the chores a child is standing in front of.
      expect(screen.queryByText(/network/i)).not.toBeInTheDocument();
    });

    it("does not lose one child's lunch because the other child's menu failed", async () => {
      const sibling = { ...PARKER, memberId: "Rowan" };
      vi.mocked(api.listSchoolProfiles).mockResolvedValue([PARKER, sibling]);
      vi.mocked(api.getSchoolMenu).mockImplementation(async (_family: string, memberId: string) => {
        if (memberId === "Rowan") throw new Error("404");
        return {
          memberId: "Parker",
          schoolName: "Maple Street Elementary",
          menuId: 40002,
          days: [],
          stale: false,
          fetchedAt: null,
          missingMonths: [],
        };
      });

      render(<Dashboard />);

      await waitFor(() => {
        const asked = new Set(vi.mocked(api.getSchoolMenu).mock.calls.map((call) => call[1]));
        expect([...asked].sort()).toEqual(["Parker", "Rowan"]);
      });
      expect(screen.getByRole("heading", { name: /Today.s chores/i })).toBeInTheDocument();
    });
  });

  describe("Dashboard — ticking the school note off", () => {
    beforeEach(() => {
      vi.mocked(api.listTasks).mockResolvedValue([]);
      vi.mocked(api.listSchedules).mockResolvedValue([]);
      vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
      vi.mocked(api.listSchoolPrep).mockResolvedValue([]);
    });

    /**
     * Thursday 1 October 2026, ten to seven in the morning — Library day,
     * and the last hour in which an untouched library book can still be
     * dealt with.
     *
     * The clock is pinned with `toFake: ["Date"]` rather than the whole
     * timer set. Replacing the timers makes `waitFor` burn its own timeout
     * in a few real milliseconds and give up before the school effect's
     * promise chain has settled.
     *
     * These cover the round trip — click, request, optimistic render,
     * rollback. The rule about *which day* a tick is filed against is tested
     * in lib/schoolDay.test.ts against `prepRecordFor`, where an evening can
     * be pinned without rendering a whole dashboard to do it.
     */
    const THURSDAY_MORNING = new Date(2026, 9, 1, 6, 50);
    const THURSDAY = "2026-10-01";
    const pinTo = (when: Date) => vi.useFakeTimers({ toFake: ["Date"], now: when });

    const PARKER = {
      memberId: "Parker",
      schoolName: "Maple Street Elementary",
      teacher: "Mr Alder",
      gradeLabel: null,
      specials: [{ dayOfWeek: 4, subject: "Library", prepNote: "Bring the library book back." }],
      menuSource: null,
    };

    it("sends the tick and shows it before the server has answered", async () => {
      pinTo(THURSDAY_MORNING);
      vi.mocked(api.listSchoolProfiles).mockResolvedValue([PARKER]);
      vi.mocked(api.markSchoolPrepPacked).mockImplementation(async (_f: string, memberId: string, date: string) => ({
        memberId,
        date,
        subject: "Library",
        note: "Bring the library book back.",
        packedAt: new Date().toISOString(),
      }));

      render(<Dashboard />);
      // Waited on the button rather than the note: the note text appears on
      // the calendar as well as on the school panel, by design.
      await waitFor(() => expect(screen.getByRole("button", { name: "Packed" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Packed" }));

      await waitFor(() => expect(api.markSchoolPrepPacked).toHaveBeenCalledTimes(1));
      const [, memberId, date, body] = vi.mocked(api.markSchoolPrepPacked).mock.calls[0]!;
      expect(memberId).toBe("Parker");
      expect(date).toBe(THURSDAY);
      expect(body).toMatchObject({ subject: "Library", note: "Bring the library book back." });
      await waitFor(() => expect(screen.getByText(/Ticked off at/)).toBeInTheDocument());
    });

    it("files an evening tick against tomorrow, the day the note is for", async () => {
      // The strong version of the rule, end to end: at half eight on
      // Wednesday the panel is asking about Thursday, so that is the day the
      // tick has to land on. `prepRecordFor` is unit-tested for the same
      // thing; this proves the dashboard actually uses it.
      vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 30, 20, 30) });
      vi.mocked(api.listSchoolProfiles).mockResolvedValue([PARKER]);
      vi.mocked(api.markSchoolPrepPacked).mockImplementation(async (_f: string, memberId: string, date: string) => ({
        memberId,
        date,
        subject: "Library",
        note: "Bring the library book back.",
        packedAt: new Date().toISOString(),
      }));

      render(<Dashboard />);
      await waitFor(() => expect(screen.getByRole("button", { name: "Packed" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Packed" }));

      await waitFor(() => expect(api.markSchoolPrepPacked).toHaveBeenCalledTimes(1));
      const [, , date] = vi.mocked(api.markSchoolPrepPacked).mock.calls[0]!;
      expect(date).toBe(THURSDAY);
      expect(date).not.toBe("2026-09-30");
    });

    it("reads a tick made last night back, so the morning stops asking", async () => {
      pinTo(THURSDAY_MORNING);
      vi.mocked(api.listSchoolProfiles).mockResolvedValue([PARKER]);
      vi.mocked(api.listSchoolPrep).mockResolvedValue([
        {
          memberId: "Parker",
          date: THURSDAY,
          subject: "Library",
          note: "Bring the library book back.",
          packedAt: "2026-09-30T20:31:00.000Z",
        },
      ]);

      render(<Dashboard />);

      await waitFor(() => expect(screen.getByText(/Ticked off at/)).toBeInTheDocument());
      expect(screen.queryByText("Still not ticked off.")).not.toBeInTheDocument();
    });

    it("says what is still outstanding on the morning it matters", async () => {
      pinTo(THURSDAY_MORNING);
      vi.mocked(api.listSchoolProfiles).mockResolvedValue([PARKER]);

      render(<Dashboard />);

      await waitFor(() => expect(screen.getByText("Still not ticked off.")).toBeInTheDocument());
    });

    it("puts the tick back when the server refuses it", async () => {
      pinTo(THURSDAY_MORNING);
      vi.mocked(api.listSchoolProfiles).mockResolvedValue([PARKER]);
      vi.mocked(api.markSchoolPrepPacked).mockRejectedValue(new Error("nope"));

      render(<Dashboard />);
      // Waited on the button rather than the note: the note text appears on
      // the calendar as well as on the school panel, by design.
      await waitFor(() => expect(screen.getByRole("button", { name: "Packed" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Packed" }));

      // Rolled back rather than left showing a state the server never took.
      await waitFor(() => expect(screen.getByRole("button", { name: "Packed" })).toBeInTheDocument());
      expect(screen.queryByText(/Ticked off at/)).not.toBeInTheDocument();
    });
  });
});
