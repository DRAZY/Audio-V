import path from "node:path";
import {
  areaUnderRoc,
  evaluateOriginScores,
  leaveOneGroupOutScores,
  originDetectorLabel,
  scoreOriginRecord,
  selectZeroFalseGroupThreshold,
  trainOriginLogisticModel,
} from "./lib/origin-multivariate.mjs";
import { readJson, root, writeJson } from "./lib/validation-corpus.mjs";

const policy = await readJson(
  path.join(root, "validation", "real-world", "origin-promotion-policy.json"),
);
const matrices = {
  development: await readJson(
    path.join(root, "build", "origin-calibration-features-development.json"),
  ),
  calibration: await readJson(
    path.join(root, "build", "origin-calibration-features-calibration.json"),
  ),
  test: await readJson(
    path.join(root, "build", "origin-calibration-features-test.json"),
  ),
  challenge: await readJson(
    path.join(root, "build", "origin-calibration-features-heldout-challenge.json"),
  ),
  edge: await readJson(
    path.join(root, "build", "origin-calibration-features-musan-edge.json"),
  ),
};

const expectedDatasets = new Set(["ebu-sqam", "maestro-v3", "musdb18-hq"]);
for (const dataset of expectedDatasets) {
  if (!matrices.challenge.records.some((record) => record.datasetId === dataset)) {
    throw new Error(`Held-out challenge matrix is missing ${dataset}.`);
  }
}
const identitySets = Object.fromEntries(
  Object.entries(matrices).map(([name, matrix]) => [
    name,
    new Set(matrix.records.map((record) => record.groupId)),
  ]),
);
for (const [leftName, left] of Object.entries(identitySets)) {
  for (const [rightName, right] of Object.entries(identitySets)) {
    if (leftName >= rightName) continue;
    const overlap = [...left].filter((identity) => right.has(identity));
    if (overlap.length > 0) {
      throw new Error(`${leftName}/${rightName} source-group leakage detected.`);
    }
  }
}

function rounded(value) {
  return value === null ? null : Number(value.toFixed(6));
}

function pooledHeldOutGroupInterval(...populations) {
  const total = populations.reduce(
    (sum, population) => sum + population.negative.sourceGroups,
    0,
  );
  const hits = populations.reduce(
    (sum, population) => sum + population.negative.falseHitSourceGroups,
    0,
  );
  // Reuse the equivalent metrics calculation by creating one row per group.
  const z = 1.959963984540054;
  const proportion = total === 0 ? 0 : hits / total;
  const denominator = 1 + z ** 2 / total;
  const center = (proportion + z ** 2 / (2 * total)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt(
      (proportion * (1 - proportion)) / total + z ** 2 / (4 * total ** 2),
    );
  return {
    sourceGroups: total,
    falseHitSourceGroups: hits,
    estimate: rounded(proportion),
    lower95: rounded(Math.max(0, center - margin)),
    upper95: rounded(Math.min(1, center + margin)),
  };
}

function gateReport(
  detector,
  developmentAuc,
  calibration,
  test,
  challenge,
  edge,
) {
  const requirements = policy.requirements;
  const challengeByDataset = Object.fromEntries(
    [...expectedDatasets].sort().map((dataset) => {
      const subset = matrices.challenge.records
        .map((record) => ({ record, score: challenge.scores.get(record.id) }))
        .filter(({ record, score }) => record.datasetId === dataset && score !== undefined);
      return [dataset, evaluateOriginScores(subset, detector, challenge.threshold)];
    }),
  );
  const pooled = pooledHeldOutGroupInterval(
    test.metrics,
    challenge.metrics,
    edge.metrics,
  );
  const gates = {
    developmentLeaveOneGroupOutAuc:
      developmentAuc >= requirements.minimumDevelopmentLeaveOneGroupOutAuc,
    calibrationFalseHitSourceGroups:
      calibration.metrics.negative.falseHitSourceGroups <=
      requirements.maximumCalibrationFalseHitSourceGroups,
    testFalseHitSourceGroups:
      test.metrics.negative.falseHitSourceGroups <=
      requirements.maximumTestFalseHitSourceGroups,
    testPositiveCaseRecall:
      (test.metrics.positive.interval95.estimate ?? 0) >=
      requirements.minimumTestPositiveCaseRecall,
    testPositiveSourceGroupRecall:
      (test.metrics.positive.sourceGroupInterval95.estimate ?? 0) >=
      requirements.minimumTestPositiveSourceGroupRecall,
    challengeFalseHitSourceGroupsPerDataset: Object.values(
      challengeByDataset,
    ).every(
      (metrics) =>
        metrics.negative.falseHitSourceGroups <=
        requirements.maximumChallengeFalseHitSourceGroupsPerDataset,
    ),
    edgeAbstentionFalseHitSourceGroups:
      edge.metrics.negative.falseHitSourceGroups <=
      requirements.maximumEdgeAbstentionFalseHitSourceGroups,
    pooledHeldOutFalseHitWilsonUpper95:
      pooled.upper95 <=
      requirements.maximumPooledHeldOutFalseHitSourceGroupWilsonUpper95,
    independentHeldOutSourceGroups:
      pooled.sourceGroups >= requirements.minimumIndependentHeldOutSourceGroups,
  };
  return {
    gates,
    passed: Object.values(gates).every(Boolean),
    challengeByDataset,
    pooledHeldOutNegativeGroups: pooled,
  };
}

function scoreMatrix(model, matrix) {
  return matrix.records.map((record) => ({
    record,
    score: scoreOriginRecord(model, record),
  }));
}

function falseAdvisoryGroups(scoredRecords, detector, threshold) {
  return [...Map.groupBy(
    scoredRecords.filter(
      ({ record, score }) =>
        score >= threshold && originDetectorLabel(record, detector) === 0,
    ),
    ({ record }) => record.groupId,
  ).entries()]
    .map(([groupId, rows]) => ({
      groupId,
      datasetId: rows[0].record.datasetId,
      maximumScore: rounded(Math.max(...rows.map(({ score }) => score))),
      cases: rows
        .map(({ record, score }) => ({
          id: record.id,
          recipeId: record.recipeId,
          truthClass: record.truthClass,
          score: rounded(score),
        }))
        .sort((left, right) => right.score - left.score),
    }))
    .sort(
      (left, right) =>
        right.maximumScore - left.maximumScore ||
        left.groupId.localeCompare(right.groupId),
    );
}

const detectors = {};
for (const detector of ["lossy", "upsample"]) {
  const trainingOptions = {
    iterations: 2_500,
    learningRate: 0.05,
    l2: 0.04,
  };
  const developmentOutOfFold = leaveOneGroupOutScores(
    matrices.development.records,
    detector,
    trainingOptions,
  );
  const developmentAuc = areaUnderRoc(developmentOutOfFold, detector);
  const model = trainOriginLogisticModel(
    matrices.development.records,
    detector,
    trainingOptions,
  );
  const calibrationScores = scoreMatrix(model, matrices.calibration);
  const selected = selectZeroFalseGroupThreshold(calibrationScores, detector);
  if (!selected) throw new Error(`No calibration threshold exists for ${detector}.`);
  const threshold = selected.threshold;
  const testScores = scoreMatrix(model, matrices.test);
  const challengeScores = scoreMatrix(model, matrices.challenge);
  const edgeScores = scoreMatrix(model, matrices.edge);
  const testMetrics = evaluateOriginScores(testScores, detector, threshold);
  const challengeMetrics = evaluateOriginScores(
    challengeScores,
    detector,
    threshold,
  );
  const edgeMetrics = evaluateOriginScores(edgeScores, detector, threshold);
  const gate = gateReport(
    detector,
    developmentAuc,
    { metrics: selected.metrics },
    { metrics: testMetrics },
    {
      metrics: challengeMetrics,
      threshold,
      scores: new Map(challengeScores.map(({ record, score }) => [record.id, score])),
    },
    { metrics: edgeMetrics },
  );
  detectors[detector] = {
    model: {
      family: "deterministic L2-regularized logistic ranking score",
      features: model.schema.map(({ name, measured }) => ({ name, measured })),
      iterations: model.iterations,
      learningRate: model.learningRate,
      l2: model.l2,
      scoreSemantics: "uncalibrated ranking score; not a probability",
      parameters: {
        intercept: rounded(model.intercept),
        coefficients: model.coefficients.map((coefficient, index) => ({
          feature:
            index < model.schema.length
              ? model.schema[index].name
              : `${model.schema[index - model.schema.length].name}:missing`,
          value: rounded(coefficient),
        })),
        schema: model.schema.map(({ name, fill, mean, scale }) => ({
          name,
          fill: rounded(fill),
          mean: rounded(mean),
          scale: rounded(scale),
        })),
      },
    },
    development: {
      leaveOneSourceGroupOutAuc: rounded(developmentAuc),
      sourceGroups: new Set(
        matrices.development.records.map((record) => record.groupId),
      ).size,
    },
    calibration: selected.metrics,
    test: testMetrics,
    challenge: challengeMetrics,
    edgeAbstention: edgeMetrics,
    falseAdvisoryGroups: {
      test: falseAdvisoryGroups(testScores, detector, threshold),
      challenge: falseAdvisoryGroups(challengeScores, detector, threshold),
      edgeAbstention: falseAdvisoryGroups(edgeScores, detector, threshold),
    },
    ...gate,
    verdictImpact: gate.passed ? "eligible-for-review-only-integration" : "none",
  };
}

const promoted = Object.values(detectors).every((detector) => detector.passed);
const report = {
  schema: "Audio-V Oracle multivariate origin candidate evaluation v1",
  generatedAt: new Date().toISOString(),
  engineVersion: matrices.development.engineVersion,
  corpusVersion: matrices.development.corpusVersion,
  recipeSetVersion: matrices.development.recipeSetVersion,
  policyVersion: policy.policyVersion,
  independenceUnit: "source-group",
  splitIntegrity: "passed-no-source-group-overlap",
  populations: Object.fromEntries(
    Object.entries(matrices).map(([name, matrix]) => [
      name,
      {
        records: matrix.records.length,
        sourceGroups: new Set(matrix.records.map((record) => record.groupId)).size,
        datasets: [...new Set(matrix.records.map((record) => record.datasetId))].sort(),
      },
    ]),
  ),
  detectors,
  decision: promoted ? "eligible-for-reviewed-production-integration" : "rejected",
  verdictImpact: "none-until-separate-production-integration",
  interpretation: promoted
    ? "Both frozen candidates passed every source-separated promotion gate. A separate reviewed integration would still be required and could affect Review only."
    : "At least one frozen candidate failed a source-separated promotion gate. Oracle production verdicts remain unchanged; the score must not be presented as probability or provenance fact.",
};
const outputPath = path.join(
  root,
  "build",
  "origin-multivariate-candidate-v1.json",
);
await writeJson(outputPath, report);
const publishedPath = path.join(
  root,
  "validation",
  "real-world",
  "calibration",
  "oracle-v12-multivariate-candidate-v1.json",
);
await writeJson(publishedPath, report);
console.log(JSON.stringify(report, null, 2));
console.log(`Wrote multivariate origin candidate evaluation to ${outputPath}.`);
console.log(`Published frozen origin candidate evidence to ${publishedPath}.`);
