import path from "node:path";
import { promises as fs } from "node:fs";
import type {
  AcceptanceRunEvidence,
  AnalysisResourceLimits,
  AuditStorageStatus,
  AudioFileRecord,
  AudioSourceSelection,
} from "../shared/contracts";

export interface AcceptanceProcessSample {
  type: string;
  workingSetBytes: number;
}

export interface AcceptanceRunContext {
  sessionId: string;
  startedAt: string;
  applicationVersion: string;
  packaged: boolean;
  platform: NodeJS.Platform;
  architecture: string;
  operatingSystemRelease: string;
  logicalCpuCount: number;
  totalMemoryBytes: number;
  source: AudioSourceSelection;
  sourceStorageKind:
    | "local"
    | "network"
    | "removable-or-mounted"
    | "mixed";
  resourceLimits: AnalysisResourceLimits;
  storageBefore: AuditStorageStatus | null;
}

function increment(
  record: Record<string, number>,
  key: string,
): void {
  record[key] = (record[key] ?? 0) + 1;
}

export class AcceptanceRunRecorder {
  readonly #context: AcceptanceRunContext;
  #discoveredCount = 0;
  #completedCount = 0;
  #completedPaths = new Set<string>();
  #completedBytes = 0;
  #cacheHitCount = 0;
  #analysisErrorCount = 0;
  #verdicts: Record<string, number> = {};
  #failureStages: Record<string, number> = {};
  #peakTotalWorkingSetBytes = 0;
  #peakMainRssBytes = 0;
  #peakWorkingSetByProcessType: Record<string, number> = {};
  #sampleCount = 0;
  #cancellationRequestedAt: string | null = null;

  constructor(context: AcceptanceRunContext) {
    this.#context = context;
  }

  recordDiscovery(count: number): void {
    this.#discoveredCount = Math.max(this.#discoveredCount, count);
  }

  recordFile(file: AudioFileRecord, fromCache: boolean): void {
    const normalizedPath = path.resolve(file.path);
    if (this.#completedPaths.has(normalizedPath)) return;
    this.#completedPaths.add(normalizedPath);
    this.#completedCount += 1;
    this.#completedBytes += Math.max(0, file.sizeBytes);
    if (fromCache) this.#cacheHitCount += 1;
    if (file.oracle.analysisState === "error") this.#analysisErrorCount += 1;
    increment(this.#verdicts, file.oracle.verdict);
    if (file.oracle.failure?.stage) {
      increment(this.#failureStages, file.oracle.failure.stage);
    }
  }

  sampleProcesses(
    processes: AcceptanceProcessSample[],
    mainRssBytes: number,
  ): void {
    const byType: Record<string, number> = {};
    let total = 0;
    for (const process of processes) {
      const bytes = Math.max(0, process.workingSetBytes);
      total += bytes;
      byType[process.type] = (byType[process.type] ?? 0) + bytes;
    }
    this.#sampleCount += 1;
    this.#peakTotalWorkingSetBytes = Math.max(
      this.#peakTotalWorkingSetBytes,
      total,
    );
    this.#peakMainRssBytes = Math.max(
      this.#peakMainRssBytes,
      Math.max(0, mainRssBytes),
    );
    for (const [type, bytes] of Object.entries(byType)) {
      this.#peakWorkingSetByProcessType[type] = Math.max(
        this.#peakWorkingSetByProcessType[type] ?? 0,
        bytes,
      );
    }
  }

  requestCancellation(at = new Date().toISOString()): void {
    this.#cancellationRequestedAt ??= at;
  }

  finish(
    status: AcceptanceRunEvidence["status"],
    storageAfter: AuditStorageStatus | null,
    finishedAt = new Date().toISOString(),
  ): AcceptanceRunEvidence {
    const elapsedMilliseconds = Math.max(
      0,
      Date.parse(finishedAt) - Date.parse(this.#context.startedAt),
    );
    const cancellationLatencyMilliseconds = this.#cancellationRequestedAt
      ? Math.max(
          0,
          Date.parse(finishedAt) -
            Date.parse(this.#cancellationRequestedAt),
        )
      : null;
    return {
      schema: "Audio-V acceptance run evidence v1",
      sessionId: this.#context.sessionId,
      status,
      startedAt: this.#context.startedAt,
      finishedAt,
      application: {
        version: this.#context.applicationVersion,
        packaged: this.#context.packaged,
        platform: this.#context.platform,
        architecture: this.#context.architecture,
      },
      system: {
        operatingSystemRelease: this.#context.operatingSystemRelease,
        logicalCpuCount: this.#context.logicalCpuCount,
        totalMemoryBytes: this.#context.totalMemoryBytes,
      },
      source: {
        kind: this.#context.source.kind,
        mode: this.#context.source.mode ?? "full-audit",
        storageKind: this.#context.sourceStorageKind,
        pathCount: this.#context.source.paths.length,
        externalIdentityEnabled:
          this.#context.source.externalLookup?.acoustIdEnabled === true,
        musicBrainzEnabled:
          this.#context.source.externalLookup?.musicBrainzEnabled === true,
      },
      workload: {
        discoveredCount: this.#discoveredCount,
        completedCount: this.#completedCount,
        completedBytes: this.#completedBytes,
        cacheHitCount: this.#cacheHitCount,
        analysisErrorCount: this.#analysisErrorCount,
        verdicts: this.#verdicts,
        failureStages: this.#failureStages,
      },
      timing: {
        elapsedMilliseconds,
        filesPerMinute:
          elapsedMilliseconds > 0
            ? (this.#completedCount * 60_000) / elapsedMilliseconds
            : 0,
        cancellationRequestedAt: this.#cancellationRequestedAt,
        cancellationLatencyMilliseconds,
      },
      resources: {
        requestedAndEffectiveLimits: this.#context.resourceLimits,
        sampleIntervalMilliseconds: 500,
        sampleCount: this.#sampleCount,
        peakTotalWorkingSetBytes: this.#peakTotalWorkingSetBytes,
        peakMainRssBytes: this.#peakMainRssBytes,
        peakWorkingSetByProcessType:
          this.#peakWorkingSetByProcessType,
      },
      storage: {
        before: this.#context.storageBefore,
        after: storageAfter,
        databaseGrowthBytes:
          this.#context.storageBefore && storageAfter
            ? storageAfter.databaseBytes -
              this.#context.storageBefore.databaseBytes
            : null,
      },
      recovery: {
        strategy: this.#context.source.recovery?.strategy ?? null,
        attempt: this.#context.source.recovery?.attempt ?? 0,
        safeCandidateCount:
          this.#context.source.recovery?.safeCandidatePaths.length ?? 0,
        quarantinedCandidateCount:
          this.#context.source.recovery?.quarantinedCandidatePaths.length ?? 0,
      },
      privacy:
        "No filenames, source paths, hashes, tags, audio evidence, or external-service credentials are included.",
      limitations: [
        "Working-set measurements are sampled at 500 ms intervals and may not capture a shorter transient peak.",
        "Process working sets can include shared pages; their sum is an operational high-water indicator, not a billing or physical-memory accounting value.",
        "A completed run establishes behavior for this package, platform, hardware, source, and workload; it is not universal performance proof.",
      ],
    };
  }
}

export class AcceptanceRunStore {
  readonly #filePath: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async load(): Promise<AcceptanceRunEvidence | null> {
    try {
      const parsed = JSON.parse(
        await fs.readFile(this.#filePath, "utf8"),
      ) as AcceptanceRunEvidence;
      return parsed.schema === "Audio-V acceptance run evidence v1"
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  async save(evidence: AcceptanceRunEvidence): Promise<void> {
    const write = this.#writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.#filePath), { recursive: true });
      const temporaryPath = `${this.#filePath}.${process.pid}.tmp`;
      await fs.writeFile(
        temporaryPath,
        `${JSON.stringify(evidence, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      await fs.rename(temporaryPath, this.#filePath);
      await fs.chmod(this.#filePath, 0o600).catch(() => undefined);
    });
    this.#writeQueue = write.catch(() => undefined);
    await write;
  }
}
