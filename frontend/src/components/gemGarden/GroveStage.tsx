import type { GardenStageProps } from "./types";

// Original illustration — a lush, sparkling grove: the top of the garden.
export default function GroveStage({ size = 120, className = "" }: GardenStageProps) {
  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="A lush, sparkling grove full of gems — the top of the garden"
    >
      <ellipse cx="80" cy="148" rx="62" ry="10" fill="var(--color-clay-300)" opacity="0.5" />

      {/* a smaller companion tree, tucked behind, for a "grove" feel */}
      <path d="M32 148 L34 118" stroke="var(--color-clay-700)" strokeWidth="6" strokeLinecap="round" opacity="0.7" />
      <circle cx="34" cy="106" r="16" fill="var(--color-olive-300)" opacity="0.7" />
      <path d="M132 148 L130 122" stroke="var(--color-clay-700)" strokeWidth="6" strokeLinecap="round" opacity="0.7" />
      <circle cx="130" cy="112" r="14" fill="var(--color-olive-300)" opacity="0.7" />

      <path d="M80 148 L75 78" stroke="var(--color-clay-700)" strokeWidth="12" strokeLinecap="round" />
      <path d="M77 104 L48 90" stroke="var(--color-clay-700)" strokeWidth="7" strokeLinecap="round" />
      <path d="M77 96 L108 84" stroke="var(--color-clay-700)" strokeWidth="7" strokeLinecap="round" />

      <circle cx="76" cy="50" r="36" fill="var(--color-olive-400)" />
      <circle cx="40" cy="70" r="24" fill="var(--color-olive-500)" />
      <circle cx="114" cy="70" r="24" fill="var(--color-olive-500)" />
      <circle cx="76" cy="84" r="22" fill="var(--color-olive-400)" />

      <circle cx="54" cy="48" r="7" fill="var(--color-gem-ruby)" />
      <circle cx="96" cy="42" r="7" fill="var(--color-gem-amber)" />
      <circle cx="36" cy="74" r="6" fill="var(--color-gem-emerald)" />
      <circle cx="118" cy="76" r="6" fill="var(--color-gem-sapphire)" />
      <circle cx="76" cy="90" r="7" fill="var(--color-gem-amber)" />
      <circle cx="94" cy="70" r="6" fill="var(--color-gem-ruby)" />
      <circle cx="58" cy="76" r="6" fill="var(--color-gem-sapphire)" />
      <circle cx="76" cy="60" r="6" fill="var(--color-gem-emerald)" />

      <path d="M30 40 L34 48 L42 50 L34 52 L30 60 L26 52 L18 50 L26 48 Z" fill="var(--color-sand-100)" />
      <path d="M126 34 L129 40 L135 42 L129 44 L126 50 L123 44 L117 42 L123 40 Z" fill="var(--color-sand-100)" />
      <path d="M78 12 L81 18 L87 20 L81 22 L78 28 L75 22 L69 20 L75 18 Z" fill="var(--color-gem-amber)" />
    </svg>
  );
}
