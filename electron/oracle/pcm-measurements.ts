import type {
  ChannelMeasurements,
  SignalMeasurements,
} from "../../shared/contracts";

const nearClipAmplitude = 10 ** (-0.1 / 20);

interface ChannelAccumulator {
  peak: number;
  sum: number;
  sumSquares: number;
  clippedSamples: number;
  nearClippedSamples: number;
  scaledClippingCandidateSamples: number;
  previousAbsolute: number | null;
  plateauLength: number;
}

function amplitudeToDbfs(amplitude: number): number | null {
  if (amplitude <= 0) return null;
  return 20 * Math.log10(amplitude);
}

function roundMeasurement(value: number): number {
  return Number(value.toFixed(8));
}

export class PcmMeasurementAccumulator {
  readonly #sampleRate: number;
  readonly #channels: number;
  readonly #perChannel: ChannelAccumulator[];
  #frames = 0;
  #sumSquares = 0;
  #peak = 0;
  #clippedSamples = 0;
  #nearClippedSamples = 0;
  #scaledClippingCandidateSamples = 0;
  #clippingEvents: SignalMeasurements["clipping"]["events"] = [];
  #activeClippingEvent: {
    startFrame: number;
    clippedSamples: number;
    peakAmplitude: number;
    channels: Set<number>;
  } | null = null;
  #clippingEventsTruncated = false;
  #stereoSumLeft = 0;
  #stereoSumRight = 0;
  #stereoSumLeftSquares = 0;
  #stereoSumRightSquares = 0;
  #stereoSumProducts = 0;
  #maxStereoDifference = 0;
  #exactDigitalSilenceFrames = 0;
  #currentDigitalSilenceFrames = 0;
  #longestDigitalSilenceFrames = 0;
  #internalDigitalDropoutCount = 0;
  #signalSeenBeforeSilence = false;
  #discontinuityCandidateCount = 0;
  #previousFrame: Float64Array | null = null;

  constructor(sampleRate: number, channels: number) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError("sampleRate must be a positive finite number.");
    }
    if (!Number.isInteger(channels) || channels <= 0) {
      throw new RangeError("channels must be a positive integer.");
    }
    this.#sampleRate = sampleRate;
    this.#channels = channels;
    this.#perChannel = Array.from({ length: channels }, () => ({
      peak: 0,
      sum: 0,
      sumSquares: 0,
      clippedSamples: 0,
      nearClippedSamples: 0,
      scaledClippingCandidateSamples: 0,
      previousAbsolute: null,
      plateauLength: 0,
    }));
  }

  pushInterleaved(samples: ArrayLike<number>): void {
    if (samples.length % this.#channels !== 0) {
      throw new RangeError("Interleaved sample count must divide evenly by channels.");
    }

    for (let offset = 0; offset < samples.length; offset += this.#channels) {
      const left = samples[offset];
      const right = this.#channels >= 2 ? samples[offset + 1] : 0;
      let frameIsDigitalSilence = true;
      let frameHasDiscontinuity = false;
      let frameIsClipped = false;
      let frameClippedSamples = 0;
      let framePeak = 0;
      const clippedChannels: number[] = [];

      for (let channel = 0; channel < this.#channels; channel += 1) {
        const sample = samples[offset + channel];
        if (!Number.isFinite(sample)) {
          throw new TypeError("PCM samples must be finite numbers.");
        }
        const absolute = Math.abs(sample);
        if (absolute !== 0) frameIsDigitalSilence = false;
        if (
          this.#previousFrame &&
          Math.abs(sample - this.#previousFrame[channel]) >= 0.95
        ) {
          frameHasDiscontinuity = true;
        }
        const accumulator = this.#perChannel[channel];
        accumulator.peak = Math.max(accumulator.peak, absolute);
        accumulator.sum += sample;
        accumulator.sumSquares += sample * sample;
        this.#peak = Math.max(this.#peak, absolute);
        this.#sumSquares += sample * sample;

        if (absolute >= 1) {
          accumulator.clippedSamples += 1;
          this.#clippedSamples += 1;
          frameIsClipped = true;
          frameClippedSamples += 1;
          framePeak = Math.max(framePeak, absolute);
          clippedChannels.push(channel);
        }
        if (absolute >= nearClipAmplitude) {
          accumulator.nearClippedSamples += 1;
          this.#nearClippedSamples += 1;
        }
        if (
          absolute >= 0.5 &&
          accumulator.previousAbsolute !== null &&
          Math.abs(absolute - accumulator.previousAbsolute) <= 1e-7
        ) {
          accumulator.plateauLength += 1;
          if (accumulator.plateauLength === 3) {
            accumulator.scaledClippingCandidateSamples += 3;
            this.#scaledClippingCandidateSamples += 3;
          } else if (accumulator.plateauLength > 3) {
            accumulator.scaledClippingCandidateSamples += 1;
            this.#scaledClippingCandidateSamples += 1;
          }
        } else {
          accumulator.plateauLength = 1;
        }
        accumulator.previousAbsolute = absolute;
      }

      if (frameIsClipped) {
        if (!this.#activeClippingEvent) {
          this.#activeClippingEvent = {
            startFrame: this.#frames,
            clippedSamples: 0,
            peakAmplitude: 0,
            channels: new Set(),
          };
        }
        this.#activeClippingEvent.clippedSamples += frameClippedSamples;
        this.#activeClippingEvent.peakAmplitude = Math.max(
          this.#activeClippingEvent.peakAmplitude,
          framePeak,
        );
        for (const channel of clippedChannels) {
          this.#activeClippingEvent.channels.add(channel);
        }
      } else {
        this.#finishClippingEvent(this.#frames);
      }

      if (frameIsDigitalSilence) {
        this.#exactDigitalSilenceFrames += 1;
        this.#currentDigitalSilenceFrames += 1;
        this.#longestDigitalSilenceFrames = Math.max(
          this.#longestDigitalSilenceFrames,
          this.#currentDigitalSilenceFrames,
        );
      } else {
        if (
          this.#signalSeenBeforeSilence &&
          this.#currentDigitalSilenceFrames >= this.#sampleRate / 10
        ) {
          this.#internalDigitalDropoutCount += 1;
        }
        this.#currentDigitalSilenceFrames = 0;
        this.#signalSeenBeforeSilence = true;
      }
      if (frameHasDiscontinuity) this.#discontinuityCandidateCount += 1;
      if (!this.#previousFrame) {
        this.#previousFrame = new Float64Array(this.#channels);
      }
      for (let channel = 0; channel < this.#channels; channel += 1) {
        this.#previousFrame[channel] = samples[offset + channel];
      }

      if (this.#channels >= 2) {
        this.#stereoSumLeft += left;
        this.#stereoSumRight += right;
        this.#stereoSumLeftSquares += left * left;
        this.#stereoSumRightSquares += right * right;
        this.#stereoSumProducts += left * right;
        this.#maxStereoDifference = Math.max(
          this.#maxStereoDifference,
          Math.abs(left - right),
        );
      }

      this.#frames += 1;
    }
  }

  #finishClippingEvent(endFrame: number): void {
    if (!this.#activeClippingEvent) return;
    if (this.#clippingEvents.length < 500) {
      this.#clippingEvents.push({
        startSeconds: roundMeasurement(
          this.#activeClippingEvent.startFrame / this.#sampleRate,
        ),
        endSeconds: roundMeasurement(endFrame / this.#sampleRate),
        clippedSamples: this.#activeClippingEvent.clippedSamples,
        peakAmplitude: roundMeasurement(
          this.#activeClippingEvent.peakAmplitude,
        ),
        channels: [...this.#activeClippingEvent.channels],
      });
    } else {
      this.#clippingEventsTruncated = true;
    }
    this.#activeClippingEvent = null;
  }

  finish(): SignalMeasurements {
    this.#finishClippingEvent(this.#frames);
    const totalSamples = this.#frames * this.#channels;
    const perChannel: ChannelMeasurements[] = this.#perChannel.map(
      (channel) => ({
        samplePeakDbfs: amplitudeToDbfs(channel.peak),
        rmsDbfs:
          this.#frames > 0
            ? amplitudeToDbfs(Math.sqrt(channel.sumSquares / this.#frames))
            : null,
        dcOffset:
          this.#frames > 0 ? roundMeasurement(channel.sum / this.#frames) : 0,
        clippedSamples: channel.clippedSamples,
        clippedSamplePercent:
          this.#frames > 0
            ? roundMeasurement((channel.clippedSamples / this.#frames) * 100)
            : 0,
        nearClippedSamples: channel.nearClippedSamples,
        scaledClippingCandidateSamples:
          channel.scaledClippingCandidateSamples,
      }),
    );

    let stereoCorrelation: number | null = null;
    if (this.#channels >= 2 && this.#frames > 1) {
      const covariance =
        this.#frames * this.#stereoSumProducts -
        this.#stereoSumLeft * this.#stereoSumRight;
      const leftVariance =
        this.#frames * this.#stereoSumLeftSquares -
        this.#stereoSumLeft * this.#stereoSumLeft;
      const rightVariance =
        this.#frames * this.#stereoSumRightSquares -
        this.#stereoSumRight * this.#stereoSumRight;
      const denominator = Math.sqrt(leftVariance * rightVariance);
      if (denominator > 0) {
        stereoCorrelation = roundMeasurement(covariance / denominator);
      }
    }

    const samplePeakDbfs = amplitudeToDbfs(this.#peak);
    const rmsDbfs =
      totalSamples > 0
        ? amplitudeToDbfs(Math.sqrt(this.#sumSquares / totalSamples))
        : null;
    const midEnergy =
      this.#channels >= 2
        ? 0.25 *
          (this.#stereoSumLeftSquares +
            this.#stereoSumRightSquares +
            2 * this.#stereoSumProducts)
        : 0;
    const sideEnergy =
      this.#channels >= 2
        ? Math.max(
            0,
            0.25 *
              (this.#stereoSumLeftSquares +
                this.#stereoSumRightSquares -
                2 * this.#stereoSumProducts),
          )
        : 0;
    const sideToMidRatioDb =
      this.#channels < 2 || midEnergy <= 0
        ? null
        : sideEnergy === 0
          ? -120
          : roundMeasurement(10 * Math.log10(sideEnergy / midEnergy));
    const duplicatedMono =
      this.#channels >= 2 ? this.#maxStereoDifference <= 1e-7 : null;
    const stereoAssessment: SignalMeasurements["stereoAssessment"] =
      this.#channels < 2
        ? "mono"
        : duplicatedMono
          ? "dual-mono"
          : stereoCorrelation === null || sideToMidRatioDb === null
            ? "inconclusive"
            : stereoCorrelation >= 0.999 && sideToMidRatioDb <= -30
              ? "near-mono"
              : "stereo-content";
    const emptySpectrogram = {
      algorithm: "STFT" as const,
      channelMode: "per-channel power average" as const,
      fftSize: 512,
      hopSize: 256,
      window: "Hann" as const,
      frequencyScale: "linear" as const,
      floorDbfs: -120 as const,
      maxFrequencyHz: this.#sampleRate / 2,
      effectiveBandwidthHz: null,
      strongestCutoffHz: null,
      cutoffDropDb: null,
      upperBandLevelDbfs: null,
      durationSeconds: this.#frames / this.#sampleRate,
      slices: [],
    };
    return {
      standard: "Audio-V PCM measurement v1",
      decoder: null,
      decodeIntegrity: "complete",
      sampleRate: this.#sampleRate,
      channels: this.#channels,
      frames: this.#frames,
      durationSeconds: roundMeasurement(this.#frames / this.#sampleRate),
      samplePeakDbfs,
      rmsDbfs,
      clippedSamples: this.#clippedSamples,
      nearClippedSamples: this.#nearClippedSamples,
      clipping: {
        clippedSamplePercent:
          totalSamples > 0
            ? roundMeasurement((this.#clippedSamples / totalSamples) * 100)
            : 0,
        eventCount:
          this.#clippingEvents.length +
          (this.#clippingEventsTruncated ? 1 : 0),
        events: this.#clippingEvents,
        eventsTruncated: this.#clippingEventsTruncated,
        scaledClippingIndicator:
          this.#scaledClippingCandidateSamples >= 3
            ? "possible-scaled-clipping"
            : "not-detected",
        scaledClippingCandidateSamples:
          this.#scaledClippingCandidateSamples,
        limitation:
          "Repeated flat sample plateaus can be compatible with previously clipped audio that was later scaled down, but limiting, synthesis, and intentional waveform shapes can produce the same pattern.",
      },
      stereoCorrelation,
      duplicatedMono,
      stereoAssessment,
      sideToMidRatioDb,
      perChannel,
      integratedLufs: null,
      loudnessRangeLu: null,
      truePeakDbtp: null,
      peakToLoudnessRatioLu: null,
      crestFactorDb:
        samplePeakDbfs === null || rmsDbfs === null
          ? null
          : roundMeasurement(samplePeakDbfs - rmsDbfs),
      continuity: {
        exactDigitalSilenceFrames: this.#exactDigitalSilenceFrames,
        longestDigitalSilenceSeconds: roundMeasurement(
          this.#longestDigitalSilenceFrames / this.#sampleRate,
        ),
        internalDigitalDropoutCount: this.#internalDigitalDropoutCount,
        discontinuityCandidateCount: this.#discontinuityCandidateCount,
      },
      waveform: null,
      spectrogram: emptySpectrogram,
      spectrogramPyramid: [emptySpectrogram],
    };
  }
}
