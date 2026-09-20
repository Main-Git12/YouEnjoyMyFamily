import { describe, it, expect } from "vitest";
import { getCastleProgress, CASTLE_STAGES, pickStageLine, CASTLE_STAGE_LINES } from "./index";

describe("getCastleProgress", () => {
  it("starts at the Watchtower stage with zero gems", () => {
    const progress = getCastleProgress(0);
    expect(progress.stage.id).toBe("watchtower");
    expect(progress.stageIndex).toBe(0);
    expect(progress.nextStage?.id).toBe("knights-keep");
    expect(progress.gemsToNextStage).toBe(25);
    expect(progress.progressFraction).toBe(0);
  });

  it("picks the highest stage the total has reached, not just crossed", () => {
    expect(getCastleProgress(24).stage.id).toBe("watchtower");
    expect(getCastleProgress(25).stage.id).toBe("knights-keep");
    expect(getCastleProgress(74).stage.id).toBe("knights-keep");
    expect(getCastleProgress(75).stage.id).toBe("rising-castle");
  });

  it("computes progress toward the next stage as a 0..1 fraction", () => {
    // Knight's Keep runs 25..74 (50 gems wide); 50 gems in is halfway.
    const progress = getCastleProgress(50);
    expect(progress.stage.id).toBe("knights-keep");
    expect(progress.gemsToNextStage).toBe(25);
    expect(progress.progressFraction).toBeCloseTo(0.5);
  });

  it("has no next stage and full progress once the top stage is reached", () => {
    const topThreshold = CASTLE_STAGES[CASTLE_STAGES.length - 1]?.threshold ?? 0;
    const progress = getCastleProgress(topThreshold + 500);
    expect(progress.stage.id).toBe("kingdom-of-gems");
    expect(progress.nextStage).toBeNull();
    expect(progress.gemsToNextStage).toBeNull();
    expect(progress.progressFraction).toBe(1);
  });
});

describe("pickStageLine", () => {
  it("returns a line from the matching stage's pool", () => {
    for (let i = 0; i < 20; i++) {
      const line = pickStageLine("knights-keep");
      expect(CASTLE_STAGE_LINES["knights-keep"]).toContain(line);
    }
  });

  it("falls back to the watchtower pool for an unknown stage id", () => {
    expect(pickStageLine("not-a-real-stage")).toBe(CASTLE_STAGE_LINES.watchtower?.[0]);
  });
});
