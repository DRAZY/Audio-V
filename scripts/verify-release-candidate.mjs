import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const checks = [];
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);

async function fileCheck(name, relativePath, validate = () => true) {
  try {
    const content = await readFile(path.join(root, relativePath), "utf8");
    checks.push({ name, passed: Boolean(validate(content)), detail: relativePath });
  } catch {
    checks.push({ name, passed: false, detail: `${relativePath} missing` });
  }
}

await fileCheck("AGPL license", "LICENSE", (value) =>
  value.includes("GNU AFFERO GENERAL PUBLIC LICENSE") &&
  value.includes("Version 3, 19 November 2007"),
);
await fileCheck("Contributor agreement", "CONTRIBUTOR_LICENSE_AGREEMENT.md");
await fileCheck("Trademark policy", "TRADEMARKS.md");
await fileCheck("Corresponding-source notice", "SOURCE_OFFER.md");
await fileCheck("User guide", "docs/USER_GUIDE.md");
await fileCheck("Privacy model", "docs/PRIVACY_SECURITY.md");
await fileCheck("Release-candidate checklist", "docs/RELEASE_CANDIDATE_CHECKLIST.md");
await fileCheck("Accessibility result", "build/accessibility-latest.json", (value) =>
  JSON.parse(value).passed === true,
);
await fileCheck(
  "Spectrogram channel rendering",
  "build/spectrogram-channel-validation-latest.json",
  (value) => {
    const report = JSON.parse(value);
    return (
      report.passed === true &&
      Array.isArray(report.results) &&
      report.results.length === 3 &&
      report.results.every(
        (result) =>
          result.paintedPixels === result.width * result.height &&
          result.maximumChannel > 30,
      )
    );
  },
);
await fileCheck("Fidelity corpus result", "build/fidelity-validation-latest.json", (value) =>
  JSON.parse(value).passed === true,
);
await fileCheck("Native defect corpus result", "build/defect-validation-latest.json", (value) =>
  JSON.parse(value).passed === true,
);
await fileCheck(
  "Real-world validation infrastructure",
  "build/real-world-validation-latest.json",
  (value) => JSON.parse(value).infrastructurePassed === true,
);
await fileCheck("Scale benchmark result", "build/performance-latest.json", (value) =>
  JSON.parse(value).passed === true,
);
await fileCheck("Headless CLI result", "build/cli-validation-latest.json", (value) =>
  JSON.parse(value).passed === true,
);

await fileCheck(
  "Unsigned release manifest",
  "release/UNSIGNED_RELEASE_MANIFEST.json",
  (value) => {
    const manifest = JSON.parse(value);
    return (
      manifest.version === packageJson.version &&
      Array.isArray(manifest.artifacts) &&
      manifest.artifacts.length === 4 &&
      manifest.artifacts.every((artifact) =>
        String(artifact.name).includes(packageJson.version)
      ) &&
      manifest.artifacts
        .filter((artifact) => String(artifact.name).endsWith(".dmg"))
        .every(
          (artifact) =>
            artifact.signingStatus ===
            "ad-hoc-app-signature-no-developer-identity",
        ) &&
      manifest.artifacts
        .filter((artifact) => String(artifact.name).endsWith(".exe"))
        .every(
          (artifact) =>
            artifact.signingStatus === "unsigned-by-project-policy",
        )
    );
  },
);

const failed = checks.filter((check) => !check.passed);
const report = {
  schema: "Audio-V release candidate readiness v1",
  measuredAt: new Date().toISOString(),
  automatedChecks: {
    total: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
  },
  checks,
  manualAcceptance:
    "Required clean-OS, assistive-technology, scaling, upgrade, and failure-mode checks are tracked in docs/RELEASE_CANDIDATE_CHECKLIST.md.",
  passed: failed.length === 0,
};
await writeFile(
  path.join(root, "build", "release-readiness-latest.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
for (const check of checks) {
  console.log(`${check.passed ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
}
if (failed.length) process.exitCode = 1;
else console.log(`Release-candidate automated readiness: ${checks.length}/${checks.length} passed.`);
