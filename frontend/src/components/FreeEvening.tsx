import type { SomethingTogether } from "../lib/roomToBreathe";

interface FreeEveningProps {
  /** Null whenever there is nothing honest to say, which is most weeks. */
  idea: SomethingTogether | null;
}

/**
 * The one line on this screen that isn't about load.
 *
 * Everything else here is what has to happen and by when. A family can be
 * perfectly organised against all of it and still never notice that Thursday
 * is empty, because nothing on a planner is shaped to point at an empty
 * evening — a planner's whole job is to point at full ones.
 *
 * It offers exactly one thing, and only something a person in this house has
 * actually said out loud. No activity database, no recommender, nothing
 * about what other families do. It names the evening, quotes the person, and
 * stops: whether a Thursday is worth spending on a skate park is not
 * something a screen on a wall can know.
 */
export default function FreeEvening({ idea }: FreeEveningProps) {
  if (!idea) return null;

  return (
    <div className="rounded-lg bg-sand-50 px-3 py-2">
      <p className="text-olive-900">
        <span className="font-display">{idea.weekdayLabel} evening</span> has nothing on it.
      </p>
      <p className="text-olive-800 mt-1">&ldquo;{idea.statement}&rdquo;</p>
      <p className="text-xs text-olive-600">{idea.because}</p>
    </div>
  );
}
