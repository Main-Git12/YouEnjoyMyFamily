import Knight from "./Knight";
import Dragon from "./Dragon";
import Princess from "./Princess";
import type { MascotProps } from "./types";

export interface Mascot {
  id: "knight" | "dragon" | "princess";
  name: string;
  Component: (props: MascotProps) => JSX.Element;
}

const KNIGHT: Mascot = { id: "knight", name: "Sir Olive", Component: Knight };
const DRAGON: Mascot = { id: "dragon", name: "Ember", Component: Dragon };
const PRINCESS: Mascot = { id: "princess", name: "Wren", Component: Princess };

export const MASCOTS: Mascot[] = [KNIGHT, DRAGON, PRINCESS];

export function randomMascot(): Mascot {
  const roll = Math.floor(Math.random() * MASCOTS.length);
  if (roll === 1) return DRAGON;
  if (roll === 2) return PRINCESS;
  return KNIGHT;
}

export { Knight, Dragon, Princess };
export type { MascotProps };
