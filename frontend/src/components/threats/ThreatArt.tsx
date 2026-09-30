import type { ThreatId } from "../../lib/gemThreats";

interface ThreatArtProps {
  threatId: ThreatId;
  size?: number;
  className?: string;
}

// Original characters, drawn in the same soft plush-toy style as the
// mascots — mischievous rather than frightening. These turn up on a
// kitchen screen at bedtime, so nothing here should give a five-year-old
// second thoughts about the dark.

function Raccoon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="Rascal the Raccoon, reaching for the gems">
      <ellipse cx="60" cy="108" rx="34" ry="7" fill="var(--color-clay-300)" opacity="0.45" />
      {/* ringed tail */}
      <path d="M86 92 Q108 86 102 64" stroke="var(--color-olive-700)" strokeWidth="11" strokeLinecap="round" fill="none" />
      <path d="M99 78 Q106 74 104 66" stroke="var(--color-sand-100)" strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* body */}
      <ellipse cx="58" cy="82" rx="26" ry="22" fill="var(--color-olive-600)" stroke="var(--color-olive-900)" strokeWidth="3" />
      <ellipse cx="58" cy="88" rx="14" ry="12" fill="var(--color-sand-100)" />
      {/* head */}
      <circle cx="58" cy="48" r="22" fill="var(--color-olive-600)" stroke="var(--color-olive-900)" strokeWidth="3" />
      {/* ears */}
      <circle cx="42" cy="32" r="8" fill="var(--color-olive-700)" stroke="var(--color-olive-900)" strokeWidth="2" />
      <circle cx="74" cy="32" r="8" fill="var(--color-olive-700)" stroke="var(--color-olive-900)" strokeWidth="2" />
      {/* bandit mask */}
      <path d="M38 46 Q58 38 78 46 Q78 56 58 56 Q38 56 38 46 Z" fill="var(--color-olive-900)" opacity="0.85" />
      <circle cx="49" cy="48" r="3.6" fill="#ffffff" />
      <circle cx="67" cy="48" r="3.6" fill="#ffffff" />
      {/* snout */}
      <ellipse cx="58" cy="60" rx="9" ry="6" fill="var(--color-sand-100)" />
      <circle cx="58" cy="58" r="2.6" fill="var(--color-olive-900)" />
      {/* paw on the gem */}
      <circle cx="30" cy="86" r="7" fill="var(--color-olive-700)" stroke="var(--color-olive-900)" strokeWidth="2" />
      <path d="M22 96 L26 88 L30 96 L26 100 Z" fill="var(--color-gem-emerald)" />
    </svg>
  );
}

function Bandit({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="The Gem Bandit, creeping in with a sack">
      <ellipse cx="60" cy="110" rx="32" ry="6" fill="var(--color-clay-300)" opacity="0.45" />
      {/* sack slung over the shoulder */}
      <path d="M78 54 Q98 52 100 74 Q100 92 82 92 Q68 90 70 72 Z" fill="var(--color-clay-700)" stroke="var(--color-olive-900)" strokeWidth="2.5" />
      <path d="M78 54 L88 46 L94 56" stroke="var(--color-olive-900)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <circle cx="86" cy="74" r="3.2" fill="var(--color-gem-amber)" />
      <circle cx="93" cy="82" r="2.6" fill="var(--color-gem-sapphire)" />
      {/* body, hunched low */}
      <path d="M32 98 Q34 70 52 68 Q70 70 70 98 Z" fill="var(--color-olive-800)" stroke="var(--color-olive-900)" strokeWidth="3" />
      {/* head */}
      <circle cx="50" cy="50" r="20" fill="var(--color-sand-100)" stroke="var(--color-olive-900)" strokeWidth="3" />
      {/* cap + mask */}
      <path d="M30 44 Q50 26 70 44 Z" fill="var(--color-olive-800)" />
      <rect x="31" y="46" width="38" height="9" rx="4" fill="var(--color-olive-900)" opacity="0.88" />
      <circle cx="42" cy="50" r="3.2" fill="#ffffff" />
      <circle cx="58" cy="50" r="3.2" fill="#ffffff" />
      <path d="M42 62 Q50 66 58 62" stroke="var(--color-olive-900)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      {/* tiptoeing foot */}
      <ellipse cx="38" cy="100" rx="9" ry="5" fill="var(--color-olive-900)" />
    </svg>
  );
}

function Dragon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="A wild dragon circling the towers">
      <ellipse cx="60" cy="110" rx="30" ry="6" fill="var(--color-clay-300)" opacity="0.45" />
      <path d="M84 88 Q104 88 100 70 Q98 60 86 64" stroke="var(--color-clay-500)" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M36 66 Q18 56 22 38 Q34 46 42 62 Z" fill="var(--color-clay-300)" stroke="var(--color-clay-700)" strokeWidth="2" />
      <path d="M84 66 Q102 56 98 38 Q86 46 78 62 Z" fill="var(--color-clay-300)" stroke="var(--color-clay-700)" strokeWidth="2" />
      <ellipse cx="60" cy="80" rx="28" ry="24" fill="var(--color-clay-500)" stroke="var(--color-olive-900)" strokeWidth="3" />
      <ellipse cx="60" cy="88" rx="15" ry="12" fill="var(--color-olive-300)" />
      <circle cx="60" cy="44" r="22" fill="var(--color-clay-500)" stroke="var(--color-olive-900)" strokeWidth="3" />
      <path d="M46 28 L42 16 L52 24 Z" fill="var(--color-sand-100)" />
      <path d="M74 28 L78 16 L68 24 Z" fill="var(--color-sand-100)" />
      <circle cx="52" cy="42" r="3.6" fill="var(--color-olive-900)" />
      <circle cx="68" cy="42" r="3.6" fill="var(--color-olive-900)" />
      <path d="M50 54 Q60 60 70 54" stroke="var(--color-olive-900)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M57 56 L57 61 L61 56 Z" fill="#ffffff" />
    </svg>
  );
}

function Wizard({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="An evil wizard casting a spell at the gems">
      <ellipse cx="60" cy="112" rx="30" ry="6" fill="var(--color-clay-300)" opacity="0.45" />
      {/* robe */}
      <path d="M36 104 Q40 68 60 66 Q80 68 84 104 Z" fill="var(--color-olive-800)" stroke="var(--color-olive-900)" strokeWidth="3" />
      {/* head */}
      <circle cx="60" cy="52" r="19" fill="var(--color-sand-100)" stroke="var(--color-olive-900)" strokeWidth="3" />
      <circle cx="53" cy="50" r="3.2" fill="var(--color-olive-900)" />
      <circle cx="67" cy="50" r="3.2" fill="var(--color-olive-900)" />
      <path d="M52 62 Q60 58 68 62" stroke="var(--color-olive-900)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      {/* beard */}
      <path d="M46 60 Q60 88 74 60 Q68 78 60 80 Q52 78 46 60 Z" fill="#ffffff" stroke="var(--color-olive-900)" strokeWidth="2" />
      {/* pointed hat */}
      <path d="M34 36 L60 4 L86 36 Z" fill="var(--color-olive-900)" />
      <rect x="32" y="34" width="56" height="7" rx="3.5" fill="var(--color-clay-700)" />
      <path d="M60 14 L62 20 L68 22 L62 24 L60 30 L58 24 L52 22 L58 20 Z" fill="var(--color-gem-amber)" />
      {/* spell */}
      <g fill="var(--color-gem-sapphire)">
        <circle cx="96" cy="66" r="4" />
        <circle cx="106" cy="54" r="2.6" />
        <circle cx="90" cy="52" r="2.2" />
      </g>
    </svg>
  );
}

function Giant({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="A rumbling giant shaking the castle walls">
      <ellipse cx="60" cy="113" rx="36" ry="6" fill="var(--color-clay-300)" opacity="0.45" />
      {/* legs */}
      <rect x="42" y="88" width="14" height="22" rx="6" fill="var(--color-olive-700)" />
      <rect x="64" y="88" width="14" height="22" rx="6" fill="var(--color-olive-700)" />
      {/* body */}
      <ellipse cx="60" cy="72" rx="30" ry="26" fill="var(--color-olive-600)" stroke="var(--color-olive-900)" strokeWidth="3" />
      {/* arms */}
      <circle cx="26" cy="70" r="10" fill="var(--color-olive-700)" stroke="var(--color-olive-900)" strokeWidth="2" />
      <circle cx="94" cy="70" r="10" fill="var(--color-olive-700)" stroke="var(--color-olive-900)" strokeWidth="2" />
      {/* head */}
      <circle cx="60" cy="34" r="20" fill="var(--color-sand-100)" stroke="var(--color-olive-900)" strokeWidth="3" />
      <circle cx="52" cy="32" r="3.4" fill="var(--color-olive-900)" />
      <circle cx="68" cy="32" r="3.4" fill="var(--color-olive-900)" />
      {/* grumpy mouth + one tooth */}
      <path d="M50 44 Q60 40 70 44" stroke="var(--color-olive-900)" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M57 44 L57 49 L61 44 Z" fill="#ffffff" />
      {/* tuft of hair */}
      <path d="M54 14 Q60 6 66 14" stroke="var(--color-clay-700)" strokeWidth="3.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export default function ThreatArt({ threatId, size = 120, className = "" }: ThreatArtProps) {
  return (
    <div className={className}>
      {threatId === "raccoon" && <Raccoon size={size} />}
      {threatId === "bandit" && <Bandit size={size} />}
      {threatId === "dragon" && <Dragon size={size} />}
      {threatId === "wizard" && <Wizard size={size} />}
      {threatId === "giant" && <Giant size={size} />}
    </div>
  );
}
