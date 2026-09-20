import type { MascotProps } from "./types";

/**
 * Original character — sand/olive gown, warm-brown braid, and a wildflower
 * crown (leaf + berry shapes) rather than a jeweled tiara, to keep the
 * design tied to this app's earthy/boho theme instead of echoing any
 * existing princess character.
 */
export default function Princess({ size = 96, className = "" }: MascotProps) {
  return (
    <svg
      viewBox="0 0 120 140"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="A cheerful princess mascot celebrating"
    >
      {/* gown */}
      <path
        d="M40 132 Q36 90 48 74 L72 74 Q84 90 80 132 Z"
        fill="var(--color-sand-100)"
        stroke="var(--color-olive-700)"
        strokeWidth="3"
      />
      <path d="M50 90 Q60 84 70 90 L74 132 L46 132 Z" fill="var(--color-olive-500)" opacity="0.55" />

      {/* raised arms, celebrating */}
      <path d="M46 82 Q28 74 26 56" stroke="var(--color-sand-100)" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M74 82 Q92 74 94 56" stroke="var(--color-sand-100)" strokeWidth="10" strokeLinecap="round" fill="none" />
      <circle cx="94" cy="53" r="6" fill="var(--color-gem-amber)" />

      {/* braid */}
      <path
        d="M74 44 Q86 56 78 74"
        stroke="var(--color-clay-700)"
        strokeWidth="9"
        strokeLinecap="round"
        fill="none"
      />

      {/* head */}
      <circle cx="60" cy="42" r="24" fill="var(--color-clay-100)" stroke="var(--color-olive-900)" strokeWidth="3" />
      {/* hair */}
      <path d="M36 40 Q34 14 60 14 Q86 14 84 40 Q78 24 60 24 Q42 24 36 40 Z" fill="var(--color-clay-700)" />

      {/* wildflower crown */}
      <path d="M40 22 Q60 8 80 22" stroke="var(--color-olive-500)" strokeWidth="4" fill="none" strokeLinecap="round" />
      <circle cx="46" cy="19" r="4" fill="var(--color-gem-ruby)" />
      <circle cx="60" cy="14" r="4.5" fill="var(--color-gem-amber)" />
      <circle cx="74" cy="19" r="4" fill="var(--color-gem-ruby)" />

      {/* face */}
      <circle cx="52" cy="44" r="3.5" fill="var(--color-olive-900)" />
      <circle cx="68" cy="44" r="3.5" fill="var(--color-olive-900)" />
      <path d="M52 54 Q60 60 68 54" stroke="var(--color-olive-900)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}
