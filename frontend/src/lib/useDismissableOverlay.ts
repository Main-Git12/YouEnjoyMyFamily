import { useEffect, useRef } from "react";

/**
 * Shared behaviour for the full-screen overlays: Escape closes them, and
 * focus goes into the overlay and comes back where it was afterwards.
 *
 * Both matter on the Echo Show as much as on a laptop — an overlay that
 * swallows the screen while the keyboard focus is still behind it leaves
 * anyone not using the touchscreen tabbing through a page they can't see.
 */
export function useDismissableOverlay<T extends HTMLElement>(onDismiss: () => void, active = true) {
  const containerRef = useRef<T | null>(null);
  // Held in a ref so a re-rendered onDismiss doesn't re-run the effect and
  // yank focus back into the overlay mid-interaction.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!active) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    // The first thing someone can act on, rather than the box itself, so a
    // keyboard user lands on the button rather than having to hunt for it.
    const firstAction = containerRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    (firstAction ?? containerRef.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismissRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Only if nothing else has claimed focus in the meantime — snatching it
      // back would undo whatever the dismissal itself moved focus to.
      if (!document.activeElement || document.activeElement === document.body) {
        previouslyFocused?.focus();
      }
    };
  }, [active]);

  return containerRef;
}
