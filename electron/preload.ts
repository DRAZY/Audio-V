import { contextBridge, ipcRenderer } from "electron";
import type { AudioVDesktopApi } from "../shared/contracts";

const api: AudioVDesktopApi = {
  ...(process.env.AUDIO_V_ENABLE_QA === "1" &&
  process.env.AUDIO_V_QA_SOURCE
    ? {
        qaLoadConfiguredSource: () =>
          ipcRenderer.invoke("qa:configured-source"),
      }
    : {}),
  selectFiles: () => ipcRenderer.invoke("library:select-files"),
  selectCompareFile: () => ipcRenderer.invoke("comparison:select-file"),
  selectFolder: () => ipcRenderer.invoke("library:select-folder"),
  validateAcoustIdApiKey: (apiKey) =>
    ipcRenderer.invoke("acoustid:validate-api-key", apiKey),
  scanSelection: (source) => ipcRenderer.invoke("library:scan-selection", source),
  onScanProgress: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: Parameters<typeof listener>[0],
    ) => listener(progress);
    ipcRenderer.on("library:scan-progress", handler);
    return () => ipcRenderer.removeListener("library:scan-progress", handler);
  },
  listAuditSessions: () => ipcRenderer.invoke("sessions:list"),
  clearAuditHistory: () => ipcRenderer.invoke("sessions:clear-history"),
  auditStorageStatus: () => ipcRenderer.invoke("storage:status"),
  optimizeAuditStorage: () => ipcRenderer.invoke("storage:optimize"),
  onAuditHistoryCleanup: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: Parameters<typeof listener>[0],
    ) => listener(progress);
    ipcRenderer.on("sessions:cleanup-progress", handler);
    return () =>
      ipcRenderer.removeListener("sessions:cleanup-progress", handler);
  },
  openAuditSession: (sessionId) =>
    ipcRenderer.invoke("sessions:open", sessionId),
  openAuditSessionFile: (sessionId, filePath) =>
    ipcRenderer.invoke("sessions:open-file", sessionId, filePath),
  setFileReviewed: (sessionId, filePath, reviewed, disposition, note) =>
    ipcRenderer.invoke(
      "sessions:set-file-reviewed",
      sessionId,
      filePath,
      reviewed,
      disposition,
      note,
    ),
  prepareAuditSessionResume: (sessionId, strategy) =>
    ipcRenderer.invoke("sessions:prepare-resume", sessionId, strategy),
  compareSignals: (leftPath, rightPath, channelMapping, region) =>
    ipcRenderer.invoke(
      "comparison:analyze-signals",
      leftPath,
      rightPath,
      channelMapping,
      region,
    ),
  loadComparisonFile: (filePath, sessionId) =>
    ipcRenderer.invoke("comparison:load-file", filePath, sessionId),
  externalIdentityServiceStatus: () =>
    ipcRenderer.invoke("identity:service-status"),
  identifyFiles: (
    filePaths,
    sessionId,
    acoustIdApiKey,
    musicBrainzEnabled,
  ) =>
    ipcRenderer.invoke(
      "identity:identify-files",
      filePaths,
      sessionId,
      acoustIdApiKey,
      musicBrainzEnabled,
    ),
  onIdentityProgress: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: Parameters<typeof listener>[0],
    ) => listener(progress);
    ipcRenderer.on("identity:progress", handler);
    return () => ipcRenderer.removeListener("identity:progress", handler);
  },
  listFingerprintLibrary: () =>
    ipcRenderer.invoke("fingerprints:list"),
  rebuildFingerprintLibrary: () =>
    ipcRenderer.invoke("fingerprints:rebuild"),
  pruneFingerprintLibrary: () =>
    ipcRenderer.invoke("fingerprints:prune"),
  clearFingerprintLibrary: () =>
    ipcRenderer.invoke("fingerprints:clear"),
  pauseScan: () => ipcRenderer.invoke("library:pause-scan"),
  resumeScan: () => ipcRenderer.invoke("library:resume-scan"),
  cancelScan: () => ipcRenderer.invoke("library:cancel-scan"),
  analyzeFile: (filePath, sessionId) =>
    ipcRenderer.invoke("oracle:analyze-file", filePath, sessionId),
  inspectSpectrogram: (filePath, fftSize, channelMode) =>
    ipcRenderer.invoke(
      "oracle:inspect-spectrogram",
      filePath,
      fftSize,
      channelMode,
    ),
  exportReport: (request, format) =>
    ipcRenderer.invoke("reports:export", request, format),
  exportSpectrogram: (fileName, dataUrl) =>
    ipcRenderer.invoke("reports:export-spectrogram", fileName, dataUrl),
  exportSpectrogramBatch: (items) =>
    ipcRenderer.invoke("reports:export-spectrogram-batch", items),
  validationStatus: () => ipcRenderer.invoke("oracle:validation-status"),
  exportDiagnostics: () => ipcRenderer.invoke("app:export-diagnostics"),
  openApplicationLogs: () => ipcRenderer.invoke("app:open-logs"),
  revealFile: (filePath) => ipcRenderer.invoke("files:reveal", filePath),
  createTruePeakSafeCopy: (filePath, targetBitDepth) =>
    ipcRenderer.invoke(
      "repair:create-true-peak-copy",
      filePath,
      targetBitDepth,
    ),
  platform: () => ipcRenderer.invoke("app:platform"),
};

contextBridge.exposeInMainWorld("audioV", api);
