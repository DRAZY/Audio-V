const { parentPort } = require("node:worker_threads");

parentPort.on("message", (request) => {
  if (request.type !== "analyze") return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000);
});
