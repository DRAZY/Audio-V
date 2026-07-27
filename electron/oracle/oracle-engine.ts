import type { OracleResult } from "../../shared/contracts";
import { analyzeWithFfmpeg } from "./ffmpeg-analyzer";
import { assessFidelityOrigin } from "./fidelity-assessment";

export const engineVersion = "0.3.0-oracle-v5";

export async function analyzeAudioFile(
  filePath: string,
  signal?: AbortSignal,
): Promise<OracleResult> {
  try {
    const { measurements, technical } = await analyzeWithFfmpeg(filePath, signal);
    const dcOffsetConcern = measurements.perChannel.some(
      (channel) => Math.abs(channel.dcOffset) >= 0.01,
    );
    const phaseConcern =
      measurements.stereoCorrelation !== null &&
      measurements.stereoCorrelation < -0.25;
    const stereoAuthenticityConcern = [
      "dual-mono",
      "near-mono",
    ].includes(measurements.stereoAssessment);
    const truePeakConcern =
      measurements.truePeakDbtp !== null && measurements.truePeakDbtp > 0;
    const durationDeltaSeconds =
      technical.durationSeconds === null
        ? null
        : Math.abs(technical.durationSeconds - measurements.durationSeconds);
    const durationConcern =
      durationDeltaSeconds !== null && durationDeltaSeconds > 0.1;
    const flacMd5Mismatch = technical.flacMd5?.status === "mismatch";
    const fidelity = assessFidelityOrigin(measurements, technical);
    const fidelityConcern = [
      "possible-lossy-transcode",
      "possible-upsample",
    ].includes(fidelity.classification);
    const dropoutConcern =
      measurements.continuity.internalDigitalDropoutCount > 0;
    const silence = measurements.rmsDbfs === null;
    const requiresReview =
      measurements.clippedSamples > 0 ||
      dcOffsetConcern ||
      phaseConcern ||
      stereoAuthenticityConcern ||
      truePeakConcern ||
      durationConcern ||
      dropoutConcern ||
      fidelityConcern ||
      silence;
    const concerns = [
      measurements.clippedSamples > 0
        ? `${measurements.clippedSamples.toLocaleString()} clipped samples`
        : null,
      dcOffsetConcern ? "material DC offset" : null,
      phaseConcern ? "negative stereo correlation" : null,
      stereoAuthenticityConcern
        ? measurements.stereoAssessment === "dual-mono"
          ? "a stereo container with sample-identical channels"
          : "a stereo container with negligible side-channel energy"
        : null,
      truePeakConcern ? "positive true peak" : null,
      durationConcern ? "declared and decoded duration mismatch" : null,
      dropoutConcern
        ? `${measurements.continuity.internalDigitalDropoutCount} internal digital-silence dropout candidate${measurements.continuity.internalDigitalDropoutCount === 1 ? "" : "s"}`
        : null,
      fidelityConcern
        ? fidelity.classification === "possible-upsample"
          ? "a spectral pattern compatible with upsampling"
          : "a spectral pattern compatible with lossy-to-lossless transcoding"
        : null,
      silence ? "no measurable signal" : null,
    ].filter((value): value is string => value !== null);
    const verdict = flacMd5Mismatch
      ? "damaged"
      : requiresReview
        ? "review"
        : "verified";
    return {
      schemaVersion: 1,
      engineVersion,
      scope: "oracle-integrity-fidelity-v5",
      verdict,
      confidence:
        flacMd5Mismatch
          ? 100
          : fidelityConcern
            ? fidelity.confidence
            : 100,
      headline: flacMd5Mismatch
        ? "FLAC audio checksum failed"
        : requiresReview
          ? fidelityConcern
            ? fidelity.classification === "possible-upsample"
              ? "Possible upsample pattern"
              : "Possible lossy-transcode pattern"
            : "Review signal findings"
          : "Current checks passed",
      interpretation: flacMd5Mismatch
        ? "The complete FLAC stream decoded, but the MD5 calculated from its uncompressed audio does not match the checksum stored in STREAMINFO. This is deterministic evidence that the decoded audio differs from the stream's recorded identity."
        : requiresReview
          ? `Audio-V decoded the complete PCM stream but found ${concerns.join(", ")}. This verdict covers structural integrity and current signal rules; it does not certify source provenance.`
        : "Audio-V decoded the complete PCM stream and found no clipping, positive true peak, material DC offset, silence, or negative stereo correlation. This clear verdict covers current structural and signal checks; it does not certify source provenance.",
      evidence: [
        {
          id: "full-decode",
          label: "Complete stream decode",
          summary: `${measurements.frames.toLocaleString()} frames decoded by ${technical.backend} without a fatal stream error.`,
          kind: "deterministic",
          disposition: "supports",
        },
        {
          id: "file-identity",
          label: "SHA-256 file identity",
          summary: technical.fileSha256,
          kind: "deterministic",
          disposition: "neutral",
        },
        ...(technical.repairProvenance
          ? [
              {
                id: "audio-v-repair-provenance",
                label: "Audio-V working-copy provenance",
                summary: `True-peak safe copy: ${technical.repairProvenance.gainReductionDb.toFixed(4)} dB gain reduction, ${technical.repairProvenance.targetDbtp.toFixed(1)} dBTP target, ${technical.repairProvenance.outputBitDepth}-bit FLAC output.`,
                kind: "deterministic" as const,
                disposition: "neutral" as const,
              },
            ]
          : []),
        ...(technical.flacMd5
          ? [
              {
                id: "flac-streaminfo-md5",
                label: "FLAC STREAMINFO audio MD5",
                summary:
                  technical.flacMd5.status === "verified"
                    ? `Verified ${technical.flacMd5.calculatedMd5}; decoded audio matches the stored STREAMINFO signature.`
                    : technical.flacMd5.status === "mismatch"
                      ? `Stored ${technical.flacMd5.storedMd5}; decoded audio calculated ${technical.flacMd5.calculatedMd5}.`
                      : technical.flacMd5.status === "not-stored"
                        ? "This FLAC stores an all-zero MD5, so checksum verification is unavailable."
                        : "The FLAC sample depth is outside the current canonical MD5 calculator.",
                kind: "deterministic" as const,
                disposition:
                  technical.flacMd5.status === "verified"
                    ? ("supports" as const)
                    : technical.flacMd5.status === "mismatch"
                      ? ("contradicts" as const)
                      : ("neutral" as const),
              },
            ]
          : []),
        {
          id: "duration-consistency",
          label: "Duration consistency",
          summary:
            durationDeltaSeconds === null
              ? "The container did not declare a comparable duration."
              : `${measurements.durationSeconds.toFixed(3)} s decoded versus ${technical.durationSeconds?.toFixed(3)} s declared (${(durationDeltaSeconds * 1_000).toFixed(1)} ms difference).`,
          kind: "deterministic",
          disposition: durationConcern ? "contradicts" : "supports",
        },
        {
          id: "pcm-levels",
          label: "PCM signal levels",
          summary:
            "Sample peak, RMS, DC offset, clipping, and channel relationship were measured from decoded samples.",
          kind: "measured",
          disposition: "neutral",
        },
        {
          id: "stereo-authenticity",
          label: "Stereo authenticity assessment",
          summary:
            measurements.stereoAssessment === "mono"
              ? "The stream is declared mono; stereo authenticity is not applicable."
              : `${measurements.stereoAssessment === "dual-mono" ? "Sample-identical dual mono" : measurements.stereoAssessment === "near-mono" ? "Near-mono stereo" : measurements.stereoAssessment === "stereo-content" ? "Distinct stereo content" : "Inconclusive channel relationship"}; correlation ${measurements.stereoCorrelation?.toFixed(5) ?? "unavailable"}, side-to-mid energy ${measurements.sideToMidRatioDb?.toFixed(1) ?? "unavailable"} dB. Dual/near mono can be intentional and is not proof of deceptive processing.`,
          kind: "measured",
          disposition: stereoAuthenticityConcern ? "contradicts" : "neutral",
        },
        {
          id: "ebu-loudness",
          label: "EBU R128 / BS.1770 loudness",
          summary: `${measurements.integratedLufs?.toFixed(1) ?? "—"} LUFS integrated, ${measurements.loudnessRangeLu?.toFixed(1) ?? "—"} LU range, ${measurements.truePeakDbtp?.toFixed(1) ?? "—"} dBTP true peak.`,
          kind: "measured",
          disposition: "neutral",
        },
        {
          id: "continuity",
          label: "Signal continuity",
          summary: `${measurements.continuity.internalDigitalDropoutCount} internal digital-silence dropout candidates, ${measurements.continuity.discontinuityCandidateCount.toLocaleString()} steep sample-transition candidates, longest exact-zero run ${measurements.continuity.longestDigitalSilenceSeconds.toFixed(3)} s.`,
          kind: "measured",
          disposition: dropoutConcern ? "contradicts" : "neutral",
        },
        {
          id: "stft-spectrogram",
          label: "STFT spectrogram",
          summary: `${measurements.spectrogram.slices.length.toLocaleString()} Hann-windowed FFT slices measured through ${Math.round(measurements.spectrogram.maxFrequencyHz).toLocaleString()} Hz; observed effective bandwidth ${measurements.spectrogram.effectiveBandwidthHz === null ? "not measurable" : `${measurements.spectrogram.effectiveBandwidthHz.toLocaleString()} Hz`}.`,
          kind: "measured",
          disposition: "neutral",
        },
        {
          id: "spectral-origin",
          label: "Spectral-origin assessment",
          summary: `${fidelity.basis.join(" ")} ${fidelity.limitation}`,
          kind: "heuristic",
          disposition: fidelityConcern ? "contradicts" : "neutral",
        },
      ],
      measurements,
      technical,
      fidelity,
      measuredAt: new Date().toISOString(),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    const summary =
      error instanceof Error ? error.message : "The complete audio decode failed.";
    return {
      schemaVersion: 1,
      engineVersion,
      scope: "oracle-integrity-fidelity-v5",
      verdict: "damaged",
      confidence: 100,
      headline: "Audio stream integrity failed",
      interpretation:
        "The selected audio stream could not be decoded completely. This is a deterministic decode-integrity failure, not a spectral quality estimate.",
      evidence: [
        {
          id: "full-decode",
          label: "Complete stream decode",
          summary,
          kind: "deterministic",
          disposition: "contradicts",
        },
      ],
      measurements: null,
      technical: null,
      fidelity: null,
      measuredAt: new Date().toISOString(),
    };
  }
}
