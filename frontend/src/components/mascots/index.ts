import Knight from "./Knight";
import Dragon from "./Dragon";
import Princess from "./Princess";
import King from "./King";
import type { MascotProps } from "./types";

export interface Mascot {
  id: "knight" | "dragon" | "princess" | "king";
  name: string;
  Component: (props: MascotProps) => JSX.Element;
}

const KNIGHT: Mascot = { id: "knight", name: "Sir Olive", Component: Knight };
const DRAGON: Mascot = { id: "dragon", name: "Ember", Component: Dragon };
const PRINCESS: Mascot = { id: "princess", name: "Wren", Component: Princess };
const KING: Mascot = { id: "king", name: "King Cedric", Component: King };

export const MASCOTS: Mascot[] = [KNIGHT, DRAGON, PRINCESS, KING];

export function randomMascot(): Mascot {
  const roll = Math.floor(Math.random() * MASCOTS.length);
  return MASCOTS[roll] ?? KNIGHT;
}

export { Knight, Dragon, Princess, King };
export type { MascotProps };
