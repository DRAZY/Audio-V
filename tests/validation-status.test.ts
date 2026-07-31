import { describe, expect, it } from "vitest";
import type { OracleValidationStatus } from "../shared/contracts";
import {
  validationClaimDetail,
  validationClaimLabel,
} from "../shared/validation-status";

const evaluatedStatus = {
  claimLevel: "real-world-corpus-present-not-probability-calibrated",
  limitations: ["Legacy generic limitation."],
} as OracleValidationStatus;

describe("Oracle validation disclosure", () => {
  it("describes the completed rejected-candidate state without implying pending calibration", () => {
    expect(validationClaimLabel(evaluatedStatus.claimLevel)).toBe(
      "Evaluated · no model promoted",
    );
    expect(validationClaimDetail(evaluatedStatus)).toContain(
      "evaluation is complete",
    );
    expect(validationClaimDetail(evaluatedStatus)).toContain(
      "Oracle v12 remains unchanged",
    );
    expect(validationClaimDetail(evaluatedStatus)).not.toContain(
      "not calibrated",
    );
  });

  it("keeps pre-corpus claim levels explicit", () => {
    expect(validationClaimLabel("synthetic-regression-only")).toBe(
      "Regression tested only",
    );
    expect(validationClaimLabel("edge-control-evidence-only")).toBe(
      "Edge abstention validated",
    );
    expect(validationClaimLabel("pilot-real-world-evidence")).toBe(
      "Pilot origin evidence",
    );
  });
});
