// Hand-rolled: a handful of divs is plenty for one celebration burst, and it
// keeps the bundle free of a confetti dependency for something this small.
const COLORS = ["#b9814f", "#7d7f45", "#dcb98f", "#9fa262", "#c8b895"];
const PIECE_COUNT = 18;

interface ConfettiPiece {
  left: string;
  delay: string;
  duration: string;
  color: string;
  rotate: string;
}

function makePieces(): ConfettiPiece[] {
  return Array.from({ length: PIECE_COUNT }, (_, i) => ({
    left: `${5 + ((i * 97) % 90)}%`,
    delay: `${(i % 6) * 0.05}s`,
    duration: `${0.9 + (i % 4) * 0.15}s`,
    color: COLORS[i % COLORS.length] ?? "#b9814f",
    rotate: `${(i * 47) % 360}deg`,
  }));
}

export default function Confetti() {
  const pieces = makePieces();
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {pieces.map((piece, i) => (
        <span
          key={i}
          className="absolute top-0 w-2.5 h-2.5 rounded-sm animate-confetti-fall"
          style={{
            left: piece.left,
            backgroundColor: piece.color,
            animationDelay: piece.delay,
            animationDuration: piece.duration,
            transform: `rotate(${piece.rotate})`,
          }}
        />
      ))}
    </div>
  );
}
