import { describe, expect, it } from "vitest";
import {
  currentRuleBlockers,
  eligibleOriginEdgeCase,
  eligibleOriginCalibrationCase,
  eligibleOriginObservationalCase,
  matchesTextureCandidateV2,
  originFeatureRecord,
} from "../scripts/lib/origin-calibration.mjs";
import {
  areaUnderRoc,
  evaluateOriginScores,
  originFeatureVector,
  selectZeroFalseGroupThreshold,
  trainOriginLogisticModel,
} from "../scripts/lib/origin-multivariate.mjs";

function analysis(overrides: Record<string, unknown> = {}) {
  return {
    technical: {
      codecName: "flac",
      sampleRate: 44_100,
      channels: 2,
      durationSeconds: 60,
      ...(overrides.technical as object),
    },
    measurements: {
      sampleRate: 44_100,
      channels: 2,
      durationSeconds: 60,
      originSpectrumSummary: {
        fftSize: 4096,
        effectiveBandwidthHz: 17_000,
        strongestCutoffHz: null,
        cutoffDropDb: null,
        upperBandLevelDbfs: -120,
        activeSlicePercent: 100,
        cutoffStabilityPercent: null,
        priorNyquistMatchHz: null,
        bandRuptureScoreDb: null,
        slices: [],
        ...(overrides.features as object),
      },
    },
    fidelity: {
      classification: "inconclusive",
      reasonCode: "unstable-cutoff",
      ruleStrength: "weak",
      evidenceCoverage: 65,
    },
  };
}

const calibrationCase = {
  id: "case:lossy",
  sha256: "abc",
  masterId: "master",
  groupId: "source-group",
  datasetId: "dataset",
  sourceCategory: "music",
  sourceStratum: "music:test",
  split: "development",
  recipeId: "aac-64-to-flac",
  truthClass: "lossy-to-lossless",
  originDetectorEligibility: "positive-and-negative",
};

describe("origin calibration evidence", () => {
  it("selects only controlled-origin cases from explicitly requested splits", () => {
    expect(
      eligibleOriginCalibrationCase(
        calibrationCase,
        new Set(["development"]),
      ),
    ).toBe(true);
    expect(
      eligibleOriginCalibrationCase(
        { ...calibrationCase, split: "test" },
        new Set(["development"]),
      ),
    ).toBe(false);
    expect(
      eligibleOriginCalibrationCase(
        { ...calibrationCase, originDetectorEligibility: "negative-only" },
        new Set(["development"]),
      ),
    ).toBe(false);
    expect(
      eligibleOriginCalibrationCase(
        { ...calibrationCase, truthClass: "clipping" },
        new Set(["development"]),
      ),
    ).toBe(false);
  });

  it("requires an explicit dataset and negative-only status for observations", () => {
    const observationalCase = {
      ...calibrationCase,
      datasetId: "maestro-v3",
      split: "challenge",
      originDetectorEligibility: "negative-only",
    };
    expect(
      eligibleOriginObservationalCase(
        observationalCase,
        new Set(["challenge"]),
        new Set(["maestro-v3"]),
      ),
    ).toBe(true);
    expect(
      eligibleOriginObservationalCase(
        observationalCase,
        new Set(["challenge"]),
        new Set(["musdb18-hq"]),
      ),
    ).toBe(false);
    expect(
      eligibleOriginObservationalCase(
        { ...observationalCase, originDetectorEligibility: "positive-and-negative" },
        new Set(["challenge"]),
        new Set(["maestro-v3"]),
      ),
    ).toBe(false);
  });

  it("keeps narrow-band edge material in an all-negative abstention population", () => {
    const edgeCase = {
      ...calibrationCase,
      datasetId: "musan",
      split: "test",
      originDetectorEligibility: "edge-abstention",
    };
    expect(
      eligibleOriginEdgeCase(
        edgeCase,
        new Set(["test"]),
        new Set(["musan"]),
      ),
    ).toBe(true);
  });

  it("exports path-free scalar measurements without spectrogram slices", () => {
    const record = originFeatureRecord(calibrationCase, analysis());
    expect(record).toMatchObject({
      id: "case:lossy",
      split: "development",
      truthClass: "lossy-to-lossless",
      features: {
        fftSize: 4096,
        effectiveBandwidthHz: 17_000,
        nyquistHz: 22_050,
        strongestCutoffHz: null,
        upperBandLevelDbfs: -120,
      },
    });
    expect(JSON.stringify(record)).not.toContain("slices");
    expect(JSON.stringify(record)).not.toContain("/Users/");
  });

  it("names every v12 prerequisite that blocks a controlled lossy case", () => {
    const record = originFeatureRecord(calibrationCase, analysis());
    expect(currentRuleBlockers(record, "lossy")).toEqual([
      "no-stable-cutoff-measured",
      "spectral-cliff-below-25db",
      "regional-stability-below-rule",
    ]);
  });

  it("recognizes a feature vector that satisfies the current upsample rule", () => {
    const item = {
      ...calibrationCase,
      id: "case:upsample",
      truthClass: "upsample",
      recipeId: "upsample-to-96k",
    };
    const record = originFeatureRecord(
      item,
      analysis({
        technical: { sampleRate: 96_000 },
        features: {
          effectiveBandwidthHz: 22_000,
          strongestCutoffHz: 22_050,
          cutoffDropDb: 10,
          upperBandLevelDbfs: -100,
          activeSlicePercent: 80,
          cutoffStabilityPercent: 75,
          priorNyquistMatchHz: 0,
          bandRuptureScoreDb: 5,
        },
      }),
    );
    expect(currentRuleBlockers(record, "upsample")).toEqual([]);
  });

  it("keeps the corrected texture candidate deterministic and sample-rate bounded", () => {
    const record = originFeatureRecord(
      calibrationCase,
      analysis({
        features: {
          highBandFloorOccupancyPercent: 20,
          highBandEntropyPercent: 85,
          highBandFlatnessDb: -10,
        },
      }),
    );
    expect(matchesTextureCandidateV2(record)).toBe(true);
    expect(
      matchesTextureCandidateV2({
        ...record,
        technical: { ...record.technical, sampleRate: 96_000 },
      }),
    ).toBe(false);
    expect(
      matchesTextureCandidateV2({
        ...record,
        features: {
          ...record.features,
          highBandEntropyPercent: 70,
          highBandFlatnessDb: -10,
        },
      }),
    ).toBe(false);
  });
});

describe("source-separated multivariate origin candidate", () => {
  function modelCase(
    id: string,
    groupId: string,
    truthClass: string,
    entropy: number,
  ) {
    return originFeatureRecord(
      {
        ...calibrationCase,
        id,
        groupId,
        truthClass,
        recipeId: `${truthClass}-recipe`,
      },
      analysis({
        features: {
          highBandEntropyPercent: entropy,
          highBandFloorOccupancyPercent: entropy / 5,
          normalizedSpectralFluxDb: -entropy,
        },
      }),
    );
  }

  it("fits a deterministic bounded model without treating its score as evidence", () => {
    const records = [
      modelCase("positive-a", "positive-a", "lossy-to-lossless", 95),
      modelCase("positive-b", "positive-b", "lossy-to-lossless", 90),
      modelCase("negative-a", "negative-a", "native-control", 20),
      modelCase("negative-b", "negative-b", "intentional-lowpass", 25),
    ];
    const first = trainOriginLogisticModel(records, "lossy", { iterations: 50 });
    const second = trainOriginLogisticModel(records, "lossy", { iterations: 50 });
    expect(first).toEqual(second);
    expect(originFeatureVector(records[0], first.schema)).toHaveLength(40);
  });

  it("selects a calibration threshold with zero false-hit source groups", () => {
    const records = [
      modelCase("positive", "positive", "lossy-to-lossless", 95),
      modelCase("native", "native", "native-control", 20),
      modelCase("lowpass", "lowpass", "intentional-lowpass", 25),
    ];
    const scored = [
      { record: records[0], score: 0.9 },
      { record: records[1], score: 0.2 },
      { record: records[2], score: 0.4 },
    ];
    const selected = selectZeroFalseGroupThreshold(scored, "lossy");
    expect(selected?.metrics.positive.hits).toBe(1);
    expect(selected?.metrics.negative.falseHitSourceGroups).toBe(0);
    expect(areaUnderRoc(scored, "lossy")).toBe(1);
  });

  it("counts one false advisory per independent source group", () => {
    const nativeA = modelCase("native-a", "shared", "native-control", 20);
    const nativeB = modelCase("native-b", "shared", "intentional-lowpass", 25);
    const positive = modelCase(
      "positive",
      "positive",
      "lossy-to-lossless",
      95,
    );
    const metrics = evaluateOriginScores(
      [
        { record: nativeA, score: 0.8 },
        { record: nativeB, score: 0.9 },
        { record: positive, score: 0.9 },
      ],
      "lossy",
      0.7,
    );
    expect(metrics.negative.falseHits).toBe(2);
    expect(metrics.negative.falseHitSourceGroups).toBe(1);
  });
});
