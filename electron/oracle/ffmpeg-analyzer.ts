import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type {
  SignalMeasurements,
  StreamTechnicalAnalysis,
} from "../../shared/contracts";
import { PcmMeasurementAccumulator } from "./pcm-measurements";
import { runEngine } from "./ffmpeg-runtime";
import { SpectrogramAccumulator } from "./spectrogram";
import { WaveformEnvelopeAccumulator } from "./waveform-envelope";
import { verifyFlacMd5 } from "./flac-integrity";
import { audioCodecLabel } from "../../shared/audio-format";

interface ProbeStream {
  codec_name?: string;
  codec_long_name?: string;
  profile?: string;
  sample_fmt?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  bit_rate?: string;
  bits_per_raw_sample?: string;
  duration?: string;
}

interface ProbeOutput {
  streams?: ProbeStream[];
  format?: {
    duration?: string;
    bit_rate?: string;
    format_name?: string;
    tags?: Record<string, string>;
  };
}

function finiteNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatTag(
  tags: Record<string, string> | undefined,
  key: string,
): string | undefined {
  return Object.entries(tags ?? {}).find(
    ([candidate]) => candidate.toUpperCase() === key,
  )?.[1];
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function probe(filePath: string, signal?: AbortSignal): Promise<{
  raw: ProbeOutput;
  technical: StreamTechnicalAnalysis;
}> {
  const result = await runEngine("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    filePath,
  ], undefined, signal);
  const raw = JSON.parse(result.stdout.toString("utf8")) as ProbeOutput;
  const stream = raw.streams?.[0];
  if (!stream) throw new Error("ffprobe found no decodable audio stream.");
  const durationSeconds =
    finiteNumber(stream.duration) ?? finiteNumber(raw.format?.duration);
  const sampleRate = finiteNumber(stream.sample_rate);
  if (!sampleRate || !stream.channels) {
    throw new Error("ffprobe did not return a valid sample rate and channel count.");
  }
  const repairAction = formatTag(raw.format?.tags, "AUDIO_V_ACTION");
  const codecName = stream.codec_name ?? "unknown";
  const repairTarget = finiteNumber(
    formatTag(raw.format?.tags, "AUDIO_V_TARGET_DBTP"),
  );
  const repairReduction = finiteNumber(
    formatTag(raw.format?.tags, "AUDIO_V_GAIN_REDUCTION_DB"),
  );
  const repairDepth = finiteNumber(
    formatTag(raw.format?.tags, "AUDIO_V_OUTPUT_BIT_DEPTH"),
  );
  const repairProvenance: StreamTechnicalAnalysis["repairProvenance"] =
    repairAction === "true_peak_safe_copy" &&
    repairTarget !== null &&
    repairReduction !== null &&
    (repairDepth === 16 || repairDepth === 24)
      ? {
          action: "true_peak_safe_copy",
          targetDbtp: repairTarget,
          gainReductionDb: repairReduction,
          outputBitDepth: repairDepth as 16 | 24,
        }
      : null;
  return {
    raw,
    technical: {
      backend: "FFmpeg 8.1.2 LGPL build",
      fileSha256: await hashFile(filePath),
      codecName,
      codecLongName: audioCodecLabel(codecName, stream.codec_long_name),
      profile: stream.profile ?? null,
      container: raw.format?.format_name ?? "unknown",
      sampleFormat: stream.sample_fmt ?? "unknown",
      sampleRate,
      channels: stream.channels,
      channelLayout: stream.channel_layout ?? null,
      bitsPerRawSample: finiteNumber(stream.bits_per_raw_sample),
      streamBitrate:
        finiteNumber(stream.bit_rate) ?? finiteNumber(raw.format?.bit_rate),
      durationSeconds,
      bitrateMode: null,
      packetCount: 0,
      packetBitrateMinimum: null,
      packetBitrateMaximum: null,
      packetBitrateAverage: null,
      flacMd5: null,
      externalChecksums: [],
      repairProvenance,
    },
  };
}

async function packetStatistics(
  filePath: string,
  technical: StreamTechnicalAnalysis,
  signal?: AbortSignal,
): Promise<void> {
  if (technical.codecName !== "mp3") return;
  const result = await runEngine("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_packets",
    "-show_entries",
    "packet=size,duration_time",
    "-of",
    "compact=p=0:nk=0",
    filePath,
  ], undefined, signal);
  let count = 0;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (const line of result.stdout.toString("utf8").split(/\r?\n/)) {
    const fields = Object.fromEntries(
      line
        .trim()
        .split("|")
        .map((entry) => entry.split("=", 2)),
    );
    const size = Number(fields.size);
    const duration = Number(fields.duration_time);
    if (Number.isFinite(size) && Number.isFinite(duration) && duration > 0) {
      const rate = (size * 8) / duration;
      count += 1;
      minimum = Math.min(minimum, rate);
      maximum = Math.max(maximum, rate);
      sum += rate;
    }
  }
  if (count === 0) return;
  const average = sum / count;
  technical.packetCount = count;
  technical.packetBitrateMinimum = minimum;
  technical.packetBitrateMaximum = maximum;
  technical.packetBitrateAverage = average;
  technical.bitrateMode =
    (maximum - minimum) / Math.max(average, 1) <= 0.02 ? "CBR" : "VBR";
}

function parseLoudness(stderr: string): {
  integratedLufs: number | null;
  loudnessRangeLu: number | null;
  truePeakDbtp: number | null;
} {
  const integrated = /Integrated loudness:[\s\S]*?\bI:\s*(-?[\d.]+)\s+LUFS/.exec(
    stderr,
  )?.[1];
  const range = /Loudness range:[\s\S]*?\bLRA:\s*(-?[\d.]+)\s+LU/.exec(stderr)?.[1];
  const peak = /True peak:[\s\S]*?\bPeak:\s*(-?[\d.]+)\s+dBFS/.exec(stderr)?.[1];
  return {
    integratedLufs: finiteNumber(integrated),
    loudnessRangeLu: finiteNumber(range),
    truePeakDbtp: finiteNumber(peak),
  };
}

export async function analyzeWithFfmpeg(
  filePath: string,
  signal?: AbortSignal,
): Promise<{
  measurements: SignalMeasurements;
  technical: StreamTechnicalAnalysis;
}> {
  const { technical } = await probe(filePath, signal);
  await packetStatistics(filePath, technical, signal);
  const totalFrames = Math.max(
    1,
    Math.round((technical.durationSeconds ?? 1) * technical.sampleRate),
  );
  const measurement = new PcmMeasurementAccumulator(
    technical.sampleRate,
    technical.channels,
  );
  const spectrogram = new SpectrogramAccumulator(
    technical.sampleRate,
    technical.channels,
    totalFrames,
  );
  const detailSpectrogram = new SpectrogramAccumulator(
    technical.sampleRate,
    technical.channels,
    totalFrames,
    { fftSize: 2048, maxSlices: 90 },
  );
  const waveform = new WaveformEnvelopeAccumulator(
    technical.sampleRate,
    technical.channels,
    totalFrames,
  );
  let carry: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  await runEngine(
    "ffmpeg",
    [
      "-nostdin",
      "-hide_banner",
      "-nostats",
      "-v",
      "error",
      "-xerror",
      "-err_detect",
      "explode",
      "-i",
      filePath,
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-f",
      "f64le",
      "-acodec",
      "pcm_f64le",
      "pipe:1",
    ],
    (chunk) => {
      const combined = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const frameBytes = technical.channels * 8;
      const completeLength = combined.length - (combined.length % frameBytes);
      const samples = new Float64Array(completeLength / 8);
      for (let offset = 0; offset < completeLength; offset += 8) {
        samples[offset / 8] = combined.readDoubleLE(offset);
      }
      measurement.pushInterleaved(samples);
      spectrogram.pushInterleaved(samples);
      detailSpectrogram.pushInterleaved(samples);
      waveform.pushInterleaved(samples);
      carry = combined.subarray(completeLength);
    },
    signal,
  );
  if (carry.length) throw new Error("Decoded PCM ended with an incomplete frame.");

  const loudnessResult = await runEngine("ffmpeg", [
    "-nostdin",
    "-hide_banner",
    "-nostats",
    "-v",
    "info",
    "-i",
    filePath,
    "-map",
    "0:a:0",
    "-af",
    "ebur128=peak=true:framelog=quiet",
    "-f",
    "null",
    "-",
  ], undefined, signal);
  const loudness = parseLoudness(loudnessResult.stderr);
  technical.flacMd5 = await verifyFlacMd5(filePath, technical, signal);
  const peakToLoudnessRatioLu =
    loudness.truePeakDbtp === null || loudness.integratedLufs === null
      ? null
      : Number(
          (loudness.truePeakDbtp - loudness.integratedLufs).toFixed(2),
        );
  const overviewSpectrum = spectrogram.finish();
  const detailSpectrum = detailSpectrogram.finish();
  return {
    technical,
    measurements: {
      ...measurement.finish(),
      standard: "Audio-V signal measurement v2",
      decoder: technical.backend,
      decodeIntegrity: "complete",
      ...loudness,
      peakToLoudnessRatioLu,
      waveform: waveform.finish(),
      spectrogram: overviewSpectrum,
      spectrogramPyramid: [overviewSpectrum, detailSpectrum],
    },
  };
}
