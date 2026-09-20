import type { GardenStageProps } from "./types";

// Original illustration — a fuller, blooming tree heavy with gems.
export default function TreeStage({ size = 120, className = "" }: GardenStageProps) {
  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="A blooming tree with several gems and a couple of flowers"
    >
      <ellipse cx="80" cy="146" rx="58" ry="10" fill="var(--color-clay-300)" opacity="0.5" />

      <path d="M80 146 L76 84" stroke="var(--color-clay-700)" strokeWidth="11" strokeLinecap="round" />
      <path d="M78 108 L52 96" stroke="var(--color-clay-700)" strokeWidth="7" strokeLinecap="round" />
      <path d="M78 100 L104 90" stroke="var(--color-clay-700)" strokeWidth="7" strokeLinecap="round" />

      <circle cx="78" cy="58" r="34" fill="var(--color-olive-400)" />
      <circle cx="46" cy="76" r="22" fill="var(--color-olive-500)" />
      <circle cx="112" cy="76" r="22" fill="var(--color-olive-500)" />
      <circle cx="78" cy="88" r="20" fill="var(--color-olive-400)" />

      <circle cx="58" cy="56" r="7" fill="var(--color-gem-ruby)" />
      <circle cx="98" cy="50" r="7" fill="var(--color-gem-amber)" />
      <circle cx="42" cy="80" r="6" fill="var(--color-gem-emerald)" />
      <circle cx="114" cy="82" r="6" fill="var(--color-gem-sapphire)" />
      <circle cx="78" cy="94" r="7" fill="var(--color-gem-amber)" />

      <path d="M36 56 L40 64 L48 66 L40 68 L36 76 L32 68 L24 66 L32 64 Z" fill="var(--color-sand-100)" />
      <path d="M126 60 L129 66 L135 68 L129 70 L126 76 L123 70 L117 68 L123 66 Z" fill="var(--color-sand-100)" />
    </svg>
  );
}
