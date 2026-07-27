import type {
  CuePregapAnalysis,
  CueTrackAnalysis,
  CueTrackDefinition,
} from "../../shared/contracts";
import { PcmMeasurementAccumulator } from "./pcm-measurements";
import { runEngine } from "./ffmpeg-runtime";

function decodedFloat64(chunk: Buffer): Float64Array {
  const completeLength = chunk.length - (chunk.length % 8);
  const samples = new Float64Array(completeLength / 8);
  for (let offset = 0; offset < completeLength; offset += 8) {
    samples[offset / 8] = chunk.readDoubleLE(offset);
  }
  return samples;
}

function loudnessValue(stderr: string, pattern: RegExp): number | null {
  const matches = [...stderr.matchAll(pattern)];
  const value = Number(matches.at(-1)?.[1]);
  return Number.isFinite(value) ? value : null;
}

async function analyzeCuePregap(
  definition: CueTrackDefinition,
  sampleRate: number,
  channels: number,
  signal?: AbortSignal,
): Promise<CuePregapAnalysis | null> {
  if (
    definition.index00Seconds === null ||
    definition.index00Seconds < 0 ||
    definition.index00Seconds >= definition.index01Seconds
  ) return null;
  const durationSeconds =
    definition.index01Seconds - definition.index00Seconds;
  try {
    const accumulator = new PcmMeasurementAccumulator(sampleRate, channels);
    await runEngine(
      "ffmpeg",
      [
        "-nostdin", "-hide_banner", "-nostats", "-v", "error", "-xerror",
        "-ss", definition.index00Seconds.toFixed(8),
        "-t", durationSeconds.toFixed(8),
        "-i", definition.sourcePath,
        "-map", "0:a:0", "-vn", "-sn", "-dn",
        "-ar", String(sampleRate), "-ac", String(channels),
        "-f", "f64le", "-acodec", "pcm_f64le", "pipe:1",
      ],
      (chunk) => accumulator.pushInterleaved(decodedFloat64(chunk)),
      signal,
    );
    const measurements = accumulator.finish();
    const loudness = await runEngine(
      "ffmpeg",
      [
        "-nostdin", "-hide_banner", "-nostats", "-v", "info",
        "-ss", definition.index00Seconds.toFixed(8),
        "-t", durationSeconds.toFixed(8),
        "-i", definition.sourcePath,
        "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-",
      ],
      undefined,
      signal,
    );
    const integratedLufs = loudnessValue(
      loudness.stderr,
      /^\s*I:\s*(-?[\d.]+)\s+LUFS/gimu,
    );
    const truePeakDbtp = loudnessValue(
      loudness.stderr,
      /^\s*Peak:\s*(-?[\d.]+)\s+dBFS/gimu,
    );
    const review =
      measurements.clippedSamples > 0 ||
      measurements.defects.clickPopCandidateCount > 0 ||
      measurements.defects.stuckSampleCandidateCount > 0 ||
      measurements.defects.steepTransitionCandidateCount > 0 ||
      (truePeakDbtp !== null && truePeakDbtp > 0);
    return {
      startSeconds: definition.index00Seconds,
      durationSeconds,
      analysisState: "completed",
      verdict: review ? "review" : "clear",
      samplePeakDbfs: measurements.samplePeakDbfs,
      integratedLufs,
      truePeakDbtp,
      clippedSamples: measurements.clippedSamples,
      clickPopCandidates: measurements.defects.clickPopCandidateCount,
      stuckSampleCandidates: measurements.defects.stuckSampleCandidateCount,
      failure: null,
    };
  } catch (error) {
    return {
      startSeconds: definition.index00Seconds,
      durationSeconds,
      analysisState: "error",
      verdict: "error",
      samplePeakDbfs: null,
      integratedLufs: null,
      truePeakDbtp: null,
      clippedSamples: null,
      clickPopCandidates: null,
      stuckSampleCandidates: null,
      failure:
        error instanceof Error ? error.message : "Cue pregap analysis failed.",
    };
  }
}

export async function analyzeCueTracks(
  definitions: CueTrackDefinition[],
  sampleRate: number,
  channels: number,
  signal?: AbortSignal,
): Promise<CueTrackAnalysis[]> {
  const results: CueTrackAnalysis[] = [];
  for (const definition of definitions) {
    const durationSeconds =
      definition.endSeconds === null
        ? 0
        : definition.endSeconds - definition.index01Seconds;
    if (!(durationSeconds > 0)) {
      results.push({
        ...definition,
        durationSeconds: 0,
        analysisState: "error",
        verdict: "error",
        samplePeakDbfs: null,
        integratedLufs: null,
        truePeakDbtp: null,
        replayGainTrackDb: null,
        clippedSamples: null,
        clickPopCandidates: null,
        stuckSampleCandidates: null,
        pregap: await analyzeCuePregap(
          definition,
          sampleRate,
          channels,
          signal,
        ),
        failure: "The cue track has no positive INDEX 01 duration.",
        limitation:
          "The INDEX 01 programme segment and any declared INDEX 00 pregap are reported separately.",
      });
      continue;
    }
    try {
      const accumulator = new PcmMeasurementAccumulator(sampleRate, channels);
      await runEngine(
        "ffmpeg",
        [
          "-nostdin", "-hide_banner", "-nostats", "-v", "error", "-xerror",
          "-ss", definition.index01Seconds.toFixed(8),
          "-t", durationSeconds.toFixed(8),
          "-i", definition.sourcePath,
          "-map", "0:a:0", "-vn", "-sn", "-dn",
          "-ar", String(sampleRate), "-ac", String(channels),
          "-f", "f64le", "-acodec", "pcm_f64le", "pipe:1",
        ],
        (chunk) => accumulator.pushInterleaved(decodedFloat64(chunk)),
        signal,
      );
      const measurements = accumulator.finish();
      const loudness = await runEngine(
        "ffmpeg",
        [
          "-nostdin", "-hide_banner", "-nostats", "-v", "info",
          "-ss", definition.index01Seconds.toFixed(8),
          "-t", durationSeconds.toFixed(8),
          "-i", definition.sourcePath,
          "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-",
        ],
        undefined,
        signal,
      );
      const integratedLufs = loudnessValue(
        loudness.stderr,
        /^\s*I:\s*(-?[\d.]+)\s+LUFS/gimu,
      );
      const truePeakDbtp = loudnessValue(
        loudness.stderr,
        /^\s*Peak:\s*(-?[\d.]+)\s+dBFS/gimu,
      );
      const review =
        measurements.clippedSamples > 0 ||
        measurements.defects.clickPopCandidateCount > 0 ||
        measurements.defects.stuckSampleCandidateCount > 0 ||
        measurements.defects.steepTransitionCandidateCount > 0 ||
        (truePeakDbtp !== null && truePeakDbtp > 0);
      const pregap = await analyzeCuePregap(
        definition,
        sampleRate,
        channels,
        signal,
      );
      results.push({
        ...definition,
        durationSeconds,
        analysisState: "completed",
        verdict: review ? "review" : "clear",
        samplePeakDbfs: measurements.samplePeakDbfs,
        integratedLufs,
        truePeakDbtp,
        replayGainTrackDb:
          integratedLufs === null ? null : Number((-18 - integratedLufs).toFixed(2)),
        clippedSamples: measurements.clippedSamples,
        clickPopCandidates: measurements.defects.clickPopCandidateCount,
        stuckSampleCandidates: measurements.defects.stuckSampleCandidateCount,
        pregap,
        failure: null,
        limitation:
          "The programme segment is analyzed from INDEX 01 to the next INDEX 00/01 boundary (or source end). Any declared INDEX 00 pregap is decoded and reported as separate evidence.",
      });
    } catch (error) {
      results.push({
        ...definition,
        durationSeconds,
        analysisState: "error",
        verdict: "error",
        samplePeakDbfs: null,
        integratedLufs: null,
        truePeakDbtp: null,
        replayGainTrackDb: null,
        clippedSamples: null,
        clickPopCandidates: null,
        stuckSampleCandidates: null,
        pregap: await analyzeCuePregap(
          definition,
          sampleRate,
          channels,
          signal,
        ),
        failure: error instanceof Error ? error.message : "Cue-track analysis failed.",
        limitation: "The cue segment could not be decoded independently.",
      });
    }
  }
  return results;
}
