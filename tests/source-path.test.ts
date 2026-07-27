import { describe, expect, it } from "vitest";
import { normalizeSourcePath, sourcePathKey } from "../electron/source-path";

describe("native source paths", () => {
  it("preserves and normalizes Windows UNC share paths", () => {
    expect(
      normalizeSourcePath(
        String.raw`\\media-server\archive\Music\..\Masters`,
        "win32",
      ),
    ).toBe(String.raw`\\media-server\archive\Masters`);
  });

  it("preserves mapped Windows drive roots", () => {
    expect(normalizeSourcePath(String.raw`M:\Music\Album`, "win32")).toBe(
      String.raw`M:\Music\Album`,
    );
  });

  it("authorizes Windows paths case-insensitively", () => {
    expect(sourcePathKey(String.raw`M:\Music\Album`, "win32")).toBe(
      sourcePathKey(String.raw`m:\music\album`, "win32"),
    );
  });

  it("keeps mounted macOS paths absolute and case-preserving", () => {
    expect(
      normalizeSourcePath("/Volumes/Studio NAS/Music/../Masters", "darwin"),
    ).toBe("/Volumes/Studio NAS/Masters");
  });
});
