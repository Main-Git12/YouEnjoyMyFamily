import type { ReactNode } from "react";

export type CardSize = "hero" | "default" | "compact";

interface FamilyCardProps {
  title: string;
  children: ReactNode;
  /** The olive card — used sparingly, for the one panel that should stand out. */
  accent?: boolean;
  /**
   * How much weight this panel carries where it currently sits.
   *
   * `hero` is the one the screen is for; `compact` is a panel in the rail
   * or the drawer, where the heading is a label rather than a headline.
   */
  size?: CardSize;
  /** A word or two under the heading — a count, a time, a state. */
  subtitle?: string;
  /**
   * Placement, supplied by whatever is laying the screen out.
   *
   * The card deliberately does not choose its own span any more. It cannot
   * see the grid it is in, and having it guess is what made the old
   * eight-cell layout impossible to restructure.
   */
  className?: string;
}

const SIZE_STYLES: Record<CardSize, { box: string; heading: string }> = {
  hero: { box: "p-5 sm:p-6 lg:p-7", heading: "font-display text-2xl sm:text-3xl text-olive-700 mb-3" },
  default: { box: "p-5 sm:p-6", heading: "font-display text-xl mb-3" },
  compact: { box: "p-3 sm:p-4", heading: "font-display text-base sm:text-lg mb-2" },
};

export default function FamilyCard({
  title,
  children,
  accent = false,
  size = "default",
  subtitle,
  className = "",
}: FamilyCardProps) {
  const styles = SIZE_STYLES[size];
  return (
    <section
      className={`rounded-card shadow-[var(--shadow-card)] ${styles.box} ${
        accent ? "bg-olive-600 text-white" : "bg-white border-2 border-olive-100 text-bark"
      } ${className}`}
    >
      <div className={styles.heading}>
        <h2 className={accent ? "" : "text-olive-700"}>{title}</h2>
        {subtitle && (
          <p className={`font-body text-sm ${accent ? "text-olive-50" : "text-olive-600"}`}>{subtitle}</p>
        )}
      </div>
      {children}
    </section>
  );
}
