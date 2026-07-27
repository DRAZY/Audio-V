import { describe, expect, it } from "vitest";
import { resolveAnalysisResourcePolicy } from "../shared/analysis-resource-policy";

describe("resolveAnalysisResourcePolicy", () => {
  it("clamps independently maximized controls to an aggregate system budget", () => {
    const resolved = resolveAnalysisResourcePolicy(
      {
        concurrency: 4,
        workerMemoryMb: 512,
        ffmpegThreads: 4,
        nativeProcessMemoryMb: 2048,
      },
      36 * 1024 * 1024 * 1024,
      18,
    );

    expect(resolved.adjusted).toBe(true);
    expect(resolved.aggregateMemoryCeilingMb).toBeLessThanOrEqual(
      resolved.systemBudgetMb,
    );
    expect(resolved.aggregateThreadCeiling).toBeLessThanOrEqual(13);
    expect(resolved.limits).toEqual({
      concurrency: 4,
      workerMemoryMb: 512,
      ffmpegThreads: 2,
      nativeProcessMemoryMb: 256,
    });
  });

  it("reduces concurrency when a low-memory system cannot support the minimum per-file budget", () => {
    const resolved = resolveAnalysisResourcePolicy(
      {
        concurrency: 4,
        workerMemoryMb: 512,
        ffmpegThreads: 4,
        nativeProcessMemoryMb: 2048,
      },
      8 * 1024 * 1024 * 1024,
      8,
    );

    expect(resolved.limits.concurrency).toBe(2);
    expect(resolved.aggregateMemoryCeilingMb).toBeLessThanOrEqual(
      resolved.systemBudgetMb,
    );
  });
});
