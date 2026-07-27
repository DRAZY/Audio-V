import { parentPort } from "node:worker_threads";
import { compareAudioFiles } from "./signal-comparison";

const port = parentPort;
if (!port) throw new Error("The comparison worker requires a parent port.");

const controller = new AbortController();
port.once(
  "message",
  (request: { leftPath: string; rightPath: string } | { cancel: true }) => {
    if ("cancel" in request) {
      controller.abort();
      return;
    }
    void compareAudioFiles(
      request.leftPath,
      request.rightPath,
      controller.signal,
    )
      .then((result) => port.postMessage({ ok: true, result }))
      .catch((error: unknown) =>
        port.postMessage({
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Signal comparison failed.",
        }),
      );
  },
);
