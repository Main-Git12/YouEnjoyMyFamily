import Knight from "../mascots/Knight";
import type { CastleStageProps } from "./types";

// Original illustration — a small keep with its first resident: Sir Olive
// standing guard at the gate.
export default function KnightsKeepStage({ size = 120, className = "" }: CastleStageProps) {
  return (
    <div className={`relative inline-block ${className}`} style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 160 160"
        width={size}
        height={size}
        className="absolute inset-0"
        role="img"
        aria-label="A small keep with a knight standing guard at the gate"
      >
        <ellipse cx="80" cy="146" rx="56" ry="9" fill="var(--color-clay-300)" opacity="0.5" />

        <rect x="30" y="108" width="100" height="38" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="3" />
        {[36, 54, 72, 90, 108, 122].map((x) => (
          <rect key={x} x={x} y="100" width="10" height="10" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="2" />
        ))}

        <rect x="58" y="58" width="44" height="88" rx="3" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="3" />
        <path d="M54 58 L80 32 L106 58 Z" fill="var(--color-clay-700)" />
        <rect x="70" y="116" width="20" height="30" fill="var(--color-bark)" opacity="0.7" />

        <path d="M80 32 L80 16" stroke="var(--color-clay-700)" strokeWidth="3" strokeLinecap="round" />
        <path d="M80 16 L98 22 L80 28 Z" fill="var(--color-olive-500)" />
      </svg>

      <div aria-hidden="true" className="absolute" style={{ left: "2%", bottom: "0%", width: "34%" }}>
        <Knight size={size * 0.34} />
      </div>
    </div>
  );
}
