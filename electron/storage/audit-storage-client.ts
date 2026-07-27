import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type {
  AudioFileRecord,
  AudioSourceSelection,
  AuditSessionStatus,
  AuditSessionSummary,
  ReportExportFormat,
  StoredAuditSession,
  FingerprintIndexCandidate,
} from "../../shared/contracts";
import type {
  StorageWorkerCommand,
  StorageWorkerResponse,
} from "./storage-worker-protocol";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class AuditStorageClient {
  readonly #worker: Worker;
  readonly #pending = new Map<string, PendingRequest>();
  #closed = false;

  constructor(workerPath: string, databasePath: string) {
    this.#worker = new Worker(workerPath, { workerData: { databasePath } });
    this.#worker.on("message", (response: StorageWorkerResponse) => {
      const pending = this.#pending.get(response.id);
      if (!pending) return;
      this.#pending.delete(response.id);
      if (response.ok) pending.resolve(response.value);
      else {
        const error = new Error(response.message);
        if (response.stack) error.stack = response.stack;
        pending.reject(error);
      }
    });
    this.#worker.on("error", (error) => this.#failAll(error));
    this.#worker.on("exit", (code) => {
      if (!this.#closed && code !== 0) {
        this.#failAll(new Error(`Storage worker exited with code ${code}.`));
      }
    });
  }

  create(source: AudioSourceSelection): Promise<string> {
    return this.#request({ operation: "create", source });
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

  getSession(sessionId: string): Promise<StoredAuditSession | null> {
    return this.#request({ operation: "get-session", sessionId });
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
  ): Promise<FingerprintIndexCandidate[]> {
    return this.#request({ operation: "find-fingerprints", filePath, limit });
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

  #request<T>(request: StorageWorkerCommand): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("The storage worker is closed."));
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.#worker.postMessage({ ...request, id });
    });
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}
