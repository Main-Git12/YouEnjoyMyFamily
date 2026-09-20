import Knight from "../mascots/Knight";
import Princess from "../mascots/Princess";
import type { CastleStageProps } from "./types";

// Original illustration — the keep has grown into a small castle with two
// towers, and Wren has joined Sir Olive at the gate.
export default function RisingCastleStage({ size = 120, className = "" }: CastleStageProps) {
  return (
    <div className={`relative inline-block ${className}`} style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 160 160"
        width={size}
        height={size}
        className="absolute inset-0"
        role="img"
        aria-label="A rising castle with two towers, guarded by a knight and a princess"
      >
        <ellipse cx="80" cy="148" rx="62" ry="9" fill="var(--color-clay-300)" opacity="0.5" />

        <rect x="20" y="106" width="120" height="40" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="3" />
        {[26, 44, 62, 80, 98, 116, 132].map((x) => (
          <rect key={x} x={x} y="98" width="10" height="10" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="2" />
        ))}

        <rect x="24" y="70" width="32" height="76" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="3" />
        <path d="M20 70 L40 50 L60 70 Z" fill="var(--color-clay-700)" />
        <rect x="104" y="70" width="32" height="76" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="3" />
        <path d="M100 70 L120 50 L140 70 Z" fill="var(--color-clay-700)" />

        <path d="M64 146 L64 118 L96 118 L96 146 Z" fill="var(--color-clay-700)" opacity="0.9" />
        <rect x="70" y="122" width="20" height="24" fill="var(--color-bark)" opacity="0.7" />

        <path d="M40 50 L40 34" stroke="var(--color-clay-700)" strokeWidth="3" strokeLinecap="round" />
        <path d="M40 34 L56 40 L40 46 Z" fill="var(--color-olive-500)" />
        <path d="M120 50 L120 34" stroke="var(--color-clay-700)" strokeWidth="3" strokeLinecap="round" />
        <path d="M120 34 L136 40 L120 46 Z" fill="var(--color-gem-ruby)" />
      </svg>

      <div aria-hidden="true" className="absolute" style={{ left: "0%", bottom: "0%", width: "28%" }}>
        <Knight size={size * 0.28} />
      </div>
      <div aria-hidden="true" className="absolute" style={{ right: "0%", bottom: "0%", width: "28%" }}>
        <Princess size={size * 0.28} />
      </div>
    </div>
  );
}
