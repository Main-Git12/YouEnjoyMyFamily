import { describe, it, expect } from "vitest";
import { CASTLE_THREATS, pickCastleThreat } from "./castleThreats";

describe("pickCastleThreat", () => {
  it("returns a line naming the assignee and the task title", () => {
    for (let i = 0; i < 20; i++) {
      const line = pickCastleThreat("Parker", "wipe the table");
      expect(line).toContain("Parker");
      expect(line).toContain("wipe the table");
      expect(CASTLE_THREATS.some((threat) => threat("Parker", "wipe the table") === line)).toBe(true);
    }
  });
});
