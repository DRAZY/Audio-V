import path from "node:path";
import { readJson, root, writeJson } from "./lib/validation-corpus.mjs";
import { currentRuleBlockers } from "./lib/origin-calibration.mjs";

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

function countBy(values, selector) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => {
      const key = selector(value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map())].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function blockerSummary(records, detector) {
  const blockerRows = records.flatMap((record) =>
    currentRuleBlockers(record, detector).map((blocker) => ({
      blocker,
      groupId: record.groupId,
    })),
  );
  return {
    cases: records.length,
    sourceGroups: new Set(records.map((record) => record.groupId)).size,
    casesPassingCurrentRule: records.filter(
      (record) => currentRuleBlockers(record, detector).length === 0,
    ).length,
    blockerCaseCounts: countBy(blockerRows, (row) => row.blocker),
    blockerSourceGroupCounts: Object.fromEntries(
      Object.entries(
        blockerRows.reduce((groups, row) => {
          (groups[row.blocker] ??= new Set()).add(row.groupId);
          return groups;
        }, {}),
      ).map(([blocker, groups]) => [blocker, groups.size]),
    ),
  };
}

const args = argumentsMap(process.argv.slice(2));
const splitLabel = args.get("splits") ?? "development";
const inputPath = path.join(
  root,
  "build",
  `origin-calibration-features-${splitLabel}.json`,
);
const matrix = await readJson(inputPath);
const lossyRecords = matrix.records.filter((record) =>
  ["lossy-to-lossless", "multi-generation-lossy"].includes(record.truthClass),
);
const upsampleRecords = matrix.records.filter(
  (record) => record.truthClass === "upsample",
);
const report = {
  schema: "Audio-V origin calibration blocker report v1",
  generatedAt: new Date().toISOString(),
  engineVersion: matrix.engineVersion,
  corpusVersion: matrix.corpusVersion,
  recipeSetVersion: matrix.recipeSetVersion,
  splits: matrix.splits,
  records: matrix.records.length,
  sourceGroups: new Set(matrix.records.map((record) => record.groupId)).size,
  byTruthClass: countBy(matrix.records, (record) => record.truthClass),
  byObservedClassification: countBy(
    matrix.records,
    (record) => record.observed.classification,
  ),
  lossy: blockerSummary(lossyRecords, "lossy"),
  upsample: blockerSummary(upsampleRecords, "upsample"),
  interpretation:
    "A blocker count identifies which v12 prerequisites prevented a controlled positive case from reaching its positive classification. It is diagnostic evidence, not a recommendation to lower that threshold.",
};
const outputPath = path.join(
  root,
  "build",
  `origin-calibration-blockers-${splitLabel}.json`,
);
await writeJson(outputPath, report);
console.log(JSON.stringify(report, null, 2));
console.log(`Wrote calibration blocker report to ${outputPath}.`);

