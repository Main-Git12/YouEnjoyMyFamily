import { describe, it, expect } from "vitest";
import { planPanels, drawerLabel, ALL_PANELS, type PanelSignals } from "./dashboardLayout";

const at = (hour: number, minute = 0) => new Date(2026, 8, 25, hour, minute);

function signals(overrides: Partial<PanelSignals> = {}): PanelSignals {
  return {
    now: at(8),
    choresLeft: 3,
    outstandingCartItems: 0,
    insightCount: 0,
    scheduleEntriesToday: 0,
    hasMorningRoutine: false,
    hasBedtimeRoutine: false,
    focusBlocksToday: 0,
    statedPreferenceCount: 0,
    schoolNotesNow: 0,
    tomorrowSignals: 0,
    ...overrides,
  };
}

describe("planPanels", () => {
  it("never loses a panel — everything is either led, railed or in the drawer", () => {
    const plan = planPanels(signals());
    const placed = [plan.lead, ...plan.rail, ...plan.drawer];
    expect(placed.length).toBe(ALL_PANELS.length);
    expect(new Set(placed).size).toBe(ALL_PANELS.length);
    for (const panel of ALL_PANELS) expect(placed).toContain(panel);
  });

  it("always leads with the chores, whatever the hour", () => {
    for (const hour of [7, 12, 16, 19, 21, 23]) {
      expect(planPanels(signals({ now: at(hour) })).lead).toBe("chores");
    }
  });

  it("keeps the rail small enough to read at a glance", () => {
    expect(planPanels(signals()).rail.length).toBe(3);
  });

  // Enough panels holding content that the three rail slots are actually
  // contested — otherwise everything fits and the ordering proves nothing.
  const busyDay = {
    hasMorningRoutine: true,
    hasBedtimeRoutine: true,
    scheduleEntriesToday: 2,
    insightCount: 2,
    outstandingCartItems: 4,
  };

  it("puts the morning routine to hand in the morning, and bedtime away", () => {
    const plan = planPanels(signals({ now: at(7, 30), ...busyDay }));
    expect(plan.rail).toContain("morning");
    expect(plan.drawer).toContain("bedtime");
  });

  it("swaps them over in the evening", () => {
    const plan = planPanels(signals({ now: at(19, 45), ...busyDay }));
    expect(plan.rail).toContain("bedtime");
    expect(plan.drawer).toContain("morning");
  });

  it("prefers a panel with something in it over one without, whatever the hour", () => {
    // At 7:30 the morning routine would normally lead the rail — but
    // there isn't one, and the shopping list has six lines on it.
    const plan = planPanels(
      signals({ now: at(7, 30), hasMorningRoutine: false, outstandingCartItems: 6, insightCount: 2 })
    );
    expect(plan.rail).toContain("kitchen");
    expect(plan.rail).toContain("insights");
    expect(plan.drawer).toContain("morning");
  });

  it("sends empty panels to the drawer rather than spending a cell saying 'nothing here'", () => {
    const plan = planPanels(signals({ now: at(16), scheduleEntriesToday: 0, statedPreferenceCount: 0 }));
    expect(plan.drawer).toContain("favorites");
  });

  it("keeps the prize board up even with no prize set, because an empty one is an invitation", () => {
    const plan = planPanels(signals({ now: at(19, 45) }));
    expect([...plan.rail, plan.lead]).toContain("prize");
  });

  it("brings today's schedule forward when there is something on it", () => {
    const plan = planPanels(signals({ now: at(8), scheduleEntriesToday: 3 }));
    expect(plan.rail).toContain("schedule");
  });

  it("puts focused work to hand during the working day once it's been used", () => {
    const plan = planPanels(signals({ now: at(14), focusBlocksToday: 3 }));
    expect(plan.rail).toContain("focus");
  });

  it("keeps focused work out of the way at breakfast", () => {
    const plan = planPanels(
      signals({ now: at(7, 30), focusBlocksToday: 2, hasMorningRoutine: true, scheduleEntriesToday: 2, insightCount: 2 })
    );
    expect(plan.drawer).toContain("focus");
  });

  it("looks to tomorrow once the day's last window has closed", () => {
    // Half eleven at night: nothing left today, so the routines are the
    // only things worth a cell.
    const plan = planPanels(signals({ now: at(23, 30), hasMorningRoutine: true, hasBedtimeRoutine: true }));
    expect(plan.rail).toContain("morning");
  });

  it("is stable across a re-render at the same moment", () => {
    const input = signals({ now: at(16, 10), insightCount: 2, outstandingCartItems: 4 });
    expect(planPanels(input)).toEqual(planPanels(input));
  });
});

describe("drawerLabel", () => {
  it("counts what's behind the tap", () => {
    expect(drawerLabel({ lead: "chores", rail: ["schedule"], drawer: ["prize", "kitchen"] })).toBe("2 more");
    expect(drawerLabel({ lead: "chores", rail: [], drawer: ["prize"] })).toBe("1 more");
  });
});

/**
 * The school panel earns its cell only when there is a school day to show —
 * which on a Saturday, or a Friday evening, is never. That is deliberate:
 * a panel that sits there saying "nothing" all weekend teaches people to
 * stop looking at that corner of the screen.
 */
describe("the school panel", () => {
  it("loses its place to a panel that has something in it", () => {
    // Stated as a comparison rather than "it is never in the rail when
    // empty", because when *nothing* has content the rail falls back to
    // preference order and school is high in the evening's — which is the
    // engine working, not a bug. The rule being asserted is the engine's
    // actual promise: content beats emptiness.
    const busy = { insightCount: 3, outstandingCartItems: 4, scheduleEntriesToday: 2, focusBlocksToday: 1 };
    const plan = planPanels(signals({ now: at(20), schoolNotesNow: 0, ...busy }));
    expect(plan.rail).not.toContain("school");
    expect(plan.drawer).toContain("school");
  });

  it("beats a panel that has nothing in it, on a school night", () => {
    const plan = planPanels(signals({ now: at(20), schoolNotesNow: 1 }));
    expect(plan.rail).toContain("school");
  });

  it("reaches the rail on a school night, when the bag can still be packed", () => {
    const plan = planPanels(signals({ now: at(20), schoolNotesNow: 1 }));
    expect(plan.rail).toContain("school");
  });

  it("reaches the rail in the morning, when there is still time to act on it", () => {
    const plan = planPanels(signals({ now: at(7), schoolNotesNow: 1 }));
    expect(plan.rail).toContain("school");
  });

  it("is never dropped — it is always either in the rail or one tap away", () => {
    for (const hour of [6, 8, 12, 15, 18, 20, 22]) {
      for (const schoolNotesNow of [0, 1, 2]) {
        const plan = planPanels(signals({ now: at(hour), schoolNotesNow }));
        expect([...plan.rail, ...plan.drawer, plan.lead]).toContain("school");
      }
    }
  });
});

/**
 * Setting the sheet up is a once-a-year job, so it lives behind the drawer
 * and stays there. A form nobody is filling in is the emptiest thing that
 * could take a cell of a kitchen screen.
 */
describe("the specials-sheet form", () => {
  it("is never in the rail, at any hour", () => {
    for (const hour of [6, 8, 12, 15, 18, 20, 22]) {
      for (const schoolNotesNow of [0, 1, 2]) {
        const plan = planPanels(signals({ now: at(hour), schoolNotesNow }));
        expect(plan.rail).not.toContain("school-setup");
        expect(plan.drawer).toContain("school-setup");
      }
    }
  });

  it("is never the lead either", () => {
    expect(planPanels(signals({ now: at(20) })).lead).not.toBe("school-setup");
  });
});
