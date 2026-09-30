import type { CastleStageProps } from "./types";

// Original illustration — a single quiet watchtower, waiting for its first
// resident. No mascots yet at this stage.
export default function WatchtowerStage({ size = 120, className = "" }: CastleStageProps) {
  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="A small, quiet watchtower with no one home yet"
    >
      <ellipse cx="80" cy="142" rx="46" ry="9" fill="var(--color-clay-300)" opacity="0.5" />

      <rect x="62" y="66" width="36" height="76" rx="3" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="3" />
      <path d="M58 66 L80 40 L102 66 Z" fill="var(--color-clay-700)" />
      <rect x="72" y="96" width="16" height="20" fill="var(--color-bark)" opacity="0.7" />
      <rect x="70" y="78" width="20" height="10" rx="2" fill="var(--color-bark)" opacity="0.5" />

      <path d="M80 40 L80 24" stroke="var(--color-clay-700)" strokeWidth="3" strokeLinecap="round" />
      <path d="M80 24 L96 30 L80 36 Z" fill="var(--color-olive-500)" />
    </svg>
  );
}
