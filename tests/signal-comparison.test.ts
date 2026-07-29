import { describe, expect, it } from "vitest";
import { compareDecodedSignals } from "../electron/oracle/signal-comparison";

describe("compareDecodedSignals", () => {
  it("recovers offset, gain, and inverted polarity", () => {
    const sampleRate = 8_000;
    const delay = 1_600;
    const left = new Float32Array(sampleRate * 4);
    const right = new Float32Array(left.length + delay);
    for (let index = 0; index < left.length; index += 1) {
      const signal =
        0.35 * Math.sin((2 * Math.PI * 317 * index) / sampleRate) +
        0.2 * Math.sin((2 * Math.PI * 701 * index) / sampleRate);
      left[index] = signal;
      right[index + delay] = -0.5 * signal;
    }

    const result = compareDecodedSignals(left, right);

    expect(result.offsetSeconds).toBeCloseTo(0.2, 2);
    expect(result.sampleCorrelation).toBeLessThan(-0.999);
    expect(result.polarity).toBe("inverted");
    expect(result.gainDifferenceDb).toBeCloseTo(-6.02, 1);
    expect(result.relationship).toBe("aligned-equivalent");
    expect(result.residualVisual.source).toBe("aligned-8khz-mono-preview");
    expect(result.residualVisual.waveform.points.length).toBeGreaterThan(0);
    expect(result.residualVisual.spectrogram.slices.length).toBeGreaterThan(0);
    expect(
      result.residualVisual.peakDbfs === null ||
        result.residualVisual.peakDbfs < -100,
    ).toBe(true);
  });

  it("measures an explicitly selected aligned region separately", () => {
    const sampleRate = 8_000;
    const left = new Float32Array(sampleRate * 3);
    const right = new Float32Array(left.length);
    let state = 0x1234_5678;
    for (let index = 0; index < left.length; index += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      const noise = (state / 0xffff_ffff) * 2 - 1;
      left[index] =
        0.3 * Math.sin((2 * Math.PI * 440 * index) / sampleRate) +
        0.05 * noise;
      right[index] = left[index];
    }
    for (let index = sampleRate; index < sampleRate * 2; index += 1) {
      right[index] += 0.05 * Math.sin((2 * Math.PI * 1_200 * index) / sampleRate);
    }

    const complete = compareDecodedSignals(left, right);
    const selected = compareDecodedSignals(left, right, {
      startSeconds: 1,
      endSeconds: 2,
    });

    expect(selected.region.startSeconds).toBeCloseTo(1, 3);
    expect(selected.region.endSeconds).toBeCloseTo(2, 3);
    expect(selected.region.durationSeconds).toBeCloseTo(1, 3);
    expect(selected.region.residualRmsDb).toBeGreaterThan(
      complete.residualRmsDb,
    );
    expect(selected.region.peakResidualDbfs).not.toBeNull();
  });
});
