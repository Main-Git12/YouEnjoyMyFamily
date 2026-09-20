// Flavor text for the "castle under attack" event — triggered only by data
// the family already explicitly entered (a pending task's own assignee),
// never by any inference about a child's behavior. See Dashboard.tsx for
// the trigger condition.
export type CastleThreat = (assignee: string, taskTitle: string) => string;

const THREAT_DRAGON: CastleThreat = (assignee, taskTitle) =>
  `A wild dragon is circling the castle! Only ${assignee} can drive it off by finishing "${taskTitle}"!`;
const THREAT_WIZARD: CastleThreat = (assignee, taskTitle) =>
  `An evil wizard has cursed the towers! ${assignee} can break the spell by finishing "${taskTitle}"!`;
const THREAT_GIANT: CastleThreat = (assignee, taskTitle) =>
  `A giant's footsteps are shaking the walls! ${assignee} can send it away by finishing "${taskTitle}"!`;

export const CASTLE_THREATS: CastleThreat[] = [THREAT_DRAGON, THREAT_WIZARD, THREAT_GIANT];

export function pickCastleThreat(assignee: string, taskTitle: string): string {
  const roll = Math.floor(Math.random() * CASTLE_THREATS.length);
  if (roll === 1) return THREAT_WIZARD(assignee, taskTitle);
  if (roll === 2) return THREAT_GIANT(assignee, taskTitle);
  return THREAT_DRAGON(assignee, taskTitle);
}
