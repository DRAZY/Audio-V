const { contextBridge } = require("electron");

const serializedPayload = process.env.AUDIO_V_QA_PAYLOAD;
if (!serializedPayload) throw new Error("AUDIO_V_QA_PAYLOAD is required");

const { source, result, comparison } = JSON.parse(serializedPayload);

contextBridge.exposeInMainWorld("audioV", {
  selectFiles: async () => source,
  selectFolder: async () => source,
  scanSelection: async () => result,
  onScanProgress: () => () => undefined,
  listAuditSessions: async () => [],
  openAuditSession: async () => null,
  compareSignals: async () => comparison,
  pauseScan: async () => false,
  resumeScan: async () => false,
  cancelScan: async () => false,
  inspectSpectrogram: async () => null,
  exportSpectrogram: async () => ({ canceled: true, filePath: null }),
  exportSpectrogramBatch: async () => ({
    canceled: true,
    filePath: null,
    exportedCount: 0,
  }),
  validationStatus: async () => null,
  exportDiagnostics: async () => ({ canceled: true, filePath: null }),
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
