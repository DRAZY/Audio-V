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
});
