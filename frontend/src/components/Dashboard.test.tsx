import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import Dashboard from "./Dashboard";
import { weekFromOffset, toLocalIsoDate } from "../lib/dates";
import { threatForChore } from "../lib/gemThreats";
import { api } from "../lib/api";
import type { Task } from "../types";

vi.mock("../lib/api", () => ({
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
    claimRewardGoal: vi.fn(),
    setRewardGoal: vi.fn(),
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
    vi.mocked(api.listGemBalances).mockResolvedValue([]);
  });

  afterEach(() => {
    // Restore here rather than at the end of each test, so a failing
    // assertion can't leave the next test frozen at somebody else's clock.
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it("renders fetched tasks and schedule entries", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([
      { scheduleId: "s1", date: "2025-01-15", title: "Soccer practice", startTime: null, endTime: null, memberIds: [] },
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
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
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
      gemsAwarded: 10,
    });

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText("Pack soccer bag")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Mark "Pack soccer bag" done'));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(within(screen.getByRole("alert")).getByText("+10 gems")).toBeInTheDocument();
    expect(screen.getByText("10 gems collected")).toBeInTheDocument();
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

    await waitFor(() => expect(screen.getByText("Nothing remembered yet.")).toBeInTheDocument());

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
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "after_dinner", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
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
      gemsAwarded: 10,
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

  it("does not raise a scenario while the chore's part of the day is still open", async () => {
    // Seven in the morning: a bedtime chore is not late, it's early.
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 7, 0) });
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Sleep in my own bed", assignedTo: "Parker", dueDate: null, gemValue: 20, dueWindow: "bedtime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText("Sleep in my own bed")).toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("does not bring a waved-away scenario straight back as the next chore", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 8, 23, 21, 30) });
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "after_dinner", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
      { taskId: "t2", title: "Put on pajamas", assignedTo: "Isla", dueDate: null, gemValue: 5, dueWindow: "bedtime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);

    // The most overdue chore goes first.
    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByText(/Wipe Table/)).toBeInTheDocument());
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /not now/i }));

    // The next one steps up...
    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByText(/Put on pajamas/)).toBeInTheDocument());
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /not now/i }));

    // ...and waving that away ends it, rather than cycling back to the first.
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
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
      gemsAwarded: 0,
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
    vi.mocked(api.listGemBalances).mockResolvedValue([
      { memberId: "Parker", earned: 30, spent: 0, balance: 30 },
    ]);
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

    await waitFor(() => expect(screen.getByText("Tacos (2)")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /generate grocery list for this week/i }));

    await waitFor(() => expect(screen.getByText(/Added 2 ingredients/)).toBeInTheDocument());
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

    await waitFor(() => expect(screen.getByText("Nothing in the cart yet.")).toBeInTheDocument());

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

    await waitFor(() => expect(screen.getByText("Spaghetti")).toBeInTheDocument());
    // Removal takes a deliberate second tap.
    fireEvent.click(screen.getByLabelText('Remove "Spaghetti" from the cart'));
    fireEvent.click(screen.getByLabelText('Tap again to remove "Spaghetti" from the cart'));

    await waitFor(() => expect(screen.getByText("Nothing in the cart yet.")).toBeInTheDocument());
    expect(api.removeCartItem).toHaveBeenCalledWith("fam_demo", "c1");
  });

  it("re-fetches for the new date range when the family pages to another week", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("This week")).toBeInTheDocument());

    const thisWeek = weekFromOffset(0);
    expect(api.listMealPlan).toHaveBeenLastCalledWith("fam_demo", thisWeek[0], thisWeek[6]);

    fireEvent.click(screen.getByRole("button", { name: /show the next week/i }));

    // Without a re-fetch the label would change while the meals on screen
    // still belonged to the previous week.
    const nextWeek = weekFromOffset(1);
    await waitFor(() => expect(api.listMealPlan).toHaveBeenLastCalledWith("fam_demo", nextWeek[0], nextWeek[6]));
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
      gemsAwarded: 0,
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
    vi.mocked(api.completeTask).mockResolvedValue({ ...pending, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "done", gemsAwarded: 10 });
    fireEvent.click(screen.getByLabelText('Mark "Feed the dog" done'));
    await waitFor(() => expect(screen.getByText("10 gems collected")).toBeInTheDocument());

    // Now the stale snapshot finally lands, still showing the chore as pending.
    await act(async () => {
      releaseStaleSync([pending]);
    });

    // It must not un-tick the chore or roll the gem total backwards.
    expect(screen.getByText("10 gems collected")).toBeInTheDocument();
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

    await waitFor(() => expect(screen.getByText("Meal plan")).toBeInTheDocument());
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
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
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
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.listTaskCompletions).mockResolvedValue([
      { taskId: "t1", date: "2026-09-21", title: "Wipe Table", memberId: "Parker", gemsAwarded: 10 },
      { taskId: "t1", date: "2026-09-22", title: "Wipe Table", memberId: "Parker", gemsAwarded: 10 },
    ]);
    vi.mocked(api.listGemBalances).mockResolvedValue([
      { memberId: "Parker", earned: 20, spent: 0, balance: 20 },
    ]);

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText("20 gems collected")).toBeInTheDocument());
    // Today's chore is waiting again, with nothing awarded yet.
    expect(screen.getByLabelText('Mark "Wipe Table" done')).toBeInTheDocument();
  });

  it("moves the gem total the moment a chore is ticked, not on the next sync", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.listTaskCompletions).mockResolvedValue([]);
    vi.mocked(api.completeTask).mockResolvedValue({
      taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10,
      dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null,
      status: "done", gemsAwarded: 10,
    });

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("0 gems collected")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Mark "Wipe Table" done'));

    await waitFor(() => expect(screen.getByText("10 gems collected")).toBeInTheDocument());
  });

  it("claims a prize, spending the gems and clearing the board", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.listTaskCompletions).mockResolvedValue([
      { taskId: "t1", date: "2026-09-22", title: "Homework", memberId: "Parker", gemsAwarded: 60 },
    ]);
    vi.mocked(api.listGemBalances).mockResolvedValue([
      { memberId: "Parker", earned: 60, spent: 0, balance: 60 },
    ]);
    vi.mocked(api.listRewardGoals).mockResolvedValue([
      { memberId: "Parker", title: "LEGO set", gemCost: 50, note: null },
    ]);
    vi.mocked(api.claimRewardGoal).mockResolvedValue({
      claim: { title: "LEGO set", gemCost: 50 },
      balance: { memberId: "Parker", earned: 60, spent: 50, balance: 10 },
    });

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText("60 gems collected")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Claim LEGO set" }));

    // The gems are spent, so the total comes down and the prize leaves the board.
    await waitFor(() => expect(screen.getByText("10 gems collected")).toBeInTheDocument());
    expect(screen.queryByText("LEGO set")).not.toBeInTheDocument();
    expect(screen.getByText(/no prizes set yet/i)).toBeInTheDocument();
  });

  it("ticks a chore off instantly, before the server has answered", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.listTaskCompletions).mockResolvedValue([]);
    vi.mocked(api.listGemBalances).mockResolvedValue([]);

    // A slow write, still in flight.
    let settle: (task: Task) => void = () => {};
    vi.mocked(api.completeTask).mockReturnValue(new Promise<Task>((resolve) => { settle = resolve; }));

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("Wipe Table")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Mark "Wipe Table" done'));

    // A child taps and the gems land. No pause, no dead-looking button.
    await waitFor(() => expect(screen.getByText("10 gems collected")).toBeInTheDocument());
    expect(screen.queryByLabelText('Mark "Wipe Table" done')).not.toBeInTheDocument();

    await act(async () => {
      settle({ taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "done", gemsAwarded: 10 });
    });
    expect(screen.getByText("10 gems collected")).toBeInTheDocument();
  });

  it("puts a chore back exactly as it was when the write fails", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Wipe Table", assignedTo: "Parker", dueDate: null, gemValue: 10, dueWindow: "anytime", date: "2026-09-23", recurrence: "daily", completedOn: null, status: "pending", gemsAwarded: 0 },
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.listTaskCompletions).mockResolvedValue([]);
    vi.mocked(api.listGemBalances).mockResolvedValue([]);
    vi.mocked(api.completeTask).mockRejectedValue(new Error("Can't reach the family account — check the wi-fi."));

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("0 gems collected")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Mark "Wipe Table" done'));

    // The gems go back and the chore is waiting again, with the reason shown.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/check the wi-fi/i));
    expect(screen.getByText("0 gems collected")).toBeInTheDocument();
    expect(screen.getByLabelText('Mark "Wipe Table" done')).toBeInTheDocument();
    // And no celebration for something that didn't happen.
    expect(screen.queryByText("+10 gems")).not.toBeInTheDocument();
  });
});
