import type { GardenStageProps } from "./types";

// Original illustration — a two-leaf sprout with a couple of gems taking root.
export default function SproutStage({ size = 120, className = "" }: GardenStageProps) {
  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="A small two-leaf sprout with a couple of gems at its base"
    >
      <ellipse cx="80" cy="128" rx="50" ry="10" fill="var(--color-clay-300)" opacity="0.5" />
      <path d="M36 130 Q80 114 124 130 L124 142 Q80 128 36 142 Z" fill="var(--color-clay-500)" />

      <path d="M80 128 Q78 104 80 88" stroke="var(--color-olive-500)" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M80 104 Q64 96 60 108 Q72 112 80 104 Z" fill="var(--color-olive-400)" />
      <path d="M80 96 Q98 90 100 102 Q86 104 80 96 Z" fill="var(--color-olive-500)" />

      <circle cx="56" cy="124" r="7" fill="var(--color-gem-emerald)" />
      <circle cx="102" cy="126" r="6" fill="var(--color-gem-amber)" />
    </svg>
  );
}
