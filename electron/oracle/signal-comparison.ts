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
  return alignDecodedSignals(left, right).result;
}

function alignDecodedSignals(
  left: Float32Array,
  right: Float32Array,
): { result: DecodedSignalComparison; signedGain: number; sampleLag: number } {
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
    signedGain: gain,
    sampleLag,
    result: {
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
    fullTrack: false,
    comparedChannels: 1,
    comparedFrames: count,
    durationCoveragePercent:
      (count / Math.max(left.length, right.length)) * 100,
    perChannel: [{
      channel: 0,
      sampleCorrelation: correlation,
      residualRmsDb,
      peakResidualDbfs: null,
      nullDepthDb: -residualRmsDb,
    }],
    relationship,
    limitation:
      "Alignment uses the first 120 seconds, resampled to an 8 kHz mono analysis preview. It is decoded-signal evidence, not byte identity or a full-track null test.",
    },
  };
}

interface ComparisonProbe {
  sampleRate: number;
  channels: number;
  durationSeconds: number | null;
}

async function probeComparison(
  filePath: string,
  signal?: AbortSignal,
): Promise<ComparisonProbe> {
  const result = await runEngine(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=sample_rate,channels,duration:format=duration",
      "-of",
      "json",
      filePath,
    ],
    undefined,
    signal,
  );
  const parsed = JSON.parse(result.stdout.toString("utf8")) as {
    streams?: Array<{ sample_rate?: string; channels?: number; duration?: string }>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0];
  const sampleRate = Number(stream?.sample_rate);
  const channels = Number(stream?.channels);
  const duration = Number(stream?.duration ?? parsed.format?.duration);
  if (!Number.isFinite(sampleRate) || !Number.isInteger(channels)) {
    throw new Error("Comparison probing did not return a valid audio stream.");
  }
  return {
    sampleRate,
    channels,
    durationSeconds: Number.isFinite(duration) ? duration : null,
  };
}

function parsePsnr(stderr: string): number[] {
  return [...stderr.matchAll(/\bPSNR\s+ch(\d+):\s+(inf|-?[\d.]+)\s+dB/giu)]
    .sort((left, right) => Number(left[1]) - Number(right[1]))
    .map((match) => match[2].toLowerCase() === "inf"
      ? Number.POSITIVE_INFINITY
      : Number(match[2]));
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
  const aligned = alignDecodedSignals(left, right);
  const [leftProbe, rightProbe] = await Promise.all([
    probeComparison(leftPath, signal),
    probeComparison(rightPath, signal),
  ]);
  if (leftProbe.channels !== rightProbe.channels) {
    return {
      ...aligned.result,
      limitation:
        `Full-track null comparison requires matching channel counts; File A has ${leftProbe.channels} and File B has ${rightProbe.channels}. ${aligned.result.limitation}`,
    };
  }
  const outputRate = Math.max(leftProbe.sampleRate, rightProbe.sampleRate);
  const trimLeft = aligned.sampleLag < 0
    ? Math.abs(aligned.sampleLag) / comparisonSampleRate
    : 0;
  const trimRight = aligned.sampleLag > 0
    ? aligned.sampleLag / comparisonSampleRate
    : 0;
  const gain = Number.isFinite(aligned.signedGain)
    ? aligned.signedGain
    : 1;
  const filter = [
    `[0:a:0]atrim=start=${trimLeft.toFixed(8)},asetpts=PTS-STARTPTS,aresample=${outputRate},aformat=sample_fmts=dblp,volume=${gain.toFixed(12)}[a]`,
    `[1:a:0]atrim=start=${trimRight.toFixed(8)},asetpts=PTS-STARTPTS,aresample=${outputRate},aformat=sample_fmts=dblp[b]`,
    "[a][b]apsnr[out]",
  ].join(";");
  const full = await runEngine(
    "ffmpeg",
    [
      "-nostdin",
      "-hide_banner",
      "-nostats",
      "-v",
      "info",
      "-i",
      leftPath,
      "-i",
      rightPath,
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-f",
      "null",
      "-",
    ],
    undefined,
    signal,
  );
  const psnr = parsePsnr(full.stderr);
  if (psnr.length !== leftProbe.channels) {
    throw new Error("Full-track null comparison did not return every channel.");
  }
  const finiteDepths = psnr.filter(Number.isFinite);
  const worstDepth = finiteDepths.length
    ? Math.min(...finiteDepths)
    : Number.POSITIVE_INFINITY;
  const analyzedSeconds = Math.max(
    0,
    Math.min(
      (leftProbe.durationSeconds ?? aligned.result.analyzedSeconds) - trimLeft,
      (rightProbe.durationSeconds ?? aligned.result.analyzedSeconds) - trimRight,
    ),
  );
  const maximumDuration = Math.max(
    leftProbe.durationSeconds ?? analyzedSeconds,
    rightProbe.durationSeconds ?? analyzedSeconds,
  );
  const relationship =
    worstDepth >= 80
      ? "aligned-equivalent"
      : worstDepth >= 50
        ? "strongly-related"
        : worstDepth >= 25
          ? "possibly-related"
          : "distinct";
  return {
    ...aligned.result,
    method: "Audio-V full-track multichannel null v2",
    sampleRate: outputRate,
    analyzedSeconds,
    residualRmsDb: Number.isFinite(worstDepth)
      ? -worstDepth
      : Number.NEGATIVE_INFINITY,
    relationship,
    fullTrack: true,
    comparedChannels: leftProbe.channels,
    comparedFrames: Math.round(analyzedSeconds * outputRate),
    durationCoveragePercent:
      maximumDuration > 0 ? (analyzedSeconds / maximumDuration) * 100 : 0,
    perChannel: psnr.map((depth, channel) => ({
      channel,
      sampleCorrelation: null,
      residualRmsDb: Number.isFinite(depth)
        ? -depth
        : Number.NEGATIVE_INFINITY,
      peakResidualDbfs: null,
      nullDepthDb: depth,
    })),
    limitation:
      `Audio-V aligned the files from a bounded mono preview, then compared every overlapping frame across ${leftProbe.channels} channel${leftProbe.channels === 1 ? "" : "s"} at ${outputRate.toLocaleString()} Hz. A signed ${gain.toFixed(8)} gain correction was applied to File A before the null measurement. Resampling occurs only when declared sample rates differ; null depth is decoded-signal evidence, not byte identity.`,
  };
}
