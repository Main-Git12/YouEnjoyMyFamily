import type { MascotProps } from "./types";

/**
 * Original character — round "chibi" proportions, bronze/olive armor with a
 * leaf-emblem shield (not a franchise cross or crest). No resemblance to any
 * existing knight character is intended; keep new mascots in this same
 * silhouette family (big head, small body, celebratory pose) rather than
 * reaching for a real IP's design.
 */
export default function Knight({ size = 96, className = "" }: MascotProps) {
  return (
    <svg
      viewBox="0 0 120 140"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="A cheerful knight mascot celebrating"
    >
      {/* shield, held out to the left */}
      <ellipse cx="26" cy="86" rx="16" ry="20" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="3" />
      <path d="M26 72 L34 82 L26 100 L18 82 Z" fill="var(--color-olive-500)" />

      {/* body */}
      <rect x="42" y="70" width="40" height="38" rx="14" fill="var(--color-clay-500)" stroke="var(--color-olive-900)" strokeWidth="3" />
      {/* raised arm, celebrating */}
      <path
        d="M78 78 Q94 66 90 50"
        stroke="var(--color-clay-500)"
        strokeWidth="12"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="90" cy="48" r="7" fill="var(--color-clay-300)" />

      {/* boots */}
      <rect x="46" y="104" width="12" height="12" rx="4" fill="var(--color-olive-800)" />
      <rect x="66" y="104" width="12" height="12" rx="4" fill="var(--color-olive-800)" />

      {/* helmet */}
      <circle cx="60" cy="46" r="26" fill="var(--color-olive-500)" stroke="var(--color-olive-900)" strokeWidth="3" />
      <rect x="48" y="42" width="24" height="8" rx="3" fill="var(--color-olive-900)" />
      {/* plume */}
      <path d="M60 20 Q66 4 76 10 Q68 16 66 26 Z" fill="var(--color-sand-100)" />

      {/* smile under the visor */}
      <path d="M52 56 Q60 62 68 56" stroke="var(--color-olive-900)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}
