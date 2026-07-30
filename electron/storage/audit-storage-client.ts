import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type {
  AudioFileRecord,
  AudioSourceSelection,
  AuditHistoryClearResult,
  AuditStorageOptimizationResult,
  AuditStorageStatus,
  AuditSessionStatus,
  AuditSessionSummary,
  ReportExportFormat,
  StoredAuditSession,
  FingerprintIndexCandidate,
  FingerprintLibraryEntry,
  FingerprintLibraryMutationResult,
} from "../../shared/contracts";
import type {
  StorageWorkerCommand,
  StorageWorkerResponse,
} from "./storage-worker-protocol";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export type AuditStorageEvent =
  | { type: "worker-started" | "worker-restarted" }
  | {
      type: "request-timeout" | "worker-error";
      operation?: StorageWorkerCommand["operation"];
      message: string;
    };

export class AuditStorageClient {
  readonly #workerPath: string;
  readonly #databasePath: string;
  readonly #requestTimeoutMs: number;
  readonly #onEvent?: (event: AuditStorageEvent) => void;
  readonly #pending = new Map<string, PendingRequest>();
  #worker: Worker;
  #restarting: Promise<void> | null = null;
  #closed = false;

  constructor(
    workerPath: string,
    databasePath: string,
    requestTimeoutMs = 30_000,
    onEvent?: (event: AuditStorageEvent) => void,
  ) {
    this.#workerPath = workerPath;
    this.#databasePath = databasePath;
    this.#requestTimeoutMs = Math.max(100, Math.trunc(requestTimeoutMs));
    this.#onEvent = onEvent;
    this.#worker = this.#createWorker();
    this.#emit({ type: "worker-started" });
  }

  #createWorker(): Worker {
    const worker = new Worker(this.#workerPath, {
      workerData: { databasePath: this.#databasePath },
    });
    worker.on("message", (response: StorageWorkerResponse) => {
      const pending = this.#pending.get(response.id);
      if (!pending) return;
      this.#pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.ok) pending.resolve(response.value);
      else {
        const error = new Error(response.message);
        if (response.stack) error.stack = response.stack;
        pending.reject(error);
      }
    });
    worker.on("error", (error) => {
      void this.#restartWorker(worker, error);
    });
    worker.on("exit", (code) => {
      if (!this.#closed && worker === this.#worker) {
        void this.#restartWorker(
          worker,
          new Error(
            code === 0
              ? "Storage worker exited before returning its pending operation."
              : `Storage worker exited with code ${code}.`,
          ),
        );
      }
    });
    return worker;
  }

  create(source: AudioSourceSelection): Promise<string> {
    return this.#request({ operation: "create", source });
  }

  recoverInterruptedSessions(): Promise<number> {
    return this.#request({ operation: "recover-interrupted" });
  }

  markFileStarted(sessionId: string, filePath: string): Promise<void> {
    return this.#request({ operation: "mark-file-started", sessionId, filePath });
  }

  markDiscovered(sessionId: string, count: number, warnings: string[]): Promise<void> {
    return this.#request({ operation: "mark-discovered", sessionId, count, warnings });
  }

  storeFile(sessionId: string, file: AudioFileRecord, ordinal: number, fromCache: boolean): Promise<void> {
    return this.#request({ operation: "store-file", sessionId, file, ordinal, fromCache });
  }

  storeFiles(
    sessionId: string,
    entries: Array<{
      file: AudioFileRecord;
      ordinal: number;
      fromCache: boolean;
    }>,
  ): Promise<void> {
    return this.#request({ operation: "store-files", sessionId, entries });
  }

  finish(sessionId: string, status: Exclude<AuditSessionStatus, "running">, warnings: string[]): Promise<void> {
    return this.#request({ operation: "finish", sessionId, status, warnings });
  }

  listSessions(limit?: number): Promise<AuditSessionSummary[]> {
    return this.#request({ operation: "list-sessions", limit });
  }

  clearHistory(): Promise<AuditHistoryClearResult> {
    return this.#request({ operation: "clear-history" });
  }

  purgeHiddenHistoryBatch(limit?: number): Promise<{
    deletedFiles: number;
    deletedSessions: number;
    remainingSessions: number;
  }> {
    return this.#request({ operation: "purge-hidden-history", limit });
  }

  storageStatus(): Promise<AuditStorageStatus> {
    return this.#request({ operation: "storage-status" });
  }

  optimizeStorage(): Promise<AuditStorageOptimizationResult> {
    return this.#request(
      { operation: "optimize-storage" },
      4 * 60 * 60_000,
    );
  }

  getSession(
    sessionId: string,
    compact = false,
  ): Promise<StoredAuditSession | null> {
    return this.#request({ operation: "get-session", sessionId, compact });
  }

  getSessionFile(
    sessionId: string,
    filePath: string,
  ): Promise<AudioFileRecord | null> {
    return this.#request({
      operation: "get-session-file",
      sessionId,
      filePath,
    });
  }

  getSessionSummary(sessionId: string): Promise<AuditSessionSummary | null> {
    return this.#request({ operation: "get-session-summary", sessionId });
  }

  getRecoveryCandidates(sessionId: string): Promise<string[]> {
    return this.#request({ operation: "get-recovery-candidates", sessionId });
  }

  getCached(filePath: string): Promise<AudioFileRecord | null> {
    return this.#request({ operation: "get-cached", filePath });
  }

  setCached(file: AudioFileRecord): Promise<void> {
    return this.#request({ operation: "set-cached", file });
  }

  findFingerprintCandidates(
    filePath: string,
    limit?: number,
    durationSeconds?: number | null,
    lookup?: {
      exactOnly: boolean;
      fingerprintSha256: string | null;
    },
  ): Promise<FingerprintIndexCandidate[]> {
    return this.#request({
      operation: "find-fingerprints",
      filePath,
      limit,
      durationSeconds,
      lookup,
    });
  }

  listFingerprintLibrary(limit?: number): Promise<FingerprintLibraryEntry[]> {
    return this.#request({ operation: "list-fingerprint-library", limit });
  }

  rebuildFingerprintLibrary(): Promise<FingerprintLibraryMutationResult> {
    return this.#request({ operation: "rebuild-fingerprint-library" });
  }

  pruneFingerprintLibrary(): Promise<FingerprintLibraryMutationResult> {
    return this.#request({ operation: "prune-fingerprint-library" });
  }

  clearFingerprintLibrary(): Promise<FingerprintLibraryMutationResult> {
    return this.#request({ operation: "clear-fingerprint-library" });
  }

  updateSessionFile(sessionId: string, filePath: string, file: AudioFileRecord): Promise<boolean> {
    return this.#request({ operation: "update-session-file", sessionId, filePath, file });
  }

  importLegacyCache(filePath: string): Promise<number> {
    return this.#request({ operation: "import-legacy", filePath });
  }

  exportSessionReport(
    sessionId: string,
    format: ReportExportFormat,
    outputPath: string,
  ): Promise<void> {
    return this.#request({
      operation: "export-session",
      sessionId,
      format,
      outputPath,
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    await this.#request({ operation: "close" }).catch(() => undefined);
    this.#closed = true;
    await this.#worker.terminate();
    this.#failAll(new Error("The storage worker is closed."));
  }

  async #request<T>(
    request: StorageWorkerCommand,
    timeoutMs =
      request.operation === "export-session"
        ? Math.max(this.#requestTimeoutMs, 10 * 60_000)
        : [
              "get-session",
              "clear-history",
              "import-legacy",
              "rebuild-fingerprint-library",
              "prune-fingerprint-library",
              "clear-fingerprint-library",
            ].includes(request.operation)
          ? Math.max(this.#requestTimeoutMs, 5 * 60_000)
        : this.#requestTimeoutMs,
  ): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("The storage worker is closed."));
    await this.#restarting;
    if (this.#closed) throw new Error("The storage worker is closed.");
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const worker = this.#worker;
      const timer = setTimeout(() => {
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        pending.reject(
          new Error(
            `Audit storage did not complete ${request.operation} within ${Math.ceil(timeoutMs / 1_000)} seconds.`,
          ),
        );
        this.#emit({
          type: "request-timeout",
          operation: request.operation,
          message: `Audit storage stalled during ${request.operation}.`,
        });
        void this.#restartWorker(
          worker,
          new Error(`Audit storage stalled during ${request.operation}.`),
        );
      }, timeoutMs);
      timer.unref();
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      try {
        worker.postMessage({ ...request, id });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error("Storage request failed."));
        void this.#restartWorker(
          worker,
          error instanceof Error ? error : new Error("Storage request failed."),
        );
      }
    });
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #restartWorker(worker: Worker, error: Error): Promise<void> {
    if (this.#closed || worker !== this.#worker) return Promise.resolve();
    if (this.#restarting) return this.#restarting;
    this.#emit({ type: "worker-error", message: error.message });
    this.#failAll(error);
    this.#restarting = worker
      .terminate()
      .catch(() => undefined)
      .then(() => {
        if (!this.#closed && worker === this.#worker) {
          this.#worker = this.#createWorker();
          this.#emit({ type: "worker-restarted" });
        }
      })
      .finally(() => {
        this.#restarting = null;
      });
    return this.#restarting;
  }

  #emit(event: AuditStorageEvent): void {
    try {
      this.#onEvent?.(event);
    } catch {
      // Observability must never affect durable storage.
    }
  }
}
