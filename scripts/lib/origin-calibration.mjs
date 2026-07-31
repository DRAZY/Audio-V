const calibrationTruthClasses = new Set([
  "intentional-lowpass",
  "lossy-to-lossless",
  "multi-generation-lossy",
  "native-control",
  "upsample",
]);

const losslessCodecs = new Set([
  "alac",
  "flac",
  "pcm_f32le",
  "pcm_f64le",
  "pcm_s16be",
  "pcm_s16le",
  "pcm_s24be",
  "pcm_s24le",
  "pcm_s32be",
  "pcm_s32le",
  "wavpack",
]);

export function eligibleOriginCalibrationCase(item, splits) {
  return (
    item.originDetectorEligibility === "positive-and-negative" &&
    calibrationTruthClasses.has(item.truthClass) &&
    splits.has(item.split)
  );
}

export function eligibleOriginObservationalCase(item, splits, datasets) {
  return (
    item.originDetectorEligibility === "negative-only" &&
    calibrationTruthClasses.has(item.truthClass) &&
    splits.has(item.split) &&
    datasets.has(item.datasetId)
  );
}

export function originFeatureRecord(item, analysis) {
  const spectrum =
    analysis.measurements?.originSpectrumSummary ??
    analysis.measurements?.spectrogram ??
    null;
  const sampleRate =
    analysis.technical?.sampleRate ?? analysis.measurements?.sampleRate ?? null;
  const nyquistHz = sampleRate === null ? null : sampleRate / 2;
  const effectiveBandwidthHz = spectrum?.effectiveBandwidthHz ?? null;
  const occupancy =
    effectiveBandwidthHz === null || nyquistHz === null || nyquistHz <= 0
      ? null
      : effectiveBandwidthHz / nyquistHz;
  return {
    id: item.id,
    sha256: item.sha256,
    masterId: item.masterId,
    groupId: item.groupId,
    datasetId: item.datasetId,
    sourceCategory: item.sourceCategory,
    sourceStratum: item.sourceStratum,
    split: item.split,
    recipeId: item.recipeId,
    truthClass: item.truthClass,
    technical: {
      codecName: analysis.technical?.codecName ?? null,
      sampleRate,
      channels:
        analysis.technical?.channels ?? analysis.measurements?.channels ?? null,
      durationSeconds:
        analysis.measurements?.durationSeconds ??
        analysis.technical?.durationSeconds ??
        null,
    },
    features: {
      fftSize: spectrum?.fftSize ?? null,
      effectiveBandwidthHz,
      nyquistHz,
      occupancy,
      strongestCutoffHz: spectrum?.strongestCutoffHz ?? null,
      cutoffDropDb: spectrum?.cutoffDropDb ?? null,
      upperBandLevelDbfs: spectrum?.upperBandLevelDbfs ?? null,
      spectralRolloff85Hz: spectrum?.spectralRolloff85Hz ?? null,
      spectralRolloff95Hz: spectrum?.spectralRolloff95Hz ?? null,
      spectralRolloff99Hz: spectrum?.spectralRolloff99Hz ?? null,
      energyAbove15kDb: spectrum?.energyAbove15kDb ?? null,
      energyAbove18kDb: spectrum?.energyAbove18kDb ?? null,
      energyAbove20kDb: spectrum?.energyAbove20kDb ?? null,
      effectiveBandwidthEdgeDropDb:
        spectrum?.effectiveBandwidthEdgeDropDb ?? null,
      activeSlicePercent: spectrum?.activeSlicePercent ?? null,
      cutoffStabilityPercent: spectrum?.cutoffStabilityPercent ?? null,
      priorNyquistMatchHz: spectrum?.priorNyquistMatchHz ?? null,
      bandRuptureScoreDb: spectrum?.bandRuptureScoreDb ?? null,
    },
    observed: {
      classification: analysis.fidelity?.classification ?? "not-assessed",
      reasonCode: analysis.fidelity?.reasonCode ?? null,
      ruleStrength: analysis.fidelity?.ruleStrength ?? null,
      evidenceCoverage: analysis.fidelity?.evidenceCoverage ?? 0,
    },
  };
}

function sharedFeatureState(record) {
  const { features } = record;
  const stableCutoff =
    features.cutoffStabilityPercent !== null &&
    features.cutoffStabilityPercent >= 65 &&
    (features.activeSlicePercent ?? 0) >= 30;
  const priorNyquistMatch =
    features.priorNyquistMatchHz !== null &&
    features.priorNyquistMatchHz <= 500;
  const secondaryBandRupture =
    (features.bandRuptureScoreDb ?? Number.NEGATIVE_INFINITY) >= 12;
  const upperBandSuppression =
    (features.upperBandLevelDbfs ?? Number.POSITIVE_INFINITY) <= -85;
  return {
    stableCutoff,
    priorNyquistMatch,
    secondaryBandRupture,
    upperBandSuppression,
  };
}

export function currentRuleBlockers(record, detector) {
  const blockers = [];
  const { technical, features } = record;
  const shared = sharedFeatureState(record);
  if (detector === "lossy") {
    if (!losslessCodecs.has(technical.codecName)) blockers.push("not-lossless-output");
    if (technical.sampleRate === null || technical.sampleRate > 50_000) {
      blockers.push("sample-rate-outside-lossy-envelope");
    }
    if (features.strongestCutoffHz === null) {
      blockers.push("no-stable-cutoff-measured");
    } else if (
      features.strongestCutoffHz < 14_000 ||
      features.strongestCutoffHz > 21_500
    ) {
      blockers.push("cutoff-outside-lossy-envelope");
    }
    if (features.cutoffDropDb === null || features.cutoffDropDb < 25) {
      blockers.push("spectral-cliff-below-25db");
    }
    if (features.occupancy === null || features.occupancy > 0.9) {
      blockers.push("band-occupancy-above-90-percent");
    }
    if (!shared.stableCutoff) blockers.push("regional-stability-below-rule");
    if (
      !shared.priorNyquistMatch &&
      !shared.secondaryBandRupture &&
      !shared.upperBandSuppression
    ) {
      blockers.push("no-corroborating-evidence-family");
    }
    return blockers;
  }
  if (detector !== "upsample") {
    throw new Error(`Unknown origin detector ${detector}.`);
  }
  if (technical.sampleRate === null || technical.sampleRate < 88_200) {
    blockers.push("declared-rate-below-88.2khz");
  }
  if (features.strongestCutoffHz === null) {
    blockers.push("no-stable-cutoff-measured");
  } else if (
    features.strongestCutoffHz < 18_000 ||
    features.strongestCutoffHz > 28_000
  ) {
    blockers.push("cutoff-outside-upsample-envelope");
  }
  if (features.cutoffDropDb === null || features.cutoffDropDb < 5) {
    blockers.push("spectral-cliff-below-5db");
  }
  if (features.occupancy === null || features.occupancy > 0.65) {
    blockers.push("band-occupancy-above-65-percent");
  }
  if (!shared.upperBandSuppression) blockers.push("upper-band-not-suppressed");
  if (!shared.stableCutoff) blockers.push("regional-stability-below-rule");
  if (!shared.priorNyquistMatch && !shared.secondaryBandRupture) {
    blockers.push("no-grid-match-or-secondary-rupture");
  }
  return blockers;
}
