/**
 * Keeping a kitchen screen awake.
 *
 * This exists because of one specific, well-documented Echo Show behaviour:
 * Amazon's Silk browser puts itself away after a period of inactivity and
 * the device returns to its home screen. Reports of how long vary — some
 * people see under a minute, others ten to fifteen — and Amazon's own
 * forum answer is that it cannot be turned off. A wall display that
 * disappears on its own is not a wall display.
 *
 * Two mechanisms, because neither is sufficient on its own:
 *
 *   1. The Screen Wake Lock API. The standard, and the honest one. Stops
 *      the display dimming. It needs HTTPS, the browser may refuse it, and
 *      it is dropped every time the page is hidden — so it is re-acquired
 *      on `visibilitychange` rather than requested once.
 *
 *   2. A silent audio loop. A page that is playing audio counts as active,
 *      which is the trick the Echo Show dashboard community settled on.
 *      Autoplay rules mean it cannot start until somebody has touched the
 *      page, so this reports `needs-gesture` and the screen asks for one
 *      tap rather than pretending it is holding.
 *
 * Both are best effort and this module does not pretend otherwise: it
 * reports which mechanisms actually took, so the UI can tell the truth.
 * None of it has been tested on a real Echo Show — there isn't one here.
 */

export type KeepAwakeState =
  /** Not started. */
  | "off"
  /** At least one mechanism is holding. */
  | "holding"
  /** Everything needs a tap before it can start. */
  | "needs-gesture"
  /** Nothing here works in this browser. */
  | "unsupported";

export interface KeepAwakeStatus {
  state: KeepAwakeState;
  wakeLock: boolean;
  audio: boolean;
}

/** The slice of `navigator.wakeLock` used here, so a test need not fake the platform. */
export interface WakeLockLike {
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}
export type RequestWakeLock = () => Promise<WakeLockLike>;

/** The slice of HTMLAudioElement used here. */
export interface AudioLike {
  loop: boolean;
  volume: number;
  play(): Promise<void>;
  pause(): void;
}

export interface KeepAwakeOptions {
  requestWakeLock?: RequestWakeLock | null;
  createAudio?: (() => AudioLike) | null;
  onChange?: (status: KeepAwakeStatus) => void;
  /** Registers a visibility listener; returns its unsubscribe. */
  onVisible?: (listener: () => void) => () => void;
}

const browserWakeLock = (): RequestWakeLock | null => {
  const nav = typeof navigator === "undefined" ? null : (navigator as Navigator & {
    wakeLock?: { request(type: "screen"): Promise<WakeLockLike> };
  });
  if (!nav?.wakeLock) return null;
  return () => nav.wakeLock!.request("screen");
};

/** Exported so the volume and loop settings can actually be asserted. */
export const browserAudio = (): (() => AudioLike) | null => {
  if (typeof Audio === "undefined") return null;
  return () => {
    const element = new Audio("/silence.wav");
    element.loop = true;
    // Muted audio is treated as "not really playing" by some autoplay
    // policies, and the point here is to look active. Silent-by-content at
    // the lowest audible volume is the safer side of that line — the file
    // is 0.1 s of digital silence, so nothing is ever heard.
    element.volume = 0.01;
    return element;
  };
};

const browserVisibility = (listener: () => void): (() => void) => {
  if (typeof document === "undefined") return () => undefined;
  const handler = () => {
    if (document.visibilityState === "visible") listener();
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
};

/**
 * Starts nothing on construction. Call `start()` from a user gesture — that
 * is the only moment audio is allowed to begin, and asking for one tap is
 * more honest than silently failing every time the page loads.
 */
export function createKeepAwake(options: KeepAwakeOptions = {}) {
  const requestWakeLock = options.requestWakeLock === undefined ? browserWakeLock() : options.requestWakeLock;
  const createAudio = options.createAudio === undefined ? browserAudio() : options.createAudio;
  const onVisible = options.onVisible ?? browserVisibility;

  let sentinel: WakeLockLike | null = null;
  let audio: AudioLike | null = null;
  let unsubscribe: (() => void) | null = null;
  let stopped = true;

  const status = (): KeepAwakeStatus => {
    const wakeLock = sentinel !== null;
    const playing = audio !== null;
    if (!requestWakeLock && !createAudio) return { state: "unsupported", wakeLock, audio: playing };
    if (wakeLock || playing) return { state: "holding", wakeLock, audio: playing };
    return { state: stopped ? "off" : "needs-gesture", wakeLock, audio: playing };
  };

  const announce = () => options.onChange?.(status());

  async function acquireWakeLock() {
    if (!requestWakeLock || sentinel) return;
    try {
      const got = await requestWakeLock();
      // The browser drops the lock whenever the page is hidden, and tells
      // us. Clearing the reference is what makes the re-acquire below fire
      // rather than silently believing we still hold one.
      got.addEventListener("release", () => {
        sentinel = null;
        announce();
      });
      sentinel = got;
    } catch {
      sentinel = null;
    }
  }

  async function startAudio() {
    if (!createAudio || audio) return;
    const element = createAudio();
    try {
      await element.play();
      audio = element;
    } catch {
      // Autoplay refused — the caller has not had a gesture yet, or this
      // browser will not allow it at all. Reported, not retried in a loop.
      audio = null;
    }
  }

  return {
    status,

    /** Call from a click or tap. Safe to call again. */
    async start(): Promise<KeepAwakeStatus> {
      stopped = false;
      await acquireWakeLock();
      await startAudio();
      if (!unsubscribe) {
        unsubscribe = onVisible(() => {
          if (!stopped) void acquireWakeLock().then(announce);
        });
      }
      announce();
      return status();
    },

    stop(): void {
      stopped = true;
      unsubscribe?.();
      unsubscribe = null;
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
      audio?.pause();
      audio = null;
      announce();
    },
  };
}

export type KeepAwake = ReturnType<typeof createKeepAwake>;
