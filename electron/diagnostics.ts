import type { AuditSessionSummary } from "../shared/contracts";

export interface DiagnosticsInput {
  generatedAt: string;
  application: {
    version: string;
    packaged: boolean;
    platform: NodeJS.Platform;
    architecture: string;
  };
  runtime: {
    electron: string;
    chrome: string;
    node: string;
    oracleWorkerCount: number;
  };
  sessions: Pick<AuditSessionSummary, "status">[];
  engineManifest: unknown;
}

export function createPrivacySafeDiagnostics(input: DiagnosticsInput) {
  const statuses = input.sessions.reduce<Record<string, number>>(
    (counts, session) => {
      counts[session.status] = (counts[session.status] ?? 0) + 1;
      return counts;
    },
    {},
  );
  return {
    schema: "Audio-V privacy-safe diagnostics v1",
    generatedAt: input.generatedAt,
    privacy:
      "No audio filenames, source paths, checksums, tags, or report contents are included.",
    application: input.application,
    runtime: input.runtime,
    sessions: {
      total: input.sessions.length,
      statuses,
    },
    engineManifest: input.engineManifest,
  };
}
