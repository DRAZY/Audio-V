import type {
  SpectrogramMeasurements,
  SpectrogramSlice,
} from "../../shared/contracts";

const floorDbfs = -120;

function fft(real: Float64Array, imaginary: Float64Array): void {
  const fftSize = real.length;
  for (let index = 1, reversed = 0; index < fftSize; index += 1) {
    let bit = fftSize >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
    }
  }

  for (let length = 2; length <= fftSize; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const phaseReal = Math.cos(angle);
    const phaseImaginary = Math.sin(angle);
    for (let offset = 0; offset < fftSize; offset += length) {
      let rotationReal = 1;
      let rotationImaginary = 0;
      for (let index = 0; index < length / 2; index += 1) {
        const even = offset + index;
        const odd = even + length / 2;
        const oddReal =
          real[odd] * rotationReal - imaginary[odd] * rotationImaginary;
        const oddImaginary =
          real[odd] * rotationImaginary + imaginary[odd] * rotationReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal =
          rotationReal * phaseReal - rotationImaginary * phaseImaginary;
        rotationImaginary =
          rotationReal * phaseImaginary + rotationImaginary * phaseReal;
        rotationReal = nextReal;
      }
    }
  }
}

export class SpectrogramAccumulator {
  readonly #sampleRate: number;
  readonly #channels: number;
  readonly #totalFrames: number;
  readonly #fftSize: number;
  readonly #binCount: number;
  readonly #maxSlices: number;
  readonly #hopSize: number;
  readonly #rings: Float64Array[];
  readonly #slices: SpectrogramSlice[] = [];
  #writeIndex = 0;
  #framesSeen = 0;
  #nextWindowEnd: number;

  constructor(
    sampleRate: number,
    channels: number,
    totalFrames: number,
    options: { fftSize?: number; maxSlices?: number } = {},
  ) {
    const fftSize = options.fftSize ?? 512;
    if (
      !Number.isInteger(fftSize) ||
      fftSize < 256 ||
      (fftSize & (fftSize - 1)) !== 0
    ) {
      throw new RangeError("Spectrogram FFT size must be a power of two.");
    }
    this.#sampleRate = sampleRate;
    this.#channels = channels;
    this.#totalFrames = totalFrames;
    this.#fftSize = fftSize;
    this.#binCount = fftSize / 2;
    this.#maxSlices = options.maxSlices ?? 180;
    this.#nextWindowEnd = fftSize;
    this.#rings = Array.from(
      { length: channels },
      () => new Float64Array(fftSize),
    );
    this.#hopSize = Math.max(
      fftSize / 2,
      Math.ceil(
        Math.max(1, totalFrames - fftSize) /
          Math.max(1, this.#maxSlices - 1),
      ),
    );
  }

  pushInterleaved(samples: ArrayLike<number>): void {
    for (let offset = 0; offset < samples.length; offset += this.#channels) {
      for (let channel = 0; channel < this.#channels; channel += 1) {
        this.#rings[channel][this.#writeIndex] = samples[offset + channel];
      }
      this.#writeIndex = (this.#writeIndex + 1) % this.#fftSize;
      this.#framesSeen += 1;

      if (
        this.#framesSeen === this.#nextWindowEnd &&
        this.#slices.length < this.#maxSlices
      ) {
        this.#captureSlice(this.#framesSeen - this.#fftSize);
        this.#nextWindowEnd += this.#hopSize;
      }
    }
  }

  #captureSlice(windowStart: number): void {
    const fftSize = this.#fftSize;
    const powerByBin = new Float64Array(this.#binCount);
    for (const ring of this.#rings) {
      const real = new Float64Array(fftSize);
      const imaginary = new Float64Array(fftSize);
      for (let index = 0; index < fftSize; index += 1) {
        const sample =
          this.#framesSeen < fftSize
            ? index < this.#framesSeen
              ? ring[index]
              : 0
            : ring[(this.#writeIndex + index) % fftSize];
        const hann =
          0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (fftSize - 1));
        real[index] = sample * hann;
      }
      fft(real, imaginary);
      for (let bin = 0; bin < this.#binCount; bin += 1) {
        const magnitude =
          (2 * Math.hypot(real[bin], imaginary[bin])) / (fftSize * 0.5);
        powerByBin[bin] += magnitude * magnitude;
      }
    }

    const levelsDbfs = Array.from({ length: this.#binCount }, (_, bin) => {
      const averagePower = powerByBin[bin] / this.#channels;
      return Number(
        Math.max(
          floorDbfs,
          10 * Math.log10(Math.max(averagePower, 1e-12)),
        ).toFixed(2),
      );
    });
    this.#slices.push({
      timeSeconds: Number(
        ((Math.max(0, windowStart) + fftSize / 2) / this.#sampleRate).toFixed(4),
      ),
      levelsDbfs,
    });
  }

  finish(): SpectrogramMeasurements {
    const fftSize = this.#fftSize;
    if (this.#slices.length === 0 && this.#framesSeen > 0) {
      this.#captureSlice(0);
    }
    let effectiveBandwidthHz: number | null = null;
    let strongestCutoffHz: number | null = null;
    let cutoffDropDb: number | null = null;
    let upperBandLevelDbfs: number | null = null;
    if (this.#slices.length > 0) {
      const averageLevels = Array.from({ length: this.#binCount }, (_, bin) => {
        const averagePower =
          this.#slices.reduce(
            (sum, slice) => sum + 10 ** (slice.levelsDbfs[bin] / 10),
            0,
          ) / this.#slices.length;
        return 10 * Math.log10(Math.max(averagePower, 1e-12));
      });
      const strongest = Math.max(...averageLevels);
      const bandwidthFloor = Math.max(-90, strongest - 60);
      for (let bin = this.#binCount - 2; bin >= 1; bin -= 1) {
        const localAverage =
          (averageLevels[bin - 1] +
            averageLevels[bin] +
            averageLevels[bin + 1]) /
          3;
        if (localAverage >= bandwidthFloor) {
          effectiveBandwidthHz = Math.round(
            (bin * this.#sampleRate) / fftSize,
          );
          break;
        }
      }
      const upperBandStart = Math.floor(this.#binCount * 0.85);
      const upperBandPower =
        averageLevels
          .slice(upperBandStart)
          .reduce((sum, level) => sum + 10 ** (level / 10), 0) /
        (this.#binCount - upperBandStart);
      upperBandLevelDbfs = Number(
        (10 * Math.log10(Math.max(upperBandPower, 1e-12))).toFixed(2),
      );
      const comparisonWidth = 6;
      let strongestDrop = 0;
      for (
        let bin = Math.max(
          comparisonWidth,
          Math.ceil((8_000 * fftSize) / this.#sampleRate),
        );
        bin < this.#binCount - comparisonWidth;
        bin += 1
      ) {
        const before =
          averageLevels
            .slice(bin - comparisonWidth, bin)
            .reduce((sum, level) => sum + level, 0) / comparisonWidth;
        const after =
          averageLevels
            .slice(bin, bin + comparisonWidth)
            .reduce((sum, level) => sum + level, 0) / comparisonWidth;
        const drop = before - after;
        if (before >= strongest - 30 && drop > strongestDrop) {
          strongestDrop = drop;
          strongestCutoffHz = Math.round((bin * this.#sampleRate) / fftSize);
        }
      }
      cutoffDropDb =
        strongestCutoffHz === null ? null : Number(strongestDrop.toFixed(2));
    }
    return {
      algorithm: "STFT",
      channelMode: "per-channel power average",
      fftSize: this.#fftSize,
      hopSize: this.#hopSize,
      window: "Hann",
      frequencyScale: "linear",
      floorDbfs,
      maxFrequencyHz: this.#sampleRate / 2,
      effectiveBandwidthHz,
      strongestCutoffHz,
      cutoffDropDb,
      upperBandLevelDbfs,
      durationSeconds: this.#totalFrames / this.#sampleRate,
      slices: this.#slices,
    };
  }
}
