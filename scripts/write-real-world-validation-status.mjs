import { access } from "node:fs/promises";
import path from "node:path";
import {
  corpusPath,
  countBy,
  generatedCasesPath,
  readJson,
  recipesPath,
  root,
  validateCorpus,
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
validation.errors.push(
  ...validateRecipes(recipes, corpus.policy.minimumCasesPerMaster).errors,
);
const requiredInfrastructure = [
  "CORPUS_CONTRIBUTION_AGREEMENT.md",
  "docs/VALIDATION_CORPUS.md",
  "validation/real-world/schemas/corpus.schema.json",
  "validation/real-world/schemas/recipes.schema.json",
  "scripts/import-validation-master.mjs",
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
const splits = countBy(publicMasters, "split");
const requiredPartitionsPresent = ["development", "calibration", "test"].every(
  (split) => (splits[split] ?? 0) > 0,
);
let readiness = "awaiting-source-masters";
if (publicMasters.length > 0) readiness = "pilot-building";
if (
  publicMasters.length >= corpus.policy.pilotIndependentMasters &&
  requiredPartitionsPresent
) {
  readiness = "pilot-ready";
}
if (
  publicMasters.length >= corpus.policy.targetIndependentMasters &&
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
    publicMasters.length === 0
      ? "synthetic-regression-only"
      : readiness === "target-corpus-ready"
        ? "real-world-corpus-present-not-probability-calibrated"
        : "pilot-real-world-evidence",
  counts: {
    independentMasters,
    publicIndependentMasters: publicMasters.length,
    privateChallengeMasters: corpus.masters.filter(
      (master) => !master.rights.redistributable || master.split === "challenge",
    ).length,
    contributorGroups: validation.groupCount,
    redistributableMasters: corpus.masters.filter(
      (master) => master.rights.redistributable,
    ).length,
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
    publicMasters.length === 0
      ? "No licensed, provenance-labeled source masters have been imported. Oracle origin rules remain synthetic-regression tested only."
      : "Real-world recordings are present, but claims remain limited to the disclosed corpus and scorecard.",
    "Synthetic fixtures and derivatives do not increase the independent-master count.",
    "Target-corpus readiness does not by itself establish probability calibration or universal provenance accuracy.",
  ],
};
await writeJson(outputPath, report);
console.log(
  `Real-world validation: ${readiness}; ${publicMasters.length}/${corpus.policy.targetIndependentMasters} public independent masters; infrastructure ${report.infrastructurePassed ? "valid" : "invalid"}.`,
);
if (!report.infrastructurePassed) process.exitCode = 1;
