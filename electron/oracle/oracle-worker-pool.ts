import { availableParallelism } from "node:os";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { AnalysisResourceLimits, OracleResult } from "../../shared/contracts";
import type {
  OracleWorkerRequest,
  OracleWorkerResponse,
} from "./oracle-worker-protocol";

interface QueuedJob {
  id: string;
  filePath: string;
  signal?: AbortSignal;
  attempts: number;
  watchdog: NodeJS.Timeout | null;
  startedAt: number | null;
  resolve: (result: OracleResult) => void;
  reject: (error: Error) => void;
  abort: () => void;
}

interface WorkerSlot {
  worker: Worker;
  activeJob: QueuedJob | null;
  recycling: boolean;
}

const cancellationGraceMs = 500;
const defaultJobTimeoutMs = 12 * 60 * 1000;
const maximumJobAttempts = 2;

export type OracleWorkerEvent =
  | {
      type: "queued" | "started" | "completed" | "canceled";
      jobId: string;
      filePath: string;
      attempt: number;
      elapsedMs?: number;
    }
  | {
      type: "retrying" | "failed";
      jobId: string;
      filePath: string;
      attempt: number;
      incident: OracleWorkerFailure["incident"];
      message: string;
    };

export class OracleWorkerFailure extends Error {
  readonly code: "ORACLE_WORKER_TIMEOUT" | "ORACLE_WORKER_EXIT" | "ORACLE_WORKER_ERROR";

  constructor(
    readonly filePath: string,
    readonly attempts: number,
    readonly incident: "timeout" | "worker-exit" | "worker-error",
    detail: string,
  ) {
    super(
      `Oracle worker ${incident === "timeout" ? "timed out" : "failed"} after ${attempts} attempt${attempts === 1 ? "" : "s"}: ${detail}`,
    );
    this.name = "OracleWorkerFailure";
    this.code =
      incident === "timeout"
        ? "ORACLE_WORKER_TIMEOUT"
        : incident === "worker-exit"
          ? "ORACLE_WORKER_EXIT"
          : "ORACLE_WORKER_ERROR";
  }
}

export class OracleWorkerPool {
  readonly #workerPath: string;
  readonly #workerMemoryMb: number;
  readonly #enginePolicy: Pick<AnalysisResourceLimits, "ffmpegThreads" | "nativeProcessMemoryMb">;
  readonly #jobTimeoutMs: number;
  readonly #onEvent?: (event: OracleWorkerEvent) => void;
  readonly #slots: WorkerSlot[] = [];
  readonly #queue: QueuedJob[] = [];
  #closed = false;

  constructor(
    workerPath: string,
    workerCount = Math.max(1, Math.min(2, availableParallelism() - 1)),
    workerMemoryMb = 256,
    enginePolicy: Pick<
      AnalysisResourceLimits,
      "ffmpegThreads" | "nativeProcessMemoryMb"
    > = { ffmpegThreads: 2, nativeProcessMemoryMb: 1024 },
    jobTimeoutMs = defaultJobTimeoutMs,
    onEvent?: (event: OracleWorkerEvent) => void,
  ) {
    if (!Number.isInteger(workerCount) || workerCount < 1) {
      throw new RangeError("Oracle worker count must be at least one.");
    }
    this.#workerPath = workerPath;
    this.#workerMemoryMb = Math.max(128, Math.min(512, workerMemoryMb));
    this.#enginePolicy = enginePolicy;
    this.#jobTimeoutMs = Math.max(100, Math.trunc(jobTimeoutMs));
    this.#onEvent = onEvent;
    for (let index = 0; index < workerCount; index += 1) {
      this.#slots.push(this.#createSlot());
    }
  }

  analyze(filePath: string, signal?: AbortSignal): Promise<OracleResult> {
    if (this.#closed) {
      return Promise.reject(new Error("The Oracle worker pool is closed."));
    }
    if (signal?.aborted) {
      return Promise.reject(new Error("Audio analysis canceled."));
    }

    return new Promise((resolve, reject) => {
      const job: QueuedJob = {
        id: randomUUID(),
        filePath,
        signal,
        attempts: 0,
        watchdog: null,
        startedAt: null,
        resolve,
        reject,
        abort: () => {
          const queueIndex = this.#queue.indexOf(job);
          if (queueIndex >= 0) {
            this.#queue.splice(queueIndex, 1);
            this.#clearWatchdog(job);
            signal?.removeEventListener("abort", job.abort);
            reject(new Error("Audio analysis canceled."));
            this.#emit({
              type: "canceled",
              jobId: job.id,
              filePath: job.filePath,
              attempt: job.attempts,
            });
            return;
          }
          const slot = this.#slots.find(
            (candidate) => candidate.activeJob === job,
          );
          if (slot) {
            slot.activeJob = null;
            slot.recycling = true;
            this.#clearWatchdog(job);
            signal?.removeEventListener("abort", job.abort);
            reject(new Error("Audio analysis canceled."));
            this.#emit({
              type: "canceled",
              jobId: job.id,
              filePath: job.filePath,
              attempt: job.attempts,
            });
            const request: OracleWorkerRequest = {
              type: "cancel",
              jobId: job.id,
            };
            slot.worker.postMessage(request);
            void this.#recycleCanceledWorker(slot);
          }
        },
      };
      signal?.addEventListener("abort", job.abort, { once: true });
      this.#queue.push(job);
      this.#emit({
        type: "queued",
        jobId: job.id,
        filePath: job.filePath,
        attempt: 0,
      });
      this.#dispatch();
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const job of this.#queue.splice(0)) {
      this.#clearWatchdog(job);
      job.signal?.removeEventListener("abort", job.abort);
      job.reject(new Error("The Oracle worker pool is closed."));
    }
    for (const slot of this.#slots) {
      if (slot.activeJob) {
        this.#clearWatchdog(slot.activeJob);
        slot.activeJob.signal?.removeEventListener(
          "abort",
          slot.activeJob.abort,
        );
        slot.activeJob.reject(new Error("The Oracle worker pool is closed."));
        slot.activeJob = null;
      }
    }
    await Promise.allSettled(
      this.#slots.map((slot) => slot.worker.terminate()),
    );
    this.#slots.length = 0;
  }

  #createSlot(): WorkerSlot {
    const slot: WorkerSlot = {
      worker: new Worker(this.#workerPath, {
        workerData: { enginePolicy: this.#enginePolicy },
        resourceLimits: {
          maxOldGenerationSizeMb: this.#workerMemoryMb,
          maxYoungGenerationSizeMb: Math.min(64, this.#workerMemoryMb / 4),
        },
      }),
      activeJob: null,
      recycling: false,
    };
    slot.worker.on("message", (response: OracleWorkerResponse) => {
      const job = slot.activeJob;
      if (!job || response.jobId !== job.id) return;
      slot.activeJob = null;
      this.#clearWatchdog(job);
      job.signal?.removeEventListener("abort", job.abort);
      if (response.type === "result") {
        job.resolve(response.result);
        this.#emit({
          type: "completed",
          jobId: job.id,
          filePath: job.filePath,
          attempt: job.attempts,
          elapsedMs:
            job.startedAt === null ? undefined : Date.now() - job.startedAt,
        });
      } else {
        const error = new Error(response.message);
        if (response.stack) error.stack = response.stack;
        job.reject(error);
      }
      this.#dispatch();
    });
    slot.worker.on("error", (error) => {
      this.#replaceFailedWorker(slot, "worker-error", error);
    });
    slot.worker.on("exit", (code) => {
      if (!this.#closed && this.#slots.includes(slot)) {
        this.#replaceFailedWorker(
          slot,
          "worker-exit",
          new Error(
            code === 0
              ? "Oracle worker exited before returning its active result."
              : `Oracle worker exited with code ${code}.`,
          ),
        );
      }
    });
    return slot;
  }

  #replaceFailedWorker(
    slot: WorkerSlot,
    incident: OracleWorkerFailure["incident"],
    error: Error,
  ): void {
    const slotIndex = this.#slots.indexOf(slot);
    if (slotIndex < 0) return;
    const job = slot.activeJob;
    slot.activeJob = null;
    if (job) {
      this.#clearWatchdog(job);
      job.signal?.removeEventListener("abort", job.abort);
      if (
        !this.#closed &&
        !job.signal?.aborted &&
        job.attempts < maximumJobAttempts
      ) {
        job.signal?.addEventListener("abort", job.abort, { once: true });
        this.#queue.unshift(job);
        this.#emit({
          type: "retrying",
          jobId: job.id,
          filePath: job.filePath,
          attempt: job.attempts,
          incident,
          message: error.message,
        });
      } else {
        const failure = new OracleWorkerFailure(
          job.filePath,
          job.attempts,
          incident,
          error.message,
        );
        job.reject(failure);
        this.#emit({
          type: "failed",
          jobId: job.id,
          filePath: job.filePath,
          attempt: job.attempts,
          incident,
          message: failure.message,
        });
      }
    }
    void slot.worker.terminate();
    if (!this.#closed) {
      this.#slots[slotIndex] = this.#createSlot();
      this.#dispatch();
    }
  }

  async #recycleCanceledWorker(slot: WorkerSlot): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, cancellationGraceMs));
    const slotIndex = this.#slots.indexOf(slot);
    if (slotIndex < 0 || this.#closed) return;
    await slot.worker.terminate();
    if (this.#closed) return;
    const currentIndex = this.#slots.indexOf(slot);
    if (currentIndex < 0) return;
    this.#slots[currentIndex] = this.#createSlot();
    this.#dispatch();
  }

  #dispatch(): void {
    if (this.#closed) return;
    for (const slot of this.#slots) {
      if (slot.activeJob || slot.recycling) continue;
      while (!slot.activeJob && this.#queue.length > 0) {
        const job = this.#queue.shift();
        if (!job) break;
        if (job.signal?.aborted) {
          job.signal.removeEventListener("abort", job.abort);
          job.reject(new Error("Audio analysis canceled."));
          continue;
        }
        slot.activeJob = job;
        job.attempts += 1;
        job.startedAt = Date.now();
        this.#emit({
          type: "started",
          jobId: job.id,
          filePath: job.filePath,
          attempt: job.attempts,
        });
        job.watchdog = setTimeout(() => {
          if (slot.activeJob !== job || this.#closed) return;
          this.#replaceFailedWorker(
            slot,
            "timeout",
            new Error(
              `Oracle analysis did not return within ${Math.ceil(this.#jobTimeoutMs / 1_000)} seconds.`,
            ),
          );
        }, this.#jobTimeoutMs);
        job.watchdog.unref();
        const request: OracleWorkerRequest = {
          type: "analyze",
          jobId: job.id,
          filePath: job.filePath,
        };
        slot.worker.postMessage(request);
      }
    }
  }

  #clearWatchdog(job: QueuedJob): void {
    if (!job.watchdog) return;
    clearTimeout(job.watchdog);
    job.watchdog = null;
  }

  #emit(event: OracleWorkerEvent): void {
    try {
      this.#onEvent?.(event);
    } catch {
      // Observability must never affect worker scheduling.
    }
  }
}
