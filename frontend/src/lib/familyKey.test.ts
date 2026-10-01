import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getFamilyApiKey, getFamilyId, isDeviceLinked, linkDevice, unlinkDevice, rememberFamilyId } from "./familyKey";

describe("familyKey", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("knows a fresh device isn't linked to anything yet", () => {
    expect(isDeviceLinked()).toBe(false);
    expect(getFamilyApiKey()).toBeNull();
  });

  it("remembers the family once a screen is linked", () => {
    linkDevice("fam_123", "fk_secret");

    expect(getFamilyId()).toBe("fam_123");
    expect(getFamilyApiKey()).toBe("fk_secret");
    expect(isDeviceLinked()).toBe(true);
  });

  it("trims what was pasted, since a stray space breaks the header silently", () => {
    linkDevice("  fam_123  ", "  fk_secret  ");

    expect(getFamilyId()).toBe("fam_123");
    expect(getFamilyApiKey()).toBe("fk_secret");
  });

  it("forgets the family when a screen is unlinked", () => {
    linkDevice("fam_123", "fk_secret");
    unlinkDevice();

    expect(isDeviceLinked()).toBe(false);
    expect(getFamilyApiKey()).toBeNull();
    expect(getFamilyId()).toBeNull();
  });

  it("needs both halves before it calls a device linked", () => {
    window.localStorage.setItem("yemf.familyId", "fam_123");
    expect(isDeviceLinked()).toBe(false);
  });

  it("falls back to the build-time env only for local development", () => {
    vi.stubEnv("VITE_FAMILY_API_KEY", "fk_dev");
    vi.stubEnv("VITE_FAMILY_ID", "fam_dev");

    expect(getFamilyApiKey()).toBe("fk_dev");
    expect(getFamilyId()).toBe("fam_dev");
  });

  it("prefers what this device was linked with over anything in the build", () => {
    vi.stubEnv("VITE_FAMILY_API_KEY", "fk_dev");
    linkDevice("fam_123", "fk_real");

    expect(getFamilyApiKey()).toBe("fk_real");
  });

  it("stays linked for the session on a device that won't store anything", () => {
    // The Echo Show case, and it is not an edge case: the Alexa HTML runtime
    // disables localStorage outright and wipes cookies at the end of every
    // skill session. A device where storage silently does nothing used to
    // read as a screen that could never be linked, showing the setup prompt
    // forever no matter what anybody typed. The credentials live in memory
    // as well, so the session works.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => linkDevice("fam_123", "fk_secret")).not.toThrow();
    expect(getFamilyApiKey()).toBe("fk_secret");
    expect(getFamilyId()).toBe("fam_123");
    expect(isDeviceLinked()).toBe(true);
  });

  it("forgets a device that can't store anything, when it's unlinked", () => {
    // Otherwise "sign out" on such a screen would leave the key sitting in
    // memory and the next person would still be signed in.
    linkDevice("fam_123", "fk_secret");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });

    unlinkDevice();

    expect(getFamilyApiKey()).toBeNull();
    expect(isDeviceLinked()).toBe(false);
  });

  it("remembers only the family when that is all the skill handed over", () => {
    // Autolink off: the key stayed in the skill's environment. Knowing the
    // family saves half the typing, but the screen must still ask.
    rememberFamilyId("fam_123");

    expect(getFamilyId()).toBe("fam_123");
    expect(getFamilyApiKey()).toBeNull();
    expect(isDeviceLinked()).toBe(false);
  });
});
