import type {
  DeliveryProfileSelection,
  OracleAssessmentFinding,
  OracleResult,
} from "../../shared/contracts";

function deliveryFinding(
  id: string,
  severity: OracleAssessmentFinding["severity"],
  summary: string,
): OracleAssessmentFinding {
  return {
    id,
    lane: "delivery",
    severity,
    certainty: "measured",
    summary,
    evidenceIds: ["delivery-profile-assessment"],
  };
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function applyDeliveryProfile(
  oracle: OracleResult,
  profile?: DeliveryProfileSelection,
): OracleResult {
  if (!oracle.assessments || !oracle.measurements) return oracle;
  const baseFindings = oracle.assessments.findings.filter(
    (finding) => finding.lane !== "delivery",
  );
  const baseEvidence = oracle.evidence.filter(
    (evidence) => evidence.id !== "delivery-profile-assessment",
  );
  const loudness = oracle.measurements.integratedLufs;
  const truePeak = oracle.measurements.truePeakDbtp;
  const deliveryFindings: OracleAssessmentFinding[] = [];

  if (!profile) {
    if (finite(truePeak) && truePeak > 0) {
      deliveryFindings.push(
        deliveryFinding(
          "positive-true-peak",
          "advisory",
          `${truePeak.toFixed(2)} dBTP may exceed some delivery targets, but no delivery profile is selected.`,
        ),
      );
    }
  } else {
    if (!finite(loudness)) {
      deliveryFindings.push(
        deliveryFinding(
          "delivery-loudness-unavailable",
          "review",
          `${profile.label} cannot be confirmed because integrated loudness was not measurable.`,
        ),
      );
    } else if (
      loudness < profile.minimumLoudnessLufs ||
      loudness > profile.maximumLoudnessLufs
    ) {
      deliveryFindings.push(
        deliveryFinding(
          "delivery-loudness-outside-target",
          "review",
          `${loudness.toFixed(2)} LUFS is outside the ${profile.minimumLoudnessLufs.toFixed(1)} to ${profile.maximumLoudnessLufs.toFixed(1)} LUFS acceptance range for ${profile.label} (target ${profile.targetLoudnessLufs.toFixed(1)} LUFS).`,
        ),
      );
    } else {
      deliveryFindings.push(
        deliveryFinding(
          "delivery-loudness-compliant",
          "info",
          `${loudness.toFixed(2)} LUFS is inside the ${profile.label} loudness range.`,
        ),
      );
    }

    if (!finite(truePeak)) {
      deliveryFindings.push(
        deliveryFinding(
          "delivery-true-peak-unavailable",
          "review",
          `${profile.label} cannot be confirmed because maximum true peak was not measurable.`,
        ),
      );
    } else if (truePeak > profile.maximumTruePeakDbtp) {
      deliveryFindings.push(
        deliveryFinding(
          "delivery-true-peak-exceeded",
          "review",
          `${truePeak.toFixed(2)} dBTP exceeds the ${profile.maximumTruePeakDbtp.toFixed(1)} dBTP maximum for ${profile.label}.`,
        ),
      );
    } else {
      deliveryFindings.push(
        deliveryFinding(
          "delivery-true-peak-compliant",
          "info",
          `${truePeak.toFixed(2)} dBTP is at or below the ${profile.maximumTruePeakDbtp.toFixed(1)} dBTP maximum for ${profile.label}.`,
        ),
      );
    }
  }

  const findings = [...baseFindings, ...deliveryFindings];
  const outsideTarget =
    profile !== undefined &&
    deliveryFindings.some(
      (finding) =>
        finding.severity === "review" || finding.severity === "critical",
    );
  const requiresReview = findings.some(
    (finding) =>
      finding.severity === "review" || finding.severity === "critical",
  );
  const verdict =
    oracle.verdict === "damaged"
      ? "damaged"
      : requiresReview
        ? "review"
        : "verified";
  const reviewSummaries = findings
    .filter(
      (finding) =>
        finding.severity === "review" || finding.severity === "critical",
    )
    .map((finding) => finding.summary);
  const deliveryEvidence = profile
    ? [{
        id: "delivery-profile-assessment",
        label: profile.label,
        summary:
          `${profile.reference}: measured ${finite(loudness) ? `${loudness.toFixed(2)} LUFS` : "unavailable loudness"} and ` +
          `${finite(truePeak) ? `${truePeak.toFixed(2)} dBTP` : "unavailable true peak"}. ${profile.qualification}`,
        kind: "measured" as const,
        disposition: outsideTarget ? "contradicts" as const : "supports" as const,
      }]
    : [];

  return {
    ...oracle,
    verdict,
    headline:
      oracle.verdict === "damaged"
        ? oracle.headline
        : outsideTarget
          ? "Outside selected delivery target"
          : requiresReview
            ? oracle.headline === "Current checks passed"
              ? "Review signal findings"
              : oracle.headline
            : "Current checks passed",
    interpretation:
      oracle.verdict === "damaged"
        ? oracle.interpretation
        : requiresReview
          ? `Audio-V decoded the complete PCM stream and found review-level evidence: ${reviewSummaries.join(" ")} Integrity, signal, origin, provenance, and delivery findings are evaluated in separate lanes.`
          : profile
            ? `Audio-V decoded the complete PCM stream, found no review-level defect, and measured the file inside the selected ${profile.label} delivery range. Delivery compliance is profile-specific and does not prove source authenticity.`
            : oracle.interpretation,
    evidence: [...baseEvidence, ...deliveryEvidence],
    assessments: {
      ...oracle.assessments,
      delivery: {
        profile: profile ? { ...profile } : null,
        status: profile
          ? outsideTarget
            ? "outside-target"
            : "compliant"
          : "not-evaluated",
        measuredLoudnessLufs: finite(loudness) ? loudness : null,
        measuredTruePeakDbtp: finite(truePeak) ? truePeak : null,
        findingIds: deliveryFindings.map((finding) => finding.id),
      },
      findings,
    },
  };
}
