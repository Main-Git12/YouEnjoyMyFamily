// Original boho "nature spirit" mascots — deliberately not a licensed
// character (Pokémon/Frozen etc. are trademarked; recognizable copies of
// them would be an IP problem in a real, public repo). Flat, simple shapes
// in the existing olive/clay/sand palette so they read as part of this
// app's own visual system rather than a bolted-on franchise.

interface SpiritProps {
  className?: string;
}

export function FoxSpirit({ className = "" }: SpiritProps) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="Fox spirit">
      <path d="M22 38 L30 12 L40 34 Z" fill="#b9814f" />
      <path d="M78 38 L70 12 L60 34 Z" fill="#b9814f" />
      <path d="M25 36 L30 20 L36 33 Z" fill="#f3ecdd" />
      <path d="M75 36 L70 20 L64 33 Z" fill="#f3ecdd" />
      <circle cx="50" cy="55" r="30" fill="#dcb98f" />
      <path d="M22 58 A28 20 0 0 0 78 58 A28 16 0 0 1 22 58 Z" fill="#fbf8f1" />
      <circle cx="39" cy="50" r="4.5" fill="#2b241c" />
      <circle cx="61" cy="50" r="4.5" fill="#2b241c" />
      <circle cx="40.5" cy="48.5" r="1.3" fill="#fff" />
      <circle cx="62.5" cy="48.5" r="1.3" fill="#fff" />
      <path d="M46 60 Q50 65 54 60" stroke="#2b241c" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M50 55 l-3 5 h6 Z" fill="#2b241c" />
    </svg>
  );
}

export function OwlSpirit({ className = "" }: SpiritProps) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="Owl spirit">
      <path d="M30 30 L22 12 L38 22 Z" fill="#7d7f45" />
      <path d="M70 30 L78 12 L62 22 Z" fill="#7d7f45" />
      <ellipse cx="50" cy="56" rx="28" ry="30" fill="#9fa262" />
      <circle cx="38" cy="50" r="13" fill="#f6f6ef" />
      <circle cx="62" cy="50" r="13" fill="#f6f6ef" />
      <circle cx="38" cy="50" r="6" fill="#2b241c" />
      <circle cx="62" cy="50" r="6" fill="#2b241c" />
      <circle cx="40" cy="48" r="1.6" fill="#fff" />
      <circle cx="64" cy="48" r="1.6" fill="#fff" />
      <path d="M50 58 l-5 7 h10 Z" fill="#b9814f" />
      <path d="M34 78 Q50 88 66 78" stroke="#4a4b2b" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function SunSpirit({ className = "" }: SpiritProps) {
  const rays = Array.from({ length: 8 }, (_, i) => (i * 360) / 8);
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="Sun spirit">
      <g stroke="#b9814f" strokeWidth="5" strokeLinecap="round">
        {rays.map((deg) => {
          const rad = (deg * Math.PI) / 180;
          const x1 = 50 + Math.cos(rad) * 34;
          const y1 = 50 + Math.sin(rad) * 34;
          const x2 = 50 + Math.cos(rad) * 46;
          const y2 = 50 + Math.sin(rad) * 46;
          return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
      </g>
      <circle cx="50" cy="50" r="28" fill="#dcb98f" />
      <circle cx="41" cy="46" r="4" fill="#2b241c" />
      <circle cx="59" cy="46" r="4" fill="#2b241c" />
      <circle cx="42.5" cy="44.5" r="1.2" fill="#fff" />
      <circle cx="60.5" cy="44.5" r="1.2" fill="#fff" />
      <path d="M40 58 Q50 68 60 58" stroke="#2b241c" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <circle cx="32" cy="55" r="3.5" fill="#c8917a" opacity="0.6" />
      <circle cx="68" cy="55" r="3.5" fill="#c8917a" opacity="0.6" />
    </svg>
  );
}

export function LeafSprite({ className = "" }: SpiritProps) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="Leaf sprite">
      <path d="M50 14 C68 14 70 40 70 50 C70 68 60 82 50 88 C40 82 30 68 30 50 C30 40 32 14 50 14 Z" fill="#7d7f45" />
      <path d="M50 20 L50 84" stroke="#4a4b2b" strokeWidth="2" opacity="0.5" />
      <circle cx="42" cy="52" r="4.5" fill="#2b241c" />
      <circle cx="58" cy="52" r="4.5" fill="#2b241c" />
      <circle cx="43.5" cy="50.5" r="1.3" fill="#fff" />
      <circle cx="59.5" cy="50.5" r="1.3" fill="#fff" />
      <path d="M44 62 Q50 68 56 62" stroke="#2b241c" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <ellipse cx="50" cy="10" rx="3" ry="6" fill="#4a4b2b" />
    </svg>
  );
}

export const SPIRITS = [FoxSpirit, OwlSpirit, SunSpirit, LeafSprite] as const;

export function randomSpirit() {
  const Spirit = SPIRITS[Math.floor(Math.random() * SPIRITS.length)] ?? FoxSpirit;
  return Spirit;
}
