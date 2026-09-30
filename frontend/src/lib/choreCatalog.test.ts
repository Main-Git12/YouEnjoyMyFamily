import { describe, it, expect } from "vitest";
import { CHORE_CATALOG, DUE_WINDOW_LABELS, DUE_WINDOW_ORDER, choresByWindow } from "./choreCatalog";

describe("chore catalog", () => {
  it("keeps the gem values the children are already used to", () => {
    const byTitle = new Map(CHORE_CATALOG.map((chore) => [chore.title, chore.gemValue]));
    expect(byTitle.get("Eat my Breakfast")).toBe(5);
    expect(byTitle.get("Wipe Table")).toBe(10);
    expect(byTitle.get("Sleep in my own bed")).toBe(20);
  });

  it("has no duplicate chores", () => {
    expect(new Set(CHORE_CATALOG.map((chore) => chore.title)).size).toBe(CHORE_CATALOG.length);
  });

  it("gives every chore a window the app knows how to label", () => {
    for (const chore of CHORE_CATALOG) {
      expect(DUE_WINDOW_ORDER).toContain(chore.window);
      expect(DUE_WINDOW_LABELS[chore.window]).toBeTruthy();
    }
  });

  it("groups the whole library, in the order the day runs", () => {
    const groups = choresByWindow();
    expect(groups.flatMap((group) => group.chores)).toHaveLength(CHORE_CATALOG.length);
    const windows = groups.map((group) => group.window);
    expect(windows).toEqual(DUE_WINDOW_ORDER.filter((window) => windows.includes(window)));
  });
});
