import { describe, it, expect } from "vitest";
import { getGardenProgress, GARDEN_STAGES } from "./index";

describe("getGardenProgress", () => {
  it("starts at the Tiny Seed stage with zero gems", () => {
    const progress = getGardenProgress(0);
    expect(progress.stage.id).toBe("seed");
    expect(progress.stageIndex).toBe(0);
    expect(progress.nextStage?.id).toBe("sprout");
    expect(progress.gemsToNextStage).toBe(25);
    expect(progress.progressFraction).toBe(0);
  });

  it("picks the highest stage the total has reached, not just crossed", () => {
    expect(getGardenProgress(24).stage.id).toBe("seed");
    expect(getGardenProgress(25).stage.id).toBe("sprout");
    expect(getGardenProgress(74).stage.id).toBe("sprout");
    expect(getGardenProgress(75).stage.id).toBe("sapling");
  });

  it("computes progress toward the next stage as a 0..1 fraction", () => {
    // Sprout runs 25..74 (50 gems wide); 50 gems in is halfway.
    const progress = getGardenProgress(50);
    expect(progress.stage.id).toBe("sprout");
    expect(progress.gemsToNextStage).toBe(25);
    expect(progress.progressFraction).toBeCloseTo(0.5);
  });

  it("has no next stage and full progress once the top stage is reached", () => {
    const topThreshold = GARDEN_STAGES[GARDEN_STAGES.length - 1]?.threshold ?? 0;
    const progress = getGardenProgress(topThreshold + 500);
    expect(progress.stage.id).toBe("grove");
    expect(progress.nextStage).toBeNull();
    expect(progress.gemsToNextStage).toBeNull();
    expect(progress.progressFraction).toBe(1);
  });
});
