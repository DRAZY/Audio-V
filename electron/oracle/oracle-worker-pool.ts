import { availableParallelism } from "node:os";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { OracleResult } from "../../shared/contracts";
import type {
  OracleWorkerRequest,
  OracleWorkerResponse,
} from "./oracle-worker-protocol";

interface QueuedJob {
  id: string;
  filePath: string;
  signal?: AbortSignal;
  resolve: (result: OracleResult) => void;
  reject: (error: Error) => void;
  abort: () => void;
}

interface WorkerSlot {
  worker: Worker;
  activeJob: QueuedJob | null;
}

export class OracleWorkerPool {
  readonly #workerPath: string;
  readonly #slots: WorkerSlot[] = [];
  readonly #queue: QueuedJob[] = [];
  #closed = false;

  constructor(
    workerPath: string,
    workerCount = Math.max(1, Math.min(2, availableParallelism() - 1)),
  ) {
    if (!Number.isInteger(workerCount) || workerCount < 1) {
      throw new RangeError("Oracle worker count must be at least one.");
    }
    this.#workerPath = workerPath;
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
        resolve,
        reject,
        abort: () => {
          const queueIndex = this.#queue.indexOf(job);
          if (queueIndex >= 0) {
            this.#queue.splice(queueIndex, 1);
            signal?.removeEventListener("abort", job.abort);
            reject(new Error("Audio analysis canceled."));
            return;
          }
          const slot = this.#slots.find(
            (candidate) => candidate.activeJob === job,
          );
          if (slot) {
            const request: OracleWorkerRequest = {
              type: "cancel",
              jobId: job.id,
            };
            slot.worker.postMessage(request);
          }
        },
      };
      signal?.addEventListener("abort", job.abort, { once: true });
      this.#queue.push(job);
      this.#dispatch();
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const job of this.#queue.splice(0)) {
      job.signal?.removeEventListener("abort", job.abort);
      job.reject(new Error("The Oracle worker pool is closed."));
    }
    for (const slot of this.#slots) {
      if (slot.activeJob) {
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
      worker: new Worker(this.#workerPath),
      activeJob: null,
    };
    slot.worker.on("message", (response: OracleWorkerResponse) => {
      const job = slot.activeJob;
      if (!job || response.jobId !== job.id) return;
      slot.activeJob = null;
      job.signal?.removeEventListener("abort", job.abort);
      if (response.type === "result") {
        job.resolve(response.result);
      } else {
        const error = new Error(response.message);
        if (response.stack) error.stack = response.stack;
        job.reject(error);
      }
      this.#dispatch();
    });
    slot.worker.on("error", (error) => {
      this.#replaceFailedWorker(slot, error);
    });
    slot.worker.on("exit", (code) => {
      if (!this.#closed && code !== 0 && this.#slots.includes(slot)) {
        this.#replaceFailedWorker(
          slot,
          new Error(`Oracle worker exited with code ${code}.`),
        );
      }
    });
    return slot;
  }

  #replaceFailedWorker(slot: WorkerSlot, error: Error): void {
    const slotIndex = this.#slots.indexOf(slot);
    if (slotIndex < 0) return;
    const job = slot.activeJob;
    slot.activeJob = null;
    if (job) {
      job.signal?.removeEventListener("abort", job.abort);
      job.reject(new Error(`Oracle worker failed: ${error.message}`));
    }
    void slot.worker.terminate();
    if (!this.#closed) {
      this.#slots[slotIndex] = this.#createSlot();
      this.#dispatch();
    }
  }

  #dispatch(): void {
    if (this.#closed) return;
    for (const slot of this.#slots) {
      if (slot.activeJob) continue;
      while (!slot.activeJob && this.#queue.length > 0) {
        const job = this.#queue.shift();
        if (!job) break;
        if (job.signal?.aborted) {
          job.signal.removeEventListener("abort", job.abort);
          job.reject(new Error("Audio analysis canceled."));
          continue;
        }
        slot.activeJob = job;
        const request: OracleWorkerRequest = {
          type: "analyze",
          jobId: job.id,
          filePath: job.filePath,
        };
        slot.worker.postMessage(request);
      }
    }
  }
}
