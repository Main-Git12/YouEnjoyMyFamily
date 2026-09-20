import SeedStage from "./SeedStage";
import SproutStage from "./SproutStage";
import SaplingStage from "./SaplingStage";
import TreeStage from "./TreeStage";
import GroveStage from "./GroveStage";
import type { GardenStageProps } from "./types";

export interface GardenStage {
  id: string;
  name: string;
  threshold: number;
  Component: (props: GardenStageProps) => JSX.Element;
}

const SEED: GardenStage = { id: "seed", name: "Tiny Seed", threshold: 0, Component: SeedStage };
const SPROUT: GardenStage = { id: "sprout", name: "Sprout", threshold: 25, Component: SproutStage };
const SAPLING: GardenStage = { id: "sapling", name: "Budding Sapling", threshold: 75, Component: SaplingStage };
const TREE: GardenStage = { id: "tree", name: "Blooming Tree", threshold: 150, Component: TreeStage };
const GROVE: GardenStage = { id: "grove", name: "Magical Grove", threshold: 300, Component: GroveStage };

// Ascending by threshold — GARDEN_STAGES[0] must always be the zero-threshold
// stage so getGardenProgress always has a match.
export const GARDEN_STAGES: readonly GardenStage[] = [SEED, SPROUT, SAPLING, TREE, GROVE];

export interface GardenProgress {
  stage: GardenStage;
  stageIndex: number;
  nextStage: GardenStage | null;
  gemsToNextStage: number | null;
  progressFraction: number;
}

export function getGardenProgress(totalGems: number): GardenProgress {
  let stage: GardenStage = SEED;
  let stageIndex = 0;

  GARDEN_STAGES.forEach((candidate, index) => {
    if (totalGems >= candidate.threshold) {
      stage = candidate;
      stageIndex = index;
    }
  });

  const nextStage = GARDEN_STAGES[stageIndex + 1] ?? null;
  const gemsToNextStage = nextStage ? nextStage.threshold - totalGems : null;
  const progressFraction = nextStage
    ? (totalGems - stage.threshold) / (nextStage.threshold - stage.threshold)
    : 1;

  return { stage, stageIndex, nextStage, gemsToNextStage, progressFraction };
}

export type { GardenStageProps };
