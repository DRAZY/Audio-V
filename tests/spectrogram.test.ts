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
});
