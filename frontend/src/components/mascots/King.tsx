import type { MascotProps } from "./types";

/**
 * Original character — King Cedric, the kingdom's warm, slightly round
 * ruler. Deliberately drawn in the same plush-toy style as Sir Olive and
 * Wren: soft shapes, big friendly eyes, no sharp edges. He turns up to
 * hand out gems and to thank the children by name.
 */
export default function King({ size = 96, className = "" }: MascotProps) {
  return (
    <svg
      viewBox="0 0 120 140"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="King Cedric, the kingdom's king"
    >
      {/* cloak */}
      <path d="M32 96 Q60 84 88 96 L94 134 L26 134 Z" fill="var(--color-clay-500)" stroke="var(--color-olive-900)" strokeWidth="3" />
      <path d="M52 92 L60 134 L68 92 Z" fill="var(--color-sand-100)" opacity="0.85" />

      {/* body */}
      <ellipse cx="60" cy="100" rx="24" ry="20" fill="var(--color-olive-500)" stroke="var(--color-olive-900)" strokeWidth="3" />

      {/* head */}
      <circle cx="60" cy="62" r="24" fill="var(--color-sand-100)" stroke="var(--color-olive-900)" strokeWidth="3" />

      {/* beard */}
      <path d="M42 68 Q60 96 78 68 Q72 84 60 86 Q48 84 42 68 Z" fill="#ffffff" stroke="var(--color-olive-900)" strokeWidth="2" />

      {/* eyes + smile */}
      <circle cx="52" cy="58" r="3.4" fill="var(--color-olive-900)" />
      <circle cx="68" cy="58" r="3.4" fill="var(--color-olive-900)" />
      <path d="M52 70 Q60 76 68 70" stroke="var(--color-olive-900)" strokeWidth="2.5" fill="none" strokeLinecap="round" />

      {/* crown */}
      <path d="M38 40 L44 22 L52 34 L60 18 L68 34 L76 22 L82 40 Z" fill="var(--color-gem-amber)" stroke="var(--color-clay-700)" strokeWidth="2.5" />
      <circle cx="60" cy="27" r="3" fill="var(--color-gem-ruby)" />
      <circle cx="45" cy="31" r="2.4" fill="var(--color-gem-emerald)" />
      <circle cx="75" cy="31" r="2.4" fill="var(--color-gem-sapphire)" />
      <rect x="38" y="40" width="44" height="6" rx="3" fill="var(--color-clay-700)" />
    </svg>
  );
}
