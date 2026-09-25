/**
 * Saying the next step out loud.
 *
 * This exists for one reason. The complaint that started it was not "we
 * can't see the time" — it was that getting three people out of the door
 * falls to one adult who has to keep asking, and being asked repeatedly by
 * a parent is something children learn to tune out. A screen that says
 * "Parker — shoes, four minutes" is not a parent asking again. It moves
 * the nagging off a person and onto a clock, which is the only part of
 * this whole problem that software can actually help with.
 *
 * Feature-detected, never assumed. The Echo Show's browser, Silk, and
 * every phone browser in the house have different ideas about speech
 * synthesis, and several will only speak after the page has been touched
 * at least once. So: if it isn't there, everything still works silently,
 * and it is off until someone turns it on.
 */

export function canSpeak(): boolean {
  try {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
  } catch {
    return false;
  }
}

/**
 * Says one short line, dropping anything already queued.
 *
 * Dropping matters: if a step is ticked while the previous prompt is still
 * being read out, the family should hear where they are *now*, not wait
 * through an announcement that has already stopped being true.
 */
export function speak(text: string): void {
  if (!canSpeak()) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(text);
    // Slightly slow and a touch low: it has to carry across a kitchen with
    // a kettle going, and the default rate reads as hurried, which is the
    // last thing this particular moment needs more of.
    utterance.rate = 0.95;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  } catch {
    // A browser that refuses to speak is not a reason for the morning to stop.
  }
}

export function stopSpeaking(): void {
  if (!canSpeak()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Nothing to do — see above.
  }
}
