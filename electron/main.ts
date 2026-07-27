import path from "node:path";
import { promises as fs } from "node:fs";
import { availableParallelism } from "node:os";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type {
  AudioFileRecord,
  AudioSourceSelection,
  ReportExportRequest,
} from "../shared/contracts";
import { createTruePeakSafeCopy } from "./repair-engine";
import { scanSources } from "./scanner";
import type { OracleRecordCache } from "./scanner";
import { compactReportFile, writeAuditReport } from "./report-exporter";
import type { ReportExportFormat } from "../shared/contracts";
import { OracleWorkerPool } from "./oracle/oracle-worker-pool";
import { runComparisonWorker } from "./oracle/comparison-worker-client";
import { AuditStorageClient } from "./storage/audit-storage-client";
import { createPrivacySafeDiagnostics } from "./diagnostics";

const approvedSelections = new Map<string, AudioSourceSelection>();
const approvedAudioFiles = new Set<string>();
const authoritativeRecords = new Map<string, AudioFileRecord>();
const audioDialogFilters = [
  {
    name: "Audio files",
    extensions: [
      "aac", "aif", "aiff", "alac", "ape", "dff", "dsf", "flac",
      "m4a", "mp3", "ogg", "opus", "wav", "wma", "wv",
    ],
  },
];
const developmentUrl = process.env.VITE_DEV_SERVER_URL;
let activeScanController: AbortController | null = null;
let activeScanPause: ScanPauseGate | null = null;
let oracleCache: OracleRecordCache;
let oracleWorkers: OracleWorkerPool;
let auditSessions: AuditStorageClient;
let activeComparisonController: AbortController | null = null;
const oracleWorkerCount = Math.max(
  1,
  Math.min(3, Math.floor(availableParallelism() / 4)),
);

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

  constructor(storage: AuditStorageClient, sessionId: string) {
    this.#storage = storage;
    this.#sessionId = sessionId;
  }

  add(file: AudioFileRecord, ordinal: number, fromCache: boolean): void {
    this.#entries.push({ file, ordinal, fromCache });
    if (this.#entries.length >= 50) {
      void this.flush();
      return;
    }
    if (!this.#timer) {
      this.#timer = setTimeout(() => {
        this.#timer = null;
        void this.flush();
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
      this.#inFlight = this.#inFlight.then(() =>
        this.#storage.storeFiles(this.#sessionId, entries),
      );
    }
    return this.#inFlight;
  }
}

function selectionKey(selection: AudioSourceSelection): string {
  return JSON.stringify({
    kind: selection.kind,
    paths: selection.paths.map((entry) => path.resolve(entry)).sort(),
  });
}

function approveSelection(selection: AudioSourceSelection): AudioSourceSelection {
  const normalized = {
    ...selection,
    paths: selection.paths.map((entry) => path.resolve(entry)),
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
    source.paths.every((entry) => typeof entry === "string")
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
    minWidth: 1120,
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
        oracleWorkerCount,
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

ipcMain.handle("sessions:open", async (_event, requestedSessionId: unknown) => {
  if (
    typeof requestedSessionId !== "string" ||
    !/^[a-f0-9-]{36}$/iu.test(requestedSessionId)
  ) {
    throw new TypeError("A valid audit session identifier is required.");
  }
  const session = await auditSessions.getSession(requestedSessionId);
  if (!session) throw new Error("The requested audit session was not found.");
  approveSelection(session.source);
  for (const file of session.files) {
    const normalizedPath = path.resolve(file.path);
    approvedAudioFiles.add(normalizedPath);
    authoritativeRecords.set(normalizedPath, file);
  }
  return session;
});

ipcMain.handle(
  "comparison:analyze-signals",
  async (_event, requestedLeft: unknown, requestedRight: unknown) => {
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
    activeComparisonController?.abort();
    const controller = new AbortController();
    activeComparisonController = controller;
    try {
      return await runComparisonWorker(
        path.join(__dirname, "oracle", "comparison-worker.js"),
        leftPath,
        rightPath,
        controller.signal,
      );
    } finally {
      if (activeComparisonController === controller) {
        activeComparisonController = null;
      }
    }
  },
);

ipcMain.handle("library:scan-selection", async (_event, requestedSource: unknown) => {
  if (!isSourceSelection(requestedSource)) {
    throw new TypeError("A valid file or folder selection is required.");
  }
  const approved = approvedSelections.get(selectionKey(requestedSource));
  if (!approved) {
    throw new Error("Select these files through Audio-V before scanning them.");
  }
  const source: AudioSourceSelection = {
    ...approved,
    mode: requestedSource.mode ?? "full-audit",
  };
  activeScanController?.abort();
  const controller = new AbortController();
  const pauseGate = new ScanPauseGate();
  activeScanController = controller;
  activeScanPause = pauseGate;
  const sessionId = await auditSessions.create(source);
  const persistence = new SessionPersistenceBuffer(auditSessions, sessionId);
  let sessionWarnings: string[] = [];
  try {
    const result = await scanSources(
      source,
      (progress) => {
        if (progress.file) {
          const normalizedPath = path.resolve(progress.file.path);
          approvedAudioFiles.add(normalizedPath);
          authoritativeRecords.set(normalizedPath, progress.file);
        }
        _event.sender.send("library:scan-progress", progress);
      },
      {
        signal: controller.signal,
        cache: oracleCache,
        analyzeFile: (filePath, signal) =>
          oracleWorkers.analyze(filePath, signal),
        onDiscovered: async (filePaths, warnings) => {
          sessionWarnings = [...warnings];
          await auditSessions.markDiscovered(
            sessionId,
            filePaths.length,
            sessionWarnings,
          );
        },
        onFileStored: (file, ordinal, fromCache) => {
          persistence.add(file, ordinal, fromCache);
        },
        waitIfPaused: () => pauseGate.wait(controller.signal),
        concurrency: oracleWorkerCount,
      },
    );
    await persistence.flush();
    sessionWarnings = result.warnings;
    await auditSessions.finish(sessionId, "completed", sessionWarnings);
    for (const file of result.files) {
      const normalizedPath = path.resolve(file.path);
      approvedAudioFiles.add(normalizedPath);
      authoritativeRecords.set(normalizedPath, file);
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
    return { ...result, sessionId };
  } catch (error) {
    await persistence.flush().catch(() => undefined);
    await auditSessions.finish(
      sessionId,
      controller.signal.aborted ? "canceled" : "failed",
      sessionWarnings,
    );
    throw error;
  } finally {
    await oracleCache.flush();
    if (activeScanController === controller) activeScanController = null;
    if (activeScanPause === pauseGate) activeScanPause = null;
  }
});

ipcMain.handle("library:pause-scan", () => activeScanPause?.pause() ?? false);

ipcMain.handle("library:resume-scan", () => activeScanPause?.resume() ?? false);

ipcMain.handle("library:cancel-scan", () => {
  if (!activeScanController) return false;
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
  const oracle = await oracleWorkers.analyze(filePath);
  const prior = authoritativeRecords.get(filePath);
  if (prior) {
    const updated = { ...prior, oracle };
    authoritativeRecords.set(filePath, updated);
    await auditSessions.setCached(updated);
    if (
      typeof requestedSessionId === "string" &&
      /^[a-f0-9-]{36}$/iu.test(requestedSessionId)
    ) {
      await auditSessions.updateSessionFile(requestedSessionId, filePath, updated);
    }
  }
  return oracle;
});

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
          oracleWorkers.analyze(candidatePath, signal),
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
    authoritativeRecords.set(outputPath, repairedFile);
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

app.whenReady().then(async () => {
  const userDataPath = app.getPath("userData");
  auditSessions = new AuditStorageClient(
    path.join(__dirname, "storage", "storage-worker.js"),
    path.join(userDataPath, "audit-sessions-v1.sqlite3"),
  );
  await auditSessions.importLegacyCache(
    path.join(userDataPath, "oracle-cache-v4.json"),
  );
  oracleCache = {
    get: (filePath) => auditSessions.getCached(filePath),
    set: (record) => auditSessions.setCached(record),
    flush: async () => undefined,
  };
  oracleWorkers = new OracleWorkerPool(
    path.join(__dirname, "oracle", "oracle-worker.js"),
    oracleWorkerCount,
  );
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  activeScanController?.abort();
  activeComparisonController?.abort();
  void oracleWorkers?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
