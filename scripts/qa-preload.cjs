const { contextBridge } = require("electron");

const serializedPayload = process.env.AUDIO_V_QA_PAYLOAD;
if (!serializedPayload) throw new Error("AUDIO_V_QA_PAYLOAD is required");

const { source, result } = JSON.parse(serializedPayload);

contextBridge.exposeInMainWorld("audioV", {
  selectFiles: async () => source,
  selectFolder: async () => source,
  scanSelection: async () => result,
  analyzeFile: async () => {
    throw new Error("Not used by populated-state QA");
  },
  exportReport: async () => ({ canceled: true, filePath: null }),
  platform: async () => "darwin",
});
