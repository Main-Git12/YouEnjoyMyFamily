import Knight from "../mascots/Knight";
import Princess from "../mascots/Princess";
import Dragon from "../mascots/Dragon";
import type { CastleStageProps } from "./types";

// Original illustration — a full fortress with three towers. Ember the
// dragon has been tamed and now perches on the tallest tower as a guardian,
// alongside Sir Olive and Wren at the gate.
export default function GrandFortressStage({ size = 120, className = "" }: CastleStageProps) {
  return (
    <div className={`relative inline-block ${className}`} style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 160 160"
        width={size}
        height={size}
        className="absolute inset-0"
        role="img"
        aria-label="A grand fortress with three towers, a knight, a princess, and a friendly dragon perched on top"
      >
        <ellipse cx="80" cy="150" rx="68" ry="9" fill="var(--color-clay-300)" opacity="0.5" />

        <rect x="14" y="108" width="132" height="42" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="3" />
        {[20, 38, 56, 74, 92, 110, 128, 140].map((x) => (
          <rect key={x} x={x} y="100" width="9" height="9" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="2" />
        ))}

        <rect x="18" y="76" width="30" height="74" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="3" />
        <path d="M14 76 L33 58 L52 76 Z" fill="var(--color-clay-700)" />
        <rect x="112" y="76" width="30" height="74" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="3" />
        <path d="M108 76 L127 58 L146 76 Z" fill="var(--color-clay-700)" />

        <rect x="58" y="46" width="44" height="104" fill="var(--color-sand-100)" stroke="var(--color-clay-700)" strokeWidth="3" />
        <path d="M54 46 L80 22 L106 46 Z" fill="var(--color-clay-700)" />
        <rect x="70" y="122" width="20" height="28" fill="var(--color-bark)" opacity="0.7" />
        <rect x="68" y="90" width="24" height="14" rx="2" fill="var(--color-bark)" opacity="0.5" />

        <path d="M33 58 L33 42" stroke="var(--color-clay-700)" strokeWidth="3" strokeLinecap="round" />
        <path d="M33 42 L49 48 L33 54 Z" fill="var(--color-olive-500)" />
        <path d="M127 58 L127 42" stroke="var(--color-clay-700)" strokeWidth="3" strokeLinecap="round" />
        <path d="M127 42 L143 48 L127 54 Z" fill="var(--color-gem-ruby)" />
      </svg>

      <div aria-hidden="true" className="absolute" style={{ left: "0%", bottom: "0%", width: "26%" }}>
        <Knight size={size * 0.26} />
      </div>
      <div aria-hidden="true" className="absolute" style={{ right: "0%", bottom: "0%", width: "26%" }}>
        <Princess size={size * 0.26} />
      </div>
      <div aria-hidden="true" className="absolute" style={{ left: "36%", top: "0%", width: "30%" }}>
        <Dragon size={size * 0.3} />
      </div>
    </div>
  );
}
