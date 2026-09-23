import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getFamilyApiKey, getFamilyId, isDeviceLinked, linkDevice, unlinkDevice } from "./familyKey";

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

  it("keeps working when the device won't let it store anything", () => {
    // A locked-down kiosk or private window throws on access rather than
    // returning null; the screen should still be usable for this session.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => linkDevice("fam_123", "fk_secret")).not.toThrow();
    expect(getFamilyApiKey()).toBeNull();
  });
});
