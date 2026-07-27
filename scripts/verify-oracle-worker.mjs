import path from "node:path";
import { promises as fs } from "node:fs";
import { OracleWorkerPool } from "../dist-electron/electron/oracle/oracle-worker-pool.js";
import { runComparisonWorker } from "../dist-electron/electron/oracle/comparison-worker-client.js";
import { AuditStorageClient } from "../dist-electron/electron/storage/audit-storage-client.js";

const pool = new OracleWorkerPool(
  path.resolve("dist-electron/electron/oracle/oracle-worker.js"),
  1,
);
let oracleResult;

try {
  const result = await pool.analyze(
    path.resolve("tests/fixtures/audio-engine/reference.flac"),
  );
  if (
    !result.measurements ||
    result.measurements.frames <= 0 ||
    result.measurements.spectrogram.channelMode !==
      "per-channel power average" ||
    result.measurements.waveform?.mix !== "per-channel envelope"
  ) {
    throw new Error("The compiled Oracle worker returned incomplete evidence.");
  }
  process.stdout.write(
    `Oracle worker verified: ${result.measurements.frames.toLocaleString()} decoded frames\n`,
  );
  oracleResult = result;
} finally {
  await pool.close();
}

const referencePath = path.resolve(
  "tests/fixtures/audio-engine/reference.flac",
);
const comparison = await runComparisonWorker(
  path.resolve("dist-electron/electron/oracle/comparison-worker.js"),
  referencePath,
  referencePath,
);
if (
  comparison.relationship !== "aligned-equivalent" ||
  comparison.sampleCorrelation < 0.999
) {
  throw new Error("The compiled comparison worker failed identity alignment.");
}
process.stdout.write(
  `Comparison worker verified: ${comparison.sampleCorrelation.toFixed(6)} correlation\n`,
);

const storagePath = path.resolve(
  `tests/.tmp-storage-worker-${process.pid}.sqlite3`,
);
const storageReportPath = path.resolve(
  `tests/.tmp-storage-worker-${process.pid}.json`,
);
const storage = new AuditStorageClient(
  path.resolve("dist-electron/electron/storage/storage-worker.js"),
  storagePath,
);
try {
  const sessionId = await storage.create({
    kind: "files",
    label: "Worker verification",
    paths: [referencePath],
  });
  await storage.markDiscovered(sessionId, 1, []);
  const record = {
    id: "worker-verification",
    path: referencePath,
    name: path.basename(referencePath),
    extension: "FLAC",
    sizeBytes: 0,
    durationSeconds: oracleResult.measurements.durationSeconds,
    codec: "FLAC",
    container: "FLAC",
    codecProfile: null,
    encoder: null,
    lossless: true,
    bitrate: null,
    overallFileBitrate: null,
    sampleRate: oracleResult.measurements.sampleRate,
    bitDepth: oracleResult.technical?.bitsPerRawSample ?? null,
    channels: oracleResult.measurements.channels,
    channelMode: oracleResult.technical?.channelLayout ?? null,
    bitrateMode: null,
    scanError: null,
    oracle: oracleResult,
  };
  await storage.storeFiles(sessionId, [
    { file: record, ordinal: 0, fromCache: false },
  ]);
  await storage.finish(sessionId, "completed", []);
  const restored = await storage.getSession(sessionId);
  if (restored?.completedCount !== 1 || restored.files[0]?.id !== record.id) {
    throw new Error("The compiled storage worker failed session persistence.");
  }
  await storage.exportSessionReport(sessionId, "json", storageReportPath);
  const exported = JSON.parse(await fs.readFile(storageReportPath, "utf8"));
  if (exported.files?.[0]?.id !== record.id) {
    throw new Error("The storage worker failed streaming report export.");
  }
  process.stdout.write("Storage worker verified: 1 durable record\n");
} finally {
  await storage.close();
  await Promise.all(
    ["", "-shm", "-wal"].map((suffix) =>
      fs.rm(`${storagePath}${suffix}`, { force: true }),
    ),
  );
  await fs.rm(storageReportPath, { force: true });
}
