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

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

for (const name of artifactNames) {
  const file = path.join(release, name);
  const stat = await fs.stat(file);
  artifacts.push({
    name,
    bytes: stat.size,
    sha256: await sha256(file),
    signingStatus: name.endsWith(".dmg")
      ? "ad-hoc-app-signature-no-developer-identity"
      : "unsigned-by-project-policy",
  });
}

const manifest = {
  schema: "Audio-V development release manifest v2",
  product: "Audio-V",
  version: packageJson.version,
  projectLicense: packageJson.license,
  correspondingSource: `https://github.com/DRAZY/Audio-V/tree/v${packageJson.version}`,
  distribution: "open-source-development",
  signingPolicy:
    "macOS app bundles are whole-bundle ad-hoc signed for code-integrity validation but have no Developer ID identity and are not notarized. Windows artifacts are unsigned. Verify SHA-256 values against the GitHub Release before opening.",
  futureSigningReady: {
    macDeveloperIdAndNotarization: "optional-not-configured",
    windowsAuthenticode: "optional-not-configured",
  },
  artifacts,
};
await fs.writeFile(
  path.join(release, "UNSIGNED_RELEASE_MANIFEST.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`Wrote development release manifest for ${artifacts.length} artifacts.`);
