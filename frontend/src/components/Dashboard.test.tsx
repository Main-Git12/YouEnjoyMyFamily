import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import Dashboard from "./Dashboard";
import { nextSevenDays } from "./MealPlan";
import { api } from "../lib/api";
import type { Task } from "../types";

vi.mock("../lib/api", () => ({
  api: {
    listTasks: vi.fn(),
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
  },
}));

describe("Dashboard", () => {
  beforeEach(() => {
    // Defaults so tests that don't touch meal planning / grocery don't have
    // to stub every call in the dashboard's initial Promise.all.
    vi.mocked(api.listMealPlan).mockResolvedValue([]);
    vi.mocked(api.listCartItems).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("renders fetched tasks and schedule entries", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, status: "pending", gemsAwarded: 0 },
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
    vi.mocked(api.listTasks).mockRejectedValue(new Error("Request failed: 500 /families/fam_demo/tasks"));
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText(/couldn't reach the backend/i)).toBeInTheDocument());
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it("shows the gem celebration and updated total after completing a task", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, status: "pending", gemsAwarded: 0 },
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.completeTask).mockResolvedValue({
      taskId: "t1",
      title: "Pack soccer bag",
      assignedTo: null,
      dueDate: null,
      status: "done",
      gemsAwarded: 10,
    });

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText("Pack soccer bag")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Mark "Pack soccer bag" done'));

    await waitFor(() => expect(screen.getByText("+10 gems")).toBeInTheDocument());
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

  it("triggers a castle-attack event for a pending task that already has an assignee", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "wipe the table", assignedTo: "Parker", dueDate: null, status: "pending", gemsAwarded: 0 },
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    vi.mocked(api.completeTask).mockResolvedValue({
      taskId: "t1",
      title: "wipe the table",
      assignedTo: "Parker",
      dueDate: null,
      status: "done",
      gemsAwarded: 10,
    });

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText("Castle Under Attack!")).toBeInTheDocument());
    expect(screen.getByText(/Parker/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /defend the castle/i }));

    await waitFor(() => expect(api.completeTask).toHaveBeenCalledWith("fam_demo", "t1"));
    expect(screen.queryByText("Castle Under Attack!")).not.toBeInTheDocument();
  });

  it("does not trigger a castle-attack event when no pending task has an assignee", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, status: "pending", gemsAwarded: 0 },
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText("Pack soccer bag")).toBeInTheDocument());
    expect(screen.queryByText("Castle Under Attack!")).not.toBeInTheDocument();
  });

  it("renders the planned meal plan and generates a grocery list from it", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    const today = nextSevenDays()[0] as string;
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
        source: "manual",
      },
    ]);
    vi.mocked(api.removeCartItem).mockResolvedValue({ deleted: "c1" });

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText("Spaghetti")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Remove "Spaghetti" from the cart'));

    await waitFor(() => expect(screen.getByText("Nothing in the cart yet.")).toBeInTheDocument());
    expect(api.removeCartItem).toHaveBeenCalledWith("fam_demo", "c1");
  });

  it("picks up an edit made on another device when the screen becomes visible again", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);
    const today = nextSevenDays()[0] as string;
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
      { taskId: "t1", title: "Pack soccer bag", assignedTo: null, dueDate: null, status: "pending", gemsAwarded: 0 },
    ]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("Pack soccer bag")).toBeInTheDocument());

    // The phone drops off the network mid-sync.
    vi.mocked(api.listTasks).mockRejectedValue(new Error("Failed to fetch"));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Pack soccer bag")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't reach the backend/i)).not.toBeInTheDocument();
  });

  it("surfaces the failure when someone asks for a refresh themselves", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listSchedules).mockResolvedValue([]);
    vi.mocked(api.listStatedPreferences).mockResolvedValue([]);

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("Today's tasks")).toBeInTheDocument());

    vi.mocked(api.listTasks).mockRejectedValue(new Error("Failed to fetch"));
    fireEvent.click(screen.getByRole("button", { name: /refresh from the family's other devices/i }));

    await waitFor(() => expect(screen.getByText(/couldn't reach the backend/i)).toBeInTheDocument());
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
    expect(screen.queryByText("Today's tasks")).not.toBeInTheDocument();

    resolveTasks([]);

    await waitFor(() => expect(screen.getByText("Today's tasks")).toBeInTheDocument());
    expect(screen.queryByText(/loading your family's day/i)).not.toBeInTheDocument();
  });
});
