/**
 * Pure decisions behind in-place updates (no Electron imports, so they are
 * unit-tested in tests/update-plan.test.ts).
 */

/** Apple Team ID the Developer ID builds are signed with. */
export const TEAM_ID = "W966GFT83K";

/**
 * Read `codesign -dv --verbose=2 <app>` output. codesign prints this on
 * stderr, so callers must pass stderr (stdout is empty). True only for a real
 * Developer ID Application signature from our team, never for an ad-hoc
 * signature or another team's certificate.
 */
export function isDeveloperIdSigned(codesignDisplay: string, teamId = TEAM_ID): boolean {
  if (/^Signature=adhoc$/mu.test(codesignDisplay)) return false;
  const team = codesignDisplay.match(/^TeamIdentifier=(\S+)$/mu)?.[1];
  const leaf = codesignDisplay.match(/^Authority=(.+)$/mu)?.[1] ?? "";
  return team === teamId && leaf.startsWith("Developer ID Application:") && leaf.endsWith(`(${teamId})`);
}

export type ManualReason = "dev" | "unsigned" | "portable" | "unsupported" | "failed";

/**
 * How this build installs an update.
 * - inPlace: Windows NSIS install, or a Developer-ID-signed Mac build
 *   (electron-updater downloads; Squirrel.Mac verifies the zip against this
 *   app's signature, swaps the bundle and relaunches).
 * - manual: open the release page; `reason` says why.
 */
export type InstallMode = { kind: "inPlace" } | { kind: "manual"; reason: ManualReason };

export function installMode(env: {
  platform: string;
  packaged: boolean;
  portable?: boolean;
  developerIdSigned?: boolean;
}): InstallMode {
  if (!env.packaged) return { kind: "manual", reason: "dev" };
  if (env.platform === "win32") {
    return env.portable ? { kind: "manual", reason: "portable" } : { kind: "inPlace" };
  }
  if (env.platform === "darwin") {
    // Squirrel.Mac accepts an update only when it satisfies the running app's
    // designated requirement; an ad-hoc build cannot be matched by any other build.
    return env.developerIdSigned ? { kind: "inPlace" } : { kind: "manual", reason: "unsigned" };
  }
  return { kind: "manual", reason: "unsupported" };
}
