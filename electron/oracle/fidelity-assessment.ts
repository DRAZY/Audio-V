import type {
  FidelityAssessment,
  SignalMeasurements,
  StreamTechnicalAnalysis,
} from "../../shared/contracts";

const losslessCodecs = new Set([
  "alac",
  "flac",
  "pcm_f32le",
  "pcm_f64le",
  "pcm_s16be",
  "pcm_s16le",
  "pcm_s24be",
  "pcm_s24le",
  "pcm_s32be",
  "pcm_s32le",
  "wavpack",
]);

function evidenceCoverage(
  measurements: SignalMeasurements,
): number {
  const spectrum = measurements.spectrogram;
  const durationScore =
    measurements.durationSeconds >= 10
      ? 25
      : measurements.durationSeconds >= 2
        ? 20
        : Math.round(
            Math.max(0, measurements.durationSeconds) / 2 * 15,
          );
  const score =
    durationScore +
    (spectrum.effectiveBandwidthHz === null ? 0 : 30) +
    (spectrum.strongestCutoffHz === null ? 0 : 20) +
    (spectrum.cutoffDropDb === null ? 0 : 15) +
    (spectrum.upperBandLevelDbfs === null ? 0 : 10);

  if (measurements.durationSeconds < 2) return Math.min(45, score);
  if (spectrum.effectiveBandwidthHz === null) return Math.min(35, score);
  return Math.min(100, score);
}

export function assessFidelityOrigin(
  measurements: SignalMeasurements,
  technical: StreamTechnicalAnalysis,
): FidelityAssessment {
  const spectrum = measurements.spectrogram;
  const cutoff = spectrum.strongestCutoffHz;
  const drop = spectrum.cutoffDropDb;
  const bandwidth = spectrum.effectiveBandwidthHz;
  const nyquist = technical.sampleRate / 2;
  const occupancy = bandwidth === null ? null : bandwidth / nyquist;
  const coverage = evidenceCoverage(measurements);
  const limitation =
    "Spectral bandwidth can be shaped by mastering, microphones, instruments, noise reduction, or intentional filtering. Rule strength is not a probability of provenance; this assessment is evidence for review, not proof of encoding history.";

  if (measurements.durationSeconds < 2) {
    return {
      classification: "inconclusive",
      reasonCode: "insufficient-duration",
      confidence: null,
      confidenceType: null,
      evidenceCoverage: coverage,
      basis: [
        `Only ${measurements.durationSeconds.toFixed(2)} seconds of decoded audio were available; at least two seconds are required.`,
      ],
      limitation,
    };
  }
  if (occupancy === null) {
    return {
      classification: "inconclusive",
      reasonCode: "unmeasurable-bandwidth",
      confidence: null,
      confidenceType: null,
      evidenceCoverage: coverage,
      basis: [
        "The effective signal bandwidth could not be measured reliably from this audio.",
      ],
      limitation,
    };
  }
  if (cutoff === null || drop === null) {
    return {
      classification: "inconclusive",
      reasonCode: "unstable-cutoff",
      confidence: null,
      confidenceType: null,
      evidenceCoverage: coverage,
      basis: [
        `Observed bandwidth reaches approximately ${Math.round(bandwidth!).toLocaleString()} Hz of the ${Math.round(nyquist).toLocaleString()} Hz Nyquist range.`,
        "No stable upper-band spectral cliff was found, so Audio-V cannot attribute the bandwidth shape to a specific source process.",
      ],
      limitation,
    };
  }

  if (
    technical.sampleRate >= 88_200 &&
    cutoff >= 18_000 &&
    cutoff <= 28_000 &&
    drop >= 18 &&
    occupancy <= 0.65 &&
    (spectrum.upperBandLevelDbfs ?? 0) <= -85
  ) {
    return {
      classification: "possible-upsample",
      reasonCode: "possible-upsample",
      confidence: 78,
      confidenceType: "rule-strength-v1",
      evidenceCoverage: coverage,
      basis: [
        `Declared Nyquist frequency is ${Math.round(nyquist).toLocaleString()} Hz, but measured bandwidth ends near ${Math.round(bandwidth!).toLocaleString()} Hz.`,
        `A ${drop.toFixed(1)} dB spectral cliff appears near ${Math.round(cutoff).toLocaleString()} Hz.`,
        `The upper 15% of the declared band averages ${spectrum.upperBandLevelDbfs?.toFixed(1)} dBFS.`,
      ],
      limitation,
    };
  }

  if (
    losslessCodecs.has(technical.codecName) &&
    technical.sampleRate <= 50_000 &&
    cutoff >= 14_000 &&
    cutoff <= 21_500 &&
    drop >= 25 &&
    occupancy <= 0.9
  ) {
    return {
      classification: "possible-lossy-transcode",
      reasonCode: "possible-lossy-transcode",
      confidence: 72,
      confidenceType: "rule-strength-v1",
      evidenceCoverage: coverage,
      basis: [
        `The lossless container has a ${drop.toFixed(1)} dB spectral cliff near ${Math.round(cutoff).toLocaleString()} Hz.`,
        `Measured bandwidth occupies ${Math.round(occupancy * 100)}% of the declared Nyquist band.`,
        "This pattern is compatible with a perceptual-codec low-pass but is not unique to lossy encoding.",
      ],
      limitation,
    };
  }

  if (occupancy >= 0.9 && drop < 12) {
    return {
      classification: "no-strong-spectral-anomaly",
      reasonCode: "no-strong-anomaly",
      confidence: 85,
      confidenceType: "rule-strength-v1",
      evidenceCoverage: coverage,
      basis: [
        `Measured bandwidth occupies ${Math.round(occupancy * 100)}% of the declared Nyquist band.`,
        `The strongest upper-band cliff is only ${drop.toFixed(1)} dB.`,
      ],
      limitation,
    };
  }

  return {
    classification: "bandwidth-limited",
    reasonCode: "bandwidth-limited",
    confidence: 55,
    confidenceType: "rule-strength-v1",
    evidenceCoverage: coverage,
    basis: [
      `Observed bandwidth is ${Math.round(bandwidth!).toLocaleString()} Hz against a ${Math.round(nyquist).toLocaleString()} Hz Nyquist limit.`,
      `The strongest measured spectral cliff is ${drop.toFixed(1)} dB near ${Math.round(cutoff).toLocaleString()} Hz.`,
    ],
    limitation,
  };
}
