import { describe, expect, it } from "vitest";
import {
  createAuditRecoveryState,
  safeRecoveryResourceLimits,
} from "../shared/audit-recovery";
import type {
  AnalysisResourceLimits,
  AudioSourceSelection,
} from "../shared/contracts";

const performanceLimits: AnalysisResourceLimits = {
  concurrency: 4,
  workerMemoryMb: 256,
  ffmpegThreads: 2,
  nativeProcessMemoryMb: 512,
};

describe("createAuditRecoveryState", () => {
  it("isolates first-time crash candidates and preserves the target settings", () => {
    const source: AudioSourceSelection = {
      kind: "folder",
      paths: ["/music"],
      label: "/music",
      resourceLimits: performanceLimits,
    };

    const recovery = createAuditRecoveryState(
      source,
      ["/music/active-a.flac", "/music/active-b.flac"],
      "adaptive-safe",
      safeRecoveryResourceLimits,
    );

    expect(recovery.safeCandidatePaths).toEqual([
      "/music/active-a.flac",
      "/music/active-b.flac",
    ]);
    expect(recovery.quarantinedCandidatePaths).toEqual([]);
    expect(recovery.targetResourceLimits).toEqual(performanceLimits);
  });

  it("quarantines only a candidate that repeats after safe validation", () => {
    const source: AudioSourceSelection = {
      kind: "folder",
      paths: ["/music"],
      label: "/music",
      resourceLimits: performanceLimits,
      recovery: {
        strategy: "adaptive-safe",
        attempt: 1,
        candidatePaths: ["/music/repeated.flac"],
        safeCandidatePaths: ["/music/repeated.flac"],
        quarantinedCandidatePaths: [],
        targetResourceLimits: performanceLimits,
      },
    };

    const recovery = createAuditRecoveryState(
      source,
      ["/music/repeated.flac", "/music/new-active.flac"],
      "adaptive-safe",
      safeRecoveryResourceLimits,
    );

    expect(recovery.safeCandidatePaths).toEqual([
      "/music/new-active.flac",
    ]);
    expect(recovery.quarantinedCandidatePaths).toEqual([
      "/music/repeated.flac",
    ]);
    expect(recovery.attempt).toBe(2);
  });

  it("honors an explicit request to resume with prior settings", () => {
    const source: AudioSourceSelection = {
      kind: "folder",
      paths: ["/music"],
      label: "/music",
      resourceLimits: performanceLimits,
    };

    const recovery = createAuditRecoveryState(
      source,
      ["/music/active.flac"],
      "previous-settings",
      safeRecoveryResourceLimits,
    );

    expect(recovery.safeCandidatePaths).toEqual([]);
    expect(recovery.quarantinedCandidatePaths).toEqual([]);
    expect(recovery.targetResourceLimits).toEqual(performanceLimits);
  });
});
