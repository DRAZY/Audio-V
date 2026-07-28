const fs = require("node:fs");
const { parentPort, workerData } = require("node:worker_threads");

const marker = `${workerData.databasePath}.worker-restarted`;
const firstWorker = !fs.existsSync(marker);
if (firstWorker) fs.writeFileSync(marker, "restart required\n");

parentPort.on("message", (request) => {
  if (firstWorker) return;
  const values = {
    "list-sessions": [],
    close: true,
  };
  parentPort.postMessage({
    id: request.id,
    ok: true,
    value: values[request.operation],
  });
});
