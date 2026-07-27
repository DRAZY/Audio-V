import type { DecodedSignalComparison } from "../../shared/contracts";
import { runEngine } from "./ffmpeg-runtime";

const comparisonSampleRate = 8_000;
const maximumComparisonSeconds = 120;
const envelopeWindow = 160;
const maximumOffsetSeconds = 5;

function decodedFloat32(chunks: Buffer[]): Float32Array {
  const bytes = Buffer.concat(chunks);
  const completeLength = bytes.length - (bytes.length % 4);
  const samples = new Float32Array(completeLength / 4);
  for (let offset = 0; offset < completeLength; offset += 4) {
    samples[offset / 4] = bytes.readFloatLE(offset);
  }
  return samples;
}

async function decodePreview(
  filePath: string,
  signal?: AbortSignal,
): Promise<Float32Array> {
  const chunks: Buffer[] = [];
  await runEngine(
    "ffmpeg",
    [
      "-nostdin",
      "-hide_banner",
      "-nostats",
      "-v",
      "error",
      "-xerror",
      "-i",
      filePath,
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-t",
      String(maximumComparisonSeconds),
      "-ac",
      "1",
      "-ar",
      String(comparisonSampleRate),
      "-f",
      "f32le",
      "-acodec",
      "pcm_f32le",
      "pipe:1",
    ],
    (chunk) => chunks.push(Buffer.from(chunk)),
    signal,
  );
  return decodedFloat32(chunks);
}

function energyEnvelope(samples: Float32Array): Float64Array {
  const length = Math.floor(samples.length / envelopeWindow);
  const envelope = new Float64Array(length);
  for (let bucket = 0; bucket < length; bucket += 1) {
    let power = 0;
    const start = bucket * envelopeWindow;
    for (let index = 0; index < envelopeWindow; index += 1) {
      const sample = samples[start + index];
      power += sample * sample;
    }
    envelope[bucket] = Math.sqrt(power / envelopeWindow);
  }
  return envelope;
}

function correlationAtLag(
  left: Float64Array,
  right: Float64Array,
  lag: number,
): number {
  const startLeft = Math.max(0, -lag);
  const startRight = Math.max(0, lag);
  const count = Math.min(
    left.length - startLeft,
    right.length - startRight,
  );
  if (count < 8) return 0;
  let sumLeft = 0;
  let sumRight = 0;
  for (let index = 0; index < count; index += 1) {
    sumLeft += left[startLeft + index];
    sumRight += right[startRight + index];
  }
  const meanLeft = sumLeft / count;
  const meanRight = sumRight / count;
  let covariance = 0;
  let energyLeft = 0;
  let energyRight = 0;
  for (let index = 0; index < count; index += 1) {
    const leftValue = left[startLeft + index] - meanLeft;
    const rightValue = right[startRight + index] - meanRight;
    covariance += leftValue * rightValue;
    energyLeft += leftValue * leftValue;
    energyRight += rightValue * rightValue;
  }
  return covariance / Math.sqrt(Math.max(energyLeft * energyRight, 1e-24));
}

export function compareDecodedSignals(
  left: Float32Array,
  right: Float32Array,
): DecodedSignalComparison {
  const leftEnvelope = energyEnvelope(left);
  const rightEnvelope = energyEnvelope(right);
  const maximumLag = Math.round(
    (maximumOffsetSeconds * comparisonSampleRate) / envelopeWindow,
  );
  let bestLag = 0;
  let bestEnvelopeCorrelation = Number.NEGATIVE_INFINITY;
  for (let lag = -maximumLag; lag <= maximumLag; lag += 1) {
    const correlation = correlationAtLag(leftEnvelope, rightEnvelope, lag);
    if (correlation > bestEnvelopeCorrelation) {
      bestEnvelopeCorrelation = correlation;
      bestLag = lag;
    }
  }

  const sampleLag = bestLag * envelopeWindow;
  const startLeft = Math.max(0, -sampleLag);
  const startRight = Math.max(0, sampleLag);
  const count = Math.min(
    left.length - startLeft,
    right.length - startRight,
  );
  let sumLeftSquares = 0;
  let sumRightSquares = 0;
  let sumProducts = 0;
  for (let index = 0; index < count; index += 1) {
    const leftSample = left[startLeft + index];
    const rightSample = right[startRight + index];
    sumLeftSquares += leftSample * leftSample;
    sumRightSquares += rightSample * rightSample;
    sumProducts += leftSample * rightSample;
  }
  const correlation =
    sumProducts /
    Math.sqrt(Math.max(sumLeftSquares * sumRightSquares, 1e-24));
  const gain = sumProducts / Math.max(sumLeftSquares, 1e-24);
  let residualPower = 0;
  for (let index = 0; index < count; index += 1) {
    const difference =
      right[startRight + index] - gain * left[startLeft + index];
    residualPower += difference * difference;
  }
  const residualRmsDb = 10 * Math.log10(
    Math.max(residualPower, 1e-24) / Math.max(sumRightSquares, 1e-24),
  );
  const absoluteCorrelation = Math.abs(correlation);
  const relationship =
    absoluteCorrelation >= 0.999 && residualRmsDb <= -50
      ? "aligned-equivalent"
      : absoluteCorrelation >= 0.95
        ? "strongly-related"
        : absoluteCorrelation >= 0.5
          ? "possibly-related"
          : "distinct";

  return {
    method: "Audio-V aligned PCM preview v1",
    sampleRate: comparisonSampleRate,
    analyzedSeconds: count / comparisonSampleRate,
    offsetSeconds: sampleLag / comparisonSampleRate,
    envelopeCorrelation: bestEnvelopeCorrelation,
    sampleCorrelation: correlation,
    polarity:
      absoluteCorrelation < 0.2
        ? "inconclusive"
        : correlation < 0
          ? "inverted"
          : "same",
    gainDifferenceDb:
      Math.abs(gain) <= 1e-12 ? null : 20 * Math.log10(Math.abs(gain)),
    residualRmsDb,
    relationship,
    limitation:
      "Alignment uses the first 120 seconds, resampled to an 8 kHz mono analysis preview. It is decoded-signal evidence, not byte identity or a full-track null test.",
  };
}

export async function compareAudioFiles(
  leftPath: string,
  rightPath: string,
  signal?: AbortSignal,
): Promise<DecodedSignalComparison> {
  const [left, right] = await Promise.all([
    decodePreview(leftPath, signal),
    decodePreview(rightPath, signal),
  ]);
  if (
    left.length < comparisonSampleRate / 4 ||
    right.length < comparisonSampleRate / 4
  ) {
    throw new Error(
      "At least 250 milliseconds of decoded audio is required to align files.",
    );
  }
  return compareDecodedSignals(left, right);
}
