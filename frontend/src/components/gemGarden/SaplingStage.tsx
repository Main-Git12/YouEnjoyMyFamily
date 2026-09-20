import type { GardenStageProps } from "./types";

// Original illustration — a young sapling with its first few gem "fruits".
export default function SaplingStage({ size = 120, className = "" }: GardenStageProps) {
  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="A young sapling with a few gems growing among its leaves"
    >
      <ellipse cx="80" cy="140" rx="54" ry="10" fill="var(--color-clay-300)" opacity="0.5" />

      <path d="M80 140 L78 92" stroke="var(--color-clay-700)" strokeWidth="8" strokeLinecap="round" />

      <circle cx="80" cy="76" r="30" fill="var(--color-olive-400)" />
      <circle cx="56" cy="88" r="18" fill="var(--color-olive-500)" />
      <circle cx="104" cy="88" r="18" fill="var(--color-olive-500)" />

      <circle cx="64" cy="76" r="7" fill="var(--color-gem-ruby)" />
      <circle cx="94" cy="70" r="7" fill="var(--color-gem-amber)" />
      <circle cx="82" cy="96" r="7" fill="var(--color-gem-emerald)" />
    </svg>
  );
}
