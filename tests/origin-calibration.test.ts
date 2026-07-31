import { describe, expect, it } from "vitest";
import {
  currentRuleBlockers,
  eligibleOriginCalibrationCase,
  eligibleOriginObservationalCase,
  originFeatureRecord,
} from "../scripts/lib/origin-calibration.mjs";

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
});
