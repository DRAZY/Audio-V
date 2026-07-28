import type {
  FidelityAssessment,
  OracleAssessmentFinding,
  OracleAssessmentLanes,
  SignalMeasurements,
  StreamTechnicalAnalysis,
} from "../../shared/contracts";

const sampleExactCodecs = new Set([
  "alac",
  "flac",
  "wavpack",
  "pcm_f32le",
  "pcm_f64le",
  "pcm_s16be",
  "pcm_s16le",
  "pcm_s24be",
  "pcm_s24le",
  "pcm_s32be",
  "pcm_s32le",
]);

function finding(
  id: string,
  lane: OracleAssessmentFinding["lane"],
  severity: OracleAssessmentFinding["severity"],
  certainty: OracleAssessmentFinding["certainty"],
  summary: string,
  ...evidenceIds: string[]
): OracleAssessmentFinding {
  return { id, lane, severity, certainty, summary, evidenceIds };
}

export function buildOracleAssessments(
  measurements: SignalMeasurements,
  technical: StreamTechnicalAnalysis,
  fidelity: FidelityAssessment,
  options: { recoveredStrictDecode?: boolean } = {},
): OracleAssessmentLanes {
  const findings: OracleAssessmentFinding[] = [];
  const durationDelta =
    technical.durationSeconds === null
      ? null
      : Math.abs(technical.durationSeconds - measurements.durationSeconds);

  if (options.recoveredStrictDecode) {
    findings.push(
      finding(
        "recoverable-stream-nonconformance",
        "integrity",
        "review",
        "deterministic",
        "Strict decoding stopped on a stream error, while a tolerant confirmation decode completed. The stream is playable but structurally nonconformant.",
        "full-decode",
      ),
    );
  }

  if (measurements.clippedSamples > 0) {
    const material =
      measurements.clippedSamples >= 3 ||
      measurements.clipping.eventCount >= 2 ||
      measurements.clipping.clippedSamplePercent >= 0.0001;
    findings.push(
      finding(
        "sample-rail-hits",
        "signal",
        material ? "review" : "advisory",
        "measured",
        `${measurements.clippedSamples.toLocaleString()} full-scale clipped samples occur in ${measurements.clipping.eventCount.toLocaleString()} contiguous event(s).`,
        "clipping-diagnostics",
      ),
    );
  }

  if (
    measurements.clipping.scaledClippingIndicator ===
    "possible-scaled-clipping"
  ) {
    findings.push(
      finding(
        "scaled-clipping-pattern",
        "signal",
        measurements.clipping.scaledClippingCandidateSamples >= 12
          ? "review"
          : "advisory",
        "heuristic",
        `${measurements.clipping.scaledClippingCandidateSamples.toLocaleString()} repeated plateau samples are compatible with scaled clipping.`,
        "clipping-diagnostics",
      ),
    );
  }

  if (measurements.defects.clickPopCandidateCount > 0) {
    const clickEvents = measurements.defects.events.filter(
      (event) => event.kind === "click-pop-candidate",
    );
    const maximumAmplitude = Math.max(
      0,
      ...clickEvents.map((event) => event.amplitude),
    );
    findings.push(
      finding(
        "click-pop-candidates",
        "signal",
        measurements.defects.clickPopCandidateCount >= 2 ||
          maximumAmplitude >= 0.5
          ? "review"
          : "advisory",
        "heuristic",
        `${measurements.defects.clickPopCandidateCount.toLocaleString()} locally isolated waveform discontinuity candidate(s) were measured.`,
        "waveform-defect-diagnostics",
      ),
    );
  }

  if (measurements.defects.stuckSampleCandidateCount > 0) {
    const longestSeconds = Math.max(
      0,
      ...measurements.defects.events
        .filter((event) => event.kind === "stuck-sample-candidate")
        .map((event) => event.endSeconds - event.startSeconds),
    );
    findings.push(
      finding(
        "stuck-sample-candidates",
        "signal",
        longestSeconds >= 0.05 ||
          measurements.defects.stuckSampleCandidateCount >= 2
          ? "review"
          : "advisory",
        "heuristic",
        `${measurements.defects.stuckSampleCandidateCount.toLocaleString()} non-zero repeated-sample plateau candidate(s) were measured.`,
        "waveform-defect-diagnostics",
      ),
    );
  }

  if (measurements.defects.steepTransitionCandidateCount > 0) {
    findings.push(
      finding(
        "steep-transition-candidates",
        "signal",
        "advisory",
        "measured",
        `${measurements.defects.steepTransitionCandidateCount.toLocaleString()} steep transitions were inventoried; steepness alone is not treated as damage.`,
        "waveform-defect-diagnostics",
      ),
    );
  }

  if (measurements.continuity.internalDigitalDropoutCount > 0) {
    findings.push(
      finding(
        "digital-silence-dropouts",
        "signal",
        measurements.continuity.internalDigitalDropoutCount >= 2
          ? "review"
          : "advisory",
        "heuristic",
        `${measurements.continuity.internalDigitalDropoutCount.toLocaleString()} internal exact-digital-silence region(s) may be dropouts.`,
        "continuity",
      ),
    );
  }

  const maximumDcOffset = Math.max(
    0,
    ...measurements.perChannel.map((channel) =>
      Math.abs(channel.dcOffset),
    ),
  );
  if (maximumDcOffset >= 0.01) {
    findings.push(
      finding(
        "dc-offset",
        "signal",
        maximumDcOffset >= 0.05 ? "review" : "advisory",
        "measured",
        `Maximum absolute channel DC offset is ${maximumDcOffset.toFixed(5)}.`,
        "pcm-levels",
      ),
    );
  }

  if (
    measurements.stereoCorrelation !== null &&
    measurements.stereoCorrelation < -0.25
  ) {
    findings.push(
      finding(
        "negative-stereo-correlation",
        "signal",
        "advisory",
        "measured",
        `Stereo correlation is ${measurements.stereoCorrelation.toFixed(5)}; polarity or wide spatial processing may be intentional.`,
        "stereo-authenticity",
      ),
    );
  }
  if (["dual-mono", "near-mono"].includes(measurements.stereoAssessment)) {
    findings.push(
      finding(
        "channel-relationship",
        "signal",
        "info",
        "measured",
        `The channel relationship is ${measurements.stereoAssessment}; this is descriptive, not evidence of damage.`,
        "stereo-authenticity",
      ),
    );
  }

  if (measurements.rmsDbfs === null) {
    findings.push(
      finding(
        "no-measurable-signal",
        "signal",
        "advisory",
        "measured",
        "No measurable signal was present in the decoded stream.",
        "pcm-levels",
      ),
    );
  }

  if (durationDelta !== null && durationDelta > 0.1) {
    findings.push(
      finding(
        "duration-mismatch",
        "integrity",
        sampleExactCodecs.has(technical.codecName) ? "review" : "advisory",
        "deterministic",
        `Declared and decoded durations differ by ${(durationDelta * 1_000).toFixed(1)} ms.`,
        "duration-consistency",
      ),
    );
  }

  if (
    measurements.bitUtilization.classification === "possible-bit-padding"
  ) {
    findings.push(
      finding(
        "possible-bit-padding",
        "origin",
        "advisory",
        "heuristic",
        `${measurements.bitUtilization.unusedLeastSignificantBits ?? "Several"} least-significant bit(s) are consistently unused.`,
        "bit-utilization",
      ),
    );
  }

  if (
    fidelity.classification === "possible-lossy-transcode" ||
    fidelity.classification === "possible-upsample"
  ) {
    findings.push(
      finding(
        "spectral-origin-pattern",
        "origin",
        fidelity.ruleStrength === "strong" ? "review" : "advisory",
        "heuristic",
        `${fidelity.classification.replaceAll("-", " ")} with ${fidelity.ruleStrength ?? "unrated"} multi-region rule strength.`,
        "spectral-origin",
      ),
    );
  } else if (fidelity.classification === "bandwidth-limited") {
    findings.push(
      finding(
        "bandwidth-limited",
        "origin",
        "advisory",
        "measured",
        "The signal is bandwidth-limited, but the pattern is not specific enough to attribute an encoding history.",
        "spectral-origin",
      ),
    );
  }

  const credentials = technical.contentCredentials;
  if (credentials.status !== "not-present") {
    const credentialSeverity =
      credentials.status === "invalid" ||
      credentials.status === "valid-untrusted-signer"
        ? "advisory"
        : "info";
    findings.push(
      finding(
        "content-credentials",
        "provenance",
        credentialSeverity,
        "deterministic",
        `Content Credentials status: ${credentials.status}. This lane reports declaration trust separately from audio fidelity.`,
        "content-credentials",
      ),
    );
  }
  if (credentials.digitalSourceTypes.some((value) => /algorithmicMedia/iu.test(value))) {
    findings.push(
      finding(
        "algorithmic-source-declaration",
        "provenance",
        "info",
        "declared",
        "A signed or embedded declaration identifies algorithmic media; the declaration is not an audio-quality defect.",
        "content-credentials",
      ),
    );
  }
  for (const [index, indicator] of technical.provenanceIndicators.entries()) {
    findings.push(
      finding(
        `provenance-indicator-${index + 1}`,
        "provenance",
        "info",
        indicator.type === "watermark-signature" ? "heuristic" : "declared",
        `${indicator.identifier}: ${indicator.interpretation}`,
        `provenance-indicator-${index + 1}`,
      ),
    );
  }

  if (
    measurements.truePeakDbtp !== null &&
    measurements.truePeakDbtp > 0
  ) {
    findings.push(
      finding(
        "positive-true-peak",
        "delivery",
        "advisory",
        "measured",
        `${measurements.truePeakDbtp.toFixed(2)} dBTP may exceed some delivery targets, but no delivery profile is selected.`,
        "ebu-loudness",
      ),
    );
  }

  const signalFindings = findings.filter((item) => item.lane === "signal");
  const originFindings = findings.filter((item) => item.lane === "origin");
  const provenanceFindings = findings.filter(
    (item) => item.lane === "provenance",
  );
  const deliveryFindings = findings.filter(
    (item) => item.lane === "delivery",
  );
  const signalStatus = signalFindings.some(
    (item) => item.severity === "review" || item.severity === "critical",
  )
    ? "review"
    : signalFindings.some((item) => item.severity === "advisory")
      ? "advisory"
      : "clear";
  const provenanceStatus =
    credentials.status === "valid"
      ? "valid"
      : credentials.status === "valid-untrusted-signer"
        ? "untrusted"
        : credentials.status === "invalid"
          ? "invalid"
          : provenanceFindings.length > 0
            ? "declared"
            : "none";
  const originStatus =
    fidelity.classification === "inconclusive"
      ? "inconclusive"
      : fidelity.classification === "no-strong-spectral-anomaly"
        ? "no-strong-anomaly"
        : fidelity.ruleStrength === "strong" &&
            (fidelity.classification === "possible-lossy-transcode" ||
              fidelity.classification === "possible-upsample")
          ? "strong-multi-feature-pattern"
          : "compatible-pattern";

  return {
    integrity: {
      status: "passed",
      summary: options.recoveredStrictDecode
        ? "Tolerant confirmation decode completed after strict decoding reported a recoverable stream error."
        : "The complete audio stream decoded and deterministic integrity checks completed.",
    },
    signal: {
      status: signalStatus,
      findingIds: signalFindings.map((item) => item.id),
    },
    origin: {
      status: originStatus,
      strength: fidelity.ruleStrength ?? "none",
      coveragePercent: fidelity.evidenceCoverage,
      stabilityPercent: fidelity.stabilityPercent ?? null,
      independentIndicatorCount:
        fidelity.independentIndicators?.length ?? 0,
      findingIds: originFindings.map((item) => item.id),
    },
    provenance: {
      status: provenanceStatus,
      findingIds: provenanceFindings.map((item) => item.id),
    },
    delivery: {
      profile: null,
      status: "not-evaluated",
      findingIds: deliveryFindings.map((item) => item.id),
    },
    findings,
  };
}

export function assessmentRequiresReview(
  assessments: OracleAssessmentLanes,
): boolean {
  return assessments.findings.some(
    (item) => item.severity === "review" || item.severity === "critical",
  );
}
