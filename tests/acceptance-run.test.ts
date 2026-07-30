import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AcceptanceRunRecorder,
  AcceptanceRunStore,
} from "../electron/acceptance-run";
import type { AudioFileRecord } from "../shared/contracts";

let temporaryDirectory = "";

afterEach(async () => {
  if (temporaryDirectory) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = "";
  }
});

describe("acceptance run evidence", () => {
  it("records workload, sampled peaks, cancellation, and storage without paths", async () => {
    const recorder = new AcceptanceRunRecorder({
      sessionId: "00000000-0000-4000-8000-000000000001",
      startedAt: "2026-07-29T20:00:00.000Z",
      applicationVersion: "0.4.34",
      packaged: true,
      platform: "darwin",
      architecture: "arm64",
      operatingSystemRelease: "25.5.0",
      logicalCpuCount: 12,
      totalMemoryBytes: 32 * 1024 ** 3,
      source: {
        kind: "folder",
        paths: ["/Volumes/Private Music"],
        label: "/Volumes/Private Music",
        mode: "full-audit",
        resourceLimits: {
          concurrency: 4,
          workerMemoryMb: 256,
          ffmpegThreads: 2,
          nativeProcessMemoryMb: 1024,
        },
      },
      sourceStorageKind: "removable-or-mounted",
      resourceLimits: {
        concurrency: 4,
        workerMemoryMb: 256,
        ffmpegThreads: 2,
        nativeProcessMemoryMb: 1024,
      },
      storageBefore: {
        databaseBytes: 100,
        liveBytes: 80,
        reclaimableBytes: 20,
        autoVacuum: "incremental",
        optimizationRecommended: false,
      },
    });
    recorder.recordDiscovery(2);
    recorder.recordFile(
      {
        path: "/Volumes/Private Music/secret.flac",
        sizeBytes: 1_000,
        oracle: {
          analysisState: "completed",
          verdict: "verified",
          failure: null,
        },
      } as AudioFileRecord,
      false,
    );
    recorder.sampleProcesses(
      [
        { type: "Browser", workingSetBytes: 100 },
        { type: "Utility", workingSetBytes: 200 },
      ],
      90,
    );
    recorder.requestCancellation("2026-07-29T20:00:01.000Z");
    const evidence = recorder.finish(
      "canceled",
      {
        databaseBytes: 150,
        liveBytes: 130,
        reclaimableBytes: 20,
        autoVacuum: "incremental",
        optimizationRecommended: false,
      },
      "2026-07-29T20:00:01.250Z",
    );
    const serialized = JSON.stringify(evidence);

    expect(evidence.workload).toMatchObject({
      discoveredCount: 2,
      completedCount: 1,
      completedBytes: 1_000,
    });
    expect(evidence.timing.cancellationLatencyMilliseconds).toBe(250);
    expect(evidence.resources.peakTotalWorkingSetBytes).toBe(300);
    expect(evidence.storage.databaseGrowthBytes).toBe(50);
    expect(serialized).not.toContain("Private Music");
    expect(serialized).not.toContain("secret.flac");
  });

  it("persists and restores the latest acceptance record", async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(process.cwd(), "tests", ".tmp-acceptance-run-"),
    );
    const store = new AcceptanceRunStore(
      path.join(temporaryDirectory, "latest.json"),
    );
    const recorder = new AcceptanceRunRecorder({
      sessionId: "00000000-0000-4000-8000-000000000002",
      startedAt: "2026-07-29T20:00:00.000Z",
      applicationVersion: "0.4.34",
      packaged: false,
      platform: "win32",
      architecture: "x64",
      operatingSystemRelease: "10.0.26100",
      logicalCpuCount: 16,
      totalMemoryBytes: 16 * 1024 ** 3,
      source: {
        kind: "files",
        paths: ["Z:\\track.wav"],
        label: "Z:\\track.wav",
      },
      sourceStorageKind: "removable-or-mounted",
      resourceLimits: {
        concurrency: 2,
        workerMemoryMb: 256,
        ffmpegThreads: 2,
        nativeProcessMemoryMb: 1024,
      },
      storageBefore: null,
    });
    const evidence = recorder.finish(
      "completed",
      null,
      "2026-07-29T20:00:02.000Z",
    );

    await store.save(evidence);

    await expect(store.load()).resolves.toEqual(evidence);
  });
});
