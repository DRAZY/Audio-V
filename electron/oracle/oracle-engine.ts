import type { OracleResult } from "../../shared/contracts";
import { analyzeWithFfmpeg } from "./ffmpeg-analyzer";
import { assessFidelityOrigin } from "./fidelity-assessment";
import { classifyOracleFailure } from "./analysis-failure";
import {
  assessmentRequiresReview,
  buildOracleAssessments,
} from "./oracle-assessments";

export const engineVersion = "0.10.0-oracle-v12";

export function oracleFailureResult(error: unknown): OracleResult {
  const failure = classifyOracleFailure(error);
  const integrityFailure = failure.category === "file-integrity";
  return {
    schemaVersion: 1,
    engineVersion,
    scope: "oracle-integrity-forensics-v12",
    verdict: integrityFailure ? "damaged" : "inconclusive",
    analysisState: integrityFailure ? "failed" : "error",
    failure,
    confidence: null,
    headline: integrityFailure
      ? "Audio stream integrity failed"
      : "Analysis could not be completed",
    interpretation: integrityFailure
      ? "The selected audio stream could not be decoded completely, and the decoder supplied deterministic corruption evidence against the file itself."
      : "Audio-V encountered a tool, resource, or internal processing error. The file has not been classified as damaged; retry the analysis and review the failure stage and diagnostic evidence.",
    evidence: [
      {
        id: integrityFailure ? "full-decode" : "analysis-diagnostic",
        label: integrityFailure
          ? "Complete stream decode"
          : "Analysis diagnostic",
        summary: failure.evidence,
        kind: integrityFailure ? "deterministic" : "measured",
        disposition: integrityFailure ? "contradicts" : "neutral",
      },
    ],
    measurements: null,
    technical: null,
    fidelity: null,
    assessments: {
      integrity: {
        status: integrityFailure ? "failed" : "error",
        summary: failure.summary,
      },
      signal: { status: "clear", findingIds: [] },
      origin: {
        status: "inconclusive",
        strength: "none",
        coveragePercent: 0,
        stabilityPercent: null,
        independentIndicatorCount: 0,
        findingIds: [],
      },
      provenance: { status: "none", findingIds: [] },
      delivery: {
        profile: null,
        status: "not-evaluated",
        measuredLoudnessLufs: null,
        measuredTruePeakDbtp: null,
        findingIds: [],
      },
      findings: [
        {
          id: integrityFailure
            ? "deterministic-integrity-failure"
            : "analysis-error",
          lane: "integrity",
          severity: integrityFailure ? "critical" : "advisory",
          certainty: integrityFailure ? "deterministic" : "measured",
          summary: failure.evidence,
          evidenceIds: [
            integrityFailure ? "full-decode" : "analysis-diagnostic",
          ],
        },
      ],
    },
    measuredAt: new Date().toISOString(),
  };
}

export async function analyzeAudioFile(
  filePath: string,
  signal?: AbortSignal,
): Promise<OracleResult> {
  try {
    let recoveredStrictDecode = false;
    let analysis: Awaited<ReturnType<typeof analyzeWithFfmpeg>>;
    try {
      analysis = await analyzeWithFfmpeg(filePath, signal);
    } catch (strictError) {
      if (signal?.aborted) throw strictError;
      const strictFailure = classifyOracleFailure(strictError);
      if (
        strictFailure.category !== "file-integrity" ||
        strictFailure.stage !== "full-decode"
      ) {
        throw strictError;
      }
      try {
        analysis = await analyzeWithFfmpeg(filePath, signal, {
          strictDecode: false,
        });
        recoveredStrictDecode = true;
      } catch {
        throw strictError;
      }
    }
    const { measurements, technical, originSpectrum } = analysis;
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
    const fidelity = assessFidelityOrigin(
      measurements,
      technical,
      originSpectrum,
    );
    const fidelityConcern = [
      "possible-lossy-transcode",
      "possible-upsample",
    ].includes(fidelity.classification);
    const dropoutConcern =
      measurements.continuity.internalDigitalDropoutCount > 0;
    const silence = measurements.rmsDbfs === null;
    const scaledClippingConcern =
      measurements.clipping.scaledClippingIndicator ===
      "possible-scaled-clipping";
    const contentCredentialsConcern = [
      "invalid",
      "valid-untrusted-signer",
    ].includes(technical.contentCredentials.status);
    const algorithmicSourceDeclaration =
      technical.contentCredentials.digitalSourceTypes.some((value) =>
        /algorithmicMedia/iu.test(value),
      );
    const bitUtilizationConcern =
      measurements.bitUtilization.classification === "possible-bit-padding";
    const clickPopConcern = measurements.defects.clickPopCandidateCount > 0;
    const stuckSampleConcern =
      measurements.defects.stuckSampleCandidateCount > 0;
    const steepTransitionConcern =
      measurements.defects.steepTransitionCandidateCount > 0;
    const rawSignatureConcern = technical.provenanceIndicators.some(
      (indicator) => indicator.type === "watermark-signature",
    );
    const assessments = buildOracleAssessments(
      measurements,
      technical,
      fidelity,
      { recoveredStrictDecode },
    );
    const requiresReview = assessmentRequiresReview(assessments);
    const reviewFindingIds = new Set(
      assessments.findings
        .filter(
          (finding) =>
            finding.severity === "review" ||
            finding.severity === "critical",
        )
        .map((finding) => finding.id),
    );
    const concerns = assessments.findings
      .filter(
        (finding) =>
          finding.severity === "review" ||
          finding.severity === "critical",
      )
      .map((finding) => finding.summary);
    const verdict = flacMd5Mismatch
      ? "damaged"
      : requiresReview
        ? "review"
        : "verified";
    return {
      schemaVersion: 1,
      engineVersion,
      scope: "oracle-integrity-forensics-v12",
      verdict,
      analysisState: flacMd5Mismatch ? "failed" : "completed",
      failure: flacMd5Mismatch
        ? {
            category: "file-integrity",
            stage: "integrity-verification",
            code: "FLAC_STREAMINFO_MD5_MISMATCH",
            summary:
              "The decoded FLAC audio does not match its stored STREAMINFO MD5.",
            evidence: `Stored ${technical.flacMd5?.storedMd5}; calculated ${technical.flacMd5?.calculatedMd5}.`,
          }
        : null,
      confidence: null,
      headline: flacMd5Mismatch
        ? "FLAC audio checksum failed"
        : requiresReview
          ? assessments.origin.status === "strong-multi-feature-pattern"
            ? fidelity.classification === "possible-upsample"
              ? "Possible upsample pattern"
              : "Possible lossy-transcode pattern"
            : "Review signal findings"
          : "Current checks passed",
      interpretation: flacMd5Mismatch
        ? "The complete FLAC stream decoded, but the MD5 calculated from its uncompressed audio does not match the checksum stored in STREAMINFO. This is deterministic evidence that the decoded audio differs from the stream's recorded identity."
        : requiresReview
          ? `Audio-V decoded the complete PCM stream and found review-level evidence: ${concerns.join(" ")} Integrity, signal, origin, provenance, and delivery findings are evaluated in separate lanes.`
        : assessments.findings.some(
              (finding) => finding.severity === "advisory",
            )
          ? "Audio-V decoded the complete PCM stream and found no review-level defect. Advisory observations remain visible in their assessment lanes and do not imply file damage."
          : "Audio-V decoded the complete PCM stream and found no review-level evidence within the tested integrity, signal, and spectral-origin scope.",
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
          disposition: reviewFindingIds.has("duration-mismatch")
            ? "contradicts"
            : "supports",
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
          id: "clipping-diagnostics",
          label: "Clipping diagnostics",
          summary: `${measurements.clippedSamples.toLocaleString()} clipped samples (${measurements.clipping.clippedSamplePercent.toFixed(6)}%), ${measurements.clipping.eventCount.toLocaleString()} contiguous events; scaled-clipping indicator ${measurements.clipping.scaledClippingIndicator}. ${measurements.clipping.limitation}`,
          kind: "measured",
          disposition:
            reviewFindingIds.has("sample-rail-hits") ||
            reviewFindingIds.has("scaled-clipping-pattern")
              ? "contradicts"
              : "neutral",
        },
        {
          id: "waveform-defect-diagnostics",
          label: "Click, pop, stuck-sample, and transition diagnostics",
          summary: `${measurements.defects.clickPopCandidateCount.toLocaleString()} isolated click/pop candidates, ${measurements.defects.stuckSampleCandidateCount.toLocaleString()} stuck-sample plateaus, and ${measurements.defects.steepTransitionCandidateCount.toLocaleString()} steep transitions. ${measurements.defects.limitation}`,
          kind: "measured",
          disposition:
            reviewFindingIds.has("click-pop-candidates") ||
            reviewFindingIds.has("stuck-sample-candidates")
              ? "contradicts"
              : "neutral",
        },
        {
          id: "content-credentials",
          label: "C2PA Content Credentials",
          summary:
            technical.contentCredentials.status === "not-present"
              ? `No embedded Content Credential was found. ${technical.contentCredentials.limitation}`
              : `${technical.contentCredentials.status}; ${technical.contentCredentials.manifestCount} manifest(s); generator ${technical.contentCredentials.claimGenerator ?? "not declared"}; signer ${technical.contentCredentials.signer ?? "not declared"}; network access ${technical.contentCredentials.networkAccess}. ${technical.contentCredentials.limitation}`,
          kind: "deterministic",
          disposition:
            technical.contentCredentials.status === "valid"
                ? "supports"
                : "neutral",
        },
        {
          id: "chromaprint",
          label: "Chromaprint acoustic fingerprint",
          summary:
            technical.fingerprint.status === "measured"
              ? `Measured ${technical.fingerprint.durationSeconds?.toFixed(1) ?? "—"} seconds; fingerprint SHA-256 ${technical.fingerprint.fingerprintSha256}. ${technical.fingerprint.limitation}`
              : `${technical.fingerprint.status}. ${technical.fingerprint.limitation}`,
          kind: "measured",
          disposition: "neutral",
        },
        ...technical.provenanceIndicators.map((indicator, index) => ({
          id: `provenance-indicator-${index + 1}`,
          label: indicator.identifier,
          summary: `${indicator.source}: ${indicator.value}. ${indicator.interpretation}`,
          kind: "heuristic" as const,
          disposition: "neutral" as const,
        })),
        {
          id: "bit-utilization",
          label: "Integer bit utilization",
          summary: `${measurements.bitUtilization.classification}; declared ${measurements.bitUtilization.declaredBitDepth ?? "—"} bits, effective ${measurements.bitUtilization.effectiveBitDepth ?? "—"} bits, unused least-significant bits ${measurements.bitUtilization.unusedLeastSignificantBits ?? "—"}. ${measurements.bitUtilization.limitation}`,
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
          disposition: "neutral",
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
          disposition: reviewFindingIds.has("digital-silence-dropouts")
            ? "contradicts"
            : "neutral",
        },
        {
          id: "stft-spectrogram",
          label: "STFT spectrogram",
          summary: `${measurements.spectrogram.slices.length.toLocaleString()} overview slices are persisted for display. The origin classifier separately evaluated ${originSpectrum.slices.length.toLocaleString()} time regions at ${originSpectrum.fftSize.toLocaleString()} points and retained its bounded summary; observed classifier bandwidth ${originSpectrum.effectiveBandwidthHz === null ? "not measurable" : `${originSpectrum.effectiveBandwidthHz.toLocaleString()} Hz`}.`,
          kind: "measured",
          disposition: "neutral",
        },
        {
          id: "spectral-origin",
          label: "Spectral-origin assessment",
          summary: `${fidelity.basis.join(" ")} ${fidelity.limitation}`,
          kind: "heuristic",
          disposition:
            assessments.origin.status === "strong-multi-feature-pattern"
              ? "contradicts"
              : "neutral",
        },
      ],
      measurements,
      technical,
      fidelity,
      assessments: flacMd5Mismatch
        ? {
            ...assessments,
            integrity: {
              status: "failed",
              summary:
                "The decoded FLAC audio does not match its stored STREAMINFO MD5.",
            },
            findings: [
              ...assessments.findings,
              {
                id: "flac-streaminfo-md5-mismatch",
                lane: "integrity",
                severity: "critical",
                certainty: "deterministic",
                summary:
                  "The decoded FLAC audio differs from its stored STREAMINFO identity.",
                evidenceIds: ["flac-streaminfo-md5"],
              },
            ],
          }
        : assessments,
      measuredAt: new Date().toISOString(),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return oracleFailureResult(error);
  }
}
