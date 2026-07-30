import type {
  AudioFileRecord,
  AudioSourceSelection,
  AuditSessionStatus,
  ReportExportFormat,
} from "../../shared/contracts";

export type StorageWorkerRequest =
  | { id: string; operation: "create"; source: AudioSourceSelection }
  | { id: string; operation: "recover-interrupted" }
  | { id: string; operation: "mark-file-started"; sessionId: string; filePath: string }
  | { id: string; operation: "mark-discovered"; sessionId: string; count: number; warnings: string[] }
  | { id: string; operation: "store-file"; sessionId: string; file: AudioFileRecord; ordinal: number; fromCache: boolean }
  | { id: string; operation: "store-files"; sessionId: string; entries: Array<{ file: AudioFileRecord; ordinal: number; fromCache: boolean }> }
  | { id: string; operation: "finish"; sessionId: string; status: Exclude<AuditSessionStatus, "running">; warnings: string[] }
  | { id: string; operation: "list-sessions"; limit?: number }
  | { id: string; operation: "clear-history" }
  | { id: string; operation: "purge-hidden-history"; limit?: number }
  | { id: string; operation: "storage-status" }
  | { id: string; operation: "optimize-storage" }
  | { id: string; operation: "get-session"; sessionId: string; compact?: boolean }
  | { id: string; operation: "get-session-file"; sessionId: string; filePath: string }
  | { id: string; operation: "get-session-summary"; sessionId: string }
  | { id: string; operation: "get-recovery-candidates"; sessionId: string }
  | { id: string; operation: "get-cached"; filePath: string }
  | { id: string; operation: "set-cached"; file: AudioFileRecord }
  | { id: string; operation: "find-fingerprints"; filePath: string; limit?: number; durationSeconds?: number | null; lookup?: { exactOnly: boolean; fingerprintSha256: string | null } }
  | { id: string; operation: "list-fingerprint-library"; limit?: number }
  | { id: string; operation: "rebuild-fingerprint-library" }
  | { id: string; operation: "prune-fingerprint-library" }
  | { id: string; operation: "clear-fingerprint-library" }
  | { id: string; operation: "update-session-file"; sessionId: string; filePath: string; file: AudioFileRecord }
  | { id: string; operation: "import-legacy"; filePath: string }
  | { id: string; operation: "export-session"; sessionId: string; format: ReportExportFormat; outputPath: string }
  | { id: string; operation: "close" };

export type StorageWorkerResponse =
  | { id: string; ok: true; value: unknown }
  | { id: string; ok: false; message: string; stack?: string };

export type StorageWorkerCommand =
  StorageWorkerRequest extends infer Request
    ? Request extends { id: string }
      ? Omit<Request, "id">
      : never
    : never;
