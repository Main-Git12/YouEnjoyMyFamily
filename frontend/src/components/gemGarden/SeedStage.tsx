import type { GardenStageProps } from "./types";

// Original illustration — a first gem barely peeking out of the soil.
export default function SeedStage({ size = 120, className = "" }: GardenStageProps) {
  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="A tiny seed just starting to sprout, with one small gem beside it"
    >
      <ellipse cx="80" cy="128" rx="46" ry="10" fill="var(--color-clay-300)" opacity="0.5" />
      <path d="M40 130 Q80 116 120 130 L120 140 Q80 128 40 140 Z" fill="var(--color-clay-500)" />

      <path d="M80 118 Q77 104 84 96" stroke="var(--color-olive-500)" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M84 96 Q92 92 98 98 Q90 100 84 96Z" fill="var(--color-olive-400)" />

      <circle cx="104" cy="122" r="7" fill="var(--color-gem-amber)" />
      <path d="M104 115 L109 122 L104 129 L99 122 Z" fill="var(--color-gem-amber)" opacity="0.6" />
    </svg>
  );
}
