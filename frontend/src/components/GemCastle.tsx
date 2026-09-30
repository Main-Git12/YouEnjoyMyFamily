import { useState } from "react";
import { getCastleProgress, pickStageLine } from "./gemCastle";

interface GemCastleProps {
  totalGems: number;
}

// Grows through stages as the family's total gems climb, and gains new
// residents (Sir Olive, Wren, Ember) along the way — the same original
// mascots from the chore celebrations, now living somewhere permanent.
// Tapping the castle is pure fun: no gems spent, no backend call, just a
// flavor line from whoever's home. Stage art lives in ./gemCastle/.
export default function GemCastle({ totalGems }: GemCastleProps) {
  const { stage, nextStage, gemsToNextStage, progressFraction } = getCastleProgress(totalGems);
  const Stage = stage.Component;
  const [message, setMessage] = useState<string | null>(null);

  function handleVisit() {
    setMessage(pickStageLine(stage.id));
  }

  return (
    <div className="text-center">
      <button
        type="button"
        onClick={handleVisit}
        aria-label="Visit the castle"
        className="mx-auto block rounded-card hover:scale-105 active:scale-95 transition-transform"
      >
        <Stage size={140} />
      </button>
      <p className="font-display text-xl text-olive-700 mt-2">{stage.name}</p>
      <p className="text-olive-600 mb-3">{totalGems} gems in the kingdom</p>

      {message && <p className="text-sm text-clay-700 font-semibold italic mb-3">{message}</p>}

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
              className="h-full rounded-full bg-olive-600 transition-[width]"
              style={{ width: `${Math.min(100, Math.max(0, progressFraction * 100))}%` }}
            />
          </div>
          <p className="text-sm text-olive-600 mt-2">
            {gemsToNextStage} more gem{gemsToNextStage === 1 ? "" : "s"} to reach {nextStage.name}!
          </p>
        </>
      ) : (
        <p className="text-sm text-clay-700 font-semibold">The kingdom is complete — every hero has come home!</p>
      )}
    </div>
  );
}
