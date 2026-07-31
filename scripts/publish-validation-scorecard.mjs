import path from "node:path";
import {
  readJson,
  root,
  writeJson,
} from "./lib/validation-corpus.mjs";

const scorecard = await readJson(
  path.join(root, "build", "real-world-scorecard-latest.json"),
);
const status = await readJson(
  path.join(root, "build", "real-world-validation-latest.json"),
);
if (scorecard.status !== "evaluated" || scorecard.cases.total === 0) {
  throw new Error("A measured real-world scorecard is required for publication.");
}
if (status.latestScorecard?.engineVersion !== scorecard.engineVersion) {
  throw new Error("Validation status and scorecard engine versions do not match.");
}
const slug = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/gu, "-")
    .replace(/^-|-$/gu, "");
const outputPath = path.join(
  root,
  "validation",
  "real-world",
  "scorecards",
  `${slug(scorecard.engineVersion)}-corpus-${slug(scorecard.corpusVersion)}.json`,
);
const published = {
  schema: "Audio-V published external validation scorecard v1",
  publishedAt: new Date().toISOString(),
  engineVersion: scorecard.engineVersion,
  corpusVersion: scorecard.corpusVersion,
  registryVersion: scorecard.registryVersion,
  recipeSetVersion: scorecard.recipeSetVersion,
  claimScope: scorecard.claimScope,
  readiness: status.readiness,
  claimLevel: status.claimLevel,
  independentReferences: scorecard.independentReferences,
  sourceGroups: scorecard.contributorGroups,
  cases: scorecard.cases,
  detectors: scorecard.detectors,
  groupedMetrics: scorecard.groupedMetrics,
  confidenceInterval: scorecard.confidenceInterval,
  limitations: scorecard.limitations,
  reproducibility: {
    sourceRegistry: "validation/real-world/external-datasets.json",
    corpusManifest: "validation/real-world/corpus.json",
    recipes: "validation/real-world/recipes.json",
    generationCommand: "npm run corpus:generate",
    evaluationCommand: "npm run validate:real-world",
    caseLevelResults:
      "Generated locally in build/real-world-scorecard-latest.json and intentionally excluded from Git because they contain large reproducible working evidence.",
  },
};
await writeJson(outputPath, published);
console.log(
  `Published aggregate validation scorecard: ${path.relative(root, outputPath)}.`,
);
