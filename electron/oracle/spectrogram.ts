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
  readonly #channelMode: SpectrogramMeasurements["channelMode"];
  readonly #rings: Float64Array[];
  readonly #slices: SpectrogramSlice[] = [];
  #writeIndex = 0;
  #framesSeen = 0;
  #nextWindowEnd: number;

  constructor(
    sampleRate: number,
    channels: number,
    totalFrames: number,
    options: {
      fftSize?: number;
      maxSlices?: number;
      channelMode?: SpectrogramMeasurements["channelMode"];
    } = {},
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
    const requestedChannelMode =
      options.channelMode ?? "per-channel power average";
    this.#channelMode =
      requestedChannelMode !== "per-channel power average" && channels < 2
        ? "left channel"
        : requestedChannelMode;
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
    const analysisRings =
      this.#channelMode === "per-channel power average"
        ? this.#rings
        : [this.#derivedChannelRing()];
    for (const ring of analysisRings) {
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
      const averagePower = powerByBin[bin] / analysisRings.length;
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

  #derivedChannelRing(): Float64Array {
    if (this.#channelMode === "left channel") return this.#rings[0];
    if (this.#channelMode === "right channel") {
      return this.#rings[Math.min(1, this.#rings.length - 1)];
    }
    const difference = new Float64Array(this.#fftSize);
    const left = this.#rings[0];
    const right = this.#rings[Math.min(1, this.#rings.length - 1)];
    for (let index = 0; index < difference.length; index += 1) {
      difference[index] = (left[index] - right[index]) / 2;
    }
    return difference;
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
    let spectralRolloff85Hz: number | null = null;
    let spectralRolloff95Hz: number | null = null;
    let spectralRolloff99Hz: number | null = null;
    let energyAbove15kDb: number | null = null;
    let energyAbove18kDb: number | null = null;
    let energyAbove20kDb: number | null = null;
    let effectiveBandwidthEdgeDropDb: number | null = null;
    let normalizedSpectralFluxDb: number | null = null;
    let highBandFlatnessDb: number | null = null;
    let highBandCrestDb: number | null = null;
    let highBandEntropyPercent: number | null = null;
    let highBandFloorOccupancyPercent: number | null = null;
    let activeSlicePercent = 0;
    let cutoffStabilityPercent: number | null = null;
    let priorNyquistMatchHz: number | null = null;
    let bandRuptureScoreDb: number | null = null;
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
      const averagePowers = averageLevels.map((level) => 10 ** (level / 10));
      const totalSpectralPower = averagePowers
        .slice(1)
        .reduce((sum, power) => sum + power, 0);
      const rolloffFrequency = (fraction: number): number | null => {
        if (totalSpectralPower <= 0) return null;
        const target = totalSpectralPower * fraction;
        let cumulative = 0;
        for (let bin = 1; bin < averagePowers.length; bin += 1) {
          cumulative += averagePowers[bin];
          if (cumulative >= target) {
            return Math.round((bin * this.#sampleRate) / fftSize);
          }
        }
        return Math.round(
          ((averagePowers.length - 1) * this.#sampleRate) / fftSize,
        );
      };
      const relativeEnergyAbove = (frequencyHz: number): number | null => {
        const firstBin = Math.ceil((frequencyHz * fftSize) / this.#sampleRate);
        if (
          totalSpectralPower <= 0 ||
          firstBin >= averagePowers.length
        ) {
          return null;
        }
        const bandPower = averagePowers
          .slice(Math.max(1, firstBin))
          .reduce((sum, power) => sum + power, 0);
        return Number(
          (
            10 *
            Math.log10(
              Math.max(bandPower / totalSpectralPower, Number.EPSILON),
            )
          ).toFixed(2),
        );
      };
      spectralRolloff85Hz = rolloffFrequency(0.85);
      spectralRolloff95Hz = rolloffFrequency(0.95);
      spectralRolloff99Hz = rolloffFrequency(0.99);
      energyAbove15kDb = relativeEnergyAbove(15_000);
      energyAbove18kDb = relativeEnergyAbove(18_000);
      energyAbove20kDb = relativeEnergyAbove(20_000);
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
      if (effectiveBandwidthHz !== null) {
        const edgeBin = Math.round(
          (effectiveBandwidthHz * fftSize) / this.#sampleRate,
        );
        const edgeWidth = Math.max(
          3,
          Math.round((500 * fftSize) / this.#sampleRate),
        );
        if (
          edgeBin >= edgeWidth &&
          edgeBin + edgeWidth < averageLevels.length
        ) {
          const before =
            averageLevels
              .slice(edgeBin - edgeWidth, edgeBin)
              .reduce((sum, level) => sum + level, 0) / edgeWidth;
          const after =
            averageLevels
              .slice(edgeBin + 1, edgeBin + edgeWidth + 1)
              .reduce((sum, level) => sum + level, 0) / edgeWidth;
          effectiveBandwidthEdgeDropDb = Number((before - after).toFixed(2));
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
      const comparisonWidth = Math.max(
        6,
        Math.round((300 * fftSize) / this.#sampleRate),
      );
      let strongestDrop = 0;
      const dropCandidates: Array<{ bin: number; drop: number }> = [];
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
        if (before >= strongest - 30 && drop > 0) {
          dropCandidates.push({ bin, drop });
        }
        if (before >= strongest - 30 && drop > strongestDrop) {
          strongestDrop = drop;
          strongestCutoffHz = Math.round((bin * this.#sampleRate) / fftSize);
        }
      }
      cutoffDropDb =
        strongestCutoffHz === null ? null : Number(strongestDrop.toFixed(2));
      if (strongestCutoffHz !== null) {
        const priorNyquistRates = [
          8_000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100,
          48_000, 88_200, 96_000,
        ].filter((frequency) => frequency < this.#sampleRate / 2 - 250);
        priorNyquistMatchHz =
          priorNyquistRates.length === 0
            ? null
            : Math.min(
                ...priorNyquistRates.map((frequency) =>
                  Math.abs(strongestCutoffHz! - frequency),
                ),
              );
        const separatedDrops = dropCandidates
          .filter(
            ({ bin }) =>
              Math.abs(
                (bin * this.#sampleRate) / fftSize - strongestCutoffHz!,
              ) >= 1_000,
          )
          .sort((left, right) => right.drop - left.drop);
        bandRuptureScoreDb =
          separatedDrops.length > 0
            ? Number(separatedDrops[0].drop.toFixed(2))
            : null;
      }

      const activeSlices = this.#slices.filter(
        (slice) => Math.max(...slice.levelsDbfs) > -70,
      );
      activeSlicePercent = Number(
        ((activeSlices.length / this.#slices.length) * 100).toFixed(1),
      );
      if (activeSlices.length > 0) {
        const highBandStart = Math.max(
          1,
          Math.ceil((8_000 * fftSize) / this.#sampleRate),
        );
        const flatnessValues: number[] = [];
        const crestValues: number[] = [];
        const entropyValues: number[] = [];
        let floorCells = 0;
        let highBandCells = 0;
        const normalizedBands: number[][] = [];
        for (const slice of activeSlices) {
          const strongestLevel = Math.max(...slice.levelsDbfs);
          const band = slice.levelsDbfs.slice(highBandStart);
          if (band.length === 0) continue;
          const measurableBand = band.filter(
            (level) => level > floorDbfs + 0.5,
          );
          const powers = measurableBand.map((level) => 10 ** (level / 10));
          const powerSum = powers.reduce((sum, power) => sum + power, 0);
          if (measurableBand.length > 0) {
            const meanPower = powerSum / powers.length;
            const meanLogPowerDb =
              measurableBand.reduce((sum, level) => sum + level, 0) /
              measurableBand.length;
            flatnessValues.push(
              meanLogPowerDb - 10 * Math.log10(Math.max(meanPower, 1e-12)),
            );
            crestValues.push(
              Math.max(...measurableBand) -
                10 * Math.log10(Math.max(meanPower, 1e-12)),
            );
          }
          if (powerSum > 0 && measurableBand.length > 1) {
            const entropy = -powers.reduce((sum, power) => {
              const probability = power / powerSum;
              return probability <= 0
                ? sum
                : sum + probability * Math.log(probability);
            }, 0);
            entropyValues.push(
              (entropy / Math.log(measurableBand.length)) * 100,
            );
          }
          floorCells += band.filter((level) => level <= floorDbfs + 0.5).length;
          highBandCells += band.length;
          normalizedBands.push(
            band.map((level) => Math.max(-80, level - strongestLevel)),
          );
        }
        const median = (values: number[]): number | null => {
          if (values.length === 0) return null;
          const sorted = [...values].sort((left, right) => left - right);
          const middle = Math.floor(sorted.length / 2);
          return sorted.length % 2 === 0
            ? (sorted[middle - 1] + sorted[middle]) / 2
            : sorted[middle];
        };
        const flatnessMedian = median(flatnessValues);
        const crestMedian = median(crestValues);
        const entropyMedian = median(entropyValues);
        highBandFlatnessDb =
          flatnessMedian === null ? null : Number(flatnessMedian.toFixed(2));
        highBandCrestDb =
          crestMedian === null ? null : Number(crestMedian.toFixed(2));
        highBandEntropyPercent =
          entropyMedian === null ? null : Number(entropyMedian.toFixed(2));
        highBandFloorOccupancyPercent =
          highBandCells === 0
            ? null
            : Number(((floorCells / highBandCells) * 100).toFixed(2));
        const fluxValues: number[] = [];
        for (let index = 1; index < normalizedBands.length; index += 1) {
          const previous = normalizedBands[index - 1];
          const current = normalizedBands[index];
          if (previous.length !== current.length || current.length === 0) {
            continue;
          }
          const squaredDifference = current.reduce((sum, level, bin) => {
            const difference = level - previous[bin];
            return sum + difference * difference;
          }, 0);
          fluxValues.push(Math.sqrt(squaredDifference / current.length));
        }
        const fluxMedian = median(fluxValues);
        normalizedSpectralFluxDb =
          fluxMedian === null ? null : Number(fluxMedian.toFixed(2));
      }
      if (strongestCutoffHz !== null && activeSlices.length >= 3) {
        let matchingSlices = 0;
        for (const slice of activeSlices) {
          const sliceStrongest = Math.max(...slice.levelsDbfs);
          let sliceCutoffHz: number | null = null;
          let sliceStrongestDrop = 0;
          let sliceBandwidthHz: number | null = null;
          const sliceBandwidthFloor = Math.max(-90, sliceStrongest - 60);
          for (let bin = this.#binCount - 2; bin >= 1; bin -= 1) {
            const localAverage =
              (slice.levelsDbfs[bin - 1] +
                slice.levelsDbfs[bin] +
                slice.levelsDbfs[bin + 1]) /
              3;
            if (localAverage >= sliceBandwidthFloor) {
              sliceBandwidthHz = (bin * this.#sampleRate) / fftSize;
              break;
            }
          }
          for (
            let bin = Math.max(
              comparisonWidth,
              Math.ceil((8_000 * fftSize) / this.#sampleRate),
            );
            bin < this.#binCount - comparisonWidth;
            bin += 1
          ) {
            const before =
              slice.levelsDbfs
                .slice(bin - comparisonWidth, bin)
                .reduce((sum, level) => sum + level, 0) / comparisonWidth;
            const after =
              slice.levelsDbfs
                .slice(bin, bin + comparisonWidth)
                .reduce((sum, level) => sum + level, 0) / comparisonWidth;
            const drop = before - after;
            if (before >= sliceStrongest - 30 && drop > sliceStrongestDrop) {
              sliceStrongestDrop = drop;
              sliceCutoffHz = (bin * this.#sampleRate) / fftSize;
            }
          }
          const cutoffMatches =
            sliceCutoffHz !== null &&
            sliceStrongestDrop >= Math.max(5, strongestDrop * 0.6) &&
            Math.abs(sliceCutoffHz - strongestCutoffHz) <= 500;
          const bandwidthMatches =
            sliceBandwidthHz !== null &&
            effectiveBandwidthHz !== null &&
            Math.abs(sliceBandwidthHz - effectiveBandwidthHz) <= 1_000;
          if (cutoffMatches || bandwidthMatches) {
            matchingSlices += 1;
          }
        }
        cutoffStabilityPercent = Number(
          ((matchingSlices / activeSlices.length) * 100).toFixed(1),
        );
      }
    }
    return {
      algorithm: "STFT",
      channelMode: this.#channelMode,
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
      spectralRolloff85Hz,
      spectralRolloff95Hz,
      spectralRolloff99Hz,
      energyAbove15kDb,
      energyAbove18kDb,
      energyAbove20kDb,
      effectiveBandwidthEdgeDropDb,
      normalizedSpectralFluxDb,
      highBandFlatnessDb,
      highBandCrestDb,
      highBandEntropyPercent,
      highBandFloorOccupancyPercent,
      activeSlicePercent,
      cutoffStabilityPercent,
      priorNyquistMatchHz,
      bandRuptureScoreDb,
      durationSeconds: this.#totalFrames / this.#sampleRate,
      slices: this.#slices,
    };
  }
}
