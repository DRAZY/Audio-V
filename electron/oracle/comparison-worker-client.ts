import { Worker } from "node:worker_threads";
import type { AnalysisResourceLimits, DecodedSignalComparison } from "../../shared/contracts";

export async function runComparisonWorker(
  workerPath: string,
  leftPath: string,
  rightPath: string,
  enginePolicy: Pick<AnalysisResourceLimits, "ffmpegThreads" | "nativeProcessMemoryMb">,
  signal?: AbortSignal,
): Promise<DecodedSignalComparison> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Signal comparison canceled."));
      return;
    }
    const worker = new Worker(workerPath, { workerData: { enginePolicy } });
    let settled = false;
    const finish = (
      outcome:
        | { ok: true; result: DecodedSignalComparison }
        | { ok: false; error: Error },
    ) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      void worker.terminate();
      if (outcome.ok) resolve(outcome.result);
      else reject(outcome.error);
    };
    const abort = () => {
      worker.postMessage({ cancel: true });
      finish({ ok: false, error: new Error("Signal comparison canceled.") });
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.on(
      "message",
      (
        response:
          | { ok: true; result: DecodedSignalComparison }
          | { ok: false; message: string },
      ) => {
        if (response.ok) finish(response);
        else finish({ ok: false, error: new Error(response.message) });
      },
    );
    worker.on("error", (error) => finish({ ok: false, error }));
    worker.on("exit", (code) => {
      if (!settled && code !== 0) {
        finish({
          ok: false,
          error: new Error(`Comparison worker exited with code ${code}.`),
        });
      }
    });
    worker.postMessage({ leftPath, rightPath });
  });
}
