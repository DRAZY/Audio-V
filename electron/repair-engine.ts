import path from "node:path";
import { runEngine } from "./oracle/ffmpeg-runtime";

export async function createTruePeakSafeCopy(
  sourcePath: string,
  outputPath: string,
  measuredTruePeakDbtp: number,
  targetBitDepth: 16 | 24,
  targetTruePeakDbtp = -1,
): Promise<number> {
  const normalizedSource = path.resolve(sourcePath);
  const normalizedOutput = path.resolve(outputPath);
  if (normalizedSource === normalizedOutput) {
    throw new Error("The protected source file cannot be overwritten.");
  }
  if (!Number.isFinite(measuredTruePeakDbtp) || !Number.isFinite(targetTruePeakDbtp)) {
    throw new TypeError("Measured and target true peak must be finite numbers.");
  }
  if (targetBitDepth !== 16 && targetBitDepth !== 24) {
    throw new TypeError("FLAC repair output must be 16-bit or 24-bit.");
  }
  const reductionDb = Math.max(
    0,
    measuredTruePeakDbtp - targetTruePeakDbtp,
  );
  if (reductionDb <= 0) {
    throw new Error("The source is already at or below the true-peak target.");
  }
  const quantizationFilter =
    targetBitDepth === 16
      ? "aresample=osf=s16:dither_method=triangular"
      : "aresample=osf=s32:output_sample_bits=24:dither_method=triangular";
  await runEngine("ffmpeg", [
    "-nostdin",
    "-hide_banner",
    "-v",
    "error",
    "-y",
    "-i",
    normalizedSource,
    "-map",
    "0:a:0",
    "-map",
    "0:v?",
    "-map_metadata",
    "0",
    "-metadata",
    "AUDIO_V_ACTION=true_peak_safe_copy",
    "-metadata",
    `AUDIO_V_TARGET_DBTP=${targetTruePeakDbtp}`,
    "-metadata",
    `AUDIO_V_GAIN_REDUCTION_DB=${reductionDb.toFixed(4)}`,
    "-metadata",
    `AUDIO_V_OUTPUT_BIT_DEPTH=${targetBitDepth}`,
    "-af",
    `volume=-${reductionDb.toFixed(4)}dB,${quantizationFilter}`,
    "-c:a",
    "flac",
    "-sample_fmt",
    targetBitDepth === 16 ? "s16" : "s32",
    "-c:v",
    "copy",
    "-disposition:v",
    "attached_pic",
    normalizedOutput,
  ]);
  return reductionDb;
}
