import type { AudioFileRecord } from "./contracts";

export type AuditResultSort = "original" | "verdict-ascending" | "verdict-descending";

export function auditVerdictRank(file: AudioFileRecord): number {
  const state =
    file.oracle.analysisState ??
    (file.oracle.verdict === "damaged"
      ? "failed"
      : file.oracle.measurements || file.oracle.measuredAt
        ? "completed"
        : file.oracle.scope === "metadata-only"
          ? "not-analyzed"
          : "error");
  if (state === "not-analyzed") return 2;
  if (state === "error") return 3;
  if (state === "failed" || file.oracle.verdict === "damaged") return 4;
  if (["verified", "authentic"].includes(file.oracle.verdict)) return 0;
  return 1;
}

export function sortAuditResults(
  files: AudioFileRecord[],
  sort: AuditResultSort,
): AudioFileRecord[] {
  if (sort === "original") return files;
  const direction = sort === "verdict-ascending" ? 1 : -1;
  return files
    .map((file, index) => ({ file, index }))
    .sort(
      (left, right) =>
        direction * (auditVerdictRank(left.file) - auditVerdictRank(right.file)) ||
        left.index - right.index,
    )
    .map(({ file }) => file);
}
