import { describe, expect, it } from "vitest";
import { PcmMeasurementAccumulator } from "../electron/oracle/pcm-measurements";

describe("PcmMeasurementAccumulator", () => {
  it("measures peak and RMS from real sample values", () => {
    const analyzer = new PcmMeasurementAccumulator(4, 1);
    analyzer.pushInterleaved([0.5, -0.5, 0.5, -0.5]);

    const result = analyzer.finish();

    expect(result.frames).toBe(4);
    expect(result.durationSeconds).toBe(1);
    expect(result.samplePeakDbfs).toBeCloseTo(-6.0206, 3);
    expect(result.rmsDbfs).toBeCloseTo(-6.0206, 3);
    expect(result.perChannel[0].dcOffset).toBe(0);
  });

  it("detects duplicated mono and positive stereo correlation", () => {
    const analyzer = new PcmMeasurementAccumulator(4, 2);
    analyzer.pushInterleaved([0.25, 0.25, -0.5, -0.5, 0.75, 0.75, -0.25, -0.25]);

    const result = analyzer.finish();

    expect(result.duplicatedMono).toBe(true);
    expect(result.stereoCorrelation).toBeCloseTo(1, 8);
    expect(result.stereoAssessment).toBe("dual-mono");
    expect(result.sideToMidRatioDb).toBe(-120);
  });

  it("separates near-mono material from distinct stereo content", () => {
    const nearMono = new PcmMeasurementAccumulator(4, 2);
    nearMono.pushInterleaved([
      0.25, 0.2501, -0.5, -0.4999, 0.75, 0.7501, -0.25, -0.2499,
    ]);
    const stereo = new PcmMeasurementAccumulator(4, 2);
    stereo.pushInterleaved([
      0.25, -0.1, -0.5, -0.25, 0.75, 0.4, -0.25, 0.6,
    ]);

    expect(nearMono.finish().stereoAssessment).toBe("near-mono");
    expect(stereo.finish().stereoAssessment).toBe("stereo-content");
  });

  it("detects inverted stereo without calling it duplicated mono", () => {
    const analyzer = new PcmMeasurementAccumulator(4, 2);
    analyzer.pushInterleaved([0.25, -0.25, -0.5, 0.5, 0.75, -0.75, -0.25, 0.25]);

    const result = analyzer.finish();

    expect(result.duplicatedMono).toBe(false);
    expect(result.stereoCorrelation).toBeCloseTo(-1, 8);
  });

  it("counts clipped and near-clipped samples independently", () => {
    const analyzer = new PcmMeasurementAccumulator(4, 1);
    analyzer.pushInterleaved([1, -1.01, 0.99, 0.5]);

    const result = analyzer.finish();

    expect(result.clippedSamples).toBe(2);
    expect(result.nearClippedSamples).toBe(3);
    expect(result.perChannel[0].clippedSamples).toBe(2);
    expect(result.clipping.clippedSamplePercent).toBe(50);
    expect(result.clipping.eventCount).toBe(1);
    expect(result.clipping.events[0]).toMatchObject({
      startSeconds: 0,
      endSeconds: 0.5,
      clippedSamples: 2,
      channels: [0],
    });
  });

  it("keeps per-channel clipping and scaled-plateau evidence distinct", () => {
    const analyzer = new PcmMeasurementAccumulator(8, 2);
    analyzer.pushInterleaved([
      0.75, 1, 0.75, 1, 0.75, 0, 0.75, 0,
      0.1, 0, 0.2, 0, 0.3, 0, 0.4, 0,
    ]);
    const result = analyzer.finish();

    expect(result.perChannel[0].scaledClippingCandidateSamples).toBe(4);
    expect(result.perChannel[1].clippedSamples).toBe(2);
    expect(result.perChannel[1].clippedSamplePercent).toBe(25);
    expect(result.clipping.scaledClippingIndicator).toBe(
      "possible-scaled-clipping",
    );
  });

  it("detects unused least-significant bits in integer lossless PCM", () => {
    const analyzer = new PcmMeasurementAccumulator(48_000, 1, {
      declaredBitDepth: 24,
      bitUtilizationApplicable: true,
    });
    const scale = 2 ** 23;
    analyzer.pushInterleaved(
      [256, -512, 768, -1_024].map((value) => value / scale),
    );

    expect(analyzer.finish().bitUtilization).toMatchObject({
      applicable: true,
      declaredBitDepth: 24,
      effectiveBitDepth: 16,
      unusedLeastSignificantBits: 8,
      classification: "possible-bit-padding",
    });
  });

  it("rejects malformed interleaved buffers and non-finite values", () => {
    const analyzer = new PcmMeasurementAccumulator(48_000, 2);

    expect(() => analyzer.pushInterleaved([0])).toThrow(/divide evenly/);
    expect(() => analyzer.pushInterleaved([Number.NaN, 0])).toThrow(
      /finite numbers/,
    );
  });

  it("measures internal digital-silence runs and steep transitions", () => {
    const analyzer = new PcmMeasurementAccumulator(10, 1);
    analyzer.pushInterleaved([0.25, 0.25, 0, 0, 0.25, -0.9, 0.25]);

    const result = analyzer.finish();

    expect(result.continuity.exactDigitalSilenceFrames).toBe(2);
    expect(result.continuity.longestDigitalSilenceSeconds).toBe(0.2);
    expect(result.continuity.internalDigitalDropoutCount).toBe(1);
    expect(result.continuity.discontinuityCandidateCount).toBe(2);
    expect(result.crestFactorDb).not.toBeNull();
  });

  it("detects isolated click/pop impulses without calling them clipping", () => {
    const analyzer = new PcmMeasurementAccumulator(48_000, 1);
    analyzer.pushInterleaved([0, 0, 0, 0, 0.8, 0, 0, 0, 0]);

    const result = analyzer.finish();

    expect(result.clippedSamples).toBe(0);
    expect(result.defects.clickPopCandidateCount).toBe(1);
    expect(result.defects.events[0]).toMatchObject({
      kind: "click-pop-candidate",
      channel: 0,
      amplitude: 0.8,
    });
  });

  it("groups a sustained non-zero constant run as one stuck-sample candidate", () => {
    const analyzer = new PcmMeasurementAccumulator(48_000, 1);
    analyzer.pushInterleaved([
      ...Array.from({ length: 600 }, () => 0.125),
      0.2,
    ]);

    const result = analyzer.finish();

    expect(result.defects.stuckSampleCandidateCount).toBe(1);
    expect(result.defects.events).toContainEqual(
      expect.objectContaining({
        kind: "stuck-sample-candidate",
        channel: 0,
      }),
    );
  });
});
