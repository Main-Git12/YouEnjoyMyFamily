/**
 * The app's icons, drawn rather than typed.
 *
 * These panels used to label themselves with emoji — 📅, 🎒, 🔥. That is
 * fine in a document and wrong on a kitchen wall for three reasons. Emoji
 * are a *font*, so they render as whatever the device happens to ship and
 * change shape between an Echo Show, an iPhone and a laptop; several land
 * as a grey box or a tofu square where the font is missing, which is what
 * they do in a bare Chromium. They arrive in somebody else's palette —
 * bright reds and blues that fight an olive and clay screen. And they carry
 * no weight control, so at two metres they are either too small to read or
 * cartoonishly large.
 *
 * So they are line drawings in the same hand as the house mark: a 24-unit
 * box, round caps and joins, stroke width 1.75, and `currentColor`
 * throughout — which means one class on the parent restyles the whole set,
 * and a single icon can never drift out of the palette.
 *
 * Every one is decorative: the text beside it always says the same thing,
 * so they carry `aria-hidden` and add nothing for a screen reader to read
 * twice.
 */

export interface IconProps {
  /** Rendered size in pixels. The stroke is scaled to stay even. */
  size?: number;
  className?: string;
}

function Frame({ size = 24, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

/** A day with something on it. */
export const CalendarIcon = (props: IconProps) => (
  <Frame {...props}>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <path d="M8 14.5h3" />
  </Frame>
);

/** School: the bag the thing has to go in. */
export const SchoolBagIcon = (props: IconProps) => (
  <Frame {...props}>
    <path d="M5 11a7 7 0 0 1 14 0v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" />
    <path d="M9 11V8a3 3 0 0 1 6 0v3" />
    <path d="M9.5 15.5h5" />
  </Frame>
);

/** A meal that is planned, or isn't. */
export const PlateIcon = (props: IconProps) => (
  <Frame {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
  </Frame>
);

/** Time against a deadline. */
export const StopwatchIcon = (props: IconProps) => (
  <Frame {...props}>
    <circle cx="12" cy="13.5" r="7.5" />
    <path d="M12 9.5v4l2.5 2M9.5 2.5h5M19 7l1.5-1.5" />
  </Frame>
);

/** A run of days somebody earned. */
export const StreakIcon = (props: IconProps) => (
  <Frame {...props}>
    <path d="M12 3c.5 3-1.5 4-3 6a5.5 5.5 0 0 0-1.5 3.8 6.5 6.5 0 0 0 13 0c0-2-1-3.6-2.5-5 0 1.2-.8 2-1.7 2C14.6 8 15 4.8 12 3Z" />
    <path d="M12 20a3 3 0 0 1-1.2-5.6c.6 1 1.6 1.2 2 .3.6.8 1.2 1.6 1.2 2.6A2.8 2.8 0 0 1 12 20Z" />
  </Frame>
);

/** Something the app has noticed and is opening as a question. */
export const NoticedIcon = (props: IconProps) => (
  <Frame {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2-2.5 3.6" />
    <path d="M12 17.5h.01" />
  </Frame>
);

/** The shopping list. */
export const CartIcon = (props: IconProps) => (
  <Frame {...props}>
    <path d="M3 4h2l2.5 11h10L20 7H6" />
    <circle cx="9" cy="19" r="1.4" />
    <circle cx="17" cy="19" r="1.4" />
  </Frame>
);

/** Night, and the night before. */
export const MoonIcon = (props: IconProps) => (
  <Frame {...props}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </Frame>
);

/** What the weather means at a front door, rather than the weather itself. */
export const CoatIcon = (props: IconProps) => (
  <Frame {...props}>
    <path d="M12 3 7 5l-2.5 6L7 12v8h10v-8l2.5-1L17 5Z" />
    <path d="M12 3v8" />
  </Frame>
);
