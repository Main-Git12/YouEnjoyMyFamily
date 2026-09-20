import { getGardenProgress } from "./gemGarden";

interface GemGardenProps {
  totalGems: number;
}

// Grows through stages as the family's total gems climb — a visual "watch it
// grow" payoff instead of a plain counter. Stage art lives in ./gemGarden/.
export default function GemGarden({ totalGems }: GemGardenProps) {
  const { stage, nextStage, gemsToNextStage, progressFraction } = getGardenProgress(totalGems);
  const Stage = stage.Component;

  return (
    <div className="text-center">
      <Stage size={140} className="mx-auto" />
      <p className="font-display text-xl text-olive-700 mt-2">{stage.name}</p>
      <p className="text-olive-600 mb-3">{totalGems} gems in the garden</p>

      {nextStage ? (
        <>
          <div
            role="progressbar"
            aria-valuenow={Math.round(progressFraction * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progress toward ${nextStage.name}`}
            className="h-3 w-full rounded-full bg-olive-100 overflow-hidden"
          >
            <div
              className="h-full rounded-full bg-olive-500 transition-[width]"
              style={{ width: `${Math.min(100, Math.max(0, progressFraction * 100))}%` }}
            />
          </div>
          <p className="text-sm text-olive-600 mt-2">
            {gemsToNextStage} more gem{gemsToNextStage === 1 ? "" : "s"} to reach {nextStage.name}!
          </p>
        </>
      ) : (
        <p className="text-sm text-clay-700 font-semibold">Full bloom! The garden is as lush as it gets.</p>
      )}
    </div>
  );
}
