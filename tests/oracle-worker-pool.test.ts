import path from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { OracleWorkerPool } from "../electron/oracle/oracle-worker-pool";

describe("OracleWorkerPool cancellation", () => {
  it("rejects promptly even when a worker cannot process its cancel message", async () => {
    const pool = new OracleWorkerPool(
      path.join(process.cwd(), "tests/fixtures/blocking-oracle-worker.cjs"),
      1,
      128,
      { ffmpegThreads: 1, nativeProcessMemoryMb: 256 },
    );
    const controller = new AbortController();
    const startedAt = performance.now();
    const analysis = pool.analyze("/tmp/blocked-audio.wav", controller.signal);
    setTimeout(() => controller.abort(), 50);

    await expect(analysis).rejects.toThrow(/canceled/i);
    expect(performance.now() - startedAt).toBeLessThan(300);
    await pool.close();
  });
});
