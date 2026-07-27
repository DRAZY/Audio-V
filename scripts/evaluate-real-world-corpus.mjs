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
  generatedCasesPath,
  readJson,
  root,
  sha256File,
  validateCorpus,
  writeJson,
} from "./lib/validation-corpus.mjs";

const outputPath = path.join(root, "build", "real-world-scorecard-latest.json");
const corpus = await readJson(corpusPath);
const validation = validateCorpus(corpus);
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
    schema: "Audio-V real-world generated cases v1",
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

const results = [];
for (const item of generated.cases) {
  const filePath = path.join(corpusDirectory, item.file);
  const actualHash = await sha256File(filePath);
  if (actualHash !== item.sha256) {
    throw new Error(`${item.id}: generated-case SHA-256 changed.`);
  }
  const result = await analyzeAudioFile(filePath);
  const actualClassification =
    result.fidelity?.classification ?? "not-assessed";
  const actualAnalysisState =
    result.analysisState ??
    (result.verdict === "damaged"
      ? "failed"
      : result.measurements
        ? "completed"
        : "error");
  const checks = [];
  if (item.acceptedClassifications.length > 0) {
    checks.push(
      item.acceptedClassifications.includes(actualClassification),
    );
  }
  if (item.expected?.analysisStates) {
    checks.push(item.expected.analysisStates.includes(actualAnalysisState));
  }
  if (item.expected?.stereoAssessments) {
    checks.push(
      item.expected.stereoAssessments.includes(
        result.measurements?.stereoAssessment ?? "unavailable",
      ),
    );
  }
  if (item.expected?.minimumClippedSamples) {
    checks.push(
      (result.measurements?.clippedSamples ?? 0) >=
        item.expected.minimumClippedSamples,
    );
  }
  results.push({
    ...item,
    actualClassification,
    actualAnalysisState,
    actualStereoAssessment:
      result.measurements?.stereoAssessment ?? null,
    actualClippedSamples: result.measurements?.clippedSamples ?? null,
    passed: checks.length > 0 && checks.every(Boolean),
    reasonCode: result.fidelity?.reasonCode ?? null,
    ruleStrength: result.fidelity?.confidence ?? null,
    evidenceCoverage: result.fidelity?.evidenceCoverage ?? 0,
  });
}

function detectorMetrics(classification, truthClass) {
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  let inconclusive = 0;
  for (const item of results) {
    const positiveTruth = item.truthClass === truthClass;
    const positiveResult = item.actualClassification === classification;
    if (item.actualClassification === "inconclusive") inconclusive += 1;
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
    sensitivity: rate(truePositive, truePositive + falseNegative),
    specificity: rate(trueNegative, trueNegative + falsePositive),
    falsePositiveRate: rate(falsePositive, falsePositive + trueNegative),
    falseNegativeRate: rate(falseNegative, falseNegative + truePositive),
    inconclusiveRate: rate(inconclusive, results.length),
  };
}

const passedCases = results.filter((item) => item.passed).length;
const scorecard = {
  schema: "Audio-V real-world validation scorecard v1",
  measuredAt: new Date().toISOString(),
  status: results.length ? "evaluated" : "not-evaluated-no-licensed-masters",
  engineVersion,
  corpusVersion: corpus.corpusVersion,
  recipeSetVersion: generated.recipeSetVersion,
  independentMasters: corpus.masters.length,
  contributorGroups: validation.groupCount,
  cases: {
    total: results.length,
    bySplit: countBy(results, "split"),
    byTruthClass: countBy(results, "truthClass"),
    passed: passedCases,
    failed: results.length - passedCases,
    acceptedClassificationRate: rate(passedCases, results.length),
  },
  detectors: {
    lossyToLossless: detectorMetrics(
      "possible-lossy-transcode",
      "lossy-to-lossless",
    ),
    upsample: detectorMetrics("possible-upsample", "upsample"),
  },
  confidenceInterval:
    "Exact two-sided 95% Clopper-Pearson binomial interval; derivatives remain grouped by independent source master.",
  limitations: [
    "A derivative is a validation case, not an independent source master.",
    "Results apply only to the disclosed corpus, transformations, and Oracle Engine version.",
    "No probability-calibrated provenance claim is permitted until the target corpus and private challenge evaluation are complete.",
  ],
  results,
};
await writeJson(outputPath, scorecard);
console.log(
  results.length
    ? `Real-world corpus: ${passedCases}/${results.length} cases accepted across ${corpus.masters.length} independent masters.`
    : "Real-world corpus: no licensed source masters imported; wrote an explicit not-evaluated scorecard.",
);
