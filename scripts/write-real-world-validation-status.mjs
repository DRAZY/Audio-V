import { access } from "node:fs/promises";
import path from "node:path";
import {
  corpusPath,
  countBy,
  externalDatasetsPath,
  generatedCasesPath,
  readJson,
  recipesPath,
  root,
  validateCorpus,
  validateExternalDatasets,
  validateRecipes,
  writeJson,
} from "./lib/validation-corpus.mjs";

const outputPath = path.join(root, "build", "real-world-validation-latest.json");
const scorecardPath = path.join(
  root,
  "build",
  "real-world-scorecard-latest.json",
);
const corpus = await readJson(corpusPath);
const validation = validateCorpus(corpus);
const recipes = await readJson(recipesPath);
const externalDatasets = await readJson(externalDatasetsPath);
validation.errors.push(
  ...validateRecipes(recipes, corpus.policy.minimumCasesPerMaster).errors,
  ...validateExternalDatasets(externalDatasets).errors,
);
const requiredInfrastructure = [
  "CORPUS_CONTRIBUTION_AGREEMENT.md",
  "docs/VALIDATION_CORPUS.md",
  "validation/real-world/schemas/corpus.schema.json",
  "validation/real-world/schemas/recipes.schema.json",
  "validation/real-world/schemas/external-datasets.schema.json",
  "validation/real-world/external-datasets.json",
  "scripts/import-validation-reference.mjs",
  "scripts/import-external-dataset.mjs",
  "scripts/plan-validation-corpus.mjs",
  "scripts/verify-external-dataset-archive.mjs",
  "scripts/publish-validation-scorecard.mjs",
  "scripts/generate-real-world-corpus.mjs",
  "scripts/evaluate-real-world-corpus.mjs",
];
const infrastructure = [];
for (const relativePath of requiredInfrastructure) {
  try {
    await access(path.join(root, relativePath));
    infrastructure.push({ path: relativePath, present: true });
  } catch {
    infrastructure.push({ path: relativePath, present: false });
    validation.errors.push(`${relativePath} is missing`);
  }
}

let generatedCases = [];
try {
  generatedCases = (await readJson(generatedCasesPath)).cases ?? [];
} catch {
  // Licensed audio and generated cases are intentionally absent in a fresh clone.
}
let scorecard = null;
try {
  scorecard = await readJson(scorecardPath);
} catch {
  // The status remains useful before the evaluation command is run.
}

const independentMasters = corpus.masters.length;
const publicMasters = corpus.masters.filter(
  (master) => master.rights.redistributable && master.split !== "challenge",
);
const publicSourceGroups = new Set(publicMasters.map((master) => master.groupId));
const originEligibleSourceGroups = new Set(
  publicMasters
    .filter(
      (master) =>
        master.dataset?.role === "controlled-source" &&
        master.technical.sampleRate >= 44100,
    )
    .map((master) => master.groupId),
);
const challengeMasters = corpus.masters.filter(
  (master) => !master.rights.redistributable || master.split === "challenge",
);
const challengeSourceGroups = new Set(
  challengeMasters.map((master) => master.groupId),
);
const splits = countBy(
  [...publicSourceGroups].map((groupId) =>
    publicMasters.find((master) => master.groupId === groupId),
  ),
  "split",
);
const requiredPartitionsPresent = ["development", "calibration", "test"].every(
  (split) => (splits[split] ?? 0) > 0,
);
let readiness = "awaiting-external-references";
if (publicSourceGroups.size > 0) readiness = "pilot-building";
if (
  publicSourceGroups.size >= corpus.policy.pilotIndependentMasters &&
  requiredPartitionsPresent
) {
  readiness = "pilot-ready";
}
if (
  publicSourceGroups.size >= corpus.policy.targetIndependentMasters &&
  requiredPartitionsPresent
) {
  readiness = "target-corpus-ready";
}

const report = {
  schema: "Audio-V real-world validation status v1",
  generatedAt: new Date().toISOString(),
  corpusVersion: corpus.corpusVersion,
  readiness,
  infrastructurePassed: validation.errors.length === 0,
  milestoneAchieved: readiness === "target-corpus-ready",
  claimLevel:
    publicSourceGroups.size === 0
      ? "synthetic-regression-only"
      : originEligibleSourceGroups.size === 0
        ? "edge-control-evidence-only"
      : readiness === "target-corpus-ready"
        ? "real-world-corpus-present-not-probability-calibrated"
        : "pilot-real-world-evidence",
  counts: {
    independentMasters,
    independentReferences: validation.groupCount,
    publicIndependentMasters: publicMasters.length,
    publicIndependentReferences: publicSourceGroups.size,
    originEligibleReferences: originEligibleSourceGroups.size,
    privateChallengeMasters: challengeMasters.length,
    challengeReferences: challengeSourceGroups.size,
    contributorGroups: validation.groupCount,
    sourceGroups: validation.groupCount,
    redistributableMasters: corpus.masters.filter(
      (master) => master.rights.redistributable,
    ).length,
    byDataset: countBy(
      corpus.masters,
      (master) => master.dataset?.id ?? "manual-import",
    ),
    generatedCases: generatedCases.length,
    bySplit: splits,
  },
  thresholds: {
    pilotIndependentMasters: corpus.policy.pilotIndependentMasters,
    targetIndependentMasters: corpus.policy.targetIndependentMasters,
    minimumCasesPerMaster: corpus.policy.minimumCasesPerMaster,
  },
  latestScorecard: scorecard
    ? {
        status: scorecard.status,
        engineVersion: scorecard.engineVersion,
        measuredAt: scorecard.measuredAt,
        acceptedClassificationRate:
          scorecard.cases.acceptedClassificationRate,
      }
    : null,
  infrastructure,
  errors: validation.errors,
  limitations: [
    publicSourceGroups.size === 0
      ? "No licensed, provenance-labeled external reference recordings have been imported. Oracle origin rules remain synthetic-regression tested only."
      : originEligibleSourceGroups.size === 0
        ? "The imported external references validate safe abstention on narrow-band edge material; they do not yet measure transcode or upsample sensitivity."
      : "Real-world recordings are present, but claims remain limited to the disclosed corpus and scorecard.",
    "Synthetic fixtures and derivatives do not increase the independent-reference count.",
    "External dataset audio remains local, license-governed, and excluded from application packages.",
    "Target-corpus readiness does not by itself establish probability calibration or universal provenance accuracy.",
  ],
};
await writeJson(outputPath, report);
console.log(
  `Real-world validation: ${readiness}; ${publicSourceGroups.size}/${corpus.policy.targetIndependentMasters} public independent references; infrastructure ${report.infrastructurePassed ? "valid" : "invalid"}.`,
);
if (!report.infrastructurePassed) process.exitCode = 1;
