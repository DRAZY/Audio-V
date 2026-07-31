import { promises as fs } from "node:fs";
import path from "node:path";
import {
  analyzeAudioFile,
  engineVersion,
} from "../dist-electron/electron/oracle/oracle-engine.js";
import {
  clopperPearson,
  corpusDirectory,
  corpusPath,
  countBy,
  externalDatasetsPath,
  generatedCasesPath,
  readJson,
  root,
  sha256File,
  validateCorpus,
  validateExternalDatasets,
  writeJson,
} from "./lib/validation-corpus.mjs";

const outputPath = path.join(root, "build", "real-world-scorecard-latest.json");
const corpus = await readJson(corpusPath);
const validation = validateCorpus(corpus);
const externalDatasets = await readJson(externalDatasetsPath);
validation.errors.push(...validateExternalDatasets(externalDatasets).errors);
if (validation.errors.length) throw new Error(validation.errors.join("\n"));

function rate(successes, total) {
  return {
    numerator: successes,
    denominator: total,
    percent: total ? Number(((successes / total) * 100).toFixed(2)) : null,
    confidence95Percent: clopperPearson(successes, total),
  };
}

let generated = null;
try {
  generated = await readJson(generatedCasesPath);
} catch {
  generated = {
    schema: "Audio-V real-world generated cases v2",
    corpusVersion: corpus.corpusVersion,
    recipeSetVersion: null,
    cases: [],
  };
}

const groupSplits = new Map();
for (const item of generated.cases) {
  const prior = groupSplits.get(item.groupId);
  if (prior && prior !== item.split) {
    throw new Error(
      `${item.groupId} appears in both ${prior} and ${item.split}; evaluation leakage is forbidden.`,
    );
  }
  groupSplits.set(item.groupId, item.split);
}

let priorScorecard = null;
try {
  priorScorecard = await readJson(outputPath);
} catch {
  // A fresh evaluation has no reusable prior results.
}
const reusableResults = new Map(
  priorScorecard?.engineVersion === engineVersion
    ? (priorScorecard.results ?? []).map((item) => [
        `${item.id}:${item.sha256}`,
        item,
      ])
    : [],
);
const results = [];
let reusedCases = 0;
for (const item of generated.cases) {
  const filePath = path.join(corpusDirectory, item.file);
  const actualHash = await sha256File(filePath);
  if (actualHash !== item.sha256) {
    throw new Error(`${item.id}: generated-case SHA-256 changed.`);
  }
  const reusable = reusableResults.get(`${item.id}:${item.sha256}`);
  let observed;
  if (reusable) {
    reusedCases += 1;
    observed = {
      actualClassification: reusable.actualClassification,
      actualAnalysisState: reusable.actualAnalysisState,
      actualStereoAssessment: reusable.actualStereoAssessment,
      actualClippedSamples: reusable.actualClippedSamples,
      reasonCode: reusable.reasonCode,
      ruleStrength: reusable.ruleStrength,
      evidenceCoverage: reusable.evidenceCoverage,
    };
  } else {
    const result = await analyzeAudioFile(filePath);
    observed = {
      actualClassification:
        result.fidelity?.classification ?? "not-assessed",
      actualAnalysisState:
        result.analysisState ??
        (result.verdict === "damaged"
          ? "failed"
          : result.measurements
            ? "completed"
            : "error"),
      actualStereoAssessment:
        result.measurements?.stereoAssessment ?? null,
      actualClippedSamples: result.measurements?.clippedSamples ?? null,
      reasonCode: result.fidelity?.reasonCode ?? null,
      ruleStrength: result.fidelity?.confidence ?? null,
      evidenceCoverage: result.fidelity?.evidenceCoverage ?? 0,
    };
  }
  const checks = [];
  if (item.acceptedClassifications.length > 0) {
    checks.push(
      item.acceptedClassifications.includes(observed.actualClassification),
    );
  }
  if (item.expected?.analysisStates) {
    checks.push(
      item.expected.analysisStates.includes(observed.actualAnalysisState),
    );
  }
  if (item.expected?.stereoAssessments) {
    checks.push(
      item.expected.stereoAssessments.includes(
        observed.actualStereoAssessment ?? "unavailable",
      ),
    );
  }
  if (item.expected?.minimumClippedSamples) {
    checks.push(
      (observed.actualClippedSamples ?? 0) >=
        item.expected.minimumClippedSamples,
    );
  }
  results.push({
    ...item,
    ...observed,
    passed: checks.length > 0 && checks.every(Boolean),
  });
  if (results.length % 25 === 0 || results.length === generated.cases.length) {
    console.log(
      `Evaluated ${results.length}/${generated.cases.length} controlled cases.`,
    );
  }
}

function detectorMetrics(classification, truthClasses, population = results) {
  const positiveTruthClasses = new Set(
    Array.isArray(truthClasses) ? truthClasses : [truthClasses],
  );
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  let inconclusive = 0;
  let excluded = 0;
  let eligible = 0;
  for (const item of population) {
    const positiveTruth = positiveTruthClasses.has(item.truthClass);
    const eligibility = item.originDetectorEligibility ?? "positive-and-negative";
    if (
      eligibility === "edge-abstention" ||
      (positiveTruth && eligibility !== "positive-and-negative")
    ) {
      excluded += 1;
      continue;
    }
    eligible += 1;
    const positiveResult = item.actualClassification === classification;
    if (
      ["inconclusive", "not-assessed"].includes(item.actualClassification)
    ) {
      inconclusive += 1;
    }
    if (positiveTruth && positiveResult) truePositive += 1;
    else if (positiveTruth) falseNegative += 1;
    else if (positiveResult) falsePositive += 1;
    else trueNegative += 1;
  }
  return {
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    inconclusive,
    eligible,
    excluded,
    sensitivity: rate(truePositive, truePositive + falseNegative),
    precision: rate(truePositive, truePositive + falsePositive),
    specificity: rate(trueNegative, trueNegative + falsePositive),
    negativePredictiveValue: rate(
      trueNegative,
      trueNegative + falseNegative,
    ),
    falsePositiveRate: rate(falsePositive, falsePositive + trueNegative),
    falseNegativeRate: rate(falseNegative, falseNegative + truePositive),
    inconclusiveRate: rate(inconclusive, eligible),
    coverage: rate(eligible - inconclusive, eligible),
  };
}

function edgeControlMetrics(population = results) {
  const edgeCases = population.filter(
    (item) => item.originDetectorEligibility === "edge-abstention",
  );
  const safeAbstentions = edgeCases.filter((item) =>
    ["inconclusive", "not-assessed"].includes(item.actualClassification),
  ).length;
  const originAdvisories = edgeCases.filter((item) =>
    ["possible-lossy-transcode", "possible-upsample"].includes(
      item.actualClassification,
    ),
  ).length;
  return {
    cases: edgeCases.length,
    safeAbstentions,
    originAdvisories,
    safeAbstentionRate: rate(safeAbstentions, edgeCases.length),
    originAdvisoryRate: rate(originAdvisories, edgeCases.length),
  };
}

function groupedMetrics(key) {
  const groups = new Map();
  for (const item of results) {
    const group = typeof key === "function" ? key(item) : item[key];
    const population = groups.get(group) ?? [];
    population.push(item);
    groups.set(group, population);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
      .map(([group, population]) => {
        const passed = population.filter((item) => item.passed).length;
        return [
          group,
          {
            cases: population.length,
            acceptedClassificationRate: rate(passed, population.length),
            lossyToLossless: detectorMetrics(
              "possible-lossy-transcode",
              ["lossy-to-lossless", "multi-generation-lossy"],
              population,
            ),
            upsample: detectorMetrics(
              "possible-upsample",
              "upsample",
              population,
            ),
          },
        ];
      }),
  );
}

const passedCases = results.filter((item) => item.passed).length;
const originEligibleCases = results.filter(
  (item) => item.originDetectorEligibility !== "edge-abstention",
).length;
const scorecard = {
  schema: "Audio-V real-world validation scorecard v1",
  measuredAt: new Date().toISOString(),
  status: results.length ? "evaluated" : "not-evaluated-no-external-references",
  engineVersion,
  corpusVersion: corpus.corpusVersion,
  registryVersion: externalDatasets.registryVersion,
  recipeSetVersion: generated.recipeSetVersion,
  reusedCases,
  claimScope:
    results.length === 0
      ? "not-evaluated"
      : originEligibleCases === 0
        ? "edge-abstention-only"
        : "origin-detector-and-edge-controls",
  independentMasters: corpus.masters.length,
  independentReferences: validation.groupCount,
  contributorGroups: validation.groupCount,
  cases: {
    total: results.length,
    originEligible: originEligibleCases,
    edgeControl: results.length - originEligibleCases,
    bySplit: countBy(results, "split"),
    byTruthClass: countBy(results, "truthClass"),
    byRecipe: countBy(results, "recipeId"),
    byDataset: countBy(
      results,
      (item) =>
        corpus.masters.find((master) => master.id === item.masterId)?.dataset
          ?.id ?? "manual-import",
    ),
    bySourceCategory: countBy(
      results,
      (item) => item.sourceCategory ?? "unspecified",
    ),
    bySourceStratum: countBy(
      results,
      (item) => item.sourceStratum ?? "unspecified",
    ),
    passed: passedCases,
    failed: results.length - passedCases,
    acceptedClassificationRate: rate(passedCases, results.length),
  },
  detectors: {
    lossyToLossless: detectorMetrics(
      "possible-lossy-transcode",
      ["lossy-to-lossless", "multi-generation-lossy"],
    ),
    upsample: detectorMetrics("possible-upsample", "upsample"),
    edgeControls: edgeControlMetrics(),
  },
  groupedMetrics: {
    bySplit: groupedMetrics("split"),
    byTruthClass: groupedMetrics("truthClass"),
    byRecipe: groupedMetrics("recipeId"),
    byDataset: groupedMetrics(
      (item) =>
        item.datasetId ??
        corpus.masters.find((master) => master.id === item.masterId)?.dataset
          ?.id ??
        "manual-import",
    ),
    bySourceCategory: groupedMetrics(
      (item) => item.sourceCategory ?? "unspecified",
    ),
    bySourceStratum: groupedMetrics(
      (item) => item.sourceStratum ?? "unspecified",
    ),
  },
  confidenceInterval:
    "Exact two-sided 95% Clopper-Pearson binomial interval; derivatives remain grouped by independent source recording.",
  limitations: [
    "A derivative is a validation case, not an independent source recording.",
    "Results apply only to the disclosed corpus, transformations, and Oracle Engine version.",
    "No probability-calibrated provenance claim is permitted until the target corpus and private challenge evaluation are complete.",
  ],
  results,
};
await writeJson(outputPath, scorecard);
console.log(
  results.length
    ? `Real-world corpus: ${passedCases}/${results.length} cases accepted across ${corpus.masters.length} independent references.`
    : "Real-world corpus: no licensed external references imported; wrote an explicit not-evaluated scorecard.",
);
