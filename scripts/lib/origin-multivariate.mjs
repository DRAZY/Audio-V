const epsilon = 1e-12;

export const originModelFeatures = Object.freeze([
  "occupancy",
  "cutoffRatio",
  "cutoffDropDb",
  "upperBandLevelDbfs",
  "rolloff85Ratio",
  "rolloff95Ratio",
  "rolloff99Ratio",
  "energyAbove15kDb",
  "energyAbove18kDb",
  "energyAbove20kDb",
  "effectiveBandwidthEdgeDropDb",
  "normalizedSpectralFluxDb",
  "highBandFlatnessDb",
  "highBandCrestDb",
  "highBandEntropyPercent",
  "highBandFloorOccupancyPercent",
  "activeSlicePercent",
  "cutoffStabilityPercent",
  "priorNyquistMatchRatio",
  "bandRuptureScoreDb",
]);

const positiveTruthClasses = Object.freeze({
  lossy: new Set(["lossy-to-lossless", "multi-generation-lossy"]),
  upsample: new Set(["upsample"]),
});

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

export function originModelFeatureValues(record) {
  const { technical, features } = record;
  const nyquist = finite(features.nyquistHz) ??
    (finite(technical.sampleRate) === null ? null : technical.sampleRate / 2);
  const ratio = (value) => {
    const measured = finite(value);
    return measured === null || nyquist === null || nyquist <= 0
      ? null
      : measured / nyquist;
  };
  return {
    occupancy: finite(features.occupancy),
    cutoffRatio: ratio(features.strongestCutoffHz),
    cutoffDropDb: finite(features.cutoffDropDb),
    upperBandLevelDbfs: finite(features.upperBandLevelDbfs),
    rolloff85Ratio: ratio(features.spectralRolloff85Hz),
    rolloff95Ratio: ratio(features.spectralRolloff95Hz),
    rolloff99Ratio: ratio(features.spectralRolloff99Hz),
    energyAbove15kDb: finite(features.energyAbove15kDb),
    energyAbove18kDb: finite(features.energyAbove18kDb),
    energyAbove20kDb: finite(features.energyAbove20kDb),
    effectiveBandwidthEdgeDropDb: finite(features.effectiveBandwidthEdgeDropDb),
    normalizedSpectralFluxDb: finite(features.normalizedSpectralFluxDb),
    highBandFlatnessDb: finite(features.highBandFlatnessDb),
    highBandCrestDb: finite(features.highBandCrestDb),
    highBandEntropyPercent: finite(features.highBandEntropyPercent),
    highBandFloorOccupancyPercent: finite(
      features.highBandFloorOccupancyPercent,
    ),
    activeSlicePercent: finite(features.activeSlicePercent),
    cutoffStabilityPercent: finite(features.cutoffStabilityPercent),
    priorNyquistMatchRatio: ratio(features.priorNyquistMatchHz),
    bandRuptureScoreDb: finite(features.bandRuptureScoreDb),
  };
}

export function originDetectorLabel(record, detector) {
  const positives = positiveTruthClasses[detector];
  if (!positives) throw new Error(`Unknown origin detector ${detector}.`);
  if (record.originDetectorEligibility === "edge-abstention") return 0;
  return positives.has(record.truthClass) ? 1 : 0;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function fitOriginFeatureSchema(records) {
  const rows = records.map(originModelFeatureValues);
  return originModelFeatures.map((name) => {
    const measured = rows.map((row) => row[name]).filter(Number.isFinite);
    const fill = median(measured);
    const mean =
      measured.length === 0
        ? 0
        : measured.reduce((sum, value) => sum + value, 0) / measured.length;
    const variance =
      measured.length === 0
        ? 0
        : measured.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
          measured.length;
    return {
      name,
      fill,
      mean,
      scale: Math.sqrt(variance) || 1,
      measured: measured.length,
    };
  });
}

export function originFeatureVector(record, schema) {
  const values = originModelFeatureValues(record);
  const standardized = schema.map(({ name, fill, mean, scale }) => {
    const value = values[name] ?? fill;
    return (value - mean) / scale;
  });
  const missing = schema.map(({ name }) => (values[name] === null ? 1 : 0));
  return [...standardized, ...missing];
}

function sigmoid(value) {
  if (value >= 0) {
    const inverse = Math.exp(-value);
    return 1 / (1 + inverse);
  }
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

function dot(left, right) {
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result += left[index] * right[index];
  }
  return result;
}

function balancedGroupWeights(records, labels) {
  const buckets = new Map();
  records.forEach((record, index) => {
    const key = `${labels[index]}:${record.groupId}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  });
  const raw = records.map(
    (record, index) => 1 / buckets.get(`${labels[index]}:${record.groupId}`),
  );
  const totals = [0, 0];
  raw.forEach((weight, index) => {
    totals[labels[index]] += weight;
  });
  return raw.map((weight, index) =>
    totals[labels[index]] <= 0 ? 0 : (weight / totals[labels[index]]) * 0.5,
  );
}

export function trainOriginLogisticModel(
  records,
  detector,
  { iterations = 2_500, learningRate = 0.05, l2 = 0.04 } = {},
) {
  if (records.length === 0) throw new Error("Origin model requires records.");
  const labels = records.map((record) => originDetectorLabel(record, detector));
  if (!labels.includes(0) || !labels.includes(1)) {
    throw new Error(`Origin ${detector} model requires both labels.`);
  }
  const schema = fitOriginFeatureSchema(records);
  const vectors = records.map((record) => originFeatureVector(record, schema));
  const weights = balancedGroupWeights(records, labels);
  const coefficients = new Array(vectors[0].length).fill(0);
  let intercept = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const coefficientGradient = new Array(coefficients.length).fill(0);
    let interceptGradient = 0;
    vectors.forEach((vector, index) => {
      const prediction = sigmoid(intercept + dot(coefficients, vector));
      const residual = (prediction - labels[index]) * weights[index];
      interceptGradient += residual;
      for (let feature = 0; feature < coefficients.length; feature += 1) {
        coefficientGradient[feature] += residual * vector[feature];
      }
    });
    intercept -= learningRate * interceptGradient;
    for (let feature = 0; feature < coefficients.length; feature += 1) {
      coefficients[feature] -=
        learningRate * (coefficientGradient[feature] + l2 * coefficients[feature]);
    }
  }
  return { detector, schema, coefficients, intercept, iterations, learningRate, l2 };
}

export function scoreOriginRecord(model, record) {
  return sigmoid(
    model.intercept +
      dot(model.coefficients, originFeatureVector(record, model.schema)),
  );
}

function wilson(successes, total, z = 1.959963984540054) {
  if (total === 0) return { estimate: null, lower: null, upper: null };
  const proportion = successes / total;
  const denominator = 1 + z ** 2 / total;
  const center = (proportion + z ** 2 / (2 * total)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt(
      (proportion * (1 - proportion)) / total + z ** 2 / (4 * total ** 2),
    );
  return {
    estimate: proportion,
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

function roundedInterval(interval) {
  return Object.fromEntries(
    Object.entries(interval).map(([key, value]) => [
      key,
      value === null ? null : Number(value.toFixed(6)),
    ]),
  );
}

export function evaluateOriginScores(scoredRecords, detector, threshold) {
  const rows = scoredRecords.map(({ record, score }) => ({
    record,
    score,
    label: originDetectorLabel(record, detector),
    detected: score >= threshold,
  }));
  const positives = rows.filter((row) => row.label === 1);
  const negatives = rows.filter((row) => row.label === 0);
  const positiveGroups = Map.groupBy(positives, (row) => row.record.groupId);
  const negativeGroups = Map.groupBy(negatives, (row) => row.record.groupId);
  const positiveHits = positives.filter((row) => row.detected).length;
  const negativeHits = negatives.filter((row) => row.detected).length;
  const positiveGroupHits = [...positiveGroups.values()].filter((group) =>
    group.some((row) => row.detected),
  ).length;
  const negativeGroupHits = [...negativeGroups.values()].filter((group) =>
    group.some((row) => row.detected),
  ).length;
  const summarize = (subset) => {
    const detected = subset.filter((row) => row.detected).length;
    return { cases: subset.length, detected };
  };
  return {
    threshold: Number(threshold.toFixed(9)),
    cases: rows.length,
    sourceGroups: new Set(rows.map((row) => row.record.groupId)).size,
    positive: {
      cases: positives.length,
      hits: positiveHits,
      interval95: roundedInterval(wilson(positiveHits, positives.length)),
      sourceGroups: positiveGroups.size,
      sourceGroupHits: positiveGroupHits,
      sourceGroupInterval95: roundedInterval(
        wilson(positiveGroupHits, positiveGroups.size),
      ),
    },
    negative: {
      cases: negatives.length,
      falseHits: negativeHits,
      interval95: roundedInterval(wilson(negativeHits, negatives.length)),
      sourceGroups: negativeGroups.size,
      falseHitSourceGroups: negativeGroupHits,
      sourceGroupInterval95: roundedInterval(
        wilson(negativeGroupHits, negativeGroups.size),
      ),
    },
    byTruthClass: Object.fromEntries(
      [...Map.groupBy(rows, (row) => row.record.truthClass).entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, subset]) => [name, summarize(subset)]),
    ),
    byRecipe: Object.fromEntries(
      [...Map.groupBy(rows, (row) => row.record.recipeId).entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, subset]) => [name, summarize(subset)]),
    ),
  };
}

export function selectZeroFalseGroupThreshold(scoredRecords, detector) {
  const negativeScores = scoredRecords
    .filter(({ record }) => originDetectorLabel(record, detector) === 0)
    .map(({ score }) => score);
  const candidates = [
    0.5,
    0.6,
    0.7,
    0.8,
    0.9,
    0.95,
    0.975,
    0.99,
    Math.min(1, Math.max(...negativeScores, 0) + epsilon),
  ];
  const eligible = [...new Set(candidates)]
    .filter((threshold) => threshold > 0 && threshold <= 1)
    .map((threshold) => ({
      threshold,
      metrics: evaluateOriginScores(scoredRecords, detector, threshold),
    }))
    .filter(({ metrics }) => metrics.negative.falseHitSourceGroups === 0)
    .sort((left, right) => {
      const recallDifference =
        (right.metrics.positive.interval95.estimate ?? 0) -
        (left.metrics.positive.interval95.estimate ?? 0);
      return recallDifference || right.threshold - left.threshold;
    });
  return eligible[0] ?? null;
}

export function areaUnderRoc(scoredRecords, detector) {
  const positives = scoredRecords.filter(
    ({ record }) => originDetectorLabel(record, detector) === 1,
  );
  const negatives = scoredRecords.filter(
    ({ record }) => originDetectorLabel(record, detector) === 0,
  );
  if (positives.length === 0 || negatives.length === 0) return null;
  let favorable = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      favorable +=
        positive.score > negative.score
          ? 1
          : positive.score === negative.score
            ? 0.5
            : 0;
    }
  }
  return favorable / (positives.length * negatives.length);
}

export function leaveOneGroupOutScores(records, detector, options) {
  const groups = Map.groupBy(records, (record) => record.groupId);
  const scored = [];
  for (const [heldOutGroup, heldOut] of groups) {
    const training = records.filter((record) => record.groupId !== heldOutGroup);
    const model = trainOriginLogisticModel(training, detector, options);
    scored.push(
      ...heldOut.map((record) => ({ record, score: scoreOriginRecord(model, record) })),
    );
  }
  return scored;
}
