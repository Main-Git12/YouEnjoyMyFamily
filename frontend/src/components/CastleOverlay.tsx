import GemCastle from "./GemCastle";
import { useDismissableOverlay } from "../lib/useDismissableOverlay";

interface CastleOverlayProps {
  totalGems: number;
  onDismiss: () => void;
}

/**
 * The castle, on request.
 *
 * It was a full cell of the dashboard whose content was a picture and a
 * number already printed in the header two inches above it. The picture
 * is the point — children look at it — but it does not need to be on
 * screen while someone is trying to find out what's for dinner. Tapping
 * the gem total opens it.
 */
export default function CastleOverlay({ totalGems, onDismiss }: CastleOverlayProps) {
  const containerRef = useDismissableOverlay<HTMLDivElement>(onDismiss);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="The Gem Castle"
      className="fixed inset-0 z-40 flex items-center justify-center bg-olive-900/70 p-4"
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        className="bg-white rounded-card shadow-[var(--shadow-card)] px-6 sm:px-10 py-8 text-center max-w-lg w-full animate-pop-in"
      >
        <GemCastle totalGems={totalGems} />
        <button
          type="button"
          onClick={onDismiss}
          className="mt-5 font-display bg-olive-600 text-white rounded-full px-8 py-3"
        >
          Close
        </button>
      </div>
    </div>
  );
}
