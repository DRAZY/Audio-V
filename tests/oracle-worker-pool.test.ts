import path from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { OracleWorkerPool } from "../electron/oracle/oracle-worker-pool";
import { OracleWorkerFailure } from "../electron/oracle/oracle-worker-pool";
import type { OracleWorkerEvent } from "../electron/oracle/oracle-worker-pool";

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

  it("recycles a silent worker once and rejects instead of hanging forever", async () => {
    const events: OracleWorkerEvent[] = [];
    const pool = new OracleWorkerPool(
      path.join(process.cwd(), "tests/fixtures/blocking-oracle-worker.cjs"),
      1,
      128,
      { ffmpegThreads: 1, nativeProcessMemoryMb: 256 },
      100,
      (event) => events.push(event),
    );
    const startedAt = performance.now();

    const failure = await pool
      .analyze("/tmp/permanently-stalled.wav")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OracleWorkerFailure);
    expect(failure).toMatchObject({
      code: "ORACLE_WORKER_TIMEOUT",
      incident: "timeout",
      attempts: 2,
      filePath: "/tmp/permanently-stalled.wav",
    });
    expect(performance.now() - startedAt).toBeLessThan(1_000);
    expect(events.map((event) => event.type)).toEqual([
      "queued",
      "started",
      "retrying",
      "started",
      "failed",
    ]);
    await pool.close();
  });
});
