import { describe, expect, it } from "vitest";
import type {
  OracleAssessmentLanes,
  OracleResult,
  SignalMeasurements,
} from "../shared/contracts";
import { deliveryProfiles } from "../shared/delivery-profiles";
import { applyDeliveryProfile } from "../electron/oracle/delivery-profile";

function result(
  integratedLufs: number | null,
  truePeakDbtp: number | null,
  findings: OracleAssessmentLanes["findings"] = [],
): OracleResult {
  return {
    schemaVersion: 1,
    engineVersion: "test",
    scope: "oracle-integrity-forensics-v12",
    verdict: findings.some((finding) => finding.severity === "review")
      ? "review"
      : "verified",
    analysisState: "completed",
    failure: null,
    confidence: null,
    headline: findings.length ? "Review signal findings" : "Current checks passed",
    interpretation: "Base interpretation.",
    evidence: [],
    measurements: {
      integratedLufs,
      truePeakDbtp,
    } as SignalMeasurements,
    technical: null,
    fidelity: null,
    assessments: {
      integrity: { status: "passed", summary: "Complete decode." },
      signal: { status: findings.length ? "review" : "clear", findingIds: [] },
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
        measuredLoudnessLufs: integratedLufs,
        measuredTruePeakDbtp: truePeakDbtp,
        findingIds: [],
      },
      findings,
    },
    measuredAt: "2026-07-29T00:00:00.000Z",
  };
}

describe("delivery profiles", () => {
  it("keeps measured delivery evidence advisory when no profile is selected", () => {
    const assessed = applyDeliveryProfile(result(-10, 0.2));
    expect(assessed.verdict).toBe("verified");
    expect(assessed.assessments?.delivery.status).toBe("not-evaluated");
    expect(assessed.assessments?.findings).toContainEqual(
      expect.objectContaining({
        id: "positive-true-peak",
        severity: "advisory",
      }),
    );
  });

  it("marks readings inside EBU R 128 QC limits compliant", () => {
    const assessed = applyDeliveryProfile(
      result(-23.1, -1.2),
      deliveryProfiles["ebu-r128-programme"],
    );
    expect(assessed.verdict).toBe("verified");
    expect(assessed.assessments?.delivery.status).toBe("compliant");
    expect(assessed.assessments?.delivery.profile?.reference).toContain(
      "EBU R 128",
    );
    expect(assessed.evidence).toContainEqual(
      expect.objectContaining({
        id: "delivery-profile-assessment",
        disposition: "supports",
      }),
    );
  });

  it("changes only the selected delivery lane to Review outside target", () => {
    const assessed = applyDeliveryProfile(
      result(-14, -0.5),
      deliveryProfiles["ebu-r128-programme"],
    );
    expect(assessed.verdict).toBe("review");
    expect(assessed.analysisState).toBe("completed");
    expect(assessed.failure).toBeNull();
    expect(assessed.headline).toBe("Outside selected delivery target");
    expect(assessed.assessments?.integrity.status).toBe("passed");
    expect(assessed.assessments?.delivery.status).toBe("outside-target");
    expect(
      assessed.assessments?.findings.filter(
        (finding) =>
          finding.id === "delivery-loudness-outside-target" ||
          finding.id === "delivery-true-peak-exceeded",
      ),
    ).toHaveLength(2);
  });

  it("replaces a prior profile without retaining stale delivery findings", () => {
    const ebu = applyDeliveryProfile(
      result(-23, -1.5),
      deliveryProfiles["ebu-r128-programme"],
    );
    const atsc = applyDeliveryProfile(
      ebu,
      deliveryProfiles["atsc-a85"],
    );
    expect(atsc.assessments?.delivery.profile?.id).toBe("atsc-a85");
    expect(
      atsc.assessments?.findings.filter(
        (finding) => finding.lane === "delivery",
      ),
    ).toHaveLength(2);
    expect(
      atsc.evidence.filter(
        (evidence) => evidence.id === "delivery-profile-assessment",
      ),
    ).toHaveLength(1);
  });

  it("does not erase an unrelated review when delivery is compliant", () => {
    const assessed = applyDeliveryProfile(
      result(-24, -2.5, [{
        id: "signal-review",
        lane: "signal",
        severity: "review",
        certainty: "measured",
        summary: "Signal review.",
        evidenceIds: [],
      }]),
      deliveryProfiles["atsc-a85"],
    );
    expect(assessed.verdict).toBe("review");
    expect(assessed.assessments?.delivery.status).toBe("compliant");
    expect(assessed.interpretation).toContain("Signal review.");
  });
});
