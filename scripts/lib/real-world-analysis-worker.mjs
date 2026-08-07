import { parentPort } from "node:worker_threads";
import { analyzeAudioFile } from "../../dist-electron/electron/oracle/oracle-engine.js";

if (!parentPort) {
  throw new Error("Real-world analysis worker requires a parent thread.");
}

parentPort.on("message", async (filePath) => {
  try {
    const result = await analyzeAudioFile(filePath);
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    });
  }
});
