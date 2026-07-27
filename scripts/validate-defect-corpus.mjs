import { promises as fs } from "node:fs";
import path from "node:path";
import {
  analyzeAudioFile,
  engineVersion,
} from "../dist-electron/electron/oracle/oracle-engine.js";

const root = process.cwd();
const manifestPath = path.join(root, "validation", "defect-corpus.json");
const fixtureDirectory = path.join(root, "tests", "fixtures", "defect-engine");
const outputPath = path.join(root, "build", "defect-validation-latest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const results = [];

function within(actual, expected) {
  return actual >= expected.minimum && actual <= expected.maximum;
}

for (const item of manifest.cases) {
  const result = await analyzeAudioFile(path.join(fixtureDirectory, item.file));
  const defects = result.measurements?.defects;
  const actual = {
    clickPopCandidates: defects?.clickPopCandidateCount ?? -1,
    stuckSampleCandidates: defects?.stuckSampleCandidateCount ?? -1,
  };
  const passed =
    result.analysisState === "completed" &&
    within(actual.clickPopCandidates, item.clickPopCandidates) &&
    within(actual.stuckSampleCandidates, item.stuckSampleCandidates);
  results.push({
    file: item.file,
    truth: item.truth,
    expected: {
      clickPopCandidates: item.clickPopCandidates,
      stuckSampleCandidates: item.stuckSampleCandidates,
    },
    actual,
    analysisState: result.analysisState,
    passed,
  });
}

const passedCases = results.filter((result) => result.passed).length;
const report = {
  schema: "Audio-V native defect validation result v1",
  measuredAt: new Date().toISOString(),
  engineVersion,
  corpus: path.relative(root, manifestPath),
  evidenceClass: "native-decoded-synthetic-regression",
  summary: {
    totalCases: results.length,
    passedCases,
    failedCases: results.length - passedCases,
  },
  limitations: manifest.limitations,
  results,
  passed: passedCases === results.length,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
for (const result of results) {
  console.log(
    `${result.passed ? "PASS" : "FAIL"} ${result.file}: ` +
      `${result.actual.clickPopCandidates} click/pop, ` +
      `${result.actual.stuckSampleCandidates} stuck`,
  );
}
console.log(`Defect corpus: ${passedCases}/${results.length} cases matched.`);
if (!report.passed) process.exitCode = 1;
