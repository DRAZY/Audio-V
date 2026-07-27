import { promises as fs } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { AuditSessionStore } from "../dist-electron/electron/audit-session-store.js";

const counts = [100, 1_000, 10_000];
const outputPath = path.resolve("build/performance-latest.json");
const databasePath = path.resolve(
  `tests/.tmp-scale-benchmark-${process.pid}.sqlite3`,
);
const budgets = {
  100: { persistMs: 1_000, restoreMs: 500 },
  1000: { persistMs: 3_000, restoreMs: 1_000 },
  10000: { persistMs: 15_000, restoreMs: 4_000 },
};

function syntheticRecord(index) {
  const id = index.toString().padStart(6, "0");
  return {
    id: `benchmark-${id}`,
    path: `/benchmark/library/track-${id}.flac`,
    name: `track-${id}.flac`,
    extension: "FLAC",
    sizeBytes: 30_000_000 + index,
    durationSeconds: 240,
    codec: "FLAC",
    container: "FLAC",
    codecProfile: null,
    encoder: null,
    lossless: true,
    bitrate: 1_000_000,
    overallFileBitrate: 1_000_000,
    sampleRate: 96_000,
    bitDepth: 24,
    channels: 2,
    channelMode: "stereo",
    bitrateMode: null,
    scanError: null,
    oracle: {
      schemaVersion: 1,
      engineVersion: "0.8.0-oracle-v10",
      scope: "oracle-integrity-forensics-v10",
      verdict: "verified",
      confidence: 100,
      headline: "Current checks passed",
      interpretation: "Synthetic scale benchmark record.",
      evidence: [],
      measurements: null,
      technical: null,
      fidelity: null,
      measuredAt: "2026-07-26T00:00:00.000Z",
    },
  };
}

const store = new AuditSessionStore(databasePath);
const results = [];
try {
  for (const count of counts) {
    const sessionId = store.create({
      kind: "folder",
      label: `${count.toLocaleString()}-file scale benchmark`,
      paths: [`/benchmark/${count}`],
    });
    store.markDiscovered(sessionId, count, []);
    const persistStart = performance.now();
    for (let offset = 0; offset < count; offset += 250) {
      const entries = Array.from(
        { length: Math.min(250, count - offset) },
        (_, localIndex) => {
          const ordinal = offset + localIndex;
          return {
            file: syntheticRecord(ordinal),
            ordinal,
            fromCache: false,
          };
        },
      );
      store.storeFiles(sessionId, entries);
    }
    store.finish(sessionId, "completed", []);
    const persistMs = performance.now() - persistStart;

    const restoreStart = performance.now();
    const restored = store.getSession(sessionId);
    const restoreMs = performance.now() - restoreStart;
    if (restored?.files.length !== count) {
      throw new Error(`Scale benchmark restored ${restored?.files.length ?? 0}/${count} files.`);
    }
    const budget = budgets[count];
    const passed =
      persistMs <= budget.persistMs && restoreMs <= budget.restoreMs;
    results.push({
      count,
      persistMs: Number(persistMs.toFixed(2)),
      restoreMs: Number(restoreMs.toFixed(2)),
      persistBudgetMs: budget.persistMs,
      restoreBudgetMs: budget.restoreMs,
      passed,
    });
  }
  const databaseBytes = (await fs.stat(databasePath)).size;
  const report = {
    schema: "Audio-V scale benchmark v1",
    measuredAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    databaseBytes,
    results,
    passed: results.every((result) => result.passed),
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
} finally {
  store.close();
  await Promise.all(
    ["", "-shm", "-wal"].map((suffix) =>
      fs.rm(`${databasePath}${suffix}`, { force: true }),
    ),
  );
}
