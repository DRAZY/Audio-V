import path from "node:path";
import { readJson, root, writeJson } from "./lib/validation-corpus.mjs";

const measurements = [
  "spectralRolloff85Hz",
  "spectralRolloff95Hz",
  "spectralRolloff99Hz",
  "energyAbove15kDb",
  "energyAbove18kDb",
  "energyAbove20kDb",
  "effectiveBandwidthEdgeDropDb",
  "normalizedSpectralFluxDb",
  "highBandFlatnessDb",
  "highBandCrestDb",
  "highBandEntropyPercent",
  "highBandFloorOccupancyPercent",
];

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

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function quantile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function rounded(value) {
  return value === null ? null : Number(value.toFixed(3));
}

function summarize(records) {
  const groupRecords = Map.groupBy(records, (record) => record.groupId);
  const featureSummary = {};
  for (const measurement of measurements) {
    const values = records
      .map((record) => record.features[measurement])
      .filter((value) => Number.isFinite(value));
    const groupMedians = [...groupRecords.values()]
      .map((group) =>
        median(
          group
            .map((record) => record.features[measurement])
            .filter((value) => Number.isFinite(value)),
        ),
      )
      .filter((value) => value !== null);
    featureSummary[measurement] = {
      measuredCases: values.length,
      missingCases: records.length - values.length,
      measuredSourceGroups: groupMedians.length,
      sourceGroupMedianP10: rounded(quantile(groupMedians, 0.1)),
      sourceGroupMedianP50: rounded(quantile(groupMedians, 0.5)),
      sourceGroupMedianP90: rounded(quantile(groupMedians, 0.9)),
      caseMinimum: rounded(quantile(values, 0)),
      caseMaximum: rounded(quantile(values, 1)),
    };
  }
  return {
    cases: records.length,
    sourceGroups: groupRecords.size,
    features: featureSummary,
  };
}

const args = argumentsMap(process.argv.slice(2));
const splitLabel = args.get("label") ?? args.get("splits") ?? "development";
const inputPath = path.join(
  root,
  "build",
  `origin-calibration-features-${splitLabel}.json`,
);
const matrix = await readJson(inputPath);
const truthClasses = Map.groupBy(matrix.records, (record) => record.truthClass);
const recipes = Map.groupBy(matrix.records, (record) => record.recipeId);
const report = {
  schema: "Audio-V origin feature separation report v1",
  generatedAt: new Date().toISOString(),
  engineVersion: matrix.engineVersion,
  corpusVersion: matrix.corpusVersion,
  recipeSetVersion: matrix.recipeSetVersion,
  population: matrix.population ?? "controlled",
  datasets: matrix.datasets ?? [],
  splits: matrix.splits,
  independenceUnit: "source-group",
  records: matrix.records.length,
  byTruthClass: Object.fromEntries(
    [...truthClasses.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([truthClass, records]) => [truthClass, summarize(records)]),
  ),
  byRecipe: Object.fromEntries(
    [...recipes.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([recipe, records]) => [recipe, summarize(records)]),
  ),
  interpretation:
    "Percentiles are calculated across source-group medians so many derivatives of one recording cannot dominate the result. These measurements are diagnostic and do not alter Oracle v12 verdicts.",
};
const outputPath = path.join(
  root,
  "build",
  `origin-feature-separation-${splitLabel}.json`,
);
await writeJson(outputPath, report);
console.log(JSON.stringify(report, null, 2));
console.log(`Wrote origin feature separation report to ${outputPath}.`);
