import type { MascotProps } from "./types";

/**
 * Original character — round, plush-toy-style dragon (terracotta/clay body,
 * olive belly). Sits and "breathes" a small puff of gem sparkles instead of
 * fire, tying it to the reward theme rather than any existing dragon
 * character's design or pose.
 */
export default function Dragon({ size = 96, className = "" }: MascotProps) {
  return (
    <svg
      viewBox="0 0 120 140"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="A cheerful dragon mascot celebrating"
    >
      {/* tail, curled */}
      <path
        d="M84 108 Q104 108 100 90 Q98 80 86 84"
        stroke="var(--color-clay-500)"
        strokeWidth="10"
        strokeLinecap="round"
        fill="none"
      />

      {/* wings */}
      <path d="M36 76 Q18 66 22 48 Q34 56 42 72 Z" fill="var(--color-clay-300)" stroke="var(--color-clay-700)" strokeWidth="2" />
      <path d="M84 76 Q102 66 98 48 Q86 56 78 72 Z" fill="var(--color-clay-300)" stroke="var(--color-clay-700)" strokeWidth="2" />

      {/* body */}
      <ellipse cx="60" cy="90" rx="30" ry="26" fill="var(--color-clay-500)" stroke="var(--color-olive-900)" strokeWidth="3" />
      <ellipse cx="60" cy="98" rx="16" ry="13" fill="var(--color-olive-300)" />

      {/* legs */}
      <rect x="42" y="110" width="10" height="10" rx="4" fill="var(--color-clay-700)" />
      <rect x="68" y="110" width="10" height="10" rx="4" fill="var(--color-clay-700)" />

      {/* head */}
      <circle cx="60" cy="48" r="24" fill="var(--color-clay-500)" stroke="var(--color-olive-900)" strokeWidth="3" />
      {/* horns */}
      <path d="M46 30 L42 18 L52 26 Z" fill="var(--color-sand-100)" />
      <path d="M74 30 L78 18 L68 26 Z" fill="var(--color-sand-100)" />
      {/* eyes */}
      <circle cx="51" cy="46" r="4" fill="var(--color-olive-900)" />
      <circle cx="69" cy="46" r="4" fill="var(--color-olive-900)" />
      {/* smile + tooth */}
      <path d="M50 58 Q60 64 70 58" stroke="var(--color-olive-900)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M58 60 L58 65 L62 60 Z" fill="#ffffff" />

      {/* celebration sparkle puff instead of fire breath */}
      <g fill="var(--color-gem-amber)">
        <circle cx="94" cy="42" r="3" />
        <circle cx="102" cy="30" r="2" />
        <circle cx="88" cy="26" r="2.2" />
      </g>
    </svg>
  );
}
