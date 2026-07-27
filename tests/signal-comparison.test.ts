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
  });
});
