import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const release = path.join(root, "release");
const packageJson = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
const artifactNames = [
  `Audio-V-${packageJson.version}-mac-arm64.dmg`,
  `Audio-V-${packageJson.version}-mac-universal.dmg`,
  `Audio-V-${packageJson.version}-win-x64.exe`,
  `Audio-V-Portable-${packageJson.version}-x64.exe`,
];
const artifacts = [];

const MAC_NOTARIZED = "developer-id-notarized-stapled";
const MAC_AD_HOC = "ad-hoc-app-signature-no-developer-identity";
const WINDOWS_UNSIGNED = "unsigned-by-project-policy";

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * Record what the DMG actually carries rather than what a build command
 * intended. A Developer ID build must pass Gatekeeper as notarized and carry a
 * stapled ticket; anything else is recorded as the ad-hoc development build.
 */
function macSigningStatus(file) {
  if (process.platform !== "darwin") {
    throw new Error("The macOS signing status can only be measured on macOS.");
  }
  const assessment = spawnSync(
    "spctl",
    ["--assess", "--type", "open", "--context", "context:primary-signature", "-v", file],
    { encoding: "utf8" },
  );
  const notarized =
    assessment.status === 0 &&
    `${assessment.stdout}${assessment.stderr}`.includes("source=Notarized Developer ID");
  const stapled =
    spawnSync("xcrun", ["stapler", "validate", file], { encoding: "utf8" }).status === 0;
  if (notarized && stapled) return MAC_NOTARIZED;
  if (notarized !== stapled) {
    throw new Error(
      `${path.basename(file)} is only partly notarized (Gatekeeper notarized: ${notarized}, ticket stapled: ${stapled}).`,
    );
  }
  return MAC_AD_HOC;
}

for (const name of artifactNames) {
  const file = path.join(release, name);
  const stat = await fs.stat(file);
  artifacts.push({
    name,
    bytes: stat.size,
    sha256: await sha256(file),
    signingStatus: name.endsWith(".dmg") ? macSigningStatus(file) : WINDOWS_UNSIGNED,
  });
}

const macNotarized = artifacts
  .filter((artifact) => artifact.name.endsWith(".dmg"))
  .every((artifact) => artifact.signingStatus === MAC_NOTARIZED);

const manifest = {
  schema: "Audio-V release manifest v3",
  product: "Audio-V",
  version: packageJson.version,
  projectLicense: packageJson.license,
  correspondingSource: `https://github.com/DRAZY/Audio-V/tree/v${packageJson.version}`,
  distribution: "open-source-development",
  signingPolicy: macNotarized
    ? "macOS DMGs and the app bundles inside them are signed with the DRAZY Developer ID (team W966GFT83K), notarized by Apple and stapled. Windows artifacts are unsigned. Verify SHA-256 values against the GitHub Release before opening."
    : "macOS app bundles are whole-bundle ad-hoc signed for code-integrity validation but have no Developer ID identity and are not notarized. Windows artifacts are unsigned. Verify SHA-256 values against the GitHub Release before opening.",
  signing: {
    macDeveloperIdAndNotarization: macNotarized ? "signed-notarized-stapled" : "not-used-for-this-build",
    windowsAuthenticode: "optional-not-configured",
  },
  artifacts,
};
// The filename predates Mac signing. It is kept so the version-free
// releases/latest/download link in the README keeps resolving.
await fs.writeFile(
  path.join(release, "UNSIGNED_RELEASE_MANIFEST.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `Wrote release manifest for ${artifacts.length} artifacts (macOS: ${macNotarized ? "Developer ID, notarized, stapled" : "ad-hoc"}).`,
);
