import type { SpectrogramMeasurements } from "../../shared/contracts";
import { runEngine } from "./ffmpeg-runtime";
import { SpectrogramAccumulator } from "./spectrogram";

export async function inspectSpectrogram(
  filePath: string,
  fftSize: 512 | 2048 | 4096 | 16384,
  channelMode: SpectrogramMeasurements["channelMode"],
): Promise<SpectrogramMeasurements> {
  const probe = await runEngine("ffprobe", [
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "stream=sample_rate,channels,duration:format=duration",
    "-of", "json",
    filePath,
  ]);
  const parsed = JSON.parse(probe.stdout.toString("utf8")) as {
    streams?: Array<{ sample_rate?: string; channels?: number; duration?: string }>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0];
  const sampleRate = Number(stream?.sample_rate);
  const channels = Number(stream?.channels);
  const duration = Number(stream?.duration ?? parsed.format?.duration ?? 1);
  if (!sampleRate || !channels) {
    throw new Error("The selected audio stream has no inspectable channel layout.");
  }
  const accumulator = new SpectrogramAccumulator(
    sampleRate,
    channels,
    Math.max(1, Math.round(duration * sampleRate)),
    { fftSize, maxSlices: fftSize >= 16384 ? 160 : 240, channelMode },
  );
  let carry: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  await runEngine(
    "ffmpeg",
    [
      "-nostdin", "-hide_banner", "-nostats", "-v", "error", "-xerror",
      "-i", filePath, "-map", "0:a:0", "-vn", "-sn", "-dn",
      "-f", "f64le", "-acodec", "pcm_f64le", "pipe:1",
    ],
    (chunk) => {
      const combined = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const frameBytes = channels * 8;
      const completeLength = combined.length - (combined.length % frameBytes);
      const samples = new Float64Array(completeLength / 8);
      for (let offset = 0; offset < completeLength; offset += 8) {
        samples[offset / 8] = combined.readDoubleLE(offset);
      }
      accumulator.pushInterleaved(samples);
      carry = combined.subarray(completeLength);
    },
  );
  if (carry.length) throw new Error("Spectrogram decode ended with an incomplete frame.");
  return accumulator.finish();
}
