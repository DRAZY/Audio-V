import { parentPort } from "node:worker_threads";
import { analyzeAudioFile } from "./oracle-engine";
import type {
  OracleWorkerRequest,
  OracleWorkerResponse,
} from "./oracle-worker-protocol";

const port = parentPort;
if (!port) {
  throw new Error("The Oracle analysis worker requires a parent message port.");
}

const jobs = new Map<string, AbortController>();

port.on("message", (request: OracleWorkerRequest) => {
  if (request.type === "cancel") {
    jobs.get(request.jobId)?.abort();
    return;
  }

  const controller = new AbortController();
  jobs.set(request.jobId, controller);
  void analyzeAudioFile(request.filePath, controller.signal)
    .then((result) => {
      const response: OracleWorkerResponse = {
        type: "result",
        jobId: request.jobId,
        result,
      };
      port.postMessage(response);
    })
    .catch((error: unknown) => {
      const response: OracleWorkerResponse = {
        type: "error",
        jobId: request.jobId,
        message:
          error instanceof Error ? error.message : "Oracle analysis failed.",
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      };
      port.postMessage(response);
    })
    .finally(() => {
      jobs.delete(request.jobId);
    });
});
