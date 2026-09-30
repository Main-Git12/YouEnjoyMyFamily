import { describe, expect, it, vi } from "vitest";
import { browserAudio, createKeepAwake, type AudioLike, type WakeLockLike } from "./keepAwake";

function fakeLock(): WakeLockLike & { release: ReturnType<typeof vi.fn>; fire: () => void } {
  let listener: (() => void) | null = null;
  return {
    release: vi.fn().mockResolvedValue(undefined),
    addEventListener: (_type: "release", fn: () => void) => {
      listener = fn;
    },
    fire: () => listener?.(),
  };
}

function fakeAudio(play: () => Promise<void>): AudioLike & { pause: ReturnType<typeof vi.fn> } {
  return { loop: false, volume: 1, play, pause: vi.fn() };
}

const resolves = () => Promise.resolve();
const rejects = () => Promise.reject(new Error("NotAllowedError"));

describe("keeping the screen awake", () => {
  it("holds when both mechanisms take", async () => {
    const keeper = createKeepAwake({
      requestWakeLock: async () => fakeLock(),
      createAudio: () => fakeAudio(resolves),
      onVisible: () => () => undefined,
    });

    expect(keeper.status().state).toBe("off");
    const status = await keeper.start();
    expect(status).toEqual({ state: "holding", wakeLock: true, audio: true });
  });

  it("still holds when only the wake lock takes", async () => {
    const keeper = createKeepAwake({
      requestWakeLock: async () => fakeLock(),
      createAudio: () => fakeAudio(rejects),
      onVisible: () => () => undefined,
    });
    expect(await keeper.start()).toEqual({ state: "holding", wakeLock: true, audio: false });
  });

  it("still holds when only the audio takes", async () => {
    const keeper = createKeepAwake({
      requestWakeLock: async () => {
        throw new Error("NotAllowedError");
      },
      createAudio: () => fakeAudio(resolves),
      onVisible: () => () => undefined,
    });
    expect(await keeper.start()).toEqual({ state: "holding", wakeLock: false, audio: true });
  });

  /**
   * The case that matters on a real device. Autoplay is refused until
   * somebody touches the page, and a screen that quietly failed here would
   * put itself away in the middle of a Tuesday morning with nothing said.
   */
  it("says it needs a tap when neither mechanism could start", async () => {
    const keeper = createKeepAwake({
      requestWakeLock: async () => {
        throw new Error("NotAllowedError");
      },
      createAudio: () => fakeAudio(rejects),
      onVisible: () => () => undefined,
    });
    expect(await keeper.start()).toEqual({ state: "needs-gesture", wakeLock: false, audio: false });
  });

  it("says so plainly when the browser has neither", async () => {
    const keeper = createKeepAwake({ requestWakeLock: null, createAudio: null, onVisible: () => () => undefined });
    expect((await keeper.start()).state).toBe("unsupported");
  });

  /**
   * The wake lock is dropped every time the page is hidden. Requesting it
   * once and believing you still hold it is the standard way to get this
   * wrong — the screen dims the first time anyone switches away.
   */
  it("takes the wake lock again after the page comes back", async () => {
    let visible: (() => void) | null = null;
    const request = vi.fn(async () => fakeLock());
    const keeper = createKeepAwake({
      requestWakeLock: request,
      createAudio: () => fakeAudio(resolves),
      onVisible: (listener) => {
        visible = listener;
        return () => undefined;
      },
    });

    await keeper.start();
    expect(request).toHaveBeenCalledTimes(1);

    // The browser releases it while hidden, then the page becomes visible.
    const held = await request.mock.results[0]!.value;
    (held as ReturnType<typeof fakeLock>).fire();
    visible!();
    await Promise.resolve();
    await Promise.resolve();

    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not stack a second lock while one is still held", async () => {
    const request = vi.fn(async () => fakeLock());
    const keeper = createKeepAwake({
      requestWakeLock: request,
      createAudio: () => fakeAudio(resolves),
      onVisible: () => () => undefined,
    });
    await keeper.start();
    await keeper.start();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("lets go of everything on stop, and stops listening", async () => {
    const lock = fakeLock();
    const audio = fakeAudio(resolves);
    const unsubscribe = vi.fn();
    const keeper = createKeepAwake({
      requestWakeLock: async () => lock,
      createAudio: () => audio,
      onVisible: () => unsubscribe,
    });

    await keeper.start();
    keeper.stop();

    expect(lock.release).toHaveBeenCalledTimes(1);
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(keeper.status()).toEqual({ state: "off", wakeLock: false, audio: false });
  });

  it("does not re-acquire after stop, even if the page becomes visible again", async () => {
    let visible: (() => void) | null = null;
    const request = vi.fn(async () => fakeLock());
    const keeper = createKeepAwake({
      requestWakeLock: request,
      createAudio: () => fakeAudio(resolves),
      onVisible: (listener) => {
        visible = listener;
        return () => undefined;
      },
    });

    await keeper.start();
    keeper.stop();
    visible!();
    await Promise.resolve();

    expect(request).toHaveBeenCalledTimes(1);
  });

  /**
   * The one thing a family would actually notice going wrong: a kitchen
   * speaker quietly playing something all day. The file is digital silence
   * and the volume is near zero, and both are asserted rather than trusted.
   */
  it("builds an audio element that loops and cannot be heard", () => {
    const factory = browserAudio();
    expect(factory).not.toBeNull();
    const element = factory!() as AudioLike & { src: string };
    expect(element.loop).toBe(true);
    expect(element.volume).toBeLessThanOrEqual(0.01);
    expect(element.src).toContain("/silence.wav");
  });
});
