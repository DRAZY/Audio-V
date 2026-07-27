<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type {
  AudioFileRecord,
  AudioSourceSelection,
  AuditSessionSummary,
  DecodedSignalComparison,
  OracleVerdict,
  ReportExportFormat,
} from "../shared/contracts";
import iconUrl from "../build/icon.svg";
import { audioFormatLabel } from "../shared/audio-format";
import { createVirtualWindow } from "../shared/virtual-window";

type AnalysisPanel = "spectrogram" | "loudness" | "evidence";
type WorkspacePanel = "audit" | "compare" | "repair" | "reports" | "settings";
type RepairBitDepthMode = "source" | "16" | "24";

const files = ref<AudioFileRecord[]>([]);
const selectedId = ref("");
const activePanel = ref<AnalysisPanel>("spectrogram");
const activeWorkspace = ref<WorkspacePanel>("audit");
const sourceRoot = ref("No source selected");
const activeSessionId = ref("");
const scanMessage = ref("Ready for files or a folder");
const diagnosticsMessage = ref(
  "Diagnostics exclude filenames, paths, checksums, tags, and audio evidence.",
);
const isDiscovering = ref(false);
const isScanPaused = ref(false);
const historyOpen = ref(false);
const recentSessions = ref<AuditSessionSummary[]>([]);
const loadingSessionId = ref("");
const isAnalyzing = ref(false);
const filter = ref<"all" | "clear" | "review" | "metadata" | "failed">("all");
const compareAId = ref("");
const compareBId = ref("");
const comparisonFiles = ref<AudioFileRecord[]>([]);
const compareLoadingSlot = ref<"a" | "b" | null>(null);
const signalComparison = ref<DecodedSignalComparison | null>(null);
const signalComparisonLoading = ref(false);
const signalComparisonError = ref("");
const reportSelectedId = ref("");
const reportExportFormat = ref<ReportExportFormat>("pdf");
const spectrogramCanvas = ref<HTMLCanvasElement | null>(null);
const compareSpectrogramA = ref<HTMLCanvasElement | null>(null);
const compareSpectrogramB = ref<HTMLCanvasElement | null>(null);
const compareSpectrogramDifference = ref<HTMLCanvasElement | null>(null);
const spectrogramScale = ref<"linear" | "log">("linear");
const spectrogramFloor = ref<-120 | -100 | -80>(-120);
const spectrogramFftSize = ref(512);
const spectrogramCursor = ref("Move across the plot for time, frequency, and level");
const acknowledgedReviewIds = ref<Set<string>>(new Set());
const repairingFileId = ref("");
const repairBitDepthModes = ref<Record<string, RepairBitDepthMode>>({});
const tableBody = ref<HTMLElement | null>(null);
const tableScrollTop = ref(0);
const tableViewportHeight = ref(360);
const virtualRowHeight = 38;
const virtualOverscan = 8;
const primaryModifier = navigator.platform.includes("Mac") ? "⌘" : "Ctrl";

const selected = computed(
  () => files.value.find((file) => file.id === selectedId.value) ?? files.value[0],
);
const canAnalyzeSelected = computed(() => Boolean(selected.value));
const displaySpectrum = computed(() => {
  const measurements = selected.value?.oracle.measurements;
  if (!measurements) return null;
  return (
    measurements.spectrogramPyramid?.find(
      (spectrum) => spectrum.fftSize === spectrogramFftSize.value,
    ) ?? measurements.spectrogram
  );
});

const visibleFiles = computed(() => {
  if (filter.value === "all") return files.value;
  if (filter.value === "clear") {
    return files.value.filter((file) =>
      ["verified", "authentic"].includes(file.oracle.verdict),
    );
  }
  if (filter.value === "review") {
    return files.value.filter((file) =>
      ["review", "likely-transcode", "likely-upsample"].includes(file.oracle.verdict),
    );
  }
  if (filter.value === "metadata") {
    return files.value.filter((file) => file.oracle.scope === "metadata-only");
  }
  return files.value.filter((file) => file.oracle.verdict === "damaged");
});
const virtualWindow = computed(() => {
  const window = createVirtualWindow(
    visibleFiles.value,
    tableScrollTop.value,
    tableViewportHeight.value,
    virtualRowHeight,
    virtualOverscan,
  );
  return {
    files: window.items,
    paddingTop: window.paddingTop,
    paddingBottom: window.paddingBottom,
  };
});
const comparisonOptions = computed(() => {
  const byId = new Map<string, AudioFileRecord>();
  for (const file of [...files.value, ...comparisonFiles.value]) {
    byId.set(file.id, file);
  }
  return [...byId.values()];
});
const compareA = computed(() =>
  comparisonOptions.value.find((file) => file.id === compareAId.value),
);
const compareB = computed(() =>
  comparisonOptions.value.find((file) => file.id === compareBId.value),
);
const comparisonSummary = computed(() => {
  if (!compareA.value || !compareB.value) return null;
  const hashA = compareA.value.oracle.technical?.fileSha256;
  const hashB = compareB.value.oracle.technical?.fileSha256;
  const durationA = compareA.value.oracle.measurements?.durationSeconds;
  const durationB = compareB.value.oracle.measurements?.durationSeconds;
  const loudnessA = compareA.value.oracle.measurements?.integratedLufs;
  const loudnessB = compareB.value.oracle.measurements?.integratedLufs;
  const exact = Boolean(hashA && hashB && hashA === hashB);
  const durationDelta =
    durationA === undefined || durationB === undefined
      ? null
      : Math.abs(durationA - durationB);
  const loudnessDelta =
    loudnessA === null ||
    loudnessA === undefined ||
    loudnessB === null ||
    loudnessB === undefined
      ? null
      : loudnessB - loudnessA;
  return {
    relationship: exact
      ? "Byte-identical files"
      : durationDelta !== null && durationDelta <= 0.1
        ? "Distinct files with matching duration"
        : "Distinct files with different duration",
    exact,
    durationDelta,
    loudnessDelta,
  };
});
const attentionItems = computed(() =>
  files.value.filter((file) => ["review", "damaged"].includes(file.oracle.verdict)),
);
const reportSelected = computed(() =>
  files.value.find((file) => file.id === reportSelectedId.value),
);

const counts = computed(() => {
  const clear = files.value.filter((file) =>
    ["verified", "authentic"].includes(file.oracle.verdict),
  ).length;
  const failed = files.value.filter(
    (file) => file.oracle.verdict === "damaged",
  ).length;
  const metadataOnly = files.value.filter(
    (file) => file.oracle.scope === "metadata-only",
  ).length;
  const review = files.value.filter((file) =>
    ["review", "likely-transcode", "likely-upsample"].includes(file.oracle.verdict),
  ).length;
  return { clear, review, metadataOnly, failed };
});

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

function formatRate(rate: number | null): string {
  return rate ? `${rate / 1_000} kHz` : "—";
}

function formatBitrate(bitrate: number | null): string {
  return bitrate ? `${Math.round(bitrate / 1_000)} kbps` : "—";
}

function formatHz(frequency: number | null | undefined): string {
  if (frequency === null || frequency === undefined) return "—";
  return frequency >= 1_000
    ? `${(frequency / 1_000).toFixed(1)} kHz`
    : `${Math.round(frequency)} Hz`;
}

function formatDb(value: number | null): string {
  return value === null ? "Silence" : `${value.toFixed(2)} dBFS`;
}

function formatCorrelation(value: number | null): string {
  return value === null ? "—" : value.toFixed(3);
}

function verdictClass(verdict: OracleVerdict): string {
  if (["verified", "authentic"].includes(verdict)) return "clear";
  if (verdict === "damaged") return "failed";
  if (["likely-transcode", "likely-upsample"].includes(verdict)) return "likely";
  return "review";
}

function shortVerdict(file: AudioFileRecord): string {
  const labels: Record<OracleVerdict, string> = {
    verified: "Clear",
    authentic: "Clear",
    review: "Review",
    "likely-transcode": "Likely",
    "likely-upsample": "Likely",
    damaged: "Failed",
    inconclusive: file.oracle.measurements ? "Measured" : "Metadata only",
  };
  return labels[file.oracle.verdict];
}

function oracleConfidenceDescription(file: AudioFileRecord): string {
  if (file.oracle.verdict === "damaged") {
    return "Deterministic integrity failure · complete evidence available";
  }
  if (
    ["possible-lossy-transcode", "possible-upsample"].includes(
      file.oracle.fidelity?.classification ?? "",
    )
  ) {
    return `${file.oracle.fidelity?.confidence ?? "—"}% heuristic rule strength · ${file.oracle.fidelity?.evidenceCoverage ?? 0}% evidence coverage`;
  }
  if (file.oracle.measurements) {
    return `Deterministic checks completed · ${file.oracle.scope}`;
  }
  return "No decoded-signal classification";
}

function spectralColor(dbfs: number, floor: number): string {
  const value = Math.max(0, Math.min(1, (dbfs - floor) / -floor));
  const stops = [
    [7, 8, 18],
    [38, 21, 78],
    [127, 32, 126],
    [225, 60, 75],
    [255, 170, 53],
    [255, 241, 159],
  ];
  const scaled = value * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const color = stops[index].map((channel, channelIndex) =>
    Math.round(channel + (stops[index + 1][channelIndex] - channel) * mix),
  );
  return `rgb(${color.join(",")})`;
}

async function renderSpectrogram(): Promise<void> {
  await nextTick();
  const canvas = spectrogramCanvas.value;
  const spectral = displaySpectrum.value;
  if (!canvas || !spectral || spectral.slices.length === 0) return;
  const bins = spectral.slices[0]?.levelsDbfs.length ?? 0;
  if (!bins) return;
  canvas.width = spectral.slices.length;
  canvas.height = bins;
  const context = canvas.getContext("2d");
  if (!context) return;
  const pixels = context.createImageData(canvas.width, canvas.height);
  for (let x = 0; x < spectral.slices.length; x += 1) {
    for (let bin = 0; bin < bins; bin += 1) {
      const frequencyFraction = bin / Math.max(1, bins - 1);
      const frequency =
        spectrogramScale.value === "linear"
          ? frequencyFraction * spectral.maxFrequencyHz
          : 20 *
            (spectral.maxFrequencyHz / 20) ** frequencyFraction;
      const sourceBin = Math.min(
        bins - 1,
        Math.max(
          0,
          Math.round(
            (frequency / spectral.maxFrequencyHz) * (bins - 1),
          ),
        ),
      );
      const color = spectralColor(
        spectral.slices[x].levelsDbfs[sourceBin],
        spectrogramFloor.value,
      )
        .match(/\d+/g)!
        .map(Number);
      const y = bins - 1 - bin;
      const offset = (y * canvas.width + x) * 4;
      pixels.data[offset] = color[0];
      pixels.data[offset + 1] = color[1];
      pixels.data[offset + 2] = color[2];
      pixels.data[offset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
}

function waveformPath(file: AudioFileRecord | undefined): string {
  const points = file?.oracle.measurements?.waveform?.points;
  if (!points?.length) return "";
  const x = (index: number) =>
    (index / Math.max(1, points.length - 1)) * 1_000;
  const y = (sample: number) => 60 - Math.max(-1, Math.min(1, sample)) * 54;
  const upper = points
    .map((point, index) => `${x(index).toFixed(2)},${y(point.maximum).toFixed(2)}`)
    .join(" L ");
  const lower = [...points]
    .reverse()
    .map((point, reverseIndex) => {
      const index = points.length - 1 - reverseIndex;
      return `${x(index).toFixed(2)},${y(point.minimum).toFixed(2)}`;
    })
    .join(" L ");
  return `M ${upper} L ${lower} Z`;
}

function drawComparisonSpectrum(
  canvas: HTMLCanvasElement | null,
  file: AudioFileRecord | undefined,
): void {
  const spectral = file?.oracle.measurements?.spectrogram;
  if (!canvas || !spectral?.slices.length) return;
  const bins = spectral.slices[0]?.levelsDbfs.length ?? 0;
  if (!bins) return;
  canvas.width = spectral.slices.length;
  canvas.height = bins;
  const context = canvas.getContext("2d");
  if (!context) return;
  const pixels = context.createImageData(canvas.width, canvas.height);
  for (let x = 0; x < canvas.width; x += 1) {
    for (let bin = 0; bin < bins; bin += 1) {
      const color = spectralColor(
        spectral.slices[x].levelsDbfs[bin],
        -120,
      )
        .match(/\d+/g)!
        .map(Number);
      const offset = ((bins - 1 - bin) * canvas.width + x) * 4;
      pixels.data[offset] = color[0];
      pixels.data[offset + 1] = color[1];
      pixels.data[offset + 2] = color[2];
      pixels.data[offset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
}

function drawComparisonDifference(): void {
  const canvas = compareSpectrogramDifference.value;
  const spectrumA = compareA.value?.oracle.measurements?.spectrogram;
  const spectrumB = compareB.value?.oracle.measurements?.spectrogram;
  if (!canvas || !spectrumA?.slices.length || !spectrumB?.slices.length) return;
  const width = Math.min(spectrumA.slices.length, spectrumB.slices.length);
  const height = Math.min(
    spectrumA.slices[0].levelsDbfs.length,
    spectrumB.slices[0].levelsDbfs.length,
  );
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
  const pixels = context.createImageData(width, height);
  for (let x = 0; x < width; x += 1) {
    const indexA = Math.round(
      (x / Math.max(1, width - 1)) * (spectrumA.slices.length - 1),
    );
    const indexB = Math.round(
      (x / Math.max(1, width - 1)) * (spectrumB.slices.length - 1),
    );
    for (let bin = 0; bin < height; bin += 1) {
      const binA = Math.round(
        (bin / Math.max(1, height - 1)) *
          (spectrumA.slices[indexA].levelsDbfs.length - 1),
      );
      const binB = Math.round(
        (bin / Math.max(1, height - 1)) *
          (spectrumB.slices[indexB].levelsDbfs.length - 1),
      );
      const difference =
        spectrumB.slices[indexB].levelsDbfs[binB] -
        spectrumA.slices[indexA].levelsDbfs[binA];
      const magnitude = Math.min(1, Math.abs(difference) / 30);
      const offset = ((height - 1 - bin) * width + x) * 4;
      const neutral = [28, 30, 36];
      const target = difference >= 0 ? [141, 100, 255] : [66, 223, 229];
      pixels.data[offset] = Math.round(
        neutral[0] + (target[0] - neutral[0]) * magnitude,
      );
      pixels.data[offset + 1] = Math.round(
        neutral[1] + (target[1] - neutral[1]) * magnitude,
      );
      pixels.data[offset + 2] = Math.round(
        neutral[2] + (target[2] - neutral[2]) * magnitude,
      );
      pixels.data[offset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
}

async function renderComparisonVisuals(): Promise<void> {
  await nextTick();
  drawComparisonSpectrum(compareSpectrogramA.value, compareA.value);
  drawComparisonSpectrum(compareSpectrogramB.value, compareB.value);
  drawComparisonDifference();
}

let comparisonRequest = 0;
async function analyzeComparisonSignals(): Promise<void> {
  const left = compareA.value;
  const right = compareB.value;
  if (!window.audioV || !left || !right) {
    signalComparison.value = null;
    signalComparisonError.value = "";
    return;
  }
  const request = ++comparisonRequest;
  signalComparisonLoading.value = true;
  signalComparisonError.value = "";
  try {
    const result = await window.audioV.compareSignals(left.path, right.path);
    if (request === comparisonRequest) signalComparison.value = result;
  } catch (error) {
    if (request === comparisonRequest) {
      signalComparison.value = null;
      signalComparisonError.value =
        error instanceof Error
          ? error.message
          : "Decoded-signal alignment failed.";
    }
  } finally {
    if (request === comparisonRequest) signalComparisonLoading.value = false;
  }
}

watch(
  () => [
    selected.value?.id,
    selected.value?.oracle.measuredAt,
    activePanel.value,
    spectrogramScale.value,
    spectrogramFloor.value,
    spectrogramFftSize.value,
  ],
  () => void renderSpectrogram(),
);
watch(
  () => [
    compareA.value?.id,
    compareA.value?.oracle.measuredAt,
    compareB.value?.id,
    compareB.value?.oracle.measuredAt,
    activeWorkspace.value,
  ],
  () => {
    void renderComparisonVisuals();
    if (activeWorkspace.value === "compare") void analyzeComparisonSignals();
  },
);
watch(filter, () => {
  tableScrollTop.value = 0;
  if (tableBody.value) tableBody.value.scrollTop = 0;
});
let removeScanProgressListener: (() => void) | null = null;
let progressFrame: number | null = null;
let queuedProgressFiles: AudioFileRecord[] = [];

function queueProgressFile(file: AudioFileRecord): void {
  queuedProgressFiles.push(file);
  if (progressFrame !== null) return;
  progressFrame = requestAnimationFrame(() => {
    const merged = new Map(files.value.map((entry) => [entry.id, entry]));
    for (const entry of queuedProgressFiles) merged.set(entry.id, entry);
    queuedProgressFiles = [];
    files.value = [...merged.values()];
    progressFrame = null;
  });
}

function updateTableViewport(event: Event): void {
  const element = event.currentTarget as HTMLElement;
  tableScrollTop.value = element.scrollTop;
  tableViewportHeight.value = element.clientHeight;
}

onMounted(() => {
  void renderSpectrogram();
  void renderComparisonVisuals();
  void refreshAuditSessions();
  removeScanProgressListener =
    window.audioV?.onScanProgress((progress) => {
      if (!isDiscovering.value) return;
      if (progress.file) {
        queueProgressFile(progress.file);
        if (!selectedId.value) selectedId.value = progress.file.id;
      }
      if (progress.phase === "discovered") {
        scanMessage.value = `${progress.total.toLocaleString()} audio files discovered · starting complete decode`;
      } else if (progress.phase === "analyzing") {
        scanMessage.value = `${progress.completed.toLocaleString()} of ${progress.total.toLocaleString()} ${progress.fromCache ? "restored from verified cache" : "fully analyzed"} · ${progress.currentFile}`;
      }
    }) ?? null;
  void window.audioV?.qaLoadConfiguredSource?.().then((source) => {
    if (source) void scanSource(source);
  });
  window.addEventListener("keydown", handleGlobalKeydown);
});

onUnmounted(() => {
  removeScanProgressListener?.();
  if (progressFrame !== null) cancelAnimationFrame(progressFrame);
  window.removeEventListener("keydown", handleGlobalKeydown);
});

function handleGlobalKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (
    target?.matches("input, select, textarea") ||
    target?.isContentEditable
  ) {
    return;
  }
  if (event.key === "Escape" && historyOpen.value) {
    historyOpen.value = false;
    return;
  }
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  if (event.key.toLowerCase() === "o") {
    event.preventDefault();
    void chooseSource(event.shiftKey ? "folder" : "files");
    return;
  }
  const panels: WorkspacePanel[] = [
    "audit",
    "compare",
    "repair",
    "reports",
    "settings",
  ];
  const panel = panels[Number(event.key) - 1];
  if (panel) {
    event.preventDefault();
    activeWorkspace.value = panel;
  }
}

async function exportDiagnostics(): Promise<void> {
  if (!window.audioV) return;
  try {
    const result = await window.audioV.exportDiagnostics();
    diagnosticsMessage.value = result.canceled
      ? "Diagnostics export canceled."
      : `Privacy-safe diagnostics exported · ${result.filePath}`;
  } catch (error) {
    diagnosticsMessage.value =
      error instanceof Error
        ? error.message
        : "Diagnostics could not be exported.";
  }
}

async function scanSource(source: AudioSourceSelection): Promise<void> {
  isDiscovering.value = true;
  isScanPaused.value = false;
  files.value = [];
  selectedId.value = "";
  scanMessage.value = "Discovering files and fully decoding every supported audio stream…";
  sourceRoot.value = source.label;

  try {
    const result = await window.audioV!.scanSelection(source);
    if (progressFrame !== null) {
      cancelAnimationFrame(progressFrame);
      progressFrame = null;
    }
    queuedProgressFiles = [];
    activeSessionId.value = result.sessionId ?? "";
    files.value = result.files;
    const firstMeasured =
      result.files.find((file) => file.oracle.measurements) ?? result.files[0];
    selectedId.value = firstMeasured?.id ?? "";
    compareAId.value = result.files[0]?.id ?? "";
    compareBId.value = result.files[1]?.id ?? result.files[0]?.id ?? "";
    reportSelectedId.value = result.files[0]?.id ?? "";
    activePanel.value = firstMeasured?.oracle.measurements ? "loudness" : "evidence";
    filter.value = "all";
    const measured = result.files.filter((file) => file.oracle.measuredAt).length;
    const metadataOnly = result.files.filter(
      (file) => !file.oracle.measuredAt && !file.scanError,
    ).length;
    const warnings = result.warnings.length
      ? ` · ${result.warnings.length} source warning${result.warnings.length === 1 ? "" : "s"}`
      : "";
    scanMessage.value =
      `${result.files.length.toLocaleString()} files loaded` +
      `${measured ? ` · ${measured} analyzed` : ""}` +
      `${metadataOnly ? ` · ${metadataOnly} metadata only` : ""}` +
      `${result.unreadableCount ? ` · ${result.unreadableCount} unreadable` : ""}` +
      warnings;
    await refreshAuditSessions();
  } catch (error) {
    scanMessage.value =
      error instanceof Error ? error.message : "The selected source could not be scanned.";
  } finally {
    isDiscovering.value = false;
    isScanPaused.value = false;
    await refreshAuditSessions();
  }
}

async function refreshAuditSessions(): Promise<void> {
  if (!window.audioV) return;
  recentSessions.value = await window.audioV.listAuditSessions();
}

async function openAuditSession(sessionId: string): Promise<void> {
  if (!window.audioV || isDiscovering.value) return;
  loadingSessionId.value = sessionId;
  try {
    const session = await window.audioV.openAuditSession(sessionId);
    files.value = session.files;
    activeSessionId.value = session.id;
    sourceRoot.value = session.label;
    selectedId.value = session.files[0]?.id ?? "";
    compareAId.value = session.files[0]?.id ?? "";
    compareBId.value = session.files[1]?.id ?? session.files[0]?.id ?? "";
    reportSelectedId.value = session.files[0]?.id ?? "";
    scanMessage.value =
      `${session.completedCount.toLocaleString()} of ${session.discoveredCount.toLocaleString()} files restored · ${session.status}`;
    historyOpen.value = false;
  } catch (error) {
    scanMessage.value =
      error instanceof Error ? error.message : "The audit session could not be opened.";
  } finally {
    loadingSessionId.value = "";
  }
}

async function resumeAuditSession(session: AuditSessionSummary): Promise<void> {
  if (!window.audioV || isDiscovering.value) return;
  await openAuditSession(session.id);
  await scanSource(session.source);
}

async function toggleScanPause(): Promise<void> {
  if (!window.audioV || !isDiscovering.value) return;
  const changed = isScanPaused.value
    ? await window.audioV.resumeScan()
    : await window.audioV.pauseScan();
  if (!changed) return;
  isScanPaused.value = !isScanPaused.value;
  scanMessage.value = isScanPaused.value
    ? "Audit paused after active files finish · results are safely persisted"
    : "Audit resumed";
}

async function chooseSource(kind: "files" | "folder"): Promise<void> {
  if (!window.audioV) {
    scanMessage.value =
      "File selection is available when running inside the Audio-V desktop shell.";
    return;
  }

  const source =
    kind === "files"
      ? await window.audioV.selectFiles()
      : await window.audioV.selectFolder();
  if (source) await scanSource(source);
}

async function chooseComparisonFile(slot: "a" | "b"): Promise<void> {
  if (!window.audioV || isDiscovering.value) return;
  compareLoadingSlot.value = slot;
  scanMessage.value = `Choose File ${slot.toUpperCase()} for comparison`;
  try {
    const source = await window.audioV.selectCompareFile();
    if (!source) {
      scanMessage.value = "Comparison selection canceled";
      return;
    }
    scanMessage.value = `Analyzing comparison file · ${source.label}`;
    const result = await window.audioV.scanSelection(source);
    const file = result.files[0];
    if (!file) {
      scanMessage.value = "No supported audio file was selected";
      return;
    }
    comparisonFiles.value = [
      ...comparisonFiles.value.filter((entry) => entry.id !== file.id),
      file,
    ];
    if (slot === "a") compareAId.value = file.id;
    else compareBId.value = file.id;
    scanMessage.value = `Comparison file analyzed · ${file.name}`;
  } catch (error) {
    scanMessage.value =
      error instanceof Error ? error.message : "The comparison file could not be analyzed.";
  } finally {
    compareLoadingSlot.value = null;
  }
}

function swapComparison(): void {
  const previousA = compareAId.value;
  compareAId.value = compareBId.value;
  compareBId.value = previousA;
}

async function cancelScan(): Promise<void> {
  if (!window.audioV || !isDiscovering.value) return;
  scanMessage.value = "Canceling active decoders and preserving completed results…";
  await window.audioV.cancelScan();
}

async function analyzeSelected(): Promise<void> {
  if (!window.audioV || !selected.value || !canAnalyzeSelected.value) return;
  isAnalyzing.value = true;
  scanMessage.value = `Decoding and analyzing ${selected.value.name}…`;

  try {
    const oracle = await window.audioV.analyzeFile(
      selected.value.path,
      activeSessionId.value || undefined,
    );
    files.value = files.value.map((file) =>
      file.id === selected.value?.id ? { ...file, oracle } : file,
    );
    activePanel.value = oracle.measurements ? "loudness" : "evidence";
    scanMessage.value = oracle.measurements
      ? `Complete decode and analysis passed · ${selected.value.name}`
      : `Decode-integrity failure · ${selected.value.name}`;
  } catch (error) {
    scanMessage.value =
      error instanceof Error ? error.message : "The complete audio analysis failed.";
  } finally {
    isAnalyzing.value = false;
  }
}

async function retryFailedFiles(): Promise<void> {
  if (!window.audioV || isAnalyzing.value || isDiscovering.value) return;
  const failed = files.value.filter(
    (file) => file.oracle.verdict === "damaged",
  );
  if (!failed.length) return;
  isAnalyzing.value = true;
  let completed = 0;
  try {
    for (const file of failed) {
      scanMessage.value = `Retrying failed files · ${completed + 1} of ${failed.length} · ${file.name}`;
      const oracle = await window.audioV.analyzeFile(
        file.path,
        activeSessionId.value || undefined,
      );
      files.value = files.value.map((candidate) =>
        candidate.id === file.id ? { ...candidate, oracle } : candidate,
      );
      completed += 1;
    }
    scanMessage.value = `Retry complete · ${completed} file${completed === 1 ? "" : "s"} re-analyzed`;
  } catch (error) {
    scanMessage.value =
      error instanceof Error ? error.message : "Failed-file retry stopped.";
  } finally {
    isAnalyzing.value = false;
    await refreshAuditSessions();
  }
}

async function exportAuditReport(): Promise<void> {
  if (!window.audioV || files.value.length === 0 || !activeSessionId.value) return;
  scanMessage.value = "Preparing audit report…";
  try {
    const result = await window.audioV.exportReport(
      { scope: "session", sessionId: activeSessionId.value },
      reportExportFormat.value,
    );
    scanMessage.value = result.canceled
      ? "Report export canceled"
      : `Report exported · ${result.filePath}`;
  } catch (error) {
    scanMessage.value =
      error instanceof Error ? error.message : "The report could not be exported.";
  }
}

function updateSpectrogramCursor(event: MouseEvent): void {
  const canvas = spectrogramCanvas.value;
  const spectral = displaySpectrum.value;
  if (!canvas || !spectral || spectral.slices.length === 0) return;
  const bounds = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  const frequencyFraction = Math.max(
    0,
    Math.min(1, 1 - (event.clientY - bounds.top) / bounds.height),
  );
  const frequency =
    spectrogramScale.value === "linear"
      ? frequencyFraction * spectral.maxFrequencyHz
      : 20 * (spectral.maxFrequencyHz / 20) ** frequencyFraction;
  const sliceIndex = Math.min(
    spectral.slices.length - 1,
    Math.round(x * (spectral.slices.length - 1)),
  );
  const binIndex = Math.min(
    spectral.slices[sliceIndex].levelsDbfs.length - 1,
    Math.round(
      (frequency / spectral.maxFrequencyHz) *
        (spectral.slices[sliceIndex].levelsDbfs.length - 1),
    ),
  );
  spectrogramCursor.value =
    `${(x * spectral.durationSeconds).toFixed(2)} s · ` +
    `${frequency >= 1_000 ? `${(frequency / 1_000).toFixed(2)} kHz` : `${Math.round(frequency)} Hz`} · ` +
    `${spectral.slices[sliceIndex].levelsDbfs[binIndex].toFixed(1)} dBFS`;
}

async function exportSpectrogram(): Promise<void> {
  const canvas = spectrogramCanvas.value;
  if (!window.audioV || !canvas || !selected.value) return;
  const result = await window.audioV.exportSpectrogram(
    selected.value.name,
    canvas.toDataURL("image/png"),
  );
  scanMessage.value = result.canceled
    ? "Spectrogram export canceled"
    : `Spectrogram exported · ${result.filePath}`;
}

function comparisonValue(
  file: AudioFileRecord | undefined,
  field:
    | "samplePeak"
    | "truePeak"
    | "loudness"
    | "rms"
    | "clipping"
    | "correlation"
    | "bandwidth",
): string {
  const measurements = file?.oracle.measurements;
  if (!measurements) return "Not measured";
  if (field === "samplePeak") return formatDb(measurements.samplePeakDbfs);
  if (field === "truePeak") {
    return measurements.truePeakDbtp === null
      ? "—"
      : `${measurements.truePeakDbtp.toFixed(1)} dBTP`;
  }
  if (field === "loudness") {
    return measurements.integratedLufs === null
      ? "—"
      : `${measurements.integratedLufs.toFixed(1)} LUFS`;
  }
  if (field === "rms") return formatDb(measurements.rmsDbfs);
  if (field === "clipping") return measurements.clippedSamples.toLocaleString();
  if (field === "bandwidth") {
    return measurements.spectrogram.effectiveBandwidthHz === null
      ? "—"
      : `${(measurements.spectrogram.effectiveBandwidthHz / 1_000).toFixed(1)} kHz`;
  }
  return formatCorrelation(measurements.stereoCorrelation);
}

function originAssessmentLabel(file: AudioFileRecord): string {
  const classification = file.oracle.fidelity?.classification;
  if (!classification) return "Not assessed";
  return {
    "no-strong-spectral-anomaly": "No strong spectral anomaly",
    "bandwidth-limited": "Bandwidth limited",
    "possible-lossy-transcode": "Possible lossy transcode",
    "possible-upsample": "Possible upsample",
    inconclusive: "Inconclusive",
  }[classification];
}

function originAssessmentSummary(file: AudioFileRecord): string {
  const classification = file.oracle.fidelity?.classification;
  if (classification === "no-strong-spectral-anomaly") {
    return "The decoded spectrum broadly occupies the bandwidth expected for the declared sample rate. This does not prove the file's source history.";
  }
  if (classification === "bandwidth-limited") {
    return "The decoded signal uses less than the declared frequency range, but the evidence does not identify a unique cause.";
  }
  if (classification === "possible-lossy-transcode") {
    return "A lossless file contains a spectral cutoff compatible with an earlier perceptual-codec source. This is a review indicator, not proof.";
  }
  if (classification === "possible-upsample") {
    return "The declared high-resolution range exceeds the observed signal bandwidth in a pattern compatible with upsampling. This is not proof of provenance.";
  }
  if (classification === "inconclusive") {
    return "There was not enough measurable spectral material to make a useful origin assessment.";
  }
  return "Origin Assessment requires a completed decoded-signal analysis.";
}

function originConfidenceLabel(file: AudioFileRecord): string {
  const fidelity = file.oracle.fidelity;
  if (!fidelity) return "Origin evidence unavailable";
  const coverage =
    typeof fidelity.evidenceCoverage === "number"
      ? `${fidelity.evidenceCoverage}% evidence coverage`
      : "evidence coverage unavailable for this legacy result";
  if (fidelity.confidence === null) {
    return `No responsible classification · ${coverage}`;
  }
  return `${fidelity.confidence}% heuristic rule strength · ${coverage}`;
}

function repairActionability(file: AudioFileRecord): {
  label: string;
  tone: "clear" | "review" | "failed";
  detail: string;
} {
  if (file.oracle.verdict === "damaged") {
    return {
      label: "Source replacement recommended",
      tone: "failed",
      detail: "Automatic repair is unavailable because rewriting cannot restore missing or checksum-invalid audio.",
    };
  }
  if ((file.oracle.measurements?.truePeakDbtp ?? -Infinity) > -1) {
    return {
      label: "Optional mitigation available",
      tone: "review",
      detail: "Audio-V can create and verify a separate playback-safe FLAC copy. The original is not changed.",
    };
  }
  if ((file.oracle.measurements?.clippedSamples ?? 0) > 0) {
    return {
      label: "Not automatically repairable",
      tone: "review",
      detail: "Clipped peaks are already embedded in the decoded signal and cannot be reconstructed by gain reduction.",
    };
  }
  if (
    ["possible-lossy-transcode", "possible-upsample"].includes(
      file.oracle.fidelity?.classification ?? "",
    )
  ) {
    return {
      label: "Source comparison recommended",
      tone: "review",
      detail: "Encoding history cannot be repaired. Compare with a trusted edition or reacquire a documented source.",
    };
  }
  return {
    label: "Manual verification required",
    tone: "review",
    detail: "No safe automatic transformation matches this finding. Review the evidence before deciding whether any action is needed.",
  };
}

function repairRecommendation(file: AudioFileRecord): string {
  if (file.oracle.verdict === "damaged") {
    return "The stream failed a deterministic integrity check. Reveal the source and re-acquire it from a verified copy; rewriting damaged audio would conceal the failure without restoring missing information.";
  }
  const clippedSamples = file.oracle.measurements?.clippedSamples ?? 0;
  if ((file.oracle.measurements?.truePeakDbtp ?? -Infinity) > -1) {
    const peak = file.oracle.measurements?.truePeakDbtp ?? 0;
    return clippedSamples > 0
      ? `The file contains ${clippedSamples.toLocaleString()} full-scale samples and measured ${peak.toFixed(1)} dBTP. Audio-V cannot reconstruct clipped peaks, but it can create a separate playback-safe FLAC copy with ${Math.max(0, peak + 1).toFixed(1)} dB gain reduction to target −1 dBTP. This prevents additional overload; it does not claim to declip the recording.`
      : `The stream passed integrity checks but measured ${peak.toFixed(1)} dBTP. Audio-V can create a separate FLAC working copy with ${Math.max(0, peak + 1).toFixed(1)} dB gain reduction to target −1 dBTP; the source remains byte-for-byte untouched.`;
  }
  if (clippedSamples > 0) {
    return "Clipping is already embedded in decoded samples. Gain reduction cannot reconstruct flattened peaks, so Audio-V preserves the original and routes the file to evidence review rather than claim an automatic repair.";
  }
  if (
    ["possible-lossy-transcode", "possible-upsample"].includes(
      file.oracle.fidelity?.classification ?? "",
    )
  ) {
    return "Spectral origin cannot be repaired. Compare this file with a trusted edition or re-acquire it from a documented source; Audio-V will not invent missing bandwidth.";
  }
  return "Inspect the contradictory evidence and compare against a trusted edition. No safe automatic signal transformation applies to this finding.";
}

function isReviewFile(file: AudioFileRecord): boolean {
  return ["review", "likely-transcode", "likely-upsample", "damaged"].includes(
    file.oracle.verdict,
  );
}

function reviewExplanation(file: AudioFileRecord): string {
  if (file.oracle.verdict === "damaged") {
    return "Failed means the decoder or a deterministic checksum found structural damage. Do not replace the original automatically; use the evidence to locate or restore a verified copy.";
  }
  const measurements = file.oracle.measurements;
  if (
    (measurements?.truePeakDbtp ?? -Infinity) > 0 ||
    (measurements?.clippedSamples ?? 0) > 0
  ) {
    const findings = [
      (measurements?.clippedSamples ?? 0) > 0
        ? `${measurements!.clippedSamples.toLocaleString()} decoded samples reached full scale`
        : null,
      (measurements?.truePeakDbtp ?? -Infinity) > 0
        ? `true peak reached ${measurements!.truePeakDbtp!.toFixed(1)} dBTP`
        : null,
    ].filter((value): value is string => value !== null);
    return `Integrity passed. Review was triggered because ${findings.join(" and ")}. Full-scale samples may be intentional mastering, but positive true peak can overload playback, sample-rate conversion, or lossy encoding.`;
  }
  if ((measurements?.continuity.internalDigitalDropoutCount ?? 0) > 0) {
    return `Integrity passed, but Audio-V found ${measurements!.continuity.internalDigitalDropoutCount} internal exact-zero interval candidates. Listen and compare before deciding whether they are intentional edits or dropouts.`;
  }
  if (file.oracle.fidelity?.classification === "possible-upsample") {
    return "Integrity passed, but the measured bandwidth and spectral cutoff are compatible with upsampling. This is a review heuristic, not proof; compare against a trusted source.";
  }
  if (file.oracle.fidelity?.classification === "possible-lossy-transcode") {
    return "Integrity passed, but the lossless file contains a cutoff pattern compatible with an earlier lossy encode. This is a review heuristic, not proof.";
  }
  return file.oracle.interpretation;
}

function canCreateTruePeakCopy(file: AudioFileRecord): boolean {
  return (
    file.oracle.verdict !== "damaged" &&
    (file.oracle.measurements?.truePeakDbtp ?? -Infinity) > -1
  );
}

function sourceRepairBitDepth(file: AudioFileRecord): 16 | 24 {
  return file.bitDepth !== null && file.bitDepth <= 16 ? 16 : 24;
}

function repairBitDepthMode(file: AudioFileRecord): RepairBitDepthMode {
  return repairBitDepthModes.value[file.id] ?? "source";
}

function repairTargetBitDepth(file: AudioFileRecord): 16 | 24 {
  const mode = repairBitDepthMode(file);
  return mode === "source" ? sourceRepairBitDepth(file) : Number(mode) as 16 | 24;
}

function updateRepairBitDepth(file: AudioFileRecord, event: Event): void {
  const value = (event.target as HTMLSelectElement).value as RepairBitDepthMode;
  repairBitDepthModes.value = {
    ...repairBitDepthModes.value,
    [file.id]: value,
  };
}

function repairBitDepthExplanation(file: AudioFileRecord): string {
  const target = repairTargetBitDepth(file);
  if (repairBitDepthMode(file) === "source" && file.bitDepth === 16) {
    return "Preserves the 16-bit source word length. Triangular dither controls quantization distortion after gain processing.";
  }
  if (repairBitDepthMode(file) === "source" && file.bitDepth === 24) {
    return "Preserves the 24-bit source word length and processing precision.";
  }
  if (file.bitDepth === 16 && target === 24) {
    return "Creates a 24-bit working copy for further processing. It does not recover detail absent from the 16-bit source.";
  }
  if (file.bitDepth === 24 && target === 16) {
    return "Creates a smaller compatibility copy using triangular dither when reducing to 16-bit.";
  }
  return target === 16
    ? "Creates a 16-bit compatibility copy with triangular dither."
    : "Uses a 24-bit FLAC working format because the source word length was not declared.";
}

function isAcknowledged(file: AudioFileRecord): boolean {
  return acknowledgedReviewIds.value.has(file.id);
}

function acknowledgeReview(file: AudioFileRecord): void {
  acknowledgedReviewIds.value = new Set([
    ...acknowledgedReviewIds.value,
    file.id,
  ]);
  scanMessage.value = `Review acknowledged · ${file.name}`;
}

function openEvidence(file: AudioFileRecord): void {
  selectedId.value = file.id;
  activeWorkspace.value = "audit";
  activePanel.value = "evidence";
}

function openRepair(file: AudioFileRecord): void {
  selectedId.value = file.id;
  activeWorkspace.value = "repair";
}

function openReport(file: AudioFileRecord): void {
  reportSelectedId.value = file.id;
}

function compareFromReport(file: AudioFileRecord): void {
  compareAId.value = file.id;
  if (compareBId.value === file.id) compareBId.value = "";
  activeWorkspace.value = "compare";
}

async function revealSource(file: AudioFileRecord): Promise<void> {
  if (!window.audioV) return;
  await window.audioV.revealFile(file.path);
  scanMessage.value = `Revealed source · ${file.name}`;
}

async function reanalyzeFile(file: AudioFileRecord): Promise<void> {
  selectedId.value = file.id;
  await nextTick();
  await analyzeSelected();
}

async function exportFileEvidence(file: AudioFileRecord): Promise<void> {
  if (!window.audioV) return;
  const result = await window.audioV.exportReport(
    { scope: "file", filePath: file.path },
    reportExportFormat.value,
  );
  scanMessage.value = result.canceled
    ? "Evidence export canceled"
    : `Evidence exported · ${result.filePath}`;
}

async function createTruePeakSafeCopy(file: AudioFileRecord): Promise<void> {
  const truePeak = file.oracle.measurements?.truePeakDbtp;
  if (!window.audioV || truePeak === null || truePeak === undefined) return;
  repairingFileId.value = file.id;
  const targetBitDepth = repairTargetBitDepth(file);
  scanMessage.value = `Creating and verifying a −1 dBTP ${targetBitDepth}-bit FLAC copy · ${file.name}`;
  try {
    const result = await window.audioV.createTruePeakSafeCopy(
      file.path,
      targetBitDepth,
    );
    if (result.canceled || !result.file) {
      scanMessage.value = "Safe-copy creation canceled";
      return;
    }
    files.value = [...files.value, result.file];
    acknowledgedReviewIds.value = new Set([
      ...acknowledgedReviewIds.value,
      file.id,
    ]);
    selectedId.value = result.file.id;
    activeWorkspace.value = "audit";
    activePanel.value = "loudness";
    scanMessage.value = `Created and verified safe copy · ${result.filePath}`;
  } catch (error) {
    scanMessage.value =
      error instanceof Error ? error.message : "The safe copy could not be created.";
  } finally {
    repairingFileId.value = "";
  }
}
</script>

<template>
  <div class="application">
    <a class="skip-link" href="#main-workspace">Skip to workspace</a>
    <aside class="side-rail" aria-label="Primary workspace navigation">
      <div class="rail-brand" role="img" aria-label="Audio-V"><img :src="iconUrl" alt="" /></div>
      <button class="rail-item" :aria-current="activeWorkspace === 'audit' ? 'page' : undefined" :class="{ active: activeWorkspace === 'audit' }" @click="activeWorkspace = 'audit'"><b aria-hidden="true">⌁</b><small>Audit</small></button>
      <button class="rail-item" :aria-current="activeWorkspace === 'compare' ? 'page' : undefined" :class="{ active: activeWorkspace === 'compare' }" @click="activeWorkspace = 'compare'"><b aria-hidden="true">⇄</b><small>Compare</small></button>
      <button class="rail-item" :aria-current="activeWorkspace === 'repair' ? 'page' : undefined" :class="{ active: activeWorkspace === 'repair' }" @click="activeWorkspace = 'repair'"><b aria-hidden="true">✦</b><small>Repair</small></button>
      <button class="rail-item" :aria-current="activeWorkspace === 'reports' ? 'page' : undefined" :class="{ active: activeWorkspace === 'reports' }" @click="activeWorkspace = 'reports'"><b aria-hidden="true">▤</b><small>Reports</small></button>
      <button class="rail-item settings" :aria-current="activeWorkspace === 'settings' ? 'page' : undefined" :class="{ active: activeWorkspace === 'settings' }" @click="activeWorkspace = 'settings'"><b aria-hidden="true">⚙</b><small>Settings</small></button>
    </aside>

    <main id="main-workspace" class="workspace" tabindex="-1">
      <h1 class="sr-only">Audio-V audio integrity and fidelity workstation</h1>
      <header class="topbar">
        <div class="product-lockup">
          <div>
            <strong>Audio-V</strong>
            <span>Oracle Engine</span>
          </div>
          <small>Audio integrity &amp; fidelity workstation</small>
        </div>
        <div class="source-command">
          <button
            class="secondary-action history-action"
            :aria-expanded="historyOpen"
            @click="historyOpen = !historyOpen"
          >
            History
          </button>
          <div class="source-field">
            <b>▰</b>
            <span>
              <small>Current source</small>
              <strong>{{ sourceRoot }}</strong>
            </span>
          </div>
          <button
            class="secondary-action"
            :disabled="isDiscovering"
            @click="chooseSource('files')"
          >
            Choose files
          </button>
          <button
            v-if="isDiscovering"
            class="secondary-action"
            @click="toggleScanPause"
          >
            {{ isScanPaused ? "Resume" : "Pause" }}
          </button>
          <button
            class="primary-action"
            @click="isDiscovering ? cancelScan() : chooseSource('folder')"
          >
            {{ isDiscovering ? "Cancel audit" : "Choose folder" }}
            <span>›</span>
          </button>
        </div>
      </header>

      <section v-if="historyOpen" class="session-history" aria-label="Recent audit sessions">
        <header>
          <div>
            <span class="eyebrow">Persistent audit history</span>
            <strong>Open completed evidence or resume an interrupted source</strong>
          </div>
          <button class="secondary-action" @click="refreshAuditSessions">Refresh</button>
        </header>
        <div v-if="recentSessions.length" class="session-history-list">
          <article v-for="session in recentSessions" :key="session.id">
            <div>
              <strong>{{ session.label }}</strong>
              <span>
                {{ session.completedCount.toLocaleString() }} / {{ session.discoveredCount.toLocaleString() }} files ·
                {{ session.warningCount }} warnings ·
                {{ new Date(session.updatedAt).toLocaleString() }}
              </span>
            </div>
            <b :class="`session-${session.status}`">{{ session.status }}</b>
            <button
              :disabled="isDiscovering || loadingSessionId === session.id"
              @click="openAuditSession(session.id)"
            >
              {{ loadingSessionId === session.id ? "Opening…" : "Open" }}
            </button>
            <button
              v-if="session.status !== 'completed'"
              class="primary-action"
              :disabled="isDiscovering || loadingSessionId === session.id"
              @click="resumeAuditSession(session)"
            >
              Resume source
            </button>
          </article>
        </div>
        <div v-else class="session-history-empty">No saved audit sessions yet.</div>
      </section>

      <template v-if="activeWorkspace === 'audit'">
      <section class="overview">
        <div class="verdict-ring" :style="{ '--sweep': files.length ? '360deg' : '0deg' }">
          <div>
            <strong>{{ files.length.toLocaleString() }}</strong>
            <span>files</span>
          </div>
        </div>
        <div class="distribution">
          <span class="eyebrow">Verdict distribution</span>
          <div class="legend">
            <span><i class="clear"></i>Clear <b>{{ counts.clear }}</b></span>
            <span><i class="review"></i>Review <b>{{ counts.review }}</b></span>
            <span><i class="failed"></i>Failed <b>{{ counts.failed }}</b></span>
            <span><i class="pending"></i>Metadata only <b>{{ counts.metadataOnly }}</b></span>
          </div>
        </div>
        <div v-if="selected" class="selected-summary">
          <span class="eyebrow">Selected file</span>
          <h1>{{ selected.name }}</h1>
          <div class="format-chips">
            <b>{{ selected.extension }}</b>
            <span>{{ formatRate(selected.sampleRate) }}</span>
            <span>{{ selected.bitDepth ? `${selected.bitDepth}-bit` : "—" }}</span>
            <span>{{ selected.channels ? `${selected.channels} ch` : "—" }}</span>
          </div>
          <p>{{ formatBytes(selected.sizeBytes) }} · {{ formatDuration(selected.durationSeconds) }}</p>
          <small>{{ selected.path }}</small>
        </div>
        <div v-else class="empty-summary">
          <span class="eyebrow">No audio selected</span>
          <strong>Add files or choose a folder to begin</strong>
        </div>
      </section>

      <section class="results-card">
        <div class="filters">
          <span class="eyebrow">Audit results</span>
          <button :aria-pressed="filter === 'all'" :class="{ active: filter === 'all' }" @click="filter = 'all'">
            All {{ files.length }}
          </button>
          <button :aria-pressed="filter === 'clear'" :class="{ active: filter === 'clear' }" @click="filter = 'clear'">
            Clear {{ counts.clear }}
          </button>
          <button :aria-pressed="filter === 'review'" :class="{ active: filter === 'review' }" @click="filter = 'review'">
            Review {{ counts.review }}
          </button>
          <button :aria-pressed="filter === 'metadata'" :class="{ active: filter === 'metadata' }" @click="filter = 'metadata'">
            Metadata {{ counts.metadataOnly }}
          </button>
          <button :aria-pressed="filter === 'failed'" :class="{ active: filter === 'failed' }" @click="filter = 'failed'">
            Failed {{ counts.failed }}
          </button>
          <button
            v-if="counts.failed"
            :disabled="isDiscovering || isAnalyzing"
            @click="retryFailedFiles"
          >
            Retry failed
          </button>
          <span class="scan-state">{{ scanMessage }}</span>
        </div>
        <div class="table-grid table-head">
          <span>File name</span><span>Format</span><span>Sample rate</span>
          <span>Bit depth</span><span>Duration</span><span>Bitrate</span>
          <span>Channels</span><span>Verdict</span>
        </div>
        <div ref="tableBody" class="table-body" @scroll="updateTableViewport">
          <div
            v-if="virtualWindow.paddingTop"
            class="virtual-spacer"
            :style="{ height: `${virtualWindow.paddingTop}px` }"
          ></div>
          <button
            v-for="file in virtualWindow.files"
            :key="file.id"
            class="table-grid file-row"
            :class="{ selected: file.id === selectedId }"
            :aria-label="`${file.name}, ${audioFormatLabel(file)}, ${shortVerdict(file)}`"
            @click="selectedId = file.id"
          >
            <span>{{ file.name }}</span>
            <span>{{ file.extension }}</span>
            <span>{{ formatRate(file.sampleRate) }}</span>
            <span>{{ file.bitDepth ? `${file.bitDepth}-bit` : "—" }}</span>
            <span>{{ formatDuration(file.durationSeconds) }}</span>
            <span>{{ formatBitrate(file.bitrate) }}</span>
            <span>{{ file.channels ?? "—" }}</span>
            <span class="row-verdict" :class="verdictClass(file.oracle.verdict)">
              <i></i>{{ shortVerdict(file) }}
            </span>
          </button>
          <div
            v-if="virtualWindow.paddingBottom"
            class="virtual-spacer"
            :style="{ height: `${virtualWindow.paddingBottom}px` }"
          ></div>
          <div v-if="visibleFiles.length === 0" class="empty-table">
            {{
              files.length === 0
                ? "Add audio files or choose a folder to begin an audit."
                : "No files match this verdict filter."
            }}
          </div>
        </div>
      </section>

      <section v-if="selected" class="analysis-card">
        <nav class="analysis-tabs" role="tablist" aria-label="Analysis views">
          <button
            v-for="panel in (['spectrogram', 'loudness', 'evidence'] as AnalysisPanel[])"
            :key="panel"
            role="tab"
            :aria-selected="activePanel === panel"
            :class="{ active: activePanel === panel }"
            @click="activePanel = panel"
          >
            {{ panel }}
          </button>
          <span>
            {{
              selected.oracle.measurements
                ? "Complete decode, integrity, loudness, and spectrum analysis finished"
                : "Complete decode did not produce signal measurements"
            }}
          </span>
        </nav>
        <div class="analysis-content">
          <div class="visualization">
            <div v-if="activePanel === 'spectrogram'" class="spectrogram">
              <div
                v-if="displaySpectrum?.slices.length"
                class="spectrogram-render"
              >
                <div class="spectrogram-meta">
                  <div>
                    <strong>Measured STFT spectrogram</strong>
                    <span>
                      {{ displaySpectrum.fftSize }}-point FFT ·
                      {{ displaySpectrum.window }} window ·
                      {{ displaySpectrum.slices.length }} slices ·
                      observed bandwidth
                      {{ displaySpectrum.effectiveBandwidthHz === null ? "—" : `${Math.round(displaySpectrum.effectiveBandwidthHz / 100) / 10} kHz` }}
                    </span>
                  </div>
                  <div class="spectrogram-controls">
                    <label>Resolution
                      <select v-model.number="spectrogramFftSize">
                        <option
                          v-for="spectrum in selected.oracle.measurements?.spectrogramPyramid ?? []"
                          :key="spectrum.fftSize"
                          :value="spectrum.fftSize"
                        >
                          {{ spectrum.fftSize === 512 ? "Overview" : "Detail" }} · {{ spectrum.fftSize }} FFT
                        </option>
                      </select>
                    </label>
                    <label>Scale
                      <select v-model="spectrogramScale">
                        <option value="linear">Linear</option>
                        <option value="log">Logarithmic</option>
                      </select>
                    </label>
                    <label>Floor
                      <select v-model="spectrogramFloor">
                        <option :value="-120">−120 dBFS</option>
                        <option :value="-100">−100 dBFS</option>
                        <option :value="-80">−80 dBFS</option>
                      </select>
                    </label>
                    <button @click="exportSpectrogram">Export PNG</button>
                  </div>
                </div>
                <div class="spectrogram-frame">
                  <div class="spectrogram-frequency">
                    <span>{{ Math.round(displaySpectrum.maxFrequencyHz / 1000) }} kHz</span>
                    <span>{{ Math.round(displaySpectrum.maxFrequencyHz / 2000) }} kHz</span>
                    <span>0 Hz</span>
                  </div>
                  <canvas
                    ref="spectrogramCanvas"
                    role="img"
                    aria-label="Measured audio spectrogram"
                    @mousemove="updateSpectrogramCursor"
                  >Measured full-track audio spectrogram.</canvas>
                </div>
                <div class="spectrogram-time">
                  <span>0:00</span>
                  <b>{{ spectrogramCursor }}</b>
                  <span>{{ formatDuration(displaySpectrum.durationSeconds) }}</span>
                </div>
              </div>
              <div v-else class="analysis-pending">
                <span>STFT</span>
                <strong>Spectrogram not measured</strong>
                <p>
                  No spectrogram is available because the complete stream decode failed.
                  Review the Evidence panel for the decoder error.
                </p>
              </div>
            </div>

            <div
              v-else-if="activePanel === 'loudness'"
              class="loudness-view"
              :class="{ measured: selected.oracle.measurements }"
            >
              <template v-if="selected.oracle.measurements">
                <article>
                  <span class="eyebrow">Sample peak</span>
                  <strong>{{ formatDb(selected.oracle.measurements.samplePeakDbfs) }}</strong>
                  <p>Maximum decoded PCM sample; this is not true peak.</p>
                </article>
                <article>
                  <span class="eyebrow">Overall RMS</span>
                  <strong>{{ formatDb(selected.oracle.measurements.rmsDbfs) }}</strong>
                  <p>Ungated root-mean-square level across all channels.</p>
                </article>
                <article>
                  <span class="eyebrow">Integrated loudness</span>
                  <strong>{{ selected.oracle.measurements.integratedLufs === null ? "—" : `${selected.oracle.measurements.integratedLufs.toFixed(1)} LUFS` }}</strong>
                  <p>Gated programme loudness measured to EBU R128.</p>
                </article>
                <article>
                  <span class="eyebrow">True peak</span>
                  <strong>{{ selected.oracle.measurements.truePeakDbtp === null ? "—" : `${selected.oracle.measurements.truePeakDbtp.toFixed(1)} dBTP` }}</strong>
                  <p>Inter-sample peak measured with BS.1770 oversampling.</p>
                </article>
                <article>
                  <span class="eyebrow">Peak-to-loudness</span>
                  <strong>{{ selected.oracle.measurements.peakToLoudnessRatioLu === null ? "—" : `${selected.oracle.measurements.peakToLoudnessRatioLu.toFixed(1)} LU` }}</strong>
                  <p>True peak minus integrated loudness; a useful micro-dynamics indicator.</p>
                </article>
                <article>
                  <span class="eyebrow">Crest factor</span>
                  <strong>{{ selected.oracle.measurements.crestFactorDb === null ? "—" : `${selected.oracle.measurements.crestFactorDb.toFixed(1)} dB` }}</strong>
                  <p>Decoded sample peak relative to overall RMS.</p>
                </article>
                <article>
                  <span class="eyebrow">Clipped samples</span>
                  <strong>{{ selected.oracle.measurements.clippedSamples.toLocaleString() }}</strong>
                  <p>{{ selected.oracle.measurements.nearClippedSamples.toLocaleString() }} at or above −0.1 dBFS.</p>
                </article>
                <article>
                  <span class="eyebrow">Stereo correlation</span>
                  <strong>{{ formatCorrelation(selected.oracle.measurements.stereoCorrelation) }}</strong>
                  <p>
                    {{
                      selected.oracle.measurements.duplicatedMono === null
                        ? "Not applicable to mono"
                        : selected.oracle.measurements.duplicatedMono
                          ? "Channels are sample-identical"
                          : "Channels contain distinct samples"
                    }}
                  </p>
                </article>
                <article>
                  <span class="eyebrow">Stereo authenticity</span>
                  <strong>{{ selected.oracle.measurements.stereoAssessment.replaceAll("-", " ") }}</strong>
                  <p>
                    Side-to-mid energy
                    {{ selected.oracle.measurements.sideToMidRatioDb === null ? "not applicable" : `${selected.oracle.measurements.sideToMidRatioDb.toFixed(1)} dB` }}.
                    This flags dual/near mono for review; it does not assume intent.
                  </p>
                </article>
              </template>
              <div v-else class="analysis-pending">
                <span>BS.1770-5</span>
                <strong>
                  Complete stream decode failed
                </strong>
                <p>
                  Review the Evidence panel for the exact decoder-integrity error.
                </p>
              </div>
            </div>

            <div v-else class="evidence-view">
              <section
                v-if="isReviewFile(selected)"
                class="review-workflow"
                :class="verdictClass(selected.oracle.verdict)"
              >
                <div>
                  <span class="eyebrow">Why this needs attention</span>
                  <h2>{{ selected.oracle.headline }}</h2>
                  <p>{{ reviewExplanation(selected) }}</p>
                </div>
                <ol>
                  <li><b>1</b><span><strong>Understand</strong>Read the contradictory evidence and the plain-language interpretation.</span></li>
                  <li><b>2</b><span><strong>Verify</strong>Listen or compare with a trusted edition when the finding is heuristic.</span></li>
                  <li><b>3</b><span><strong>Act</strong>Acknowledge it, export evidence, reveal the source, or open safe repair options.</span></li>
                </ol>
                <div class="review-actions">
                  <button @click="acknowledgeReview(selected)">
                    {{ isAcknowledged(selected) ? "Review acknowledged" : "Acknowledge review" }}
                  </button>
                  <button @click="exportFileEvidence(selected)">Export evidence</button>
                  <button @click="revealSource(selected)">Reveal source</button>
                  <button class="primary-review-action" @click="openRepair(selected)">Open repair options</button>
                </div>
              </section>
              <article
                v-for="item in selected.oracle.evidence"
                :key="item.id"
                :class="item.disposition"
              >
                <span>{{ item.kind }}</span>
                <strong>{{ item.label }}</strong>
                <p>{{ item.summary }}</p>
              </article>
              <div class="interpretation">
                <span class="eyebrow">Plain-language interpretation</span>
                <p>{{ selected.oracle.interpretation }}</p>
              </div>
            </div>
          </div>

          <aside class="metrics-panel">
            <span class="eyebrow">Declared profile</span>
            <p class="profile-definition">Container and codec claims read from the file. These describe how the file is labeled, not whether its decoded signal originated at that quality.</p>
            <div class="inspector-actions">
              <button
                :disabled="!canAnalyzeSelected || isAnalyzing"
                @click="analyzeSelected"
              >
                {{ isAnalyzing ? "Decoding…" : "Re-run analysis" }}
              </button>
              <button
                v-if="isReviewFile(selected)"
                class="attention"
                @click="openRepair(selected)"
              >
                Review actions
              </button>
            </div>
            <dl>
              <div><dt>Codec</dt><dd>{{ selected.codec }}</dd></div>
              <div><dt>Container</dt><dd>{{ selected.container }}</dd></div>
              <div><dt>Codec profile</dt><dd>{{ selected.codecProfile ?? "Not declared" }}</dd></div>
              <div><dt>Sample rate</dt><dd>{{ formatRate(selected.sampleRate) }}</dd></div>
              <div><dt>Bit depth</dt><dd>{{ selected.bitDepth ? `${selected.bitDepth}-bit` : "—" }}</dd></div>
              <div><dt>Bitrate</dt><dd>{{ formatBitrate(selected.bitrate) }}</dd></div>
              <div><dt>Channels</dt><dd>{{ selected.channels ?? "—" }}</dd></div>
              <div><dt>Channel layout</dt><dd>{{ selected.oracle.technical?.channelLayout ?? selected.channelMode ?? "—" }}</dd></div>
              <div><dt>Bitrate mode</dt><dd>{{ selected.bitrateMode ?? "Not probed" }}</dd></div>
              <div><dt>Decoder</dt><dd>{{ selected.oracle.measurements?.decoder ?? "Decode failed" }}</dd></div>
              <div><dt>SHA-256</dt><dd class="hash-value">{{ selected.oracle.technical?.fileSha256.slice(0, 16) ?? "—" }}{{ selected.oracle.technical ? "…" : "" }}</dd></div>
              <div v-if="selected.oracle.technical?.flacMd5"><dt>FLAC audio MD5</dt><dd>{{ selected.oracle.technical.flacMd5.status }}</dd></div>
              <div><dt>External checksums</dt><dd>{{ selected.oracle.technical?.externalChecksums?.length ? `${selected.oracle.technical.externalChecksums.filter((item) => item.status === "verified").length}/${selected.oracle.technical.externalChecksums.length} verified` : "No manifest entry" }}</dd></div>
              <div><dt>Stereo assessment</dt><dd>{{ selected.oracle.measurements?.stereoAssessment.replaceAll("-", " ") ?? "—" }}</dd></div>
              <div><dt>Side / mid energy</dt><dd>{{ selected.oracle.measurements?.sideToMidRatioDb === null || selected.oracle.measurements?.sideToMidRatioDb === undefined ? "—" : `${selected.oracle.measurements.sideToMidRatioDb.toFixed(1)} dB` }}</dd></div>
              <div><dt>Longest zero run</dt><dd>{{ selected.oracle.measurements ? `${selected.oracle.measurements.continuity.longestDigitalSilenceSeconds.toFixed(3)} s` : "—" }}</dd></div>
              <div><dt>Dropout candidates</dt><dd>{{ selected.oracle.measurements?.continuity.internalDigitalDropoutCount ?? "—" }}</dd></div>
              <div><dt>Origin assessment</dt><dd>{{ originAssessmentLabel(selected) }}</dd></div>
              <div v-if="selected.oracle.technical?.repairProvenance"><dt>Audio-V action</dt><dd>−{{ selected.oracle.technical.repairProvenance.gainReductionDb.toFixed(2) }} dB · {{ selected.oracle.technical.repairProvenance.outputBitDepth }}-bit copy</dd></div>
            </dl>
            <section class="origin-assessment-card">
              <header>
                <span class="eyebrow">Measured origin assessment</span>
                <strong>{{ originAssessmentLabel(selected) }}</strong>
                <em>{{ originConfidenceLabel(selected) }}</em>
              </header>
              <p>{{ originAssessmentSummary(selected) }}</p>
              <dl v-if="selected.oracle.measurements">
                <div><dt>Declared Nyquist</dt><dd>{{ formatHz((selected.sampleRate ?? 0) / 2) }}</dd></div>
                <div><dt>Observed bandwidth</dt><dd>{{ formatHz(selected.oracle.measurements.spectrogram.effectiveBandwidthHz) }}</dd></div>
                <div><dt>Strongest cutoff</dt><dd>{{ formatHz(selected.oracle.measurements.spectrogram.strongestCutoffHz) }}</dd></div>
                <div><dt>Cutoff strength</dt><dd>{{ selected.oracle.measurements.spectrogram.cutoffDropDb === null ? "—" : `${selected.oracle.measurements.spectrogram.cutoffDropDb.toFixed(1)} dB` }}</dd></div>
                <div><dt>Upper-band level</dt><dd>{{ selected.oracle.measurements.spectrogram.upperBandLevelDbfs === null ? "—" : `${selected.oracle.measurements.spectrogram.upperBandLevelDbfs.toFixed(1)} dBFS` }}</dd></div>
                <div><dt>Evidence coverage</dt><dd>{{ selected.oracle.fidelity?.evidenceCoverage ?? 0 }}%</dd></div>
                <div><dt>Assessment reason</dt><dd>{{ selected.oracle.fidelity?.reasonCode?.replaceAll("-", " ") ?? "Not assessed" }}</dd></div>
              </dl>
              <ul v-if="selected.oracle.fidelity?.basis.length">
                <li v-for="basis in selected.oracle.fidelity.basis" :key="basis">{{ basis }}</li>
              </ul>
              <small v-if="selected.oracle.fidelity">{{ selected.oracle.fidelity.limitation }}</small>
            </section>
            <div class="oracle-card" :class="verdictClass(selected.oracle.verdict)">
              <span class="oracle-glyph">◇</span>
              <div>
                <small>Oracle verdict</small>
                <strong>{{ selected.oracle.headline }}</strong>
                <span>
                  {{ oracleConfidenceDescription(selected) }}
                </span>
              </div>
            </div>
          </aside>
        </div>
      </section>
      </template>

      <section v-else-if="activeWorkspace === 'compare'" class="module-page">
        <header class="module-header">
          <div><span class="eyebrow">Compare</span><h1>Signal and format comparison</h1></div>
          <p>Choose from the current audit or load either file directly from disk. Comparison files are analyzed independently and do not replace the active audit session.</p>
        </header>
        <div class="compare-selectors">
          <div class="compare-slot">
            <label>
              File A
              <select v-model="compareAId">
                <option value="">Choose a file</option>
                <option v-for="file in comparisonOptions" :key="file.id" :value="file.id">{{ file.name }}</option>
              </select>
            </label>
            <button :disabled="isDiscovering || compareLoadingSlot !== null" @click="chooseComparisonFile('a')">
              {{ compareLoadingSlot === "a" ? "Analyzing…" : "Load File A" }}
            </button>
          </div>
          <button class="swap-comparison" :disabled="!compareAId && !compareBId" aria-label="Swap comparison files" @click="swapComparison">⇄<span>Swap</span></button>
          <div class="compare-slot">
            <label>
              File B
              <select v-model="compareBId">
                <option value="">Choose a file</option>
                <option v-for="file in comparisonOptions" :key="file.id" :value="file.id">{{ file.name }}</option>
              </select>
            </label>
            <button :disabled="isDiscovering || compareLoadingSlot !== null" @click="chooseComparisonFile('b')">
              {{ compareLoadingSlot === "b" ? "Analyzing…" : "Load File B" }}
            </button>
          </div>
        </div>
        <div v-if="comparisonSummary" class="comparison-summary">
          <article><span>Relationship</span><strong>{{ comparisonSummary.relationship }}</strong></article>
          <article><span>File identity</span><strong>{{ comparisonSummary.exact ? "SHA-256 match" : "Different SHA-256" }}</strong></article>
          <article><span>Duration difference</span><strong>{{ comparisonSummary.durationDelta === null ? "Not measured" : `${comparisonSummary.durationDelta.toFixed(3)} s` }}</strong></article>
          <article><span>Loudness B − A</span><strong>{{ comparisonSummary.loudnessDelta === null ? "Not measured" : `${comparisonSummary.loudnessDelta >= 0 ? "+" : ""}${comparisonSummary.loudnessDelta.toFixed(1)} LU` }}</strong></article>
        </div>
        <section v-if="compareA && compareB" class="alignment-evidence">
          <header>
            <div>
              <span class="eyebrow">Decoded-signal alignment</span>
              <strong>
                {{
                  signalComparisonLoading
                    ? "Aligning decoded audio…"
                    : signalComparison
                      ? signalComparison.relationship.replaceAll("-", " ")
                      : "Alignment unavailable"
                }}
              </strong>
            </div>
            <span v-if="signalComparison">{{ signalComparison.method }}</span>
          </header>
          <div v-if="signalComparison" class="alignment-metrics">
            <article><span>B offset from A</span><strong>{{ signalComparison.offsetSeconds >= 0 ? "+" : "" }}{{ signalComparison.offsetSeconds.toFixed(3) }} s</strong></article>
            <article><span>Sample correlation</span><strong>{{ signalComparison.sampleCorrelation.toFixed(6) }}</strong></article>
            <article><span>Polarity</span><strong>{{ signalComparison.polarity }}</strong></article>
            <article><span>Gain B − A</span><strong>{{ signalComparison.gainDifferenceDb === null ? "Unavailable" : `${signalComparison.gainDifferenceDb >= 0 ? "+" : ""}${signalComparison.gainDifferenceDb.toFixed(2)} dB` }}</strong></article>
            <article><span>Aligned residual</span><strong>{{ signalComparison.residualRmsDb.toFixed(1) }} dB</strong></article>
          </div>
          <p v-if="signalComparison">{{ signalComparison.limitation }}</p>
          <p v-else-if="signalComparisonError">{{ signalComparisonError }}</p>
        </section>
        <section v-if="compareA && compareB" class="comparison-visuals">
          <header>
            <div>
              <span class="eyebrow">Measured visual comparison</span>
              <h2>Waveform envelope and spectral difference</h2>
            </div>
            <p>The heatmap remains a normalized full-track overview. Offset, gain, polarity, and correlation are measured separately by the decoded-signal alignment stage above.</p>
          </header>
          <div class="waveform-stack">
            <article>
              <span>File A · {{ compareA.name }}</span>
              <svg viewBox="0 0 1000 120" preserveAspectRatio="none" role="img" :aria-label="`Waveform envelope for ${compareA.name}`">
                <line x1="0" y1="60" x2="1000" y2="60" />
                <path :d="waveformPath(compareA)" />
              </svg>
            </article>
            <article>
              <span>File B · {{ compareB.name }}</span>
              <svg viewBox="0 0 1000 120" preserveAspectRatio="none" role="img" :aria-label="`Waveform envelope for ${compareB.name}`">
                <line x1="0" y1="60" x2="1000" y2="60" />
                <path :d="waveformPath(compareB)" />
              </svg>
            </article>
          </div>
          <div class="spectrum-compare-grid">
            <article><span>File A spectrum</span><canvas ref="compareSpectrogramA" role="img" aria-label="Measured spectrum for comparison file A">Measured spectrum for comparison file A.</canvas></article>
            <article><span>File B spectrum</span><canvas ref="compareSpectrogramB" role="img" aria-label="Measured spectrum for comparison file B">Measured spectrum for comparison file B.</canvas></article>
            <article class="difference-spectrum">
              <span>Difference · B − A</span>
              <canvas ref="compareSpectrogramDifference" role="img" aria-label="Normalized spectral difference between comparison files">Normalized spectral difference between comparison files.</canvas>
              <small><i></i>More energy in A <b></b>Matched <em></em>More energy in B</small>
            </article>
          </div>
        </section>
        <div v-if="compareA && compareB" class="comparison-grid">
          <span>Property</span><strong>{{ compareA.name }}</strong><strong>{{ compareB.name }}</strong>
          <span>Oracle verdict</span><b>{{ shortVerdict(compareA) }}</b><b>{{ shortVerdict(compareB) }}</b>
          <span>Format</span><b>{{ audioFormatLabel(compareA) }}</b><b>{{ audioFormatLabel(compareB) }}</b>
          <span>Sample rate</span><b>{{ formatRate(compareA.sampleRate) }}</b><b>{{ formatRate(compareB.sampleRate) }}</b>
          <span>Bit depth</span><b>{{ compareA.bitDepth ? `${compareA.bitDepth}-bit` : "—" }}</b><b>{{ compareB.bitDepth ? `${compareB.bitDepth}-bit` : "—" }}</b>
          <span>Bitrate</span><b>{{ formatBitrate(compareA.bitrate) }}</b><b>{{ formatBitrate(compareB.bitrate) }}</b>
          <span>Sample peak</span><b>{{ comparisonValue(compareA, "samplePeak") }}</b><b>{{ comparisonValue(compareB, "samplePeak") }}</b>
          <span>True peak</span><b>{{ comparisonValue(compareA, "truePeak") }}</b><b>{{ comparisonValue(compareB, "truePeak") }}</b>
          <span>Integrated loudness</span><b>{{ comparisonValue(compareA, "loudness") }}</b><b>{{ comparisonValue(compareB, "loudness") }}</b>
          <span>RMS</span><b>{{ comparisonValue(compareA, "rms") }}</b><b>{{ comparisonValue(compareB, "rms") }}</b>
          <span>Observed bandwidth</span><b>{{ comparisonValue(compareA, "bandwidth") }}</b><b>{{ comparisonValue(compareB, "bandwidth") }}</b>
          <span>Clipped samples</span><b>{{ comparisonValue(compareA, "clipping") }}</b><b>{{ comparisonValue(compareB, "clipping") }}</b>
          <span>Stereo correlation</span><b>{{ comparisonValue(compareA, "correlation") }}</b><b>{{ comparisonValue(compareB, "correlation") }}</b>
          <span>Stereo assessment</span><b>{{ compareA.oracle.measurements?.stereoAssessment.replaceAll("-", " ") ?? "Not measured" }}</b><b>{{ compareB.oracle.measurements?.stereoAssessment.replaceAll("-", " ") ?? "Not measured" }}</b>
          <span>External checksum</span><b>{{ compareA.oracle.technical?.externalChecksums?.length ? `${compareA.oracle.technical.externalChecksums.filter((item) => item.status === "verified").length}/${compareA.oracle.technical.externalChecksums.length} verified` : "No manifest entry" }}</b><b>{{ compareB.oracle.technical?.externalChecksums?.length ? `${compareB.oracle.technical.externalChecksums.filter((item) => item.status === "verified").length}/${compareB.oracle.technical.externalChecksums.length} verified` : "No manifest entry" }}</b>
        </div>
        <div v-else class="module-empty">Choose File A and File B from the current audit or load them directly from disk.</div>
      </section>

      <section v-else-if="activeWorkspace === 'repair'" class="module-page">
        <header class="module-header">
          <div><span class="eyebrow">Attention &amp; repair</span><h1>Non-destructive remediation center</h1></div>
          <p>Appearing here does not mean a file must or can be repaired. Audio-V identifies the finding, states whether action is optional or recommended, and only offers transformations that preserve the source.</p>
        </header>
        <div class="repair-definition">
          <strong>Verdict answers “what did Audio-V find?”</strong>
          <span>Actionability separately answers “what, if anything, can the user safely do?” Review can require no repair; Failed can require source replacement rather than transformation.</span>
        </div>
        <div class="repair-process">
          <article><b>1</b><span><strong>Diagnose</strong>Open the measured evidence that caused Review or Failed.</span></article>
          <article><b>2</b><span><strong>Choose safely</strong>Apply only reversible actions that match the finding.</span></article>
          <article><b>3</b><span><strong>Verify the output</strong>Every Audio-V working copy is decoded and audited again before it is added.</span></article>
        </div>
        <div v-if="attentionItems.length" class="repair-list">
          <article v-for="file in attentionItems" :key="file.id">
            <div>
              <span class="row-verdict" :class="verdictClass(file.oracle.verdict)"><i></i>{{ shortVerdict(file) }}<em v-if="isAcknowledged(file)">Acknowledged</em></span>
              <h2>{{ file.name }}</h2>
              <p>{{ reviewExplanation(file) }}</p>
              <div class="repair-actions">
                <button @click="openEvidence(file)">View evidence</button>
                <button @click="revealSource(file)">Reveal source</button>
                <button @click="exportFileEvidence(file)">Export evidence</button>
                <button @click="reanalyzeFile(file)">Re-run analysis</button>
              </div>
            </div>
            <aside>
              <span class="actionability-badge" :class="repairActionability(file).tone">{{ repairActionability(file).label }}</span>
              <p class="actionability-detail">{{ repairActionability(file).detail }}</p>
              <span class="eyebrow">What Audio-V recommends</span>
              <p>{{ repairRecommendation(file) }}</p>
              <div v-if="canCreateTruePeakCopy(file)" class="repair-output-control">
                <label>
                  Output bit depth
                  <select :value="repairBitDepthMode(file)" @change="updateRepairBitDepth(file, $event)">
                    <option value="source">
                      {{ file.bitDepth === 16 || file.bitDepth === 24 ? `Preserve source (${file.bitDepth}-bit) — recommended` : `Automatic (${sourceRepairBitDepth(file)}-bit FLAC) — recommended` }}
                    </option>
                    <option v-if="sourceRepairBitDepth(file) !== 16" value="16">16-bit compatibility copy</option>
                    <option v-if="sourceRepairBitDepth(file) !== 24" value="24">24-bit processing copy</option>
                  </select>
                </label>
                <small>{{ repairBitDepthExplanation(file) }}</small>
                <span>Sample rate, channel layout, metadata, and embedded artwork are preserved where supported. FLAC bitrate varies losslessly with the signal and is not a quality setting.</span>
              </div>
              <button
                v-if="canCreateTruePeakCopy(file)"
                class="safe-copy-action"
                :disabled="repairingFileId === file.id"
                @click="createTruePeakSafeCopy(file)"
              >
                {{ repairingFileId === file.id ? "Creating and verifying…" : `Create −1 dBTP ${repairTargetBitDepth(file)}-bit FLAC copy` }}
              </button>
              <button
                v-else-if="!isAcknowledged(file)"
                class="acknowledge-action"
                @click="acknowledgeReview(file)"
              >
                Acknowledge review
              </button>
              <span class="preservation-badge">Original remains untouched</span>
            </aside>
          </article>
        </div>
        <div v-else class="module-empty">{{ files.length ? "No current files require attention or remediation." : "Load and audit files before opening the remediation center." }}</div>
      </section>

      <section v-else-if="activeWorkspace === 'reports'" class="module-page">
        <header class="module-header">
          <div><span class="eyebrow">Current audit report</span><h1>Audit evidence and file details</h1></div>
          <div class="report-export-controls">
            <label>
              Export format
              <select v-model="reportExportFormat">
                <option value="pdf">PDF report</option>
                <option value="xlsx">Excel workbook</option>
                <option value="docx">Word document</option>
                <option value="csv">CSV data</option>
                <option value="json">JSON evidence</option>
              </select>
            </label>
            <button class="primary-action report-action" :disabled="files.length === 0" @click="exportAuditReport">Export {{ reportExportFormat.toUpperCase() }}</button>
          </div>
        </header>
        <div class="report-summary">
          <article><span>Total files</span><strong>{{ files.length }}</strong></article>
          <article><span>Clear</span><strong>{{ counts.clear }}</strong></article>
          <article><span>Review</span><strong>{{ counts.review }}</strong></article>
          <article><span>Metadata only</span><strong>{{ counts.metadataOnly }}</strong></article>
          <article><span>Failed</span><strong>{{ counts.failed }}</strong></article>
        </div>
        <div v-if="files.length" class="reports-workspace">
          <div class="report-table" aria-label="Files in current audit report">
            <button
              v-for="file in files"
              :key="file.id"
              :class="{ selected: reportSelectedId === file.id }"
              @click="openReport(file)"
            >
              <strong>{{ file.name }}</strong><span>{{ audioFormatLabel(file) }} · {{ formatRate(file.sampleRate) }}</span>
              <b :class="verdictClass(file.oracle.verdict)">{{ shortVerdict(file) }}</b>
              <small>{{ file.oracle.headline }} · {{ file.oracle.scope }}</small>
            </button>
          </div>
          <article v-if="reportSelected" class="report-detail">
            <header>
              <div>
                <span class="eyebrow">Per-file evidence report</span>
                <h2>{{ reportSelected.name }}</h2>
                <p>{{ reportSelected.path }}</p>
              </div>
              <span class="report-verdict" :class="verdictClass(reportSelected.oracle.verdict)">{{ shortVerdict(reportSelected) }}</span>
            </header>
            <section class="report-interpretation">
              <strong>{{ reportSelected.oracle.headline }}</strong>
              <p>{{ reportSelected.oracle.interpretation }}</p>
            </section>
            <div class="report-detail-grid">
              <section>
                <span class="eyebrow">Identity &amp; engine</span>
                <dl>
                  <div><dt>Analyzed</dt><dd>{{ reportSelected.oracle.measuredAt ? new Date(reportSelected.oracle.measuredAt).toLocaleString() : "Not measured" }}</dd></div>
                  <div><dt>Engine</dt><dd>{{ reportSelected.oracle.engineVersion }}</dd></div>
                  <div><dt>SHA-256</dt><dd class="hash-value">{{ reportSelected.oracle.technical?.fileSha256 ?? "Unavailable" }}</dd></div>
                  <div><dt>Format</dt><dd>{{ audioFormatLabel(reportSelected) }}</dd></div>
                </dl>
              </section>
              <section>
                <span class="eyebrow">Decoded signal</span>
                <dl>
                  <div><dt>Decode</dt><dd>{{ reportSelected.oracle.measurements ? "Complete" : "Failed" }}</dd></div>
                  <div><dt>Integrated</dt><dd>{{ comparisonValue(reportSelected, "loudness") }}</dd></div>
                  <div><dt>True peak</dt><dd>{{ comparisonValue(reportSelected, "truePeak") }}</dd></div>
                  <div><dt>Clipped samples</dt><dd>{{ comparisonValue(reportSelected, "clipping") }}</dd></div>
                  <div><dt>Bandwidth</dt><dd>{{ comparisonValue(reportSelected, "bandwidth") }}</dd></div>
                  <div v-if="reportSelected.oracle.technical?.repairProvenance"><dt>Working copy</dt><dd>−{{ reportSelected.oracle.technical.repairProvenance.gainReductionDb.toFixed(2) }} dB · {{ reportSelected.oracle.technical.repairProvenance.outputBitDepth }}-bit</dd></div>
                </dl>
              </section>
            </div>
            <section class="report-origin">
              <span class="eyebrow">Origin assessment</span>
              <strong>{{ originAssessmentLabel(reportSelected) }}</strong>
              <p>{{ originAssessmentSummary(reportSelected) }}</p>
              <ul v-if="reportSelected.oracle.fidelity?.basis.length">
                <li v-for="basis in reportSelected.oracle.fidelity.basis" :key="basis">{{ basis }}</li>
              </ul>
              <small v-if="reportSelected.oracle.fidelity">{{ reportSelected.oracle.fidelity.limitation }}</small>
            </section>
            <section class="report-evidence">
              <span class="eyebrow">Evidence chain</span>
              <details v-for="item in reportSelected.oracle.evidence" :key="item.id">
                <summary>{{ item.label }} <em>{{ item.kind }}</em></summary>
                <p>{{ item.summary }}</p>
              </details>
            </section>
            <footer class="report-detail-actions">
              <button @click="openEvidence(reportSelected)">Open audit evidence</button>
              <button @click="compareFromReport(reportSelected)">Compare this file</button>
              <button v-if="isReviewFile(reportSelected)" @click="openRepair(reportSelected)">Open remediation</button>
              <button @click="revealSource(reportSelected)">Reveal source</button>
              <button @click="exportFileEvidence(reportSelected)">Export this report</button>
            </footer>
          </article>
        </div>
        <div v-else class="module-empty">The report will populate after an audit source is loaded.</div>
      </section>

      <section v-else class="module-page">
        <header class="module-header">
          <div><span class="eyebrow">Settings</span><h1>Oracle engine capabilities</h1></div>
          <p>Capabilities are disclosed by format so an unavailable decoder is never mistaken for unfinished processing.</p>
        </header>
        <div class="capability-grid">
          <article><span>Decode integrity</span><strong>Multi-codec full decode</strong><p>Every selected stream is decoded from beginning to end. Fatal stream or truncation errors produce a deterministic Failed verdict.</p></article>
          <article><span>Signal analysis</span><strong>Measured PCM and spectrum</strong><p>Peak, RMS, clipping, DC offset, channel relationship, and a real STFT spectrogram come from decoded samples.</p></article>
          <article><span>Broadcast loudness</span><strong>EBU R128 / BS.1770</strong><p>Integrated LUFS, loudness range, and oversampled true peak are measured by the bundled engine.</p></article>
          <article><span>Codec integrity</span><strong>FLAC audio MD5</strong><p>The decoded PCM is independently compared with the checksum stored in STREAMINFO; mismatch is a deterministic failure.</p></article>
          <article><span>Spectral origin</span><strong>Conservative review classifier</strong><p>Measured cutoffs can flag compatible patterns with rule strength, evidence coverage, reason codes, and explicit mastering limitations.</p></article>
          <article><span>Open-source license</span><strong>AGPL-3.0-only</strong><p>Code remains available under strong copyleft. Audio-V and Oracle Engine names and artwork remain governed by the trademark policy.</p></article>
          <article><span>Support diagnostics</span><strong>Privacy-safe export</strong><p>{{ diagnosticsMessage }}</p><button class="secondary-action" @click="exportDiagnostics">Export diagnostics</button></article>
          <article><span>Keyboard workflow</span><strong>Fast navigation</strong><p>Use {{ primaryModifier }}+O for files, {{ primaryModifier }}+Shift+O for a folder, and {{ primaryModifier }}+1–5 for workspaces.</p></article>
        </div>
      </section>

      <footer class="statusbar">
        <span role="status" aria-live="polite"><i></i>{{ scanMessage }}</span>
        <span>{{ files.length.toLocaleString() }} files in session</span>
        <span>Oracle integrity &amp; fidelity scope v5</span>
      </footer>
    </main>
  </div>
</template>
