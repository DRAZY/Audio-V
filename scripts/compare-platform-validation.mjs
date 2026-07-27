import { promises as fs } from "node:fs";
import path from "node:path";

const files = process.argv.slice(2);
if (files.length !== 2) {
  throw new Error(
    "Usage: node scripts/compare-platform-validation.mjs <mac-snapshot.json> <windows-snapshot.json>",
  );
}

const [left, right] = await Promise.all(
  files.map(async (file) => JSON.parse(await fs.readFile(file, "utf8"))),
);
const exactFields = [
  "engineVersion",
  "scope",
  "verdict",
  "originClassification",
  "originReason",
  "fileSha256",
  "codec",
  "sampleRate",
  "channels",
  "frames",
];
const tolerances = {
  durationSeconds: 0.001,
  samplePeakDbfs: 0.01,
  rmsDbfs: 0.02,
  integratedLufs: 0.1,
  loudnessRangeLu: 0.1,
  truePeakDbtp: 0.1,
  effectiveBandwidthHz: 200,
  strongestCutoffHz: 200,
  cutoffDropDb: 0.5,
};
const failures = [];
const rightByFixture = new Map(
  right.fixtures.map((item) => [item.fixture, item]),
);

for (const expected of left.fixtures) {
  const actual = rightByFixture.get(expected.fixture);
  if (!actual) {
    failures.push(`${expected.fixture}: missing from ${right.platform}`);
    continue;
  }
  for (const field of exactFields) {
    if (expected[field] !== actual[field]) {
      failures.push(
        `${expected.fixture}.${field}: ${JSON.stringify(expected[field])} != ${JSON.stringify(actual[field])}`,
      );
    }
  }
  for (const [field, tolerance] of Object.entries(tolerances)) {
    const a = expected[field];
    const b = actual[field];
    if (a === null || b === null) {
      if (a !== b) {
        failures.push(`${expected.fixture}.${field}: nullability differs`);
      }
    } else if (Math.abs(a - b) > tolerance) {
      failures.push(
        `${expected.fixture}.${field}: |${a} - ${b}| exceeds ${tolerance}`,
      );
    }
  }
}

if (left.fixtures.length !== right.fixtures.length) {
  failures.push(
    `fixture counts differ: ${left.fixtures.length} != ${right.fixtures.length}`,
  );
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Cross-platform Oracle parity passed for ${left.fixtures.length} fixtures (${left.platform}/${left.architecture} vs ${right.platform}/${right.architecture}).`,
  );
}
