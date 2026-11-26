import { describe, expect, it } from "vitest";
import { compareVersions, isNewerVersion } from "../electron/version-compare";

describe("isNewerVersion", () => {
  it("offers a higher patch, minor, or major version", () => {
    expect(isNewerVersion("0.4.49", "0.4.48")).toBe(true);
    expect(isNewerVersion("0.5.0", "0.4.49")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.99")).toBe(true);
    expect(isNewerVersion("v0.4.49", "0.4.48")).toBe(true);
  });

  it("never offers an older version whose later part is larger", () => {
    expect(isNewerVersion("0.4.49", "0.5.0")).toBe(false);
    expect(isNewerVersion("0.9.99", "1.0.0")).toBe(false);
  });

  it("does not offer the version already installed", () => {
    expect(isNewerVersion("0.4.49", "0.4.49")).toBe(false);
    expect(isNewerVersion("0.4.49", "0.4.49.0")).toBe(false);
  });

  it("treats a release as newer than its prereleases", () => {
    expect(isNewerVersion("0.5.0", "0.5.0-rc.1")).toBe(true);
    expect(isNewerVersion("0.5.0-rc.1", "0.5.0")).toBe(false);
    expect(isNewerVersion("0.5.0-rc.2", "0.5.0-rc.1")).toBe(true);
    expect(isNewerVersion("0.5.0-rc.10", "0.5.0-rc.9")).toBe(true);
    expect(isNewerVersion("0.5.0-rc.1", "0.4.49")).toBe(true);
  });

  it("orders versions consistently", () => {
    const ordered = ["0.4.9", "0.4.48", "0.4.49", "0.5.0-beta.1", "0.5.0-rc.1", "0.5.0-rc.2", "0.5.0", "1.0.0"];
    const shuffled = [...ordered].reverse();
    expect(shuffled.sort(compareVersions)).toEqual(ordered);
  });
});
