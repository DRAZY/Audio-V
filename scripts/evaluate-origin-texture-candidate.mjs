import path from "node:path";
import {
  matchesTextureCandidateV2,
  textureCandidateV2,
} from "./lib/origin-calibration.mjs";
import { readJson, root, writeJson } from "./lib/validation-corpus.mjs";

function summarize(records) {
  const hits = records.filter(matchesTextureCandidateV2);
  return {
    cases: records.length,
    hits: hits.length,
    hitSourceGroups: new Set(hits.map((record) => record.groupId)).size,
  };
}

function populationSummary(matrix) {
  const byTruthClass = Map.groupBy(matrix.records, (record) => record.truthClass);
  const byRecipe = Map.groupBy(matrix.records, (record) => record.recipeId);
  return {
    population: matrix.population ?? "controlled",
    datasets: matrix.datasets ?? [],
    splits: matrix.splits,
    cases: matrix.records.length,
    sourceGroups: new Set(matrix.records.map((record) => record.groupId)).size,
    byTruthClass: Object.fromEntries(
      [...byTruthClass.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([truthClass, records]) => [truthClass, summarize(records)]),
    ),
    byRecipe: Object.fromEntries(
      [...byRecipe.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([recipe, records]) => [recipe, summarize(records)]),
    ),
  };
}

const controlled = await readJson(
  path.join(root, "build", "origin-calibration-features-development.json"),
);
const maestro = await readJson(
  path.join(
    root,
    "build",
    "origin-calibration-features-maestro-observational.json",
  ),
);
const populations = {
  controlledDevelopment: populationSummary(controlled),
  maestroObservational: populationSummary(maestro),
};
const maestroControls = ["native-control", "intentional-lowpass", "upsample"];
const maestroControlHits = maestroControls.reduce(
  (sum, truthClass) =>
    sum + (populations.maestroObservational.byTruthClass[truthClass]?.hits ?? 0),
  0,
);
const report = {
  schema: "Audio-V origin texture candidate evaluation v2",
  generatedAt: new Date().toISOString(),
  engineVersion: controlled.engineVersion,
  corpusVersion: controlled.corpusVersion,
  recipeSetVersion: controlled.recipeSetVersion,
  independenceUnit: "source-group",
  candidate: textureCandidateV2,
  populations,
  decision:
    maestroControlHits === 0
      ? "eligible-for-further-calibration"
      : "rejected-non-generalizing",
  verdictImpact: "none",
  interpretation:
    maestroControlHits === 0
      ? "The frozen development candidate produced no MAESTRO control hits; further calibration would still be required before any production use."
      : "The frozen development candidate hit MAESTRO native, intentional-processing, or upsample controls. Quiet high-frequency content can mimic this texture pattern, so it must not influence production verdicts.",
};
const outputPath = path.join(root, "build", "origin-texture-candidate-v2.json");
await writeJson(outputPath, report);
console.log(JSON.stringify(report, null, 2));
console.log(`Wrote origin texture candidate evaluation to ${outputPath}.`);
