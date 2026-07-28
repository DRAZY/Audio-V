import { describe, expect, it } from "vitest";
import type { AudioFileRecord, OracleAnalysisState, OracleVerdict } from "../shared/contracts";
import { auditVerdictRank, sortAuditResults } from "../shared/audit-result-sort";

function result(
  id: string,
  verdict: OracleVerdict,
  analysisState: OracleAnalysisState = "completed",
): AudioFileRecord {
  return {
    id,
    oracle: {
      verdict,
      analysisState,
      scope: "oracle-integrity-forensics-v10",
    },
  } as AudioFileRecord;
}

describe("audit result verdict sorting", () => {
  const files = [
    result("review", "review"),
    result("failed", "damaged", "failed"),
    result("clear", "verified"),
    result("error", "inconclusive", "error"),
    result("pending", "inconclusive", "not-analyzed"),
  ];

  it("ranks the complete workflow from Clear through Failed", () => {
    expect(files.map(auditVerdictRank)).toEqual([1, 4, 0, 3, 2]);
  });

  it("sorts in either triage direction without changing original order", () => {
    expect(
      sortAuditResults(files, "verdict-ascending").map((file) => file.id),
    ).toEqual(["clear", "review", "pending", "error", "failed"]);
    expect(
      sortAuditResults(files, "verdict-descending").map((file) => file.id),
    ).toEqual(["failed", "error", "pending", "review", "clear"]);
    expect(sortAuditResults(files, "original")).toBe(files);
  });
});
