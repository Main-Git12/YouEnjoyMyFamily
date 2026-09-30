import Knight from "../mascots/Knight";
import Princess from "../mascots/Princess";
import Dragon from "../mascots/Dragon";
import type { CastleStageProps } from "./types";

// Original illustration — the whole kingdom, gem-encrusted and sparkling,
// with Sir Olive, Wren, and Ember all home together.
export default function KingdomOfGemsStage({ size = 120, className = "" }: CastleStageProps) {
  return (
    <div className={`relative inline-block ${className}`} style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 160 160"
        width={size}
        height={size}
        className="absolute inset-0"
        role="img"
        aria-label="A grand, sparkling kingdom covered in gems, with a knight, a princess, and a dragon all at home"
      >
        <ellipse cx="80" cy="152" rx="72" ry="9" fill="var(--color-clay-300)" opacity="0.5" />

        <rect x="10" y="110" width="140" height="44" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="3" />
        {[16, 34, 52, 70, 88, 106, 124, 138].map((x) => (
          <rect key={x} x={x} y="102" width="9" height="9" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="2" />
        ))}
        <circle cx="24" cy="132" r="5" fill="var(--color-gem-amber)" />
        <circle cx="50" cy="132" r="5" fill="var(--color-gem-emerald)" />
        <circle cx="110" cy="132" r="5" fill="var(--color-gem-sapphire)" />
        <circle cx="136" cy="132" r="5" fill="var(--color-gem-ruby)" />

        <rect x="14" y="78" width="30" height="76" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="3" />
        <path d="M10 78 L29 60 L48 78 Z" fill="var(--color-clay-700)" />
        <rect x="116" y="78" width="30" height="76" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="3" />
        <path d="M112 78 L131 60 L150 78 Z" fill="var(--color-clay-700)" />

        <rect x="56" y="44" width="48" height="110" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="3" />
        <path d="M52 44 L80 18 L108 44 Z" fill="var(--color-clay-700)" />
        <rect x="70" y="128" width="20" height="26" fill="var(--color-bark)" opacity="0.7" />
        <rect x="68" y="88" width="24" height="14" rx="2" fill="var(--color-bark)" opacity="0.5" />

        <path d="M29 60 L29 44" stroke="var(--color-clay-700)" strokeWidth="3" strokeLinecap="round" />
        <path d="M29 44 L45 50 L29 56 Z" fill="var(--color-olive-500)" />
        <path d="M131 60 L131 44" stroke="var(--color-clay-700)" strokeWidth="3" strokeLinecap="round" />
        <path d="M131 44 L147 50 L131 56 Z" fill="var(--color-gem-ruby)" />
        <path d="M80 18 L80 4" stroke="var(--color-clay-700)" strokeWidth="3" strokeLinecap="round" />
        <path d="M80 4 L94 10 L80 16 Z" fill="var(--color-gem-amber)" />

        <path d="M18 30 L21 37 L28 39 L21 41 L18 48 L15 41 L8 39 L15 37 Z" fill="var(--color-sand-100)" />
        <path d="M142 26 L145 32 L151 34 L145 36 L142 42 L139 36 L133 34 L139 32 Z" fill="var(--color-sand-100)" />
      </svg>

      <div aria-hidden="true" className="absolute" style={{ left: "0%", bottom: "0%", width: "24%" }}>
        <Knight size={size * 0.24} />
      </div>
      <div aria-hidden="true" className="absolute" style={{ right: "0%", bottom: "0%", width: "24%" }}>
        <Princess size={size * 0.24} />
      </div>
      <div aria-hidden="true" className="absolute" style={{ left: "38%", top: "0%", width: "28%" }}>
        <Dragon size={size * 0.28} />
      </div>
    </div>
  );
}
