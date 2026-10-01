import { describe, it, expect, vi, beforeEach } from "vitest";
import { isAlexaSurface, linkFromAlexa, ALEXA_CLIENT_LIBRARY, ALEXA_CLIENT_VERSION } from "./alexaSurface";
import type { AlexaStartupData } from "./alexaSurface";

const onEchoShow = () => {
  // The skill puts this on the URL so the layout is right at first paint,
  // before any third-party script has loaded.
  window.history.replaceState({}, "", "/?surface=echo-show");
};

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("isAlexaSurface", () => {
  it("is true only for the marker the skill actually sends", () => {
    expect(isAlexaSurface("?surface=echo-show")).toBe(true);
    expect(isAlexaSurface("?surface=phone")).toBe(false);
    expect(isAlexaSurface("")).toBe(false);
    expect(isAlexaSurface("?theme=olive")).toBe(false);
  });

  it("survives other query parameters being there too", () => {
    expect(isAlexaSurface("?theme=olive&surface=echo-show&v=2")).toBe(true);
  });
});

describe("linkFromAlexa", () => {
  const client = (message: AlexaStartupData | undefined) => ({
    create: vi.fn(async () => ({ alexa: {}, message })),
  });

  it("does nothing at all on a device that isn't an Echo Show", async () => {
    // Including never fetching Amazon's library onto somebody's phone.
    const load = vi.fn();
    expect(await linkFromAlexa({ load, getClient: () => undefined })).toBe("unavailable");
    expect(load).not.toHaveBeenCalled();
  });

  it("links the screen when the skill sent both the family and the key", async () => {
    onEchoShow();
    const onLink = vi.fn();

    const outcome = await linkFromAlexa({
      load: async () => {},
      getClient: () => client({ familyId: "fam_1", apiKey: "fk_live" }),
      onLink,
    });

    expect(outcome).toBe("linked");
    expect(onLink).toHaveBeenCalledWith("fam_1", "fk_live");
  });

  it("asks the library for the version it was written against, as a string", async () => {
    onEchoShow();
    const alexa = client({ familyId: "fam_1", apiKey: "fk_live" });

    await linkFromAlexa({ load: async () => {}, getClient: () => alexa, onLink: vi.fn() });

    expect(alexa.create).toHaveBeenCalledWith({ version: ALEXA_CLIENT_VERSION });
    expect(typeof ALEXA_CLIENT_VERSION).toBe("string");
  });

  it("keeps the family id when the key was deliberately withheld", async () => {
    // Autolink off: the credential stays in the skill's environment. Knowing
    // the family still saves half the linking.
    onEchoShow();
    const onLink = vi.fn();
    const onFamilyId = vi.fn();

    const outcome = await linkFromAlexa({
      load: async () => {},
      getClient: () => client({ familyId: "fam_1" }),
      onLink,
      onFamilyId,
    });

    expect(outcome).toBe("partial");
    expect(onFamilyId).toHaveBeenCalledWith("fam_1");
    expect(onLink).not.toHaveBeenCalled();
  });

  it("loads Amazon's library only when the client isn't there yet", async () => {
    onEchoShow();
    const load = vi.fn(async (_src: string) => {});
    let alexa: ReturnType<typeof client> | undefined;

    await linkFromAlexa({
      load: async (src) => {
        await load(src);
        alexa = client({ familyId: "fam_1", apiKey: "fk" });
      },
      getClient: () => alexa,
      onLink: vi.fn(),
    });

    expect(load).toHaveBeenCalledWith(ALEXA_CLIENT_LIBRARY);
  });

  it("carries on unchanged when the library can't be fetched", async () => {
    // A locked-down network, a CDN hiccup. The screen falls back to asking
    // to be linked, which is a recoverable Tuesday.
    onEchoShow();
    const outcome = await linkFromAlexa({
      load: async () => {
        throw new Error("blocked");
      },
      getClient: () => undefined,
    });

    expect(outcome).toBe("unavailable");
  });

  it("carries on unchanged when the handshake rejects", async () => {
    onEchoShow();
    const outcome = await linkFromAlexa({
      load: async () => {},
      getClient: () => ({
        create: vi.fn(async () => {
          throw new Error("no runtime");
        }),
      }),
    });

    expect(outcome).toBe("unavailable");
  });

  it("carries on unchanged when the payload has nothing useful in it", async () => {
    onEchoShow();
    for (const payload of [undefined, {}, { familyId: "" }, { familyId: "   " }, { apiKey: "fk_orphan" }]) {
      expect(
        await linkFromAlexa({ load: async () => {}, getClient: () => client(payload), onLink: vi.fn() })
      ).toBe("unavailable");
    }
  });

  it("never links on a key with no family against it", async () => {
    // A key alone cannot address anything, and guessing the family would be
    // the app inventing the one value it must never invent.
    onEchoShow();
    const onLink = vi.fn();

    await linkFromAlexa({ load: async () => {}, getClient: () => client({ apiKey: "fk_orphan" }), onLink });

    expect(onLink).not.toHaveBeenCalled();
  });

  it("points at Amazon's own library over HTTPS", () => {
    // Everything in that runtime must be HTTPS — mixed content simply fails.
    expect(ALEXA_CLIENT_LIBRARY).toMatch(/^https:\/\//);
    expect(ALEXA_CLIENT_LIBRARY).toContain("alexa-html.js");
  });
});

describe("when the handover never finishes", () => {
  const onEchoShow = () => window.history.replaceState({}, "", "/?surface=echo-show");

  it("gives up rather than leaving the screen waiting forever", async () => {
    // Nothing in this exchange is ours: a script from Amazon's CDN and a
    // promise resolved by a runtime we can't see. Either can simply never
    // settle, and a wall screen stuck on "Opening your family screen…" is
    // indistinguishable from a broken app.
    onEchoShow();

    const outcome = await linkFromAlexa({
      load: async () => {},
      getClient: () => ({ create: () => new Promise(() => {}) }),
      timeoutMs: 20,
    });

    expect(outcome).toBe("unavailable");
  });

  it("gives up when the library itself never loads", async () => {
    onEchoShow();

    const outcome = await linkFromAlexa({
      load: () => new Promise(() => {}),
      getClient: () => undefined,
      timeoutMs: 20,
    });

    expect(outcome).toBe("unavailable");
  });

  it("doesn't link a screen on a handover that arrives after the deadline", async () => {
    // The late answer must not reach in and link the device behind the
    // screen's back once it has already moved on.
    onEchoShow();
    const onLink = vi.fn();
    let settle: (value: { message: AlexaStartupData }) => void = () => {};

    const outcome = await linkFromAlexa({
      load: async () => {},
      getClient: () => ({ create: () => new Promise((resolve) => (settle = resolve)) }),
      onLink,
      timeoutMs: 20,
    });
    expect(outcome).toBe("unavailable");

    settle({ message: { familyId: "fam_late", apiKey: "fk_late" } });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(onLink).not.toHaveBeenCalled();
  });

  it("still answers in time when the handover is merely slow", async () => {
    onEchoShow();

    const outcome = await linkFromAlexa({
      load: async () => {},
      getClient: () => ({
        create: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { message: { familyId: "fam_1", apiKey: "fk" } };
        },
      }),
      onLink: vi.fn(),
      timeoutMs: 200,
    });

    expect(outcome).toBe("linked");
  });
});
