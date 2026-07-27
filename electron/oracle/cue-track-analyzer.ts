import type { CueTrackAnalysis, CueTrackDefinition } from "../../shared/contracts";
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
        failure: "The cue track has no positive INDEX 01 duration.",
        limitation: "Cue INDEX 01 boundaries define the analyzed segment; pregaps are excluded.",
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
        failure: null,
        limitation: "The segment is analyzed independently from INDEX 01 to the next INDEX 01 (or source end); pregaps are excluded.",
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
        failure: error instanceof Error ? error.message : "Cue-track analysis failed.",
        limitation: "The cue segment could not be decoded independently.",
      });
    }
  }
  return results;
}
