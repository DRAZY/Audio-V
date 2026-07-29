import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const document = JSON.parse(
  await readFile(
    path.join(root, "validation", "manual-acceptance.json"),
    "utf8",
  ),
);
const errors = [];
if (document.schema !== "Audio-V manual acceptance evidence v1") {
  errors.push("Unexpected manual-acceptance schema.");
}
if (!Array.isArray(document.evidence) || document.evidence.length === 0) {
  errors.push("At least one manual acceptance record is required.");
}
const ids = new Set();
for (const item of document.evidence ?? []) {
  if (typeof item.id !== "string" || !item.id.trim() || ids.has(item.id)) {
    errors.push(`Invalid or duplicate acceptance ID ${item.id ?? "(missing)"}.`);
  } else {
    ids.add(item.id);
  }
  if (!Number.isFinite(Date.parse(item.observedAt))) {
    errors.push(`${item.id} has an invalid observation date.`);
  }
  if (
    item.kind === "real-library-full-audit" &&
    (!Number.isInteger(item.minimumFileCount) || item.minimumFileCount < 1)
  ) {
    errors.push(`${item.id} requires a positive minimumFileCount.`);
  }
  if (!Array.isArray(item.verifiedClaims) || item.verifiedClaims.length === 0) {
    errors.push(`${item.id} must state exactly what was verified.`);
  }
  if (!Array.isArray(item.notCaptured)) {
    errors.push(`${item.id} must disclose measurements that were not captured.`);
  }
}
const largestCompletedLibrary = Math.max(
  0,
  ...(document.evidence ?? [])
    .filter(
      (item) =>
        item.kind === "real-library-full-audit" &&
        item.outcome === "completed",
    )
    .map((item) => item.minimumFileCount),
);
const report = {
  schema: "Audio-V manual acceptance gate result v1",
  measuredAt: new Date().toISOString(),
  evidenceRecords: document.evidence?.length ?? 0,
  largestCompletedRealLibraryAtLeast: largestCompletedLibrary,
  platformQualifiedRecords: (document.evidence ?? []).filter(
    (item) => item.platform !== "not-recorded",
  ).length,
  limitation:
    "Maintainer-witnessed evidence closes only the claims explicitly recorded; missing platform and performance measurements remain open.",
  errors,
  passed: errors.length === 0,
};
await writeFile(
  path.join(root, "build", "manual-acceptance-latest.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Manual acceptance evidence verified: real-library completion at >=${largestCompletedLibrary.toLocaleString()} files; ${report.platformQualifiedRecords} platform-qualified record(s).`,
  );
}
