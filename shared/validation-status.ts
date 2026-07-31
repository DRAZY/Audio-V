import type { OracleValidationStatus } from "./contracts";

export function validationClaimLabel(
  claimLevel: OracleValidationStatus["claimLevel"] | undefined,
): string {
  switch (claimLevel) {
    case "synthetic-regression-only":
      return "Regression tested only";
    case "edge-control-evidence-only":
      return "Edge abstention validated";
    case "pilot-real-world-evidence":
      return "Pilot origin evidence";
    case "real-world-corpus-present-not-probability-calibrated":
      return "Evaluated · no model promoted";
    default:
      return "Loading validation disclosure…";
  }
}

export function validationClaimDetail(
  status: OracleValidationStatus | null,
): string {
  if (!status) {
    return "Audio-V is loading the packaged corpus and scorecard disclosure.";
  }
  if (
    status.claimLevel ===
    "real-world-corpus-present-not-probability-calibrated"
  ) {
    return "Corpus evaluation is complete. The experimental Origin candidate did not pass independent false-advisory gates, so no probability model was promoted and Oracle v12 remains unchanged.";
  }
  return status.limitations[0] ??
    "The packaged validation disclosure does not contain a claim explanation.";
}
