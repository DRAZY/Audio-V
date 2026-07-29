import path from "node:path";
import { promises as fs } from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type {
  AnalysisResourceLimits,
  AuditHistoryCleanupProgress,
  AudioFileRecord,
  AudioSourceSelection,
  AuditResumeStrategy,
  OracleValidationStatus,
  ReportExportRequest,
  ScanProgressUpdate,
} from "../shared/contracts";
import {
  createUserReview,
  isUserReviewDisposition,
} from "../shared/user-review";
import { AUDIO_EXTENSIONS } from "../shared/contracts";
import { createTruePeakSafeCopy } from "./repair-engine";
import { scanSources } from "./scanner";
import type { OracleRecordCache } from "./scanner";
import { compactReportFile, writeAuditReport } from "./report-exporter";
import type { ReportExportFormat } from "../shared/contracts";
import { OracleWorkerPool } from "./oracle/oracle-worker-pool";
import {
  OracleWorkerFailure,
  type OracleWorkerEvent,
} from "./oracle/oracle-worker-pool";
import { oracleFailureResult } from "./oracle/oracle-engine";
import { runComparisonWorker } from "./oracle/comparison-worker-client";
import { AuditStorageClient } from "./storage/audit-storage-client";
import { createPrivacySafeDiagnostics } from "./diagnostics";
import { inspectSpectrogram } from "./oracle/spectrogram-inspector";
import { configureEngineResourcePolicy } from "./oracle/ffmpeg-runtime";
import { normalizeSourcePath, sourcePathKey } from "./source-path";
import { resolveAnalysisResourcePolicy } from "../shared/analysis-resource-policy";
import {
  createAuditRecoveryState,
  safeRecoveryResourceLimits,
} from "../shared/audit-recovery";
import { ApplicationLogger } from "./application-logger";
import {
  normalizeAcoustIdApiKey,
  validateAcoustIdApiKey,
} from "./oracle/analysis-tools";

const approvedSelections = new Map<string, AudioSourceSelection>();
const approvedAudioFiles = new Set<string>();
const authoritativeRecords = new Map<string, AudioFileRecord>();
const maximumResidentAuthoritativeRecords = 16;

function rememberAuthoritativeRecord(file: AudioFileRecord): void {
  const normalizedPath = path.resolve(file.path);
  authoritativeRecords.delete(normalizedPath);
  authoritativeRecords.set(normalizedPath, file);
  while (authoritativeRecords.size > maximumResidentAuthoritativeRecords) {
    const oldestPath = authoritativeRecords.keys().next().value as
      | string
      | undefined;
    if (!oldestPath) break;
    authoritativeRecords.delete(oldestPath);
  }
}
const audioDialogFilters = [
  {
    name: "Audio files",
    extensions: AUDIO_EXTENSIONS.map((extension) => extension.slice(1)),
  },
];
const developmentUrl = process.env.VITE_DEV_SERVER_URL;
let activeScanController: AbortController | null = null;
let activeScanPause: ScanPauseGate | null = null;
let activeScanSessionId: string | null = null;
let oracleCache: OracleRecordCache;
let oracleWorkers: OracleWorkerPool;
let auditSessions: AuditStorageClient;
let activeComparisonController: AbortController | null = null;
let historyCleanupTimer: NodeJS.Timeout | null = null;
let historyCleanupRunning = false;
let historyCleanupDeletedFiles = 0;
let historyCleanupDeletedSessions = 0;
const defaultResourceLimits = resolveAnalysisResourcePolicy(
  {
    concurrency: Math.max(
      1,
      Math.min(4, Math.floor(availableParallelism() / 4)),
    ) as AnalysisResourceLimits["concurrency"],
    workerMemoryMb: 256,
    ffmpegThreads: 2,
    nativeProcessMemoryMb: 1024,
  },
  totalmem(),
  availableParallelism(),
).limits;
let currentResourceLimits = defaultResourceLimits;
let applicationLogger: ApplicationLogger | null = null;
const validatedAcoustIdApiKeys = new Set<string>();

function logApplication(
  level: "debug" | "info" | "warn" | "error",
  event: string,
  data?: Record<string, unknown>,
): void {
  applicationLogger?.log(level, event, data);
}

async function ensureValidatedAcoustIdApiKey(
  requestedKey: string,
): Promise<string> {
  const normalized = normalizeAcoustIdApiKey(requestedKey);
  if (validatedAcoustIdApiKeys.has(normalized)) return normalized;
  try {
    await validateAcoustIdApiKey(normalized);
    validatedAcoustIdApiKeys.add(normalized);
    logApplication("info", "acoustid.preflight-succeeded");
    return normalized;
  } catch (error) {
    logApplication("warn", "acoustid.preflight-failed", { error });
    throw error;
  }
}

function logOracleWorkerEvent(event: OracleWorkerEvent): void {
  logApplication(
    event.type === "failed"
      ? "error"
      : event.type === "retrying"
        ? "warn"
        : event.type === "completed"
          ? "debug"
          : "info",
    `oracle-worker.${event.type}`,
    { ...event },
  );
}

function sendHistoryCleanupProgress(
  progress: AuditHistoryCleanupProgress,
): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("sessions:cleanup-progress", progress);
    }
  }
}

function scheduleHistoryCleanup(delayMs = 50): void {
  if (historyCleanupRunning || historyCleanupTimer) return;
  historyCleanupTimer = setTimeout(() => {
    historyCleanupTimer = null;
    void runHistoryCleanupBatch();
  }, delayMs);
  historyCleanupTimer.unref();
}

async function runHistoryCleanupBatch(): Promise<void> {
  if (historyCleanupRunning) return;
  historyCleanupRunning = true;
  let shouldContinue = false;
  try {
    const result = await auditSessions.purgeHiddenHistoryBatch(50);
    historyCleanupDeletedFiles += result.deletedFiles;
    historyCleanupDeletedSessions += result.deletedSessions;
    if (
      result.remainingSessions > 0 ||
      result.deletedFiles > 0 ||
      result.deletedSessions > 0
    ) {
      const progress: AuditHistoryCleanupProgress = {
        state: result.remainingSessions > 0 ? "cleaning" : "complete",
        deletedFiles: historyCleanupDeletedFiles,
        deletedSessions: historyCleanupDeletedSessions,
        remainingSessions: result.remainingSessions,
        explanation:
          result.remainingSessions > 0
            ? "History is already clear. Audio-V is reclaiming its saved session records in small background batches."
            : "History cleanup finished. Source audio, reusable Oracle cache, and Identity fingerprints were not changed.",
      };
      sendHistoryCleanupProgress(progress);
      logApplication(
        progress.state === "complete" ? "info" : "debug",
        `audit-history.cleanup-${progress.state}`,
        { ...progress },
      );
    }
    shouldContinue = result.remainingSessions > 0;
    if (!shouldContinue) {
      historyCleanupDeletedFiles = 0;
      historyCleanupDeletedSessions = 0;
    }
  } catch (error) {
    const progress: AuditHistoryCleanupProgress = {
      state: "failed",
      deletedFiles: historyCleanupDeletedFiles,
      deletedSessions: historyCleanupDeletedSessions,
      remainingSessions: -1,
      explanation:
        "The history list is clear, but background storage cleanup paused. Restarting Audio-V will resume it safely.",
    };
    sendHistoryCleanupProgress(progress);
    logApplication("error", "audit-history.cleanup-failed", {
      ...progress,
      error,
    });
  } finally {
    historyCleanupRunning = false;
    if (shouldContinue) scheduleHistoryCleanup(25);
  }
}

async function analyzeWithWorkerIsolation(
  filePath: string,
  signal?: AbortSignal,
): Promise<ReturnType<typeof oracleFailureResult>> {
  try {
    return await oracleWorkers.analyze(filePath, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (!(error instanceof OracleWorkerFailure)) throw error;
    logApplication("error", "scan.file-infrastructure-error", {
      filePath,
      code: error.code,
      incident: error.incident,
      attempts: error.attempts,
      error,
    });
    return oracleFailureResult(error);
  }
}

function sameResourceLimits(
  left: AnalysisResourceLimits,
  right: AnalysisResourceLimits,
): boolean {
  return (
    left.concurrency === right.concurrency &&
    left.workerMemoryMb === right.workerMemoryMb &&
    left.ffmpegThreads === right.ffmpegThreads &&
    left.nativeProcessMemoryMb === right.nativeProcessMemoryMb
  );
}

async function applyOracleResourceLimits(
  limits: AnalysisResourceLimits,
): Promise<void> {
  if (sameResourceLimits(limits, currentResourceLimits)) return;
  await oracleWorkers.close();
  oracleWorkers = new OracleWorkerPool(
    path.join(__dirname, "oracle", "oracle-worker.js"),
    limits.concurrency,
    limits.workerMemoryMb,
    limits,
    undefined,
    logOracleWorkerEvent,
  );
  configureEngineResourcePolicy(limits);
  currentResourceLimits = limits;
}

class ScanPauseGate {
  #paused = false;
  #resume: (() => void) | null = null;

  get paused(): boolean {
    return this.#paused;
  }

  pause(): boolean {
    if (this.#paused) return false;
    this.#paused = true;
    return true;
  }

  resume(): boolean {
    if (!this.#paused) return false;
    this.#paused = false;
    this.#resume?.();
    this.#resume = null;
    return true;
  }

  async wait(signal: AbortSignal): Promise<void> {
    if (!this.#paused) return;
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        this.#resume = null;
        reject(new Error("Audio analysis canceled."));
      };
      this.#resume = () => {
        signal.removeEventListener("abort", abort);
        resolve();
      };
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}

class SessionPersistenceBuffer {
  readonly #storage: AuditStorageClient;
  readonly #sessionId: string;
  readonly #entries: Array<{
    file: AudioFileRecord;
    ordinal: number;
    fromCache: boolean;
  }> = [];
  #timer: NodeJS.Timeout | null = null;
  #inFlight: Promise<void> = Promise.resolve();
  #failure: Error | null = null;
  readonly #onStatus?: (
    state: "queued" | "writing" | "saved" | "stalled",
    pendingFiles: number,
  ) => void;

  constructor(
    storage: AuditStorageClient,
    sessionId: string,
    onStatus?: (
      state: "queued" | "writing" | "saved" | "stalled",
      pendingFiles: number,
    ) => void,
  ) {
    this.#storage = storage;
    this.#sessionId = sessionId;
    this.#onStatus = onStatus;
  }

  add(
    file: AudioFileRecord,
    ordinal: number,
    fromCache: boolean,
  ): void | Promise<void> {
    if (this.#failure) return Promise.reject(this.#failure);
    this.#entries.push({ file, ordinal, fromCache });
    this.#onStatus?.("queued", this.#entries.length);
    if (this.#entries.length >= 25) {
      return this.flush();
    }
    if (!this.#timer) {
      this.#timer = setTimeout(() => {
        this.#timer = null;
        void this.flush().catch(() => undefined);
      }, 250);
    }
  }

  flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    const entries = this.#entries.splice(0);
    if (entries.length > 0) {
      this.#onStatus?.("writing", entries.length);
      this.#inFlight = this.#inFlight
        .then(() => this.#storage.storeFiles(this.#sessionId, entries))
        .then(() => {
          this.#onStatus?.("saved", 0);
        })
        .catch((error: unknown) => {
          this.#failure =
            error instanceof Error
              ? error
              : new Error("Audit checkpoint persistence failed.");
          this.#onStatus?.("stalled", entries.length);
          throw this.#failure;
        });
    }
    return this.#inFlight;
  }

  async flushWithin(timeoutMs: number): Promise<boolean> {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        this.flush().then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function selectionKey(selection: AudioSourceSelection): string {
  return JSON.stringify({
    kind: selection.kind,
    paths: selection.paths.map((entry) => sourcePathKey(entry)).sort(),
  });
}

function approveSelection(selection: AudioSourceSelection): AudioSourceSelection {
  const normalized = {
    ...selection,
    paths: selection.paths.map((entry) => normalizeSourcePath(entry)),
  };
  approvedSelections.set(selectionKey(normalized), normalized);
  return normalized;
}

function isSourceSelection(value: unknown): value is AudioSourceSelection {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<AudioSourceSelection>;
  return (
    (source.kind === "files" || source.kind === "folder") &&
    typeof source.label === "string" &&
    (source.mode === undefined ||
      source.mode === "full-audit" ||
      source.mode === "metadata-inventory") &&
    Array.isArray(source.paths) &&
    source.paths.length > 0 &&
    source.paths.every((entry) => typeof entry === "string") &&
    (source.resourceLimits === undefined ||
      ([1, 2, 3, 4, 5, 6, 7, 8].includes(source.resourceLimits.concurrency) &&
        [128, 256, 384, 512].includes(source.resourceLimits.workerMemoryMb) &&
        [1, 2, 4].includes(source.resourceLimits.ffmpegThreads) &&
        [256, 512, 1024, 2048].includes(source.resourceLimits.nativeProcessMemoryMb))) &&
    (source.externalLookup === undefined ||
      (typeof source.externalLookup.acoustIdEnabled === "boolean" &&
        (source.externalLookup.musicBrainzEnabled === undefined ||
          typeof source.externalLookup.musicBrainzEnabled === "boolean") &&
        (source.externalLookup.acoustIdApiKey === undefined ||
          (typeof source.externalLookup.acoustIdApiKey === "string" &&
            source.externalLookup.acoustIdApiKey.length <= 128))))
  );
}

function isReportExportRequest(value: unknown): value is ReportExportRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<ReportExportRequest>;
  return (
    (request.scope === "session" &&
      typeof request.sessionId === "string" &&
      /^[a-f0-9-]{36}$/iu.test(request.sessionId)) ||
    (request.scope === "file" &&
      typeof request.filePath === "string" &&
      request.filePath.length > 0)
  );
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 900,
    minHeight: 720,
    backgroundColor: "#090a0e",
    title: "Audio-V",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    const allowedDevelopmentNavigation =
      developmentUrl && url.startsWith(developmentUrl);
    const allowedPackagedNavigation =
      !developmentUrl && url.startsWith("file:");
    if (!allowedDevelopmentNavigation && !allowedPackagedNavigation) {
      event.preventDefault();
    }
  });
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );

  if (developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

ipcMain.handle("app:platform", () => process.platform);
ipcMain.handle("app:open-logs", () => {
  if (!applicationLogger) return false;
  void shell.openPath(applicationLogger.directory);
  logApplication("info", "application.logs-opened");
  return true;
});

ipcMain.handle("oracle:validation-status", async (): Promise<OracleValidationStatus> => {
  const statusPath = app.isPackaged
    ? path.join(process.resourcesPath, "real-world-validation.json")
    : path.join(app.getAppPath(), "build", "real-world-validation-latest.json");
  return fs
    .readFile(statusPath, "utf8")
    .then((content) => JSON.parse(content) as OracleValidationStatus)
    .catch(() => ({
      schema: "Audio-V real-world validation status v1",
      generatedAt: new Date(0).toISOString(),
      corpusVersion: "unavailable",
      readiness: "awaiting-source-masters",
      infrastructurePassed: false,
      milestoneAchieved: false,
      claimLevel: "synthetic-regression-only",
      counts: {
        independentMasters: 0,
        publicIndependentMasters: 0,
        privateChallengeMasters: 0,
        contributorGroups: 0,
        redistributableMasters: 0,
        generatedCases: 0,
        bySplit: {},
      },
      thresholds: {
        pilotIndependentMasters: 25,
        targetIndependentMasters: 50,
        minimumCasesPerMaster: 10,
      },
      latestScorecard: null,
      limitations: [
        "Validation disclosure is unavailable in this build. No real-world calibration claim is permitted.",
      ],
    }));
});

ipcMain.handle("app:export-diagnostics", async () => {
  const result = await dialog.showSaveDialog({
    title: "Export privacy-safe Audio-V diagnostics",
    defaultPath: `Audio-V-Diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON diagnostics", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true, filePath: null };
  }
  const sessions = await auditSessions.listSessions();
  const manifestPath = app.isPackaged
    ? path.join(process.resourcesPath, "engine-manifest.json")
    : path.join(app.getAppPath(), "build", "engine-manifest.json");
  const engineManifest = await fs
    .readFile(manifestPath, "utf8")
    .then((content) => JSON.parse(content) as unknown)
    .catch(() => null);
  await fs.writeFile(
    result.filePath,
    `${JSON.stringify(createPrivacySafeDiagnostics({
      generatedAt: new Date().toISOString(),
      application: {
        version: app.getVersion(),
        packaged: app.isPackaged,
        platform: process.platform,
        architecture: process.arch,
      },
      runtime: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        oracleWorkerCount: currentResourceLimits.concurrency,
      },
      sessions,
      engineManifest,
    }), null, 2)}\n`,
  );
  return { canceled: false, filePath: result.filePath };
});

if (
  process.env.AUDIO_V_ENABLE_QA === "1" &&
  process.env.AUDIO_V_QA_SOURCE
) {
  ipcMain.handle("qa:configured-source", async () => {
    const configuredPath = path.resolve(process.env.AUDIO_V_QA_SOURCE!);
    const stat = await fs.stat(configuredPath);
    return approveSelection({
      kind: stat.isDirectory() ? "folder" : "files",
      paths: [configuredPath],
      label: configuredPath,
    });
  });
}

ipcMain.handle("library:select-files", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose audio files to audit",
    properties: ["openFile", "multiSelections"],
    filters: audioDialogFilters,
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return approveSelection({
    kind: "files",
    paths: result.filePaths,
    label:
      result.filePaths.length === 1
        ? path.basename(result.filePaths[0])
        : `${result.filePaths.length} selected files`,
  });
});

ipcMain.handle("comparison:select-file", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose one audio file to compare",
    properties: ["openFile"],
    filters: audioDialogFilters,
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return approveSelection({
    kind: "files",
    paths: [result.filePaths[0]],
    label: path.basename(result.filePaths[0]),
  });
});

ipcMain.handle("library:select-folder", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose an audio folder to audit",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const selectedRoot = path.resolve(result.filePaths[0]);
  return approveSelection({
    kind: "folder",
    paths: [selectedRoot],
    label: selectedRoot,
  });
});

ipcMain.handle("sessions:list", () => auditSessions.listSessions());

ipcMain.handle("sessions:clear-history", async () => {
  if (activeScanSessionId) {
    throw new Error(
      "History cannot be cleared while an audit is running. Cancel or finish the audit first.",
    );
  }
  const result = await auditSessions.clearHistory();
  logApplication("info", "audit-history.cleared", { ...result });
  if (result.cleanupPending) {
    sendHistoryCleanupProgress({
      state: "cleaning",
      deletedFiles: 0,
      deletedSessions: 0,
      remainingSessions: result.affected,
      explanation:
        "History is clear. Audio-V is reclaiming its saved session records in small background batches.",
    });
    scheduleHistoryCleanup();
  }
  return result;
});

ipcMain.handle("storage:status", () => auditSessions.storageStatus());

ipcMain.handle("storage:optimize", async () => {
  if (activeScanSessionId) {
    throw new Error(
      "Storage cannot be optimized while an audit is running.",
    );
  }
  if (historyCleanupRunning || historyCleanupTimer) {
    throw new Error(
      "Wait for history cleanup to finish before optimizing storage.",
    );
  }
  logApplication("info", "audit-storage.optimization-started");
  const result = await auditSessions.optimizeStorage();
  logApplication("info", "audit-storage.optimization-completed", {
    beforeBytes: result.before.databaseBytes,
    afterBytes: result.after.databaseBytes,
    reclaimedBytes:
      result.before.databaseBytes - result.after.databaseBytes,
    elapsedMilliseconds: result.elapsedMilliseconds,
  });
  return result;
});

ipcMain.handle("fingerprints:list", () =>
  auditSessions.listFingerprintLibrary(),
);

ipcMain.handle("fingerprints:rebuild", () =>
  auditSessions.rebuildFingerprintLibrary(),
);

ipcMain.handle("fingerprints:prune", () =>
  auditSessions.pruneFingerprintLibrary(),
);

ipcMain.handle("fingerprints:clear", () =>
  auditSessions.clearFingerprintLibrary(),
);

ipcMain.handle("sessions:open", async (_event, requestedSessionId: unknown) => {
  if (
    typeof requestedSessionId !== "string" ||
    !/^[a-f0-9-]{36}$/iu.test(requestedSessionId)
  ) {
    throw new TypeError("A valid audit session identifier is required.");
  }
  const session = await auditSessions.getSession(requestedSessionId, true);
  if (!session) throw new Error("The requested audit session was not found.");
  approveSelection(session.source);
  for (const file of session.files) {
    const normalizedPath = path.resolve(file.path);
    approvedAudioFiles.add(normalizedPath);
  }
  return session;
});

ipcMain.handle(
  "sessions:open-file",
  async (
    _event,
    requestedSessionId: unknown,
    requestedFilePath: unknown,
  ) => {
    if (
      typeof requestedSessionId !== "string" ||
      !/^[a-f0-9-]{36}$/iu.test(requestedSessionId) ||
      typeof requestedFilePath !== "string"
    ) {
      throw new TypeError("A valid audit session and file path are required.");
    }
    const resolvedPath = path.resolve(requestedFilePath);
    const storedFile = await auditSessions.getSessionFile(
      requestedSessionId,
      resolvedPath,
    );
    const file =
      storedFile ??
      (requestedSessionId === activeScanSessionId
        ? authoritativeRecords.get(resolvedPath) ?? null
        : null);
    if (!file) {
      throw new Error("The requested file is not present in this audit session.");
    }
    approvedAudioFiles.add(path.resolve(file.path));
    rememberAuthoritativeRecord(file);
    return file;
  },
);

ipcMain.handle(
  "sessions:set-file-reviewed",
  async (
    _event,
    requestedSessionId: unknown,
    requestedFilePath: unknown,
    requestedReviewed: unknown,
    requestedDisposition: unknown,
    requestedNote: unknown,
  ) => {
    if (
      typeof requestedSessionId !== "string" ||
      !/^[a-f0-9-]{36}$/iu.test(requestedSessionId) ||
      typeof requestedFilePath !== "string" ||
      typeof requestedReviewed !== "boolean" ||
      (requestedDisposition !== undefined &&
        !isUserReviewDisposition(requestedDisposition)) ||
      (requestedNote !== undefined && typeof requestedNote !== "string")
    ) {
      throw new TypeError(
        "A valid audit session, file path, reviewed state, and review disposition are required.",
      );
    }
    const resolvedPath = path.resolve(requestedFilePath);
    const storedFile = await auditSessions.getSessionFile(
      requestedSessionId,
      resolvedPath,
    );
    if (!storedFile) {
      throw new Error("The requested file is not present in this audit session.");
    }
    const updated: AudioFileRecord = { ...storedFile };
    if (requestedReviewed) {
      updated.userReview = createUserReview(
        isUserReviewDisposition(requestedDisposition)
          ? requestedDisposition
          : "acknowledged",
        typeof requestedNote === "string" ? requestedNote : "",
      );
    } else {
      delete updated.userReview;
    }
    await auditSessions.updateSessionFile(
      requestedSessionId,
      resolvedPath,
      updated,
    );
    rememberAuthoritativeRecord(updated);
    return updated;
  },
);

ipcMain.handle(
  "sessions:prepare-resume",
  async (
    _event,
    requestedSessionId: unknown,
    requestedStrategy: unknown,
  ) => {
    if (
      typeof requestedSessionId !== "string" ||
      !/^[a-f0-9-]{36}$/iu.test(requestedSessionId)
    ) {
      throw new TypeError("A valid audit session identifier is required.");
    }
    const session = await auditSessions.getSessionSummary(requestedSessionId);
    if (!session) throw new Error("The requested audit session was not found.");
    for (const sourcePath of session.source.paths) {
      try {
        await fs.stat(sourcePath);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "source unavailable";
        throw new Error(
          `The saved source is not currently available: ${sourcePath}. Reconnect or remount it, then resume again. (${detail})`,
        );
      }
    }
    const recoveryCandidates =
      await auditSessions.getRecoveryCandidates(requestedSessionId);
    const strategy: AuditResumeStrategy =
      requestedStrategy === undefined || requestedStrategy === "adaptive-safe"
        ? "adaptive-safe"
        : requestedStrategy === "previous-settings"
          ? "previous-settings"
          : (() => {
              throw new TypeError("A valid audit recovery strategy is required.");
            })();
    const recovery = createAuditRecoveryState(
      session.source,
      recoveryCandidates,
      strategy,
      defaultResourceLimits,
    );
    const source = approveSelection({
      ...session.source,
      resourceLimits: recovery.targetResourceLimits,
      recovery,
    });
    return {
      sessionId: session.id,
      source,
      strategy,
      targetResourceLimits: recovery.targetResourceLimits,
      safeResourceLimits: safeRecoveryResourceLimits,
      completedCount: session.completedCount,
      discoveredCount: session.discoveredCount,
      recoveryCandidateCount: recoveryCandidates.length,
      recoveryCandidateNames: recoveryCandidates.map((filePath) =>
        path.basename(filePath),
      ),
      safeCandidateCount: recovery.safeCandidatePaths.length,
      quarantinedCandidateCount:
        recovery.quarantinedCandidatePaths.length,
    };
  },
);

ipcMain.handle(
  "comparison:analyze-signals",
  async (
    _event,
    requestedLeft: unknown,
    requestedRight: unknown,
    requestedMapping: unknown,
  ) => {
    if (
      typeof requestedLeft !== "string" ||
      typeof requestedRight !== "string"
    ) {
      throw new TypeError("Two audio file paths are required for comparison.");
    }
    const leftPath = path.resolve(requestedLeft);
    const rightPath = path.resolve(requestedRight);
    if (
      !approvedAudioFiles.has(leftPath) ||
      !approvedAudioFiles.has(rightPath)
    ) {
      throw new Error("Select both files through Audio-V before comparing them.");
    }
    const channelMapping =
      requestedMapping === undefined
        ? undefined
        : Array.isArray(requestedMapping) &&
            requestedMapping.every(
              (mapping) =>
                typeof mapping === "object" &&
                mapping !== null &&
                Number.isInteger(
                  (mapping as { leftChannel?: unknown }).leftChannel,
                ) &&
                Number.isInteger(
                  (mapping as { rightChannel?: unknown }).rightChannel,
                ),
            )
          ? (requestedMapping as Array<{
              leftChannel: number;
              rightChannel: number;
            }>)
          : null;
    if (channelMapping === null) {
      throw new TypeError("Comparison channel mappings must use integer channel indexes.");
    }
    activeComparisonController?.abort();
    const controller = new AbortController();
    activeComparisonController = controller;
    try {
      return await runComparisonWorker(
        path.join(__dirname, "oracle", "comparison-worker.js"),
        leftPath,
        rightPath,
        currentResourceLimits,
        controller.signal,
        channelMapping,
      );
    } finally {
      if (activeComparisonController === controller) {
        activeComparisonController = null;
      }
    }
  },
);

ipcMain.handle("acoustid:validate-api-key", async (_event, requestedKey: unknown) => {
  if (typeof requestedKey !== "string") {
    throw new TypeError("An AcoustID application API key is required.");
  }
  await ensureValidatedAcoustIdApiKey(requestedKey);
  return true;
});

ipcMain.handle("library:scan-selection", async (_event, requestedSource: unknown) => {
  if (!isSourceSelection(requestedSource)) {
    throw new TypeError("A valid file or folder selection is required.");
  }
  const approved = approvedSelections.get(selectionKey(requestedSource));
  if (!approved) {
    throw new Error("Select these files through Audio-V before scanning them.");
  }
  const requestedResourceLimits =
    requestedSource.resourceLimits ?? defaultResourceLimits;
  const resourcePolicy = resolveAnalysisResourcePolicy(
    requestedResourceLimits,
    totalmem(),
    availableParallelism(),
  );
  let externalLookup = requestedSource.externalLookup;
  if (
    externalLookup?.acoustIdEnabled &&
    typeof externalLookup.acoustIdApiKey === "string"
  ) {
    const normalized = await ensureValidatedAcoustIdApiKey(
      externalLookup.acoustIdApiKey,
    );
    externalLookup = {
      ...externalLookup,
      acoustIdApiKey: normalized,
    };
  }
  const source: AudioSourceSelection = {
    ...approved,
    mode: requestedSource.mode ?? "full-audit",
    resourceLimits: resourcePolicy.limits,
    recovery: approved.recovery,
    externalLookup,
  };
  const requestedLimits = source.resourceLimits ?? defaultResourceLimits;
  const recoveryQuarantine = new Map(
    (source.recovery?.quarantinedCandidatePaths ?? []).map((filePath) => [
      path.resolve(filePath),
      `${path.basename(filePath)} caused a second interruption during safe validation and was quarantined. Re-run it separately only after reviewing the saved diagnostic evidence.`,
    ]),
  );
  activeScanController?.abort();
  await applyOracleResourceLimits(
    source.recovery?.safeCandidatePaths.length
      ? safeRecoveryResourceLimits
      : requestedLimits,
  );
  const controller = new AbortController();
  const pauseGate = new ScanPauseGate();
  activeScanController = controller;
  activeScanPause = pauseGate;
  const persistedSource: AudioSourceSelection = {
    ...source,
    externalLookup: source.externalLookup
      ? {
          acoustIdEnabled: source.externalLookup.acoustIdEnabled,
          musicBrainzEnabled:
            source.externalLookup.musicBrainzEnabled === true,
        }
      : undefined,
  };
  const sessionId = await auditSessions.create(persistedSource);
  const scanStartedMilliseconds = Date.now();
  activeScanSessionId = sessionId;
  logApplication("info", "scan.started", {
    sessionId,
    source: persistedSource,
    requestedResourceLimits,
    effectiveResourceLimits: source.resourceLimits,
    recovery: source.recovery,
  });
  let latestScanProgress: ScanProgressUpdate | null = null;
  const persistence = new SessionPersistenceBuffer(
    auditSessions,
    sessionId,
    (state, pendingFiles) => {
      if (state === "writing" || state === "stalled") {
        logApplication(
          state === "stalled" ? "error" : "debug",
          `scan.checkpoint-${state}`,
          { sessionId, pendingFiles },
        );
      }
      if (!latestScanProgress) return;
      const explanations = {
        queued: `${pendingFiles} completed result${pendingFiles === 1 ? " is" : "s are"} queued for the next durable checkpoint.`,
        writing: `Writing ${pendingFiles} completed result${pendingFiles === 1 ? "" : "s"} to resumable audit history.`,
        saved: "Completed results are checkpointed in resumable audit history.",
        stalled:
          "Audit history stopped responding. Audio-V is ending this scan safely instead of waiting indefinitely.",
      } as const;
      _event.sender.send("library:scan-progress", {
        ...latestScanProgress,
        phase: "checkpointing",
        file: null,
        checkpoint: {
          state,
          pendingFiles,
          explanation: explanations[state],
        },
      } satisfies ScanProgressUpdate);
    },
  );
  let sessionWarnings: string[] = [];
  try {
    const emitProgress = (
      progress: Parameters<NonNullable<Parameters<typeof scanSources>[1]>>[0],
      effectiveLimits: AnalysisResourceLimits,
      recovery:
        | {
            stage: "safe-validation" | "restored-settings" | "quarantine";
            explanation: string;
            targetResourceLimits: AnalysisResourceLimits;
          }
        | undefined,
      publishCompletion = false,
    ) => {
      latestScanProgress = progress;
      if (progress.phase === "complete" && !publishCompletion) return;
      if (progress.phase === "finalizing" && progress.finalization) {
        logApplication("info", "scan.finalization-stage", {
          sessionId,
          stage: progress.finalization.stage,
          completed: progress.finalization.completed,
          total: progress.finalization.total,
          explanation: progress.finalization.explanation,
        });
      }
      if (progress.file) {
        const normalizedPath = path.resolve(progress.file.path);
        approvedAudioFiles.add(normalizedPath);
      }
      _event.sender.send("library:scan-progress", {
        ...progress,
        sessionId,
        resourceLimits: effectiveLimits,
        resourcePolicyExplanation: resourcePolicy.adjusted
          ? resourcePolicy.explanation
          : null,
        recovery,
      });
    };
    const onFileStored = (
      file: AudioFileRecord,
      ordinal: number,
      fromCache: boolean,
    ) => {
      const normalizedPath = path.resolve(file.path);
      approvedAudioFiles.add(normalizedPath);
      rememberAuthoritativeRecord(file);
      logApplication(
        file.oracle.analysisState === "error" ? "warn" : "debug",
        "scan.file-completed",
        {
          sessionId,
          filePath: normalizedPath,
          ordinal,
          fromCache,
          analysisState: file.oracle.analysisState,
          verdict: file.oracle.verdict,
          failure: file.oracle.failure,
        },
      );
      return persistence.add(file, ordinal, fromCache);
    };
    const onFileStarted = async (filePath: string) => {
      logApplication("debug", "scan.file-started", {
        sessionId,
        filePath,
      });
      await auditSessions.markFileStarted(sessionId, filePath);
    };
    if (source.recovery?.safeCandidatePaths.length) {
      const recoverySource: AudioSourceSelection = {
        kind: "files",
        paths: source.recovery.safeCandidatePaths,
        label: `${source.label} · recovery validation`,
        mode: source.mode,
        resourceLimits: safeRecoveryResourceLimits,
        externalLookup: source.externalLookup,
      };
      const recoveryExplanation =
        `Safe validation is processing ${source.recovery.safeCandidatePaths.length} file${source.recovery.safeCandidatePaths.length === 1 ? "" : "s"} that were active during the interruption with one worker. The audit will automatically restore ${requestedLimits.concurrency} concurrent file${requestedLimits.concurrency === 1 ? "" : "s"} afterward.`;
      await scanSources(
        recoverySource,
        (progress) =>
          emitProgress(progress, safeRecoveryResourceLimits, {
            stage: "safe-validation",
            explanation: recoveryExplanation,
            targetResourceLimits: requestedLimits,
          }),
        {
          signal: controller.signal,
          cache: oracleCache,
          analyzeFile: (filePath, signal) =>
            analyzeWithWorkerIsolation(filePath, signal),
          onFileStarted,
          onFileStored,
          waitIfPaused: () => pauseGate.wait(controller.signal),
          concurrency: 1,
          bypassCachePaths: new Set(
            source.recovery.safeCandidatePaths.map((entry) =>
              path.resolve(entry),
            ),
          ),
          compactResults: true,
        },
      );
      await persistence.flush();
      await applyOracleResourceLimits(requestedLimits);
      emitProgress(
        {
          phase: "processing",
          completed: 0,
          total: 0,
          currentFile: null,
          file: null,
          fromCache: false,
        },
        requestedLimits,
        {
          stage: "restored-settings",
          explanation:
            `Safe validation completed. Audio-V restored the saved ${requestedLimits.concurrency}-worker configuration for the remaining audit.`,
          targetResourceLimits: requestedLimits,
        },
      );
    }
    const quarantineExplanation = recoveryQuarantine.size
      ? `${recoveryQuarantine.size} repeatedly unstable file${recoveryQuarantine.size === 1 ? " was" : "s were"} quarantined; the remaining audit is running with the saved configuration.`
      : undefined;
    const result = await scanSources(
      source,
      (progress) =>
        emitProgress(
          progress,
          requestedLimits,
          quarantineExplanation
            ? {
                stage: "quarantine",
                explanation: quarantineExplanation,
                targetResourceLimits: requestedLimits,
              }
            : source.recovery
              ? {
                  stage: "restored-settings",
                  explanation:
                    source.recovery.strategy === "previous-settings"
                      ? "Recovery is using the previously saved resource settings by explicit request."
                      : `Adaptive recovery is running the remaining audit with the saved ${requestedLimits.concurrency}-worker configuration.`,
                  targetResourceLimits: requestedLimits,
                }
              : undefined,
        ),
      {
        signal: controller.signal,
        cache: oracleCache,
        analyzeFile: (filePath, signal) =>
          analyzeWithWorkerIsolation(filePath, signal),
        onDiscovered: async (filePaths, warnings) => {
          sessionWarnings = [...warnings];
          logApplication("info", "scan.discovery-completed", {
            sessionId,
            discoveredCount: filePaths.length,
            warningCount: warnings.length,
            warnings,
          });
          await auditSessions.markDiscovered(
            sessionId,
            filePaths.length,
            sessionWarnings,
          );
        },
        onFileStarted,
        onFileStored,
        waitIfPaused: () => pauseGate.wait(controller.signal),
        concurrency: requestedLimits.concurrency,
        recoveryQuarantine,
        compactResults: true,
      },
    );
    emitProgress(
      {
        phase: "finalizing",
        completed: result.files.length,
        total: result.files.length,
        currentFile: null,
        file: null,
        fromCache: false,
        finalization: {
          stage: "history-commit",
          completed: 0,
          total: 1,
          explanation:
            "Committing the final evidence index and session state to resumable audit history.",
        },
      },
      requestedLimits,
      undefined,
    );
    await persistence.flush();
    sessionWarnings = result.warnings;
    await auditSessions.finish(sessionId, "completed", sessionWarnings);
    const completedStorageStatus = await auditSessions
      .storageStatus()
      .catch(() => null);
    emitProgress(
      {
        phase: "complete",
        completed: result.files.length,
        total: result.files.length,
        currentFile: null,
        file: null,
        fromCache: false,
      },
      requestedLimits,
      undefined,
      true,
    );
    logApplication("info", "scan.completed", {
      sessionId,
      applicationVersion: app.getVersion(),
      discoveredCount: result.files.length,
      warningCount: sessionWarnings.length,
      analysisErrorCount: result.files.filter(
        (file) => file.oracle.analysisState === "error",
      ).length,
      elapsedMilliseconds: Date.now() - scanStartedMilliseconds,
      mainProcessRssBytesAtCompletion: process.memoryUsage().rss,
      databaseBytesAtCompletion:
        completedStorageStatus?.databaseBytes ?? null,
      databaseReclaimableBytesAtCompletion:
        completedStorageStatus?.reclaimableBytes ?? null,
      sourceKind: persistedSource.kind,
      sourceMode: persistedSource.mode ?? "full-audit",
      performanceLimitation:
        "Completion RSS is a point-in-time main-process value, not total application peak memory.",
    });
    for (const file of result.files) {
      const normalizedPath = path.resolve(file.path);
      approvedAudioFiles.add(normalizedPath);
    }
    if (
      process.env.AUDIO_V_ENABLE_QA === "1" &&
      process.env.AUDIO_V_QA_RESULT_PATH
    ) {
      await fs.writeFile(
        path.resolve(process.env.AUDIO_V_QA_RESULT_PATH),
        `${JSON.stringify({
          sessionId,
          discovered: result.files.length,
          completed: result.files.filter((file) => file.oracle.measuredAt).length,
          verdicts: result.files.map((file) => file.oracle.verdict),
          engineVersions: [
            ...new Set(result.files.map((file) => file.oracle.engineVersion)),
          ],
        }, null, 2)}\n`,
      );
      setTimeout(() => app.quit(), 250);
    }
    return {
      ...result,
      source: persistedSource,
      warnings: sessionWarnings,
      sessionId,
    };
  } catch (error) {
    logApplication(
      controller.signal.aborted ? "warn" : "error",
      controller.signal.aborted ? "scan.canceled" : "scan.failed",
      { sessionId, error, warnings: sessionWarnings },
    );
    if (controller.signal.aborted) {
      await persistence.flushWithin(2_000).catch(() => false);
      await Promise.race([
        auditSessions.finish(sessionId, "canceled", sessionWarnings),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]).catch(() => undefined);
    } else {
      await persistence.flush().catch(() => undefined);
      await auditSessions
        .finish(sessionId, "failed", sessionWarnings)
        .catch(() => undefined);
    }
    throw error;
  } finally {
    await oracleCache.flush();
    if (activeScanController === controller) activeScanController = null;
    if (activeScanPause === pauseGate) activeScanPause = null;
    if (activeScanSessionId === sessionId) activeScanSessionId = null;
  }
});

ipcMain.handle("library:pause-scan", () => activeScanPause?.pause() ?? false);

ipcMain.handle("library:resume-scan", () => activeScanPause?.resume() ?? false);

ipcMain.handle("library:cancel-scan", () => {
  if (!activeScanController) return false;
  logApplication("info", "scan.cancel-requested", {
    sessionId: activeScanSessionId,
  });
  activeScanPause?.resume();
  activeScanController.abort();
  return true;
});

ipcMain.handle("oracle:analyze-file", async (
  _event,
  requestedPath: unknown,
  requestedSessionId: unknown,
) => {
  if (typeof requestedPath !== "string") {
    throw new TypeError("An audio file path is required.");
  }
  const filePath = path.resolve(requestedPath);
  if (!approvedAudioFiles.has(filePath)) {
    throw new Error("Select this audio file through Audio-V before analyzing it.");
  }
  const oracle = await analyzeWithWorkerIsolation(filePath);
  let prior: AudioFileRecord | null | undefined =
    authoritativeRecords.get(filePath);
  if (
    !prior &&
    typeof requestedSessionId === "string" &&
    /^[a-f0-9-]{36}$/iu.test(requestedSessionId)
  ) {
    prior = await auditSessions.getSessionFile(requestedSessionId, filePath);
  }
  if (prior) {
    const updated = { ...prior, oracle };
    rememberAuthoritativeRecord(updated);
    await auditSessions.setCached(updated);
    if (
      typeof requestedSessionId === "string" &&
      /^[a-f0-9-]{36}$/iu.test(requestedSessionId)
    ) {
      const stored = await auditSessions.getSessionFile(
        requestedSessionId,
        filePath,
      );
      if (stored?.userReview) updated.userReview = stored.userReview;
      await auditSessions.updateSessionFile(requestedSessionId, filePath, updated);
    }
  }
  return oracle;
});

ipcMain.handle(
  "oracle:inspect-spectrogram",
  async (
    _event,
    requestedPath: unknown,
    requestedFftSize: unknown,
    requestedChannelMode: unknown,
  ) => {
    if (
      typeof requestedPath !== "string" ||
      ![512, 2048, 4096, 16384].includes(Number(requestedFftSize)) ||
      ![
        "per-channel power average",
        "left channel",
        "right channel",
        "left-right difference",
      ].includes(String(requestedChannelMode))
    ) {
      throw new TypeError("Valid spectrogram inspection settings are required.");
    }
    const filePath = path.resolve(requestedPath);
    if (!approvedAudioFiles.has(filePath)) {
      throw new Error("Select this audio file through Audio-V before inspecting it.");
    }
    return inspectSpectrogram(
      filePath,
      requestedFftSize as 512 | 2048 | 4096 | 16384,
      requestedChannelMode as Parameters<typeof inspectSpectrogram>[2],
    );
  },
);

ipcMain.handle("files:reveal", (_event, requestedPath: unknown) => {
  if (typeof requestedPath !== "string") {
    throw new TypeError("An audio file path is required.");
  }
  const filePath = path.resolve(requestedPath);
  if (!approvedAudioFiles.has(filePath)) {
    throw new Error("Select this audio file through Audio-V before revealing it.");
  }
  shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle(
  "repair:create-true-peak-copy",
  async (
    _event,
    requestedPath: unknown,
    requestedBitDepth: unknown,
  ) => {
    if (
      typeof requestedPath !== "string" ||
      (requestedBitDepth !== 16 && requestedBitDepth !== 24)
    ) {
      throw new TypeError(
        "A valid audio file and 16-bit or 24-bit output are required.",
      );
    }
    const filePath = path.resolve(requestedPath);
    if (!approvedAudioFiles.has(filePath)) {
      throw new Error("Select this audio file through Audio-V before creating a copy.");
    }
    const authoritativeFile = authoritativeRecords.get(filePath);
    const measuredTruePeak =
      authoritativeFile?.oracle.measurements?.truePeakDbtp;
    if (measuredTruePeak === null || measuredTruePeak === undefined) {
      throw new Error(
        "A current Oracle true-peak measurement is required before remediation.",
      );
    }
    if (measuredTruePeak <= -1) {
      throw new Error("This file is already at or below the −1 dBTP safety target.");
    }
    const sourceBase = path.basename(filePath, path.extname(filePath));
    const saveResult = await dialog.showSaveDialog({
      title: `Create −1 dBTP ${requestedBitDepth}-bit FLAC working copy`,
      defaultPath: path.join(
        path.dirname(filePath),
        `${sourceBase} (Audio-V -1dBTP ${requestedBitDepth}-bit).flac`,
      ),
      filters: [{ name: "FLAC audio", extensions: ["flac"] }],
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return { canceled: true, filePath: null, file: null };
    }
    const outputPath = path.resolve(saveResult.filePath);
    if (outputPath === filePath) {
      throw new Error("The protected source file cannot be overwritten.");
    }
    await createTruePeakSafeCopy(
      filePath,
      outputPath,
      measuredTruePeak,
      requestedBitDepth,
    );
    const repairResult = await scanSources(
      {
        kind: "files",
        paths: [outputPath],
        label: path.basename(outputPath),
      },
      undefined,
      {
        analyzeFile: (candidatePath, signal) =>
          analyzeWithWorkerIsolation(candidatePath, signal),
      },
    );
    const repairedFile = repairResult.files[0] ?? null;
    if (!repairedFile) {
      throw new Error("The working copy was created but could not be verified.");
    }
    if (repairedFile.bitDepth !== requestedBitDepth) {
      throw new Error(
        `The working copy verified as ${repairedFile.bitDepth ?? "unknown"}-bit instead of the requested ${requestedBitDepth}-bit output.`,
      );
    }
    approvedAudioFiles.add(outputPath);
    rememberAuthoritativeRecord(repairedFile);
    return { canceled: false, filePath: outputPath, file: repairedFile };
  },
);

ipcMain.handle("reports:export", async (
  _event,
  requestedReport: unknown,
  requestedFormat: unknown,
) => {
  if (!isReportExportRequest(requestedReport)) {
    throw new TypeError("A valid Audio-V report scope is required.");
  }
  let report: unknown = null;
  let sessionId: string | null = null;
  if (requestedReport.scope === "session") {
    sessionId = requestedReport.sessionId;
  } else {
    const filePath = path.resolve(requestedReport.filePath);
    const file = authoritativeRecords.get(filePath);
    if (!file || !approvedAudioFiles.has(filePath)) {
      throw new Error(
        "The requested file does not have an authoritative Oracle record.",
      );
    }
    report = {
      schema: "Audio-V authoritative per-file evidence v5",
      exportedAt: new Date().toISOString(),
      source: file.path,
      file: compactReportFile(file),
    };
  }
  const supportedFormats = new Set<ReportExportFormat>([
    "json",
    "csv",
    "pdf",
    "xlsx",
    "docx",
  ]);
  const format: ReportExportFormat =
    typeof requestedFormat === "string" &&
    supportedFormats.has(requestedFormat as ReportExportFormat)
      ? (requestedFormat as ReportExportFormat)
      : "json";
  const formatNames: Record<ReportExportFormat, string> = {
    json: "JSON evidence",
    csv: "CSV data",
    pdf: "PDF report",
    xlsx: "Excel workbook",
    docx: "Word document",
  };
  const result = await dialog.showSaveDialog({
    title: "Export Audio-V audit report",
    defaultPath: `Audio-V-Audit-${new Date().toISOString().slice(0, 10)}.${format}`,
    filters: [{ name: formatNames[format], extensions: [format] }],
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true, filePath: null };
  }
  if (sessionId) {
    await auditSessions.exportSessionReport(sessionId, format, result.filePath);
  } else {
    await writeAuditReport(report, format, result.filePath);
  }
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle(
  "reports:export-spectrogram",
  async (_event, requestedName: unknown, dataUrl: unknown) => {
    if (
      typeof requestedName !== "string" ||
      typeof dataUrl !== "string" ||
      !dataUrl.startsWith("data:image/png;base64,")
    ) {
      throw new TypeError("A valid PNG spectrogram export is required.");
    }
    const bytes = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
    if (bytes.length === 0 || bytes.length > 20_000_000) {
      throw new Error("The spectrogram PNG is empty or exceeds 20 MB.");
    }
    const safeBaseName =
      path.basename(requestedName, path.extname(requestedName))
        .replace(/[^\w.-]+/g, "-")
        .slice(0, 100) || "audio";
    const result = await dialog.showSaveDialog({
      title: "Export measured spectrogram",
      defaultPath: `${safeBaseName}-Audio-V-Spectrogram.png`,
      filters: [{ name: "PNG image", extensions: ["png"] }],
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true, filePath: null };
    }
    await fs.writeFile(result.filePath, bytes);
    return { canceled: false, filePath: result.filePath };
  },
);

ipcMain.handle(
  "reports:export-spectrogram-batch",
  async (_event, requestedItems: unknown) => {
    if (
      !Array.isArray(requestedItems) ||
      requestedItems.length === 0 ||
      requestedItems.length > 500
    ) {
      throw new TypeError("Choose between 1 and 500 measured spectrograms.");
    }
    let aggregateBytes = 0;
    const decoded = requestedItems.map((item) => {
      if (
        !item ||
        typeof item.fileName !== "string" ||
        typeof item.dataUrl !== "string" ||
        !item.dataUrl.startsWith("data:image/png;base64,")
      ) {
        throw new TypeError("Every batch item must contain a valid PNG.");
      }
      const bytes = Buffer.from(
        item.dataUrl.slice("data:image/png;base64,".length),
        "base64",
      );
      if (!bytes.length || bytes.length > 20_000_000) {
        throw new Error("A batch spectrogram is empty or exceeds 20 MB.");
      }
      if (
        bytes.length < 8 ||
        !bytes.subarray(0, 8).equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        )
      ) {
        throw new Error("A batch spectrogram does not contain a PNG signature.");
      }
      aggregateBytes += bytes.length;
      if (aggregateBytes > 250_000_000) {
        throw new Error("The batch spectrogram payload exceeds 250 MB.");
      }
      const base =
        path
          .basename(item.fileName, path.extname(item.fileName))
          .replace(/[^\w.-]+/g, "-")
          .slice(0, 100) || "audio";
      return { base, bytes };
    });
    const result = await dialog.showOpenDialog({
      title: "Choose a folder for batch spectrogram PNGs",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true, filePath: null, exportedCount: 0 };
    }
    const directory = result.filePaths[0];
    for (let index = 0; index < decoded.length; index += 1) {
      const suffix = decoded.length > 1 ? `-${String(index + 1).padStart(3, "0")}` : "";
      await fs.writeFile(
        path.join(directory, `${decoded[index].base}${suffix}-Audio-V-Spectrogram.png`),
        decoded[index].bytes,
      );
    }
    return {
      canceled: false,
      filePath: directory,
      exportedCount: decoded.length,
    };
  },
);

app.whenReady().then(async () => {
  const userDataPath = app.getPath("userData");
  applicationLogger = new ApplicationLogger(
    path.join(userDataPath, "logs"),
  );
  logApplication("info", "application.started", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    architecture: process.arch,
    runtime: process.versions,
    totalMemoryBytes: totalmem(),
    logicalCpuCount: availableParallelism(),
  });
  auditSessions = new AuditStorageClient(
    path.join(__dirname, "storage", "storage-worker.js"),
    path.join(userDataPath, "audit-sessions-v1.sqlite3"),
    30_000,
    (event) =>
      logApplication(
        event.type === "request-timeout" || event.type === "worker-error"
          ? "error"
          : "info",
        `storage.${event.type}`,
        { ...event },
      ),
  );
  await auditSessions.recoverInterruptedSessions();
  await auditSessions.importLegacyCache(
    path.join(userDataPath, "oracle-cache-v4.json"),
  );
  scheduleHistoryCleanup(250);
  oracleCache = {
    get: (filePath) => auditSessions.getCached(filePath),
    set: (record) => auditSessions.setCached(record),
    flush: async () => undefined,
    findFingerprintCandidates: (filePath, limit, durationSeconds) =>
      auditSessions.findFingerprintCandidates(
        filePath,
        limit,
        durationSeconds,
      ),
  };
  oracleWorkers = new OracleWorkerPool(
    path.join(__dirname, "oracle", "oracle-worker.js"),
    defaultResourceLimits.concurrency,
    defaultResourceLimits.workerMemoryMb,
    defaultResourceLimits,
    undefined,
    logOracleWorkerEvent,
  );
  configureEngineResourcePolicy(defaultResourceLimits);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  logApplication("info", "application.before-quit", {
    activeSessionId: activeScanSessionId,
  });
  activeScanController?.abort();
  activeComparisonController?.abort();
  if (historyCleanupTimer) {
    clearTimeout(historyCleanupTimer);
    historyCleanupTimer = null;
  }
  void oracleWorkers?.close();
  applicationLogger?.close();
});

app.on("render-process-gone", (_event, webContents, details) => {
  logApplication("error", "application.renderer-gone", {
    webContentsId: webContents.id,
    reason: details.reason,
    exitCode: details.exitCode,
  });
});

app.on("child-process-gone", (_event, details) => {
  logApplication("error", "application.child-process-gone", {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    serviceName: details.serviceName,
    name: details.name,
  });
});

process.once("uncaughtException", (error) => {
  logApplication("error", "application.uncaught-exception", { error });
  setImmediate(() => app.exit(1));
});

process.on("unhandledRejection", (reason) => {
  logApplication("error", "application.unhandled-rejection", { reason });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
