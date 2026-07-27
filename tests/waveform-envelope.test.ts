import { describe, expect, it } from "vitest";
import { WaveformEnvelopeAccumulator } from "../electron/oracle/waveform-envelope";

describe("WaveformEnvelopeAccumulator", () => {
  it("stores a bounded full-track min/max/RMS envelope without retaining PCM", () => {
    const accumulator = new WaveformEnvelopeAccumulator(4, 2, 4);
    accumulator.pushInterleaved([
      0.5, 0.5,
      -0.5, -0.5,
      1, 0,
      -1, 0,
    ]);

    const result = accumulator.finish();

    expect(result.mix).toBe("per-channel envelope");
    expect(result.pointCount).toBe(4);
    expect(result.points.map((point) => point.maximum)).toEqual([
      0.5, -0.5, 1, 0,
    ]);
    expect(result.points[0].timeSeconds).toBe(0.125);
  });

  it("does not erase opposite-polarity stereo content", () => {
    const accumulator = new WaveformEnvelopeAccumulator(2, 2, 2);
    accumulator.pushInterleaved([0.8, -0.8, -0.6, 0.6]);

    const result = accumulator.finish();

    expect(result.points[0]).toMatchObject({ minimum: -0.8, maximum: 0.8 });
    expect(result.points[1]).toMatchObject({ minimum: -0.6, maximum: 0.6 });
  });

  it("caps long files at 480 display points", () => {
    const accumulator = new WaveformEnvelopeAccumulator(48_000, 1, 1_000);
    accumulator.pushInterleaved(new Float64Array(1_000));

    expect(accumulator.finish().pointCount).toBe(480);
  });
});
