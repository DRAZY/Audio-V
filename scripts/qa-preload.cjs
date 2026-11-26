const { contextBridge } = require("electron");

const serializedPayload =
  process.env.AUDIO_V_QA_PAYLOAD ??
  (process.env.AUDIO_V_QA_PAYLOAD_PATH
    ? require("node:fs").readFileSync(
        process.env.AUDIO_V_QA_PAYLOAD_PATH,
        "utf8",
      )
    : null);
if (!serializedPayload) throw new Error("AUDIO_V_QA_PAYLOAD is required");

const {
  source,
  result,
  comparison,
  comparisonFiles = result?.files ?? [],
  externalIdentityPreferences = {
    acoustIdEnabled: false,
    musicBrainzEnabled: false,
    acoustIdApiKey: "",
    hasStoredAcoustIdApiKey: false,
    protection: "os-encrypted",
  },
  acceptanceRun = null,
  spectrograms = {},
  updateStatus = { state: "idle", current: "0.0.0-qa" },
} =
  JSON.parse(serializedPayload);
let savedExternalIdentityPreferences = externalIdentityPreferences;
let currentUpdateStatus = updateStatus;
const updateListeners = new Set();
const updateCalls = [];
function publishUpdateStatus(next) {
  currentUpdateStatus = { ...currentUpdateStatus, ...next };
  for (const listener of updateListeners) listener(currentUpdateStatus);
  return currentUpdateStatus;
}

contextBridge.exposeInMainWorld("audioV", {
  getUpdateStatus: async () => currentUpdateStatus,
  getUpdateSchedule: async () => "launch",
  setUpdateSchedule: async (schedule) => schedule,
  checkForUpdates: async () => currentUpdateStatus,
  installUpdate: async () => {
    updateCalls.push("install");
  },
  skipUpdate: async (version) => {
    updateCalls.push(`skip:${version}`);
    return publishUpdateStatus({ skippedVersion: version });
  },
  onUpdateStatus: (listener) => {
    updateListeners.add(listener);
    return () => updateListeners.delete(listener);
  },
  qaSetUpdateStatus: async (next) => publishUpdateStatus(next),
  qaUpdateCalls: async () => [...updateCalls],
  selectFiles: async () => source,
  selectFolder: async () => source,
  scanSelection: async () => result,
  onScanProgress: () => () => undefined,
  listAuditSessions: async () => [],
  openAuditSession: async () => null,
  openAuditSessionFile: async (_sessionId, filePath) =>
    comparisonFiles.find((file) => file.path === filePath) ??
    result.files.find((file) => file.path === filePath),
  loadComparisonFile: async (filePath) =>
    comparisonFiles.find((file) => file.path === filePath) ??
    result.files.find((file) => file.path === filePath),
  compareSignals: async () => comparison,
  externalIdentityServiceStatus: async () => ({
    officialClientConfigured: false,
    customClientRequired: true,
    explanation: "QA build",
  }),
  validateAcoustIdApiKey: async () => true,
  loadExternalIdentityPreferences: async () =>
    savedExternalIdentityPreferences,
  saveExternalIdentityPreferences: async (preferences) => {
    savedExternalIdentityPreferences = {
      ...preferences,
      acoustIdApiKey: preferences.acoustIdApiKey ?? "",
      hasStoredAcoustIdApiKey: Boolean(preferences.acoustIdApiKey),
      protection: "os-encrypted",
    };
    return savedExternalIdentityPreferences;
  },
  onIdentityProgress: () => () => undefined,
  listFingerprintLibrary: async () => [],
  rebuildFingerprintLibrary: async () => ({ affected: 0, remaining: 0 }),
  pruneFingerprintLibrary: async () => ({ affected: 0, remaining: 0 }),
  clearFingerprintLibrary: async () => ({ affected: 0, remaining: 0 }),
  auditStorageStatus: async () => null,
  onAuditHistoryCleanup: () => () => undefined,
  pauseScan: async () => false,
  resumeScan: async () => false,
  cancelScan: async () => false,
  inspectSpectrogram: async (_filePath, fftSize, channelMode) =>
    spectrograms[`${fftSize}:${channelMode}`] ?? null,
  exportSpectrogram: async () => ({ canceled: true, filePath: null }),
  exportSpectrogramBatch: async () => ({
    canceled: true,
    filePath: null,
    exportedCount: 0,
  }),
  validationStatus: async () => null,
  exportDiagnostics: async () => ({ canceled: true, filePath: null }),
  latestAcceptanceRun: async () => acceptanceRun,
  exportAcceptanceRun: async () => ({ canceled: true, filePath: null }),
  revealFile: async () => undefined,
  createTruePeakSafeCopy: async () => {
    throw new Error("Not used by populated-state QA");
  },
  analyzeFile: async () => {
    throw new Error("Not used by populated-state QA");
  },
  exportReport: async () => ({ canceled: true, filePath: null }),
  platform: async () => "darwin",
});
