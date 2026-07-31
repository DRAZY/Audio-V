import { describe, expect, it } from "vitest";
import { SpectrogramAccumulator } from "../electron/oracle/spectrogram";

describe("SpectrogramAccumulator", () => {
  it("preserves opposite-polarity stereo energy instead of canceling it", () => {
    const sampleRate = 48_000;
    const frames = 512;
    const samples = new Float64Array(frames * 2);
    for (let frame = 0; frame < frames; frame += 1) {
      const sample = 0.8 * Math.sin((2 * Math.PI * 3_000 * frame) / sampleRate);
      samples[frame * 2] = sample;
      samples[frame * 2 + 1] = -sample;
    }
    const accumulator = new SpectrogramAccumulator(sampleRate, 2, frames);
    accumulator.pushInterleaved(samples);

    const result = accumulator.finish();
    const targetBin = Math.round((3_000 * result.fftSize) / sampleRate);

    expect(result.channelMode).toBe("per-channel power average");
    expect(result.slices[0].levelsDbfs[targetBin]).toBeGreaterThan(-12);
  });

  it("measures left, right, and L-R difference without downmix ambiguity", () => {
    const sampleRate = 48_000;
    const frames = 512;
    const samples = new Float64Array(frames * 2);
    for (let frame = 0; frame < frames; frame += 1) {
      samples[frame * 2] =
        0.8 * Math.sin((2 * Math.PI * 3_000 * frame) / sampleRate);
      samples[frame * 2 + 1] =
        0.8 * Math.sin((2 * Math.PI * 6_000 * frame) / sampleRate);
    }
    const left = new SpectrogramAccumulator(sampleRate, 2, frames, {
      channelMode: "left channel",
    });
    const right = new SpectrogramAccumulator(sampleRate, 2, frames, {
      channelMode: "right channel",
    });
    const difference = new SpectrogramAccumulator(sampleRate, 2, frames, {
      channelMode: "left-right difference",
    });
    left.pushInterleaved(samples);
    right.pushInterleaved(samples);
    difference.pushInterleaved(samples);

    const leftResult = left.finish();
    const rightResult = right.finish();
    const differenceResult = difference.finish();
    const leftBin = Math.round((3_000 * leftResult.fftSize) / sampleRate);
    const rightBin = Math.round((6_000 * rightResult.fftSize) / sampleRate);
    expect(leftResult.slices[0].levelsDbfs[leftBin]).toBeGreaterThan(-12);
    expect(leftResult.slices[0].levelsDbfs[rightBin]).toBeLessThan(-60);
    expect(rightResult.slices[0].levelsDbfs[rightBin]).toBeGreaterThan(-12);
    expect(differenceResult.slices[0].levelsDbfs[leftBin]).toBeGreaterThan(-18);
    expect(differenceResult.channelMode).toBe("left-right difference");
  });

  it("reports rolloff and relative high-band energy without requiring a cutoff", () => {
    const sampleRate = 48_000;
    const frames = 4_096;
    const samples = new Float64Array(frames);
    for (let frame = 0; frame < frames; frame += 1) {
      samples[frame] =
        0.6 * Math.sin((2 * Math.PI * 2_000 * frame) / sampleRate) +
        0.2 * Math.sin((2 * Math.PI * 10_000 * frame) / sampleRate) +
        0.12 * Math.sin((2 * Math.PI * 19_000 * frame) / sampleRate);
    }
    const accumulator = new SpectrogramAccumulator(sampleRate, 1, frames, {
      fftSize: 4_096,
    });
    accumulator.pushInterleaved(samples);

    const result = accumulator.finish();

    expect(result.spectralRolloff85Hz).toBeGreaterThan(1_900);
    expect(result.spectralRolloff85Hz).toBeLessThan(10_100);
    expect(result.spectralRolloff95Hz).toBeGreaterThan(9_900);
    expect(result.spectralRolloff99Hz).toBeGreaterThan(18_800);
    expect(result.energyAbove18kDb).not.toBeNull();
    expect(result.energyAbove18kDb!).toBeLessThan(-12);
    expect(result.energyAbove20kDb).not.toBeNull();
    expect(result.energyAbove20kDb!).toBeLessThan(
      result.energyAbove18kDb!,
    );
  });
});
