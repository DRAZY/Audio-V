import type {
  WaveformMeasurements,
  WaveformPoint,
} from "../../shared/contracts";

interface Bucket {
  minimum: number;
  maximum: number;
  sumSquares: number;
  frames: number;
}

const maximumPoints = 480;

export class WaveformEnvelopeAccumulator {
  readonly #sampleRate: number;
  readonly #channels: number;
  readonly #totalFrames: number;
  readonly #buckets: Bucket[];
  #framesSeen = 0;

  constructor(sampleRate: number, channels: number, totalFrames: number) {
    this.#sampleRate = sampleRate;
    this.#channels = channels;
    this.#totalFrames = Math.max(1, totalFrames);
    this.#buckets = Array.from(
      { length: Math.min(maximumPoints, this.#totalFrames) },
      () => ({
        minimum: Number.POSITIVE_INFINITY,
        maximum: Number.NEGATIVE_INFINITY,
        sumSquares: 0,
        frames: 0,
      }),
    );
  }

  pushInterleaved(samples: ArrayLike<number>): void {
    for (let offset = 0; offset < samples.length; offset += this.#channels) {
      let frameMinimum = Number.POSITIVE_INFINITY;
      let frameMaximum = Number.NEGATIVE_INFINITY;
      let framePower = 0;
      for (let channel = 0; channel < this.#channels; channel += 1) {
        const sample = samples[offset + channel];
        frameMinimum = Math.min(frameMinimum, sample);
        frameMaximum = Math.max(frameMaximum, sample);
        framePower += sample * sample;
      }
      const bucketIndex = Math.min(
        this.#buckets.length - 1,
        Math.floor(
          (this.#framesSeen / this.#totalFrames) * this.#buckets.length,
        ),
      );
      const bucket = this.#buckets[bucketIndex];
      bucket.minimum = Math.min(bucket.minimum, frameMinimum);
      bucket.maximum = Math.max(bucket.maximum, frameMaximum);
      bucket.sumSquares += framePower / this.#channels;
      bucket.frames += 1;
      this.#framesSeen += 1;
    }
  }

  finish(): WaveformMeasurements {
    const points: WaveformPoint[] = this.#buckets
      .map((bucket, index) => {
        if (bucket.frames === 0) return null;
        return {
          timeSeconds: Number(
            (
              ((index + 0.5) / this.#buckets.length) *
              (this.#framesSeen / this.#sampleRate)
            ).toFixed(4),
          ),
          minimum: Number(bucket.minimum.toFixed(6)),
          maximum: Number(bucket.maximum.toFixed(6)),
          rms: Number(
            Math.sqrt(bucket.sumSquares / bucket.frames).toFixed(6),
          ),
        };
      })
      .filter((point): point is WaveformPoint => point !== null);
    return {
      mix: "per-channel envelope",
      pointCount: points.length,
      points,
    };
  }
}
