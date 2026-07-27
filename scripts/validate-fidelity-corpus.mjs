import { promises as fs } from "node:fs";
import path from "node:path";
import {
  analyzeAudioFile,
  engineVersion,
} from "../dist-electron/electron/oracle/oracle-engine.js";

const root = process.cwd();
const manifestPath = path.join(root, "validation", "fidelity-corpus.json");
const fixtureDirectory = path.join(root, "tests", "fixtures", "fidelity-engine");
const outputPath = path.join(root, "build", "fidelity-validation-latest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const results = [];

for (const item of manifest.cases) {
  const result = await analyzeAudioFile(
    path.join(fixtureDirectory, item.file),
  );
  const actual = result.fidelity?.classification ?? "not-assessed";
  results.push({
    file: item.file,
    truth: item.truth,
    acceptedClassifications: item.acceptedClassifications,
    actualClassification: actual,
    reasonCode: result.fidelity?.reasonCode ?? null,
    ruleStrength: result.fidelity?.confidence ?? null,
    evidenceCoverage: result.fidelity?.evidenceCoverage ?? 0,
    passed: item.acceptedClassifications.includes(actual),
  });
}

const passedCases = results.filter((item) => item.passed).length;
const report = {
  schema: "Audio-V fidelity validation result v1",
  measuredAt: new Date().toISOString(),
  engineVersion,
  corpus: path.relative(root, manifestPath),
  calibrationStatus: "regression-only-not-probability-calibrated",
  summary: {
    totalCases: results.length,
    passedCases,
    failedCases: results.length - passedCases,
    accuracyPercent: Number((passedCases / results.length * 100).toFixed(2)),
  },
  limitations: [
    "The corpus is synthetic and intentionally small.",
    "Passing this suite validates deterministic rule behavior, not real-world prevalence or probability calibration.",
    "Market calibration requires licensed, provenance-labeled recordings spanning genres, eras, mastering styles, codecs, bitrates, sample rates, and transformations.",
  ],
  results,
  passed: passedCases === results.length,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

for (const item of results) {
  console.log(
    `${item.passed ? "PASS" : "FAIL"} ${item.file}: ${item.actualClassification} (${item.evidenceCoverage}% coverage)`,
  );
}
console.log(
  `Fidelity corpus: ${passedCases}/${results.length} classifications matched.`,
);

if (!report.passed) process.exitCode = 1;
