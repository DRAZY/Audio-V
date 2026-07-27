import { parentPort, workerData } from "node:worker_threads";
import { compareAudioFiles } from "./signal-comparison";
import { configureEngineResourcePolicy } from "./ffmpeg-runtime";
import type { ComparisonChannelMapping } from "../../shared/contracts";

const port = parentPort;
if (!port) throw new Error("The comparison worker requires a parent port.");

const controller = new AbortController();
configureEngineResourcePolicy(
  (workerData as {
    enginePolicy?: { ffmpegThreads: number; nativeProcessMemoryMb: number };
  } | null)?.enginePolicy ?? {
    ffmpegThreads: 2,
    nativeProcessMemoryMb: 1024,
  },
);
port.once(
  "message",
  (
    request:
      | {
          leftPath: string;
          rightPath: string;
          channelMapping?: ComparisonChannelMapping[];
        }
      | { cancel: true },
  ) => {
    if ("cancel" in request) {
      controller.abort();
      return;
    }
    void compareAudioFiles(
      request.leftPath,
      request.rightPath,
      controller.signal,
      request.channelMapping,
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
