import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  analyzeAudioFile,
  engineVersion,
} from "../dist-electron/electron/oracle/oracle-engine.js";
import {
  corpusDirectory,
  generatedCasesPath,
  readJson,
  root,
  sha256File,
  writeJson,
} from "./lib/validation-corpus.mjs";
import {
  eligibleOriginCalibrationCase,
  eligibleOriginEdgeCase,
  eligibleOriginObservationalCase,
  originFeatureRecord,
} from "./lib/origin-calibration.mjs";

const matrixSchema = "Audio-V origin calibration feature matrix v4";

function argumentsMap(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith("--") || values[index + 1] === undefined) {
      throw new Error(`Expected --name value arguments; received ${key ?? "(end)"}.`);
    }
    result.set(key.slice(2), values[index + 1]);
  }
  return result;
}

const args = argumentsMap(process.argv.slice(2));
const population = args.get("population") ?? "controlled";
if (!["controlled", "observational", "edge"].includes(population)) {
  throw new Error("--population must be controlled, observational, or edge.");
}
const requestedDatasets = new Set(
  (args.get("datasets") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
if (population !== "controlled" && requestedDatasets.size === 0) {
  throw new Error(
    "Observational export requires an explicit --datasets allowlist.",
  );
}
const requestedSplits = new Set(
  (args.get("splits") ?? "development")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const allowedSplits = new Set([
  "development",
  "calibration",
  "test",
  ...(population !== "controlled" ? ["challenge"] : []),
]);
for (const split of requestedSplits) {
  if (!allowedSplits.has(split)) {
    throw new Error(
      `--splits may contain only development, calibration, and test; received ${split}.`,
    );
  }
}
const generated = await readJson(generatedCasesPath);
const selectedCases = generated.cases.filter((item) =>
  population === "controlled"
    ? eligibleOriginCalibrationCase(item, requestedSplits)
    : population === "observational"
      ? eligibleOriginObservationalCase(
        item,
        requestedSplits,
        requestedDatasets,
      )
      : eligibleOriginEdgeCase(item, requestedSplits, requestedDatasets),
);
const splitLabel =
  args.get("label") ??
  (population === "controlled"
    ? [...requestedSplits].sort().join("-")
    : `${[...requestedDatasets].sort().join("-")}-observational`);
const outputPath = path.join(
  root,
  "build",
  `origin-calibration-features-${splitLabel}.json`,
);
const checkpointPath = `${outputPath}.checkpoint`;
const requestedConcurrency = Number.parseInt(
  process.env.AUDIO_V_CALIBRATION_CONCURRENCY ?? "",
  10,
);
const concurrency = Number.isInteger(requestedConcurrency)
  ? Math.max(1, Math.min(8, requestedConcurrency))
  : Math.max(1, Math.min(4, os.availableParallelism()));

let reusable = [];
const buildEntries = await fs.readdir(path.join(root, "build"), {
  withFileTypes: true,
});
const compatibleMatrixPaths = buildEntries
  .filter(
    (entry) =>
      entry.isFile() &&
      entry.name.startsWith("origin-calibration-features-") &&
      entry.name.endsWith(".json"),
  )
  .map((entry) => path.join(root, "build", entry.name));
for (const candidatePath of [
  ...new Set([outputPath, checkpointPath, ...compatibleMatrixPaths]),
]) {
  try {
    const candidate = await readJson(candidatePath);
    if (
      candidate.schema === matrixSchema &&
      candidate.population === population &&
      candidate.engineVersion === engineVersion &&
      candidate.corpusVersion === generated.corpusVersion &&
      candidate.recipeSetVersion === generated.recipeSetVersion
    ) {
      reusable.push(...(candidate.records ?? []));
    }
  } catch {
    // A first run has no reusable matrix or checkpoint.
  }
}
const reusableByIdentity = new Map(
  reusable.map((record) => [`${record.id}:${record.sha256}`, record]),
);
const records = new Array(selectedCases.length);
let nextIndex = 0;
let completed = 0;
let newlyAnalyzed = 0;
let checkpointWrite = Promise.resolve();

function matrix(completedRecords) {
  return {
    schema: matrixSchema,
    generatedAt: new Date().toISOString(),
    engineVersion,
    corpusVersion: generated.corpusVersion,
    recipeSetVersion: generated.recipeSetVersion,
    population,
    datasets: [...requestedDatasets].sort(),
    splits: [...requestedSplits].sort(),
    independenceUnit: "source-group",
    records: completedRecords,
  };
}

function saveCheckpoint() {
  const completedRecords = records.filter(Boolean);
  checkpointWrite = checkpointWrite.then(() =>
    writeJson(checkpointPath, matrix(completedRecords)),
  );
  return checkpointWrite;
}

async function worker() {
  while (nextIndex < selectedCases.length) {
    const index = nextIndex;
    nextIndex += 1;
    const item = selectedCases[index];
    const filePath = path.join(corpusDirectory, item.file);
    const actualHash = await sha256File(filePath);
    if (actualHash !== item.sha256) {
      throw new Error(`${item.id}: calibration source SHA-256 changed.`);
    }
    const prior = reusableByIdentity.get(`${item.id}:${item.sha256}`);
    if (prior) {
      records[index] = {
        ...prior,
        originDetectorEligibility: item.originDetectorEligibility,
      };
    } else {
      records[index] = originFeatureRecord(
        item,
        await analyzeAudioFile(filePath),
      );
      newlyAnalyzed += 1;
    }
    completed += 1;
    if (completed % 10 === 0 || completed === selectedCases.length) {
      console.log(
        `Calibration features ${completed}/${selectedCases.length} ` +
          `(${newlyAnalyzed} newly analyzed).`,
      );
    }
    if (newlyAnalyzed > 0 && newlyAnalyzed % 10 === 0) {
      await saveCheckpoint();
    }
  }
}

console.log(
  `Exporting ${selectedCases.length} ${population} origin cases from ` +
    `${[...requestedSplits].sort().join(", ")} with ${concurrency} bounded worker(s).`,
);
await Promise.all(
  Array.from(
    { length: Math.min(concurrency, selectedCases.length || 1) },
    () => worker(),
  ),
);
await checkpointWrite;
await writeJson(outputPath, matrix(records));
await fs.rm(checkpointPath, { force: true });
console.log(
  `Wrote ${records.length} path-free calibration feature records to ${outputPath}.`,
);
