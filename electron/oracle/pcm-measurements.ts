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
  defectWindow: Array<{ frame: number; sample: number }>;
  stuckValue: number | null;
  stuckStartFrame: number;
  stuckLength: number;
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
  readonly #declaredBitDepth: number | null;
  readonly #bitUtilizationApplicable: boolean;
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
  #clickPopCandidateCount = 0;
  #stuckSampleCandidateCount = 0;
  #defectEvents: SignalMeasurements["defects"]["events"] = [];
  #defectEventsTruncated = false;
  #previousFrame: Float64Array | null = null;
  #minimumTrailingZeroBits: number | null = null;
  #bitUtilizationSignalSamples = 0;

  constructor(
    sampleRate: number,
    channels: number,
    options: {
      declaredBitDepth?: number | null;
      bitUtilizationApplicable?: boolean;
    } = {},
  ) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError("sampleRate must be a positive finite number.");
    }
    if (!Number.isInteger(channels) || channels <= 0) {
      throw new RangeError("channels must be a positive integer.");
    }
    this.#sampleRate = sampleRate;
    this.#channels = channels;
    this.#declaredBitDepth =
      options.declaredBitDepth &&
      Number.isInteger(options.declaredBitDepth) &&
      options.declaredBitDepth >= 2 &&
      options.declaredBitDepth <= 32
        ? options.declaredBitDepth
        : null;
    this.#bitUtilizationApplicable =
      Boolean(options.bitUtilizationApplicable) &&
      this.#declaredBitDepth !== null;
    this.#perChannel = Array.from({ length: channels }, () => ({
      peak: 0,
      sum: 0,
      sumSquares: 0,
      clippedSamples: 0,
      nearClippedSamples: 0,
      scaledClippingCandidateSamples: 0,
      previousAbsolute: null,
      plateauLength: 0,
      defectWindow: [],
      stuckValue: null,
      stuckStartFrame: 0,
      stuckLength: 0,
    }));
  }

  #appendDefectEvent(
    event: SignalMeasurements["defects"]["events"][number],
  ): void {
    const previous = this.#defectEvents.at(-1);
    if (
      previous &&
      previous.kind === event.kind &&
      previous.channel === event.channel &&
      event.startSeconds - previous.endSeconds <= 0.002
    ) {
      previous.endSeconds = event.endSeconds;
      previous.amplitude = Math.max(previous.amplitude, event.amplitude);
      return;
    }
    if (this.#defectEvents.length < 500) this.#defectEvents.push(event);
    else this.#defectEventsTruncated = true;
  }

  #finishStuckRun(channel: number, accumulator: ChannelAccumulator): void {
    const minimumFrames = Math.max(128, Math.round(this.#sampleRate * 0.01));
    if (
      accumulator.stuckValue !== null &&
      Math.abs(accumulator.stuckValue) >= 0.0001 &&
      accumulator.stuckLength >= minimumFrames
    ) {
      this.#stuckSampleCandidateCount += 1;
      this.#appendDefectEvent({
        startSeconds: roundMeasurement(
          accumulator.stuckStartFrame / this.#sampleRate,
        ),
        endSeconds: roundMeasurement(
          (accumulator.stuckStartFrame + accumulator.stuckLength) /
            this.#sampleRate,
        ),
        channel,
        amplitude: roundMeasurement(Math.abs(accumulator.stuckValue)),
        kind: "stuck-sample-candidate",
      });
    }
  }

  #inspectDefectWindow(
    channel: number,
    accumulator: ChannelAccumulator,
  ): void {
    const window = accumulator.defectWindow;
    if (window.length < 9) return;
    const before = window.slice(0, 4).map((entry) => entry.sample);
    const center = window[4];
    const after = window.slice(5).map((entry) => entry.sample);
    const mean = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const beforeMean = mean(before);
    const afterMean = mean(after);
    const neighbors = [...before, ...after];
    const neighborRms = Math.sqrt(
      neighbors.reduce((sum, value) => sum + value * value, 0) /
        neighbors.length,
    );
    const range = (values: number[]) =>
      Math.max(...values) - Math.min(...values);
    const baseline = (beforeMean + afterMean) / 2;
    const impulse = Math.abs(center.sample - baseline);
    if (
      range(before) <= 0.04 &&
      range(after) <= 0.04 &&
      Math.abs(beforeMean - afterMean) <= 0.05 &&
      impulse >= 0.25 &&
      impulse >= 6 * Math.max(neighborRms, 0.005)
    ) {
      this.#clickPopCandidateCount += 1;
      this.#appendDefectEvent({
        startSeconds: roundMeasurement(center.frame / this.#sampleRate),
        endSeconds: roundMeasurement((center.frame + 1) / this.#sampleRate),
        channel,
        amplitude: roundMeasurement(impulse),
        kind: "click-pop-candidate",
      });
    }
    window.shift();
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
        if (this.#bitUtilizationApplicable && absolute > 0) {
          const scale = 2 ** (this.#declaredBitDepth! - 1);
          let integer = BigInt(Math.round(sample * scale));
          if (integer < 0n) integer = -integer;
          if (integer > 0n) {
            let trailing = 0;
            while ((integer & 1n) === 0n && trailing < this.#declaredBitDepth!) {
              integer >>= 1n;
              trailing += 1;
            }
            this.#minimumTrailingZeroBits =
              this.#minimumTrailingZeroBits === null
                ? trailing
                : Math.min(this.#minimumTrailingZeroBits, trailing);
            this.#bitUtilizationSignalSamples += 1;
          }
        }
        if (absolute !== 0) frameIsDigitalSilence = false;
        if (
          this.#previousFrame &&
          Math.abs(sample - this.#previousFrame[channel]) >= 0.95
        ) {
          frameHasDiscontinuity = true;
        }
        const accumulator = this.#perChannel[channel];
        accumulator.defectWindow.push({ frame: this.#frames, sample });
        this.#inspectDefectWindow(channel, accumulator);
        if (
          accumulator.stuckValue !== null &&
          Math.abs(sample - accumulator.stuckValue) <= 1e-12
        ) {
          accumulator.stuckLength += 1;
        } else {
          this.#finishStuckRun(channel, accumulator);
          accumulator.stuckValue = sample;
          accumulator.stuckStartFrame = this.#frames;
          accumulator.stuckLength = 1;
        }
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
    for (let channel = 0; channel < this.#perChannel.length; channel += 1) {
      this.#finishStuckRun(channel, this.#perChannel[channel]);
    }
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
    const unusedLeastSignificantBits =
      this.#bitUtilizationApplicable &&
      this.#bitUtilizationSignalSamples > 0
        ? this.#minimumTrailingZeroBits
        : null;
    const effectiveBitDepth =
      unusedLeastSignificantBits === null || this.#declaredBitDepth === null
        ? null
        : this.#declaredBitDepth - unusedLeastSignificantBits;
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
      drMeter: null,
      drMeterPerChannel: [],
      replayGain: {
        standard: "ReplayGain 2.0 / ITU-R BS.1770",
        referenceLufs: -18,
        trackGainDb: null,
        trackPeak: null,
        albumGainDb: null,
        albumPeak: null,
        albumGroup: null,
        albumTrackCount: 0,
        albumStatus: "unavailable",
        albumReason:
          "Album eligibility is evaluated after every file in the audit finishes.",
        limitation:
          "Track gain requires a completed BS.1770 loudness measurement; album gain requires a complete grouped-album scan.",
      },
      bitUtilization: {
        applicable: this.#bitUtilizationApplicable,
        declaredBitDepth: this.#declaredBitDepth,
        effectiveBitDepth,
        unusedLeastSignificantBits,
        classification: !this.#bitUtilizationApplicable
          ? "not-applicable"
          : this.#bitUtilizationSignalSamples === 0
            ? "insufficient-signal"
            : (unusedLeastSignificantBits ?? 0) >= 2
              ? "possible-bit-padding"
              : "fully-utilized",
        limitation:
          "Bit utilization measures repeated unused least-significant bits in integer lossless PCM. It can reveal padding or truncation but cannot identify why it occurred or recover discarded precision.",
      },
      continuity: {
        exactDigitalSilenceFrames: this.#exactDigitalSilenceFrames,
        longestDigitalSilenceSeconds: roundMeasurement(
          this.#longestDigitalSilenceFrames / this.#sampleRate,
        ),
        internalDigitalDropoutCount: this.#internalDigitalDropoutCount,
        discontinuityCandidateCount: this.#discontinuityCandidateCount,
      },
      defects: {
        clickPopCandidateCount: this.#clickPopCandidateCount,
        stuckSampleCandidateCount: this.#stuckSampleCandidateCount,
        steepTransitionCandidateCount: this.#discontinuityCandidateCount,
        events: this.#defectEvents,
        eventsTruncated: this.#defectEventsTruncated,
        limitation:
          "Click/pop and stuck-sample detections are conservative waveform-shape candidates. Percussion, synthesis, square waves, hard edits, and test tones can produce similar measurements, so candidates require review and never establish file damage.",
      },
      waveform: null,
      spectrogram: emptySpectrogram,
      spectrogramPyramid: [emptySpectrogram],
    };
  }
}
