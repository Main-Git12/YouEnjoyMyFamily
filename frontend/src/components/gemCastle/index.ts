import WatchtowerStage from "./WatchtowerStage";
import KnightsKeepStage from "./KnightsKeepStage";
import RisingCastleStage from "./RisingCastleStage";
import GrandFortressStage from "./GrandFortressStage";
import KingdomOfGemsStage from "./KingdomOfGemsStage";
import type { CastleStageProps } from "./types";

export interface CastleStage {
  id: string;
  name: string;
  threshold: number;
  Component: (props: CastleStageProps) => JSX.Element;
}

const WATCHTOWER: CastleStage = { id: "watchtower", name: "Watchtower", threshold: 0, Component: WatchtowerStage };
const KNIGHTS_KEEP: CastleStage = { id: "knights-keep", name: "Knight's Keep", threshold: 25, Component: KnightsKeepStage };
const RISING_CASTLE: CastleStage = { id: "rising-castle", name: "Rising Castle", threshold: 75, Component: RisingCastleStage };
const GRAND_FORTRESS: CastleStage = { id: "grand-fortress", name: "Grand Fortress", threshold: 150, Component: GrandFortressStage };
const KINGDOM_OF_GEMS: CastleStage = { id: "kingdom-of-gems", name: "Kingdom of Gems", threshold: 300, Component: KingdomOfGemsStage };

// Ascending by threshold — CASTLE_STAGES[0] must always be the zero-threshold
// stage so getCastleProgress always has a match.
export const CASTLE_STAGES: readonly CastleStage[] = [WATCHTOWER, KNIGHTS_KEEP, RISING_CASTLE, GRAND_FORTRESS, KINGDOM_OF_GEMS];

export interface CastleProgress {
  stage: CastleStage;
  stageIndex: number;
  nextStage: CastleStage | null;
  gemsToNextStage: number | null;
  progressFraction: number;
}

export function getCastleProgress(totalGems: number): CastleProgress {
  let stage: CastleStage = WATCHTOWER;
  let stageIndex = 0;

  CASTLE_STAGES.forEach((candidate, index) => {
    if (totalGems >= candidate.threshold) {
      stage = candidate;
      stageIndex = index;
    }
  });

  const nextStage = CASTLE_STAGES[stageIndex + 1] ?? null;
  const gemsToNextStage = nextStage ? nextStage.threshold - totalGems : null;
  const progressFraction = nextStage
    ? (totalGems - stage.threshold) / (nextStage.threshold - stage.threshold)
    : 1;

  return { stage, stageIndex, nextStage, gemsToNextStage, progressFraction };
}

export { pickStageLine, CASTLE_STAGE_LINES } from "./residentLines";
export type { CastleStageProps };
