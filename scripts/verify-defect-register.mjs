import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const register = JSON.parse(
  await readFile(
    path.join(root, "validation", "release-defects.json"),
    "utf8",
  ),
);
const severities = new Set(["P0", "P1", "P2", "P3"]);
const statuses = new Set([
  "open",
  "investigating",
  "mitigated",
  "fixed",
  "wont-fix",
]);
const errors = [];
if (register.schema !== "Audio-V release defect register v1") {
  errors.push("Unexpected defect-register schema.");
}
if (register.releaseVersion !== packageJson.version) {
  errors.push(
    `Defect register ${register.releaseVersion ?? "has no version"} does not match package ${packageJson.version}.`,
  );
}
const auditedAt = Date.parse(register.auditedAt);
if (!Number.isFinite(auditedAt)) {
  errors.push("Defect register auditedAt is invalid.");
} else if (Date.now() - auditedAt > 30 * 24 * 60 * 60_000) {
  errors.push("Defect register is older than 30 days.");
}
if (!Array.isArray(register.defects)) {
  errors.push("Defect register entries must be an array.");
}
const ids = new Set();
for (const defect of register.defects ?? []) {
  if (typeof defect.id !== "string" || !defect.id.trim()) {
    errors.push("Every defect requires a stable ID.");
  } else if (ids.has(defect.id)) {
    errors.push(`Duplicate defect ID ${defect.id}.`);
  } else {
    ids.add(defect.id);
  }
  if (!severities.has(defect.severity)) {
    errors.push(`${defect.id ?? "Unknown defect"} has invalid severity.`);
  }
  if (!statuses.has(defect.status)) {
    errors.push(`${defect.id ?? "Unknown defect"} has invalid status.`);
  }
  if (
    defect.status === "fixed" &&
    (typeof defect.verification !== "string" || !defect.verification.trim())
  ) {
    errors.push(`${defect.id} is fixed without verification evidence.`);
  }
}
const unresolvedBlocking = (register.defects ?? []).filter(
  (defect) =>
    (defect.severity === "P0" || defect.severity === "P1") &&
    defect.status !== "fixed",
);
if (unresolvedBlocking.length > 0) {
  errors.push(
    `${unresolvedBlocking.length} unresolved P0/P1 defect(s): ${unresolvedBlocking
      .map((defect) => defect.id)
      .join(", ")}.`,
  );
}
const report = {
  schema: "Audio-V defect gate result v1",
  measuredAt: new Date().toISOString(),
  releaseVersion: packageJson.version,
  registeredDefects: (register.defects ?? []).length,
  unresolvedBlockingDefects: unresolvedBlocking.length,
  repositoryIssueCountAtAudit:
    register.repositoryIssueCountAtAudit ?? null,
  limitations: register.limitations ?? [],
  errors,
  passed: errors.length === 0,
};
await writeFile(
  path.join(root, "build", "defect-register-latest.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Defect gate passed: ${report.unresolvedBlockingDefects} unresolved P0/P1 defects across ${report.registeredDefects} registered defects.`,
  );
}
