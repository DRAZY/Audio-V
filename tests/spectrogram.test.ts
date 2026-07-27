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
});
