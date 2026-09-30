// Flavor lines a family can trigger by tapping the castle — purely for fun,
// no gems or backend calls involved. One pool per stage id, since who's
// "home" (see the stage components) changes what they'd plausibly say.
export const CASTLE_STAGE_LINES: Record<string, string[]> = {
  watchtower: ["The watchtower is quiet... finish a few more chores and someone will move in!"],
  "knights-keep": [
    "Sir Olive: Onward, brave gem collector!",
    "Sir Olive: The keep stands strong thanks to you!",
    "Sir Olive: Another gem, another victory!",
  ],
  "rising-castle": [
    "Sir Olive: The walls keep rising higher every day!",
    "Wren: The kingdom sparkles a little more with every gem!",
    "Wren: Keep going — you're doing wonderfully!",
  ],
  "grand-fortress": [
    "Sir Olive: A fortress fit for heroes!",
    "Wren: Ember finally settled down and joined us!",
    "Ember: Roar! ...I mean, hello, friend!",
  ],
  "kingdom-of-gems": [
    "Sir Olive: This kingdom is the finest in the land!",
    "Wren: Every gem you've earned lives here with us now!",
    "Ember: I guard this treasure proudly — thanks to you!",
  ],
};

export function pickStageLine(stageId: string): string {
  const lines = CASTLE_STAGE_LINES[stageId] ?? CASTLE_STAGE_LINES.watchtower ?? [];
  if (lines.length === 0) return "";
  const index = Math.floor(Math.random() * lines.length);
  return lines[index] ?? lines[0] ?? "";
}
