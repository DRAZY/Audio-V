const { basename } = require("node:path");
const { execFileSync } = require("node:child_process");

/** Notarize and staple DMGs after electron-builder has signed/notarized their apps. */
module.exports = async function afterAllArtifactBuild(context) {
  const profile = process.env.APPLE_KEYCHAIN_PROFILE;
  for (const artifact of context.artifactPaths) {
    if (!artifact.endsWith(".dmg")) continue;
    if (!profile) {
      console.warn(`Skipped DMG notarization for ${basename(artifact)}: APPLE_KEYCHAIN_PROFILE is not set.`);
      continue;
    }
    console.log(`Notarizing ${basename(artifact)} with keychain profile ${profile}.`);
    execFileSync("xcrun", ["notarytool", "submit", artifact, "--keychain-profile", profile, "--wait"], { stdio: "inherit" });
    execFileSync("xcrun", ["stapler", "staple", artifact], { stdio: "inherit" });
    execFileSync("xcrun", ["stapler", "validate", artifact], { stdio: "inherit" });
  }
  return [];
};
