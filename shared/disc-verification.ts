import type {
  AudioFileRecord,
  DiscVerificationEligibility,
} from "./contracts";

function isCdFrameAligned(seconds: number | null): boolean {
  if (seconds === null) return true;
  return Math.abs(seconds * 75 - Math.round(seconds * 75)) < 0.000_01;
}

export function assessDiscVerificationEligibility(
  file: AudioFileRecord,
): DiscVerificationEligibility {
  const cue = file.metadata.cueSheet;
  const tracks = cue.tracks;
  const hasCue = cue.embedded || cue.sidecarPaths.length > 0;
  const completeSingleImageCue =
    hasCue &&
    cue.trackCount > 0 &&
    tracks.length === cue.trackCount &&
    tracks.every(
      (track) =>
        isCdFrameAligned(track.index00Seconds) &&
        isCdFrameAligned(track.index01Seconds) &&
        isCdFrameAligned(track.endSeconds),
    );
  const lossless =
    file.lossless === true ||
    /^(?:pcm_|flac$|alac$|wavpack$)/iu.test(
      file.oracle.technical?.codecName ?? "",
    );
  const cdAudio =
    lossless &&
    file.sampleRate === 44_100 &&
    file.bitDepth === 16 &&
    file.channels === 2;
  const reasonCodes: string[] = [];
  if (!cdAudio) {
    if (!lossless) reasonCodes.push("lossless-pcm-required");
    if (file.sampleRate !== 44_100) reasonCodes.push("sample-rate-not-44100");
    if (file.bitDepth !== 16) reasonCodes.push("bit-depth-not-16");
    if (file.channels !== 2) reasonCodes.push("channel-count-not-stereo");
  }
  if (!hasCue) reasonCodes.push("cue-layout-missing");
  else if (tracks.length !== cue.trackCount) {
    reasonCodes.push("whole-disc-audio-set-not-assembled");
  }
  if (
    hasCue &&
    tracks.some(
      (track) =>
        !isCdFrameAligned(track.index00Seconds) ||
        !isCdFrameAligned(track.index01Seconds) ||
        !isCdFrameAligned(track.endSeconds),
    )
  ) {
    reasonCodes.push("cue-boundary-not-cd-frame-aligned");
  }
  const eligible = cdAudio && completeSingleImageCue;
  return {
    status: eligible
      ? "eligible-not-verified"
      : cdAudio
        ? "insufficient-disc-context"
        : "not-cd-audio",
    layout: completeSingleImageCue
      ? "single-image-cue"
      : hasCue
        ? "partial-or-multifile-cue"
        : "none",
    ctdbEligible: eligible,
    accurateRipEligible: eligible,
    cueTrackCount: cue.trackCount,
    reasonCodes,
    summary: eligible
      ? `Complete ${cue.trackCount}-track, CD-frame-aligned 44.1 kHz / 16-bit / stereo lossless image context is available for a future read-only CTDB or AccurateRip verification.`
      : cdAudio
        ? "The audio has CD-compatible sample properties, but Audio-V does not have a complete single-image disc layout; no disc-database claim can be made."
        : "This file is not in the 44.1 kHz / 16-bit / stereo lossless form required for CD-rip database verification.",
    limitation:
      "Eligibility is not verification. Audio-V has not calculated a CTDB/AccurateRip disc checksum or contacted either database.",
  };
}
