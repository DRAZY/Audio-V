import { describe, expect, it } from "vitest";
import { installMode, isDeveloperIdSigned } from "../electron/update-plan";

// Shape of `codesign -dv --verbose=2 /Applications/Audio-V.app` (printed on stderr).
const developerId = `Executable=/Applications/Audio-V.app/Contents/MacOS/Audio-V
Identifier=com.drazy.audiov
Format=app bundle with Mach-O thin (arm64)
Authority=Developer ID Application: Andre Hall (W966GFT83K)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Timestamp=Nov 23, 2026 at 2:51:12 AM
TeamIdentifier=W966GFT83K
Runtime Version=15.0.0
`;
const adHoc = `Executable=/Applications/Audio-V.app/Contents/MacOS/Audio-V
Identifier=com.drazy.audiov
Signature=adhoc
TeamIdentifier=not set
`;

describe("isDeveloperIdSigned", () => {
  it("accepts our Developer ID signature", () => {
    expect(isDeveloperIdSigned(developerId)).toBe(true);
  });

  it("rejects empty output, which is what stdout alone gives", () => {
    expect(isDeveloperIdSigned("")).toBe(false);
  });

  it("rejects ad-hoc signatures and other teams", () => {
    expect(isDeveloperIdSigned(adHoc)).toBe(false);
    expect(isDeveloperIdSigned(developerId.replaceAll("W966GFT83K", "ABCDE12345"))).toBe(false);
    expect(
      isDeveloperIdSigned(developerId.replace("Developer ID Application:", "Apple Development:")),
    ).toBe(false);
  });
});

describe("installMode", () => {
  it("updates signed Mac builds and the Windows installer in place", () => {
    expect(installMode({ platform: "darwin", packaged: true, developerIdSigned: true })).toEqual({ kind: "inPlace" });
    expect(installMode({ platform: "win32", packaged: true })).toEqual({ kind: "inPlace" });
  });

  it("sends everything else to the release page with a reason", () => {
    expect(installMode({ platform: "darwin", packaged: true, developerIdSigned: false })).toEqual({ kind: "manual", reason: "unsigned" });
    expect(installMode({ platform: "win32", packaged: true, portable: true })).toEqual({ kind: "manual", reason: "portable" });
    expect(installMode({ platform: "darwin", packaged: false, developerIdSigned: true })).toEqual({ kind: "manual", reason: "dev" });
    expect(installMode({ platform: "linux", packaged: true })).toEqual({ kind: "manual", reason: "unsupported" });
  });
});
