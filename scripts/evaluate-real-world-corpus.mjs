import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { engineVersion } from "../dist-electron/electron/oracle/oracle-engine.js";
import {
  acceptanceEligibilityForCase,
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
const checkpointPath = path.join(
  root,
  "build",
  "real-world-evaluation-checkpoint-latest.json",
);
const corpus = await readJson(corpusPath);
const validation = validateCorpus(corpus);
const externalDatasets = await readJson(externalDatasetsPath);
validation.errors.push(...validateExternalDatasets(externalDatasets).errors);
if (validation.errors.length) throw new Error(validation.errors.join("\n"));

function rate(successes, total, independenceUnit = "generated-case") {
  return {
    numerator: successes,
    denominator: total,
    percent: total ? Number(((successes / total) * 100).toFixed(2)) : null,
    confidence95Percent: clopperPearson(successes, total),
    independenceUnit,
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
let priorCheckpoint = null;
try {
  priorCheckpoint = await readJson(checkpointPath);
} catch {
  // An uninterrupted or completed evaluation has no checkpoint.
}
const reusableCandidates = [
  ...(priorScorecard?.engineVersion === engineVersion
    ? priorScorecard.results ?? []
    : []),
  ...(priorCheckpoint?.engineVersion === engineVersion &&
  priorCheckpoint?.corpusVersion === generated.corpusVersion &&
  priorCheckpoint?.recipeSetVersion === generated.recipeSetVersion
    ? priorCheckpoint.results ?? []
    : []),
];
const reusableResults = new Map(
  reusableCandidates.map((item) => [`${item.id}:${item.sha256}`, item]),
);
const requestedConcurrency = Number.parseInt(
  process.env.AUDIO_V_VALIDATION_CONCURRENCY ?? "",
  10,
);
const evaluationConcurrency = Number.isInteger(requestedConcurrency)
  ? Math.max(1, Math.min(16, requestedConcurrency))
  : Math.max(1, Math.min(4, os.availableParallelism()));
const results = new Array(generated.cases.length);
let reusedCases = 0;
let completedCases = 0;
let nextCaseIndex = 0;
let newlyAnalyzedSinceCheckpoint = 0;
let checkpointWrite = Promise.resolve();

function saveCheckpoint() {
  const completedResults = results.filter(Boolean);
  const checkpoint = {
    schema: "Audio-V real-world evaluation checkpoint v1",
    engineVersion,
    corpusVersion: generated.corpusVersion,
    recipeSetVersion: generated.recipeSetVersion,
    completedCases: completedResults.length,
    updatedAt: new Date().toISOString(),
    results: completedResults,
  };
  checkpointWrite = checkpointWrite.then(async () => {
    const temporaryPath = `${checkpointPath}.tmp`;
    await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify(checkpoint, null, 2)}\n`,
    );
    await fs.rename(temporaryPath, checkpointPath);
  });
  return checkpointWrite;
}

function analyzeWithWorker(worker, filePath) {
  return new Promise((resolve, reject) => {
    const handleMessage = (message) => {
      cleanup();
      if (message.ok) resolve(message.result);
      else reject(new Error(message.error));
    };
    const handleError = (error) => {
      cleanup();
      reject(error);
    };
    const handleExit = (code) => {
      cleanup();
      reject(
        new Error(`Real-world analysis worker exited unexpectedly (${code}).`),
      );
    };
    const cleanup = () => {
      worker.off("message", handleMessage);
      worker.off("error", handleError);
      worker.off("exit", handleExit);
    };
    worker.once("message", handleMessage);
    worker.once("error", handleError);
    worker.once("exit", handleExit);
    worker.postMessage(filePath);
  });
}

async function evaluateCase(item, worker) {
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
    const result = await analyzeWithWorker(worker, filePath);
    newlyAnalyzedSinceCheckpoint += 1;
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
  const acceptanceEligibility =
    item.acceptanceEligibility ??
    acceptanceEligibilityForCase(
      item.originDetectorEligibility,
      item.truthClass,
    );
  return {
    ...item,
    ...observed,
    acceptanceEligibility,
    passed:
      acceptanceEligibility === "scored"
        ? checks.length > 0 && checks.every(Boolean)
        : null,
  };
}

async function evaluationWorker() {
  const worker = new Worker(
    new URL("./lib/real-world-analysis-worker.mjs", import.meta.url),
  );
  try {
    while (nextCaseIndex < generated.cases.length) {
      const caseIndex = nextCaseIndex;
      nextCaseIndex += 1;
      results[caseIndex] = await evaluateCase(
        generated.cases[caseIndex],
        worker,
      );
      completedCases += 1;
      if (
        completedCases % 25 === 0 ||
        completedCases === generated.cases.length
      ) {
        console.log(
          `Evaluated ${completedCases}/${generated.cases.length} controlled cases.`,
        );
      }
      if (
        newlyAnalyzedSinceCheckpoint >= 25 ||
        completedCases === generated.cases.length
      ) {
        newlyAnalyzedSinceCheckpoint = 0;
        await saveCheckpoint();
      }
    }
  } finally {
    await worker.terminate();
  }
}

if (generated.cases.length > 0) {
  console.log(
    `Real-world evaluation concurrency: ${evaluationConcurrency} bounded worker(s).`,
  );
  await Promise.all(
    Array.from(
      { length: Math.min(evaluationConcurrency, generated.cases.length) },
      () => evaluationWorker(),
    ),
  );
  await checkpointWrite;
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
        const scoredPopulation = population.filter(
          (item) => item.acceptanceEligibility !== "observational-only",
        );
        const passed = scoredPopulation.filter((item) => item.passed).length;
        return [
          group,
          {
            cases: population.length,
            scoredCases: scoredPopulation.length,
            observationalCases: population.length - scoredPopulation.length,
            acceptedClassificationRate: rate(passed, scoredPopulation.length),
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

const scoredResults = results.filter(
  (item) => item.acceptanceEligibility !== "observational-only",
);
const observationalResults = results.filter(
  (item) => item.acceptanceEligibility === "observational-only",
);
const passedCases = scoredResults.filter((item) => item.passed).length;
const resultsBySourceGroup = new Map();
for (const item of results) {
  const population = resultsBySourceGroup.get(item.groupId) ?? [];
  population.push(item);
  resultsBySourceGroup.set(item.groupId, population);
}
const passedSourceGroups = [...resultsBySourceGroup.values()].filter(
  (population) => {
    const scoredPopulation = population.filter(
      (item) => item.acceptanceEligibility !== "observational-only",
    );
    return (
      scoredPopulation.length > 0 &&
      scoredPopulation.every((item) => item.passed)
    );
  },
).length;
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
  sourceGroupAcceptance: {
    total: resultsBySourceGroup.size,
    passed: passedSourceGroups,
    failed: resultsBySourceGroup.size - passedSourceGroups,
    acceptedRate: rate(
      passedSourceGroups,
      resultsBySourceGroup.size,
      "independent-source-group",
    ),
    rule: "A source group passes only when every scored generated case for that source is accepted; observational-only cases are excluded.",
  },
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
    failed: scoredResults.length - passedCases,
    scored: scoredResults.length,
    observationalOnly: observationalResults.length,
    acceptedClassificationRate: rate(passedCases, scoredResults.length),
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
    "Exact two-sided 95% Clopper-Pearson binomial intervals. The headline sourceGroupAcceptance interval uses independent source groups; generated-case intervals are descriptive because derivatives from one source are correlated.",
  limitations: [
    "A derivative is a validation case, not an independent source recording.",
    "Case-weighted confidence intervals must not be presented as independent-sample accuracy bounds.",
    "Results apply only to the disclosed corpus, transformations, and Oracle Engine version.",
    "No probability-calibrated provenance claim is permitted until the target corpus and private challenge evaluation are complete.",
  ],
  results,
};
await writeJson(outputPath, scorecard);
await fs.rm(checkpointPath, { force: true });
console.log(
  results.length
    ? `Real-world corpus: ${passedCases}/${scoredResults.length} scored cases accepted across ${corpus.masters.length} independent references; ${observationalResults.length} observational case(s) retained without acceptance scoring.`
    : "Real-world corpus: no licensed external references imported; wrote an explicit not-evaluated scorecard.",
);
