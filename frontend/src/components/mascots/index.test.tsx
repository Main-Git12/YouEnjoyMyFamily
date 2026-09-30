import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { MASCOTS, randomMascot } from "./index";

describe("mascots", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gives every mascot a name the celebration can say out loud", () => {
    for (const mascot of MASCOTS) {
      expect(mascot.name).toMatch(/\S/);
    }
    expect(MASCOTS.map((mascot) => mascot.id)).toContain("king");
  });

  it("can actually pick every mascot, not just the first few", () => {
    const picked = new Set<string>();
    for (let roll = 0; roll < MASCOTS.length; roll += 1) {
      vi.spyOn(Math, "random").mockReturnValue(roll / MASCOTS.length);
      picked.add(randomMascot().id);
    }
    expect(picked.size).toBe(MASCOTS.length);
  });

  it("still returns a mascot when the roll lands right on the edge", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999999999);
    expect(MASCOTS).toContain(randomMascot());
  });

  it("draws each mascot with a description a screen reader can read", () => {
    for (const mascot of MASCOTS) {
      const { getByRole, unmount } = render(<mascot.Component size={64} />);
      expect(getByRole("img")).toHaveAccessibleName();
      unmount();
    }
  });
});
