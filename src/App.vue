<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type {
  AcceptanceRunEvidence,
  AnalysisMode,
  AnalysisResourceLimits,
  AudioFileRecord,
  AudioSourceSelection,
  AuditResumeStrategy,
  AuditSessionSummary,
  AuditStorageStatus,
  ComparisonRegion,
  DecodedSignalComparison,
  DeliveryProfileId,
  ExternalIdentityServiceStatus,
  FingerprintLibraryEntry,
  OracleValidationStatus,
  OracleVerdict,
  ReportExportFormat,
  ScanProgressUpdate,
  SpectrogramMeasurements,
  UserReviewDisposition,
} from "../shared/contracts";
import iconUrl from "../build/icon.svg";
import { audioFormatLabel } from "../shared/audio-format";
import {
  sortAuditResults,
  type AuditResultSort,
} from "../shared/audit-result-sort";
import { createVirtualWindow } from "../shared/virtual-window";
import { desktopErrorMessage } from "../shared/desktop-error-message";
import {
  isDeliveryProfileId,
  resolveDeliveryProfile,
} from "../shared/delivery-profiles";
import {
  validationClaimDetail,
  validationClaimLabel,
} from "../shared/validation-status";

type AnalysisPanel = "quick" | "spectrogram" | "loudness" | "evidence";
type WorkspacePanel =
  | "audit"
  | "library"
  | "compare"
  | "repair"
  | "reports"
  | "settings";
type RepairBitDepthMode = "source" | "16" | "24";

const files = ref<AudioFileRecord[]>([]);
const selectedId = ref("");
const activePanel = ref<AnalysisPanel>("quick");
const activeWorkspace = ref<WorkspacePanel>("audit");
const sourceRoot = ref("No source selected");
const activeSessionId = ref("");
const scanMessage = ref("Ready for files or a folder");
const scanProgress = ref<ScanProgressUpdate | null>(null);
const auditNotices = ref<string[]>([]);
const hasSourceAccessNotices = computed(() =>
  auditNotices.value.some((notice) =>
    /access was denied|external or network source is unavailable|could not be read/iu.test(
      notice,
    ),
  ),
);
const scanFailureMessage = ref("");
const resourcePolicyNotice = ref("");
const sourceIoNotice = ref("");
const diagnosticsMessage = ref(
  "Diagnostics exclude filenames, paths, checksums, tags, and audio evidence.",
);
const latestAcceptanceRun = ref<AcceptanceRunEvidence | null>(null);
const acceptanceRunMessage = ref(
  "Every audit records privacy-safe package, workload, timing, memory, storage, cancellation, and recovery evidence.",
);
const auditStorageStatus = ref<AuditStorageStatus | null>(null);
const auditStorageMessage = ref("Measuring saved audit storage…");
const auditStorageOptimizing = ref(false);
const validationStatus = ref<OracleValidationStatus | null>(null);
const isDiscovering = ref(false);
const isScanPaused = ref(false);
const isScanCancelling = ref(false);
const historyOpen = ref(false);
const recentSessions = ref<AuditSessionSummary[]>([]);
const historyClearing = ref(false);
const historyMessage = ref("");
const fingerprintLibrary = ref<FingerprintLibraryEntry[]>([]);
const fingerprintLibraryLoading = ref(false);
const fingerprintLibraryMessage = ref("Index has not been loaded.");
const fingerprintLibraryFilter = ref("");
const loadingSessionId = ref("");
const hydratingFileId = ref("");
const isAnalyzing = ref(false);
const scanMode = ref<AnalysisMode>("full-audit");
const storedDeliveryProfile = localStorage.getItem(
  "audio-v.delivery-profile-v1",
);
const deliveryProfileId = ref<DeliveryProfileId>(
  isDeliveryProfileId(storedDeliveryProfile)
    ? storedDeliveryProfile
    : "none",
);
const selectedDeliveryProfile = computed(() =>
  resolveDeliveryProfile(deliveryProfileId.value),
);
const analysisConcurrency = ref<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8>(2);
const analysisWorkerMemoryMb = ref<128 | 256 | 384 | 512>(256);
const analysisFfmpegThreads = ref<1 | 2 | 4>(2);
const analysisNativeMemoryMb = ref<256 | 512 | 1024 | 2048>(1024);
const effectiveResourceLimits = ref<AnalysisResourceLimits | null>(null);
const recoveryStatus = ref("");
const acoustIdEnabled = ref(false);
const acoustIdApiKey = ref("");
const musicBrainzEnabled = ref(false);
const identityPreferencesSaving = ref(false);
const identityPreferencesLoaded = ref(false);
const identityPreferencesMessage = ref(
  "Loading saved external identity preferences…",
);
let identityPreferencesLoadPromise: Promise<void> | null = null;
let identityPreferencesRequest = 0;
const acoustIdValidationState = ref<"idle" | "checking" | "valid" | "error">(
  "idle",
);
const acoustIdValidationMessage = ref(
  "The application key will be checked before discovery begins.",
);
const filter = ref<
  "all" | "clear" | "review" | "not-analyzed" | "error" | "failed"
>("all");
const auditResultSort = ref<AuditResultSort>("original");
const compareAId = ref("");
const compareBId = ref("");
const comparisonFiles = ref<AudioFileRecord[]>([]);
const compareLoadingSlot = ref<"a" | "b" | null>(null);
const comparisonVisualState = ref<
  Record<"a" | "b", { status: "idle" | "loading" | "ready" | "error"; message: string }>
>({
  a: { status: "idle", message: "Choose File A." },
  b: { status: "idle", message: "Choose File B." },
});
const comparisonFileSessions = new Map<string, string>();
let comparisonVisualRequestA = 0;
let comparisonVisualRequestB = 0;
const comparisonMappingMode = ref<"automatic" | "explicit">("automatic");
const comparisonChannelMappings = ref<
  Array<{ leftChannel: number; rightChannel: number }>
>([]);
const signalComparison = ref<DecodedSignalComparison | null>(null);
const signalComparisonLoading = ref(false);
const signalComparisonError = ref("");
const comparisonVisualMode = ref<
  "stacked" | "overlay" | "wipe" | "blink"
>("stacked");
const comparisonOpacity = ref(0.5);
const comparisonWipe = ref(0.5);
const comparisonZoom = ref(1);
const comparisonPan = ref(0);
const comparisonBlinkFrame = ref<"a" | "b">("a");
const comparisonRegionStart = ref(0);
const comparisonRegionEnd = ref(0);
const reportSelectedId = ref("");
const reportExportFormat = ref<ReportExportFormat>("pdf");
const reportDetail = ref<HTMLElement | null>(null);
const spectrogramCanvas = ref<HTMLCanvasElement | null>(null);
const compareSpectrogramA = ref<HTMLCanvasElement | null>(null);
const compareSpectrogramB = ref<HTMLCanvasElement | null>(null);
const compareSpectrogramDifference = ref<HTMLCanvasElement | null>(null);
const compareSpectrogramComposite = ref<HTMLCanvasElement | null>(null);
const compareResidualSpectrogram = ref<HTMLCanvasElement | null>(null);
const externalIdentityStatus = ref<ExternalIdentityServiceStatus | null>(null);
const identityBatchRunning = ref(false);
const identityBatchMessage = ref(
  "Choose Identify current audit to recognize and enrich already measured files.",
);
const identityBatchCompleted = ref(0);
const identityBatchTotal = ref(0);
const spectrogramScale = ref<"linear" | "log">("linear");
const spectrogramFloor = ref<-120 | -100 | -80>(-120);
const spectrogramFftSize = ref<512 | 2048 | 4096 | 16384>(512);
const spectrogramChannelMode = ref<SpectrogramMeasurements["channelMode"]>(
  "per-channel power average",
);
const spectrogramColormap = ref<"inferno" | "magma" | "viridis">("inferno");
const inspectedSpectrum = ref<SpectrogramMeasurements | null>(null);
const spectrogramInspecting = ref(false);
const spectrogramInspectionError = ref("");
const spectrogramZoom = ref(1);
const spectrogramPan = ref(0);
const spectrogramSelectionStart = ref<{ x: number; y: number } | null>(null);
const spectrogramRegion = ref("Drag across the plot to measure a region");
const spectrogramCursor = ref("Move across the plot for time, frequency, and level");
let spectrogramInspectionRequest = 0;
const reviewStatusUpdatingIds = ref<Set<string>>(new Set());
const reviewDispositionDrafts = ref<
  Record<string, UserReviewDisposition>
>({});
const reviewNoteDrafts = ref<Record<string, string>>({});
const repairingFileId = ref("");
const repairBitDepthModes = ref<Record<string, RepairBitDepthMode>>({});
const tableBody = ref<HTMLElement | null>(null);
const tableScrollTop = ref(0);
const tableViewportHeight = ref(360);
const virtualRowHeight = 38;
const virtualOverscan = 8;
const primaryModifier = navigator.platform.includes("Mac") ? "⌘" : "Ctrl";

const validationStatusLabel = computed(() => {
  const labels: Record<OracleValidationStatus["readiness"], string> = {
    "awaiting-external-references": "External corpus ready · references pending",
    "awaiting-source-masters": "External corpus ready · references pending",
    "pilot-building": "External validation pilot building",
    "pilot-ready": "External validation pilot ready",
    "target-corpus-ready": "External target corpus ready",
  };
  return validationStatus.value
    ? labels[validationStatus.value.readiness]
    : "Loading validation disclosure…";
});
const validationProgress = computed(() => {
  const status = validationStatus.value;
  if (!status) return 0;
  return Math.min(
    100,
    ((status.counts.publicIndependentReferences ??
      status.counts.publicIndependentMasters) /
      status.thresholds.targetIndependentMasters) *
      100,
  );
});
const auditStorageLivePercent = computed(() => {
  const status = auditStorageStatus.value;
  if (!status || status.databaseBytes <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, (status.liveBytes / status.databaseBytes) * 100),
  );
});
const scanProgressPercent = computed(() => {
  const progress = scanProgress.value;
  if (!progress?.total) return 0;
  if (progress.phase === "complete") return 100;
  if (progress.phase === "finalizing") {
    if (progress.finalization?.stage === "album-replaygain") return 96;
    if (progress.finalization?.stage === "fingerprint-relationships") return 98;
    return 99;
  }
  return Math.min(
    99,
    Math.round((progress.completed / progress.total) * 100),
  );
});
const scanProgressSweep = computed(
  () => `${scanProgressPercent.value * 3.6}deg`,
);
const scanProgressTitle = computed(() => {
  const progress = scanProgress.value;
  if (isScanCancelling.value) {
    return `Cancelling · ${progress?.completed.toLocaleString() ?? 0} completed results preserved`;
  }
  if (progress?.phase === "checkpointing" && progress.checkpoint) {
    return progress.checkpoint.state === "stalled"
      ? "Checkpoint stalled · ending safely"
      : `Checkpointing · ${progress.completed.toLocaleString()} analyzed`;
  }
  if (progress?.phase === "finalizing" && progress.finalization) {
    const labels = {
      "album-replaygain": "Finalizing · album ReplayGain",
      "fingerprint-relationships": "Finalizing · fingerprint relationships",
      "history-commit": "Finalizing · durable history",
    } as const;
    return labels[progress.finalization.stage];
  }
  if (progress?.phase === "complete") return "Audit complete";
  if (!progress?.total) return "Discovering audio files";
  const action =
    scanMode.value === "metadata-inventory" ? "Inventorying" : "Analyzing";
  return `${action} · ${progress.completed.toLocaleString()} of ${progress.total.toLocaleString()} complete`;
});
const requestedAggregateMemoryMb = computed(
  () =>
    768 +
    analysisConcurrency.value *
      (analysisWorkerMemoryMb.value + analysisNativeMemoryMb.value),
);
const requestedAggregateThreads = computed(
  () => analysisConcurrency.value * analysisFfmpegThreads.value,
);
const resourceControlWarning = computed(() => {
  const memory = requestedAggregateMemoryMb.value;
  const threads = requestedAggregateThreads.value;
  if (memory > 4_096 || threads > 8) {
    return `Requested ceiling: ${(memory / 1024).toFixed(1)} GB and ${threads} FFmpeg threads. Audio-V will automatically reduce this combination to the system-safe aggregate budget when the audit starts.`;
  }
  return `Requested ceiling: ${(memory / 1024).toFixed(1)} GB and ${threads} FFmpeg threads. Final limits are validated against available system memory and CPU before workers start.`;
});

const selected = computed(
  () => files.value.find((file) => file.id === selectedId.value) ?? files.value[0],
);
const canAnalyzeSelected = computed(() => Boolean(selected.value));
const displaySpectrum = computed(() => {
  const measurements = selected.value?.oracle.measurements;
  if (!measurements) return null;
  if (
    inspectedSpectrum.value?.fftSize === spectrogramFftSize.value &&
    inspectedSpectrum.value.channelMode === spectrogramChannelMode.value
  ) {
    return inspectedSpectrum.value;
  }
  const persisted = measurements.spectrogramPyramid?.find(
      (spectrum) =>
        spectrum.fftSize === spectrogramFftSize.value &&
        spectrogramChannelMode.value === "per-channel power average" &&
        spectrum.slices.length > 0,
    );
  return persisted ?? null;
});
const spectrogramVisibleTimes = computed(() => {
  const duration = displaySpectrum.value?.durationSeconds ?? 0;
  const visibleFraction = 1 / spectrogramZoom.value;
  const start = spectrogramPan.value * Math.max(0, 1 - visibleFraction);
  return {
    start: start * duration,
    end: Math.min(duration, (start + visibleFraction) * duration),
  };
});

const visibleFiles = computed(() => {
  let filtered: AudioFileRecord[];
  if (filter.value === "all") filtered = files.value;
  else if (filter.value === "clear") {
    filtered = files.value.filter((file) =>
      ["verified", "authentic"].includes(file.oracle.verdict),
    );
  } else if (filter.value === "review") {
    filtered = files.value.filter((file) =>
      ["review", "likely-transcode", "likely-upsample"].includes(file.oracle.verdict),
    );
  } else if (filter.value === "not-analyzed") {
    filtered = files.value.filter(
      (file) => oracleAnalysisState(file) === "not-analyzed",
    );
  } else if (filter.value === "error") {
    filtered = files.value.filter(
      (file) => oracleAnalysisState(file) === "error",
    );
  } else {
    filtered = files.value.filter(
      (file) => oracleAnalysisState(file) === "failed",
    );
  }
  return sortAuditResults(filtered, auditResultSort.value);
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
const filteredFingerprintLibrary = computed(() => {
  const query = fingerprintLibraryFilter.value.trim().toLocaleLowerCase();
  if (!query) return fingerprintLibrary.value;
  return fingerprintLibrary.value.filter((entry) =>
    `${entry.fileName}\n${entry.filePath}\n${entry.fingerprintSha256 ?? ""}`
      .toLocaleLowerCase()
      .includes(query),
  );
});
const fingerprintLibrarySummary = computed(() => ({
  indexed: fingerprintLibrary.value.length,
  missing: fingerprintLibrary.value.filter((entry) => !entry.fileExists).length,
  duplicateMembers: fingerprintLibrary.value.filter(
    (entry) => entry.exactDuplicateCount > 0,
  ).length,
}));
const comparisonMappingError = computed(() => {
  if (comparisonMappingMode.value !== "explicit") return "";
  if (comparisonChannelMappings.value.length === 0) {
    return "Add at least one channel pair for an explicit comparison.";
  }
  const left = comparisonChannelMappings.value.map(
    (mapping) => mapping.leftChannel,
  );
  const right = comparisonChannelMappings.value.map(
    (mapping) => mapping.rightChannel,
  );
  if (new Set(left).size !== left.length || new Set(right).size !== right.length) {
    return "Each File A and File B channel can appear only once.";
  }
  return "";
});
const comparisonRegionMaximum = computed(() =>
  Math.max(0, signalComparison.value?.analyzedSeconds ?? 0),
);
const comparisonRegionSelection = computed<ComparisonRegion | undefined>(() => {
  const maximum = comparisonRegionMaximum.value;
  const start = Math.max(0, Math.min(maximum, comparisonRegionStart.value));
  const end = Math.max(0, Math.min(maximum, comparisonRegionEnd.value));
  return end > start ? { startSeconds: start, endSeconds: end } : undefined;
});
const attentionItems = computed(() =>
  files.value.filter(
    (file) =>
      ["review", "damaged"].includes(file.oracle.verdict) ||
      oracleAnalysisState(file) === "error",
  ),
);
const reportSelected = computed(() =>
  files.value.find((file) => file.id === reportSelectedId.value),
);

const counts = computed(() => {
  const clear = files.value.filter((file) =>
    ["verified", "authentic"].includes(file.oracle.verdict),
  ).length;
  const failed = files.value.filter(
    (file) => oracleAnalysisState(file) === "failed",
  ).length;
  const notAnalyzed = files.value.filter(
    (file) => oracleAnalysisState(file) === "not-analyzed",
  ).length;
  const analysisErrors = files.value.filter(
    (file) => oracleAnalysisState(file) === "error",
  ).length;
  const review = files.value.filter((file) =>
    ["review", "likely-transcode", "likely-upsample"].includes(file.oracle.verdict),
  ).length;
  return { clear, review, notAnalyzed, analysisErrors, failed };
});

function oracleAnalysisState(file: AudioFileRecord) {
  if (file.oracle.analysisState) return file.oracle.analysisState;
  if (file.oracle.verdict === "damaged") return "failed";
  if (file.oracle.measurements || file.oracle.measuredAt) return "completed";
  return file.oracle.scope === "metadata-only" ? "not-analyzed" : "error";
}

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

function fileStateClass(file: AudioFileRecord): string {
  const state = oracleAnalysisState(file);
  if (state === "not-analyzed") return "pending";
  if (state === "error") return "error";
  return verdictClass(file.oracle.verdict);
}

function shortVerdict(file: AudioFileRecord): string {
  const state = oracleAnalysisState(file);
  if (state === "not-analyzed") return "Not analyzed";
  if (state === "error") return "Analysis error";
  const labels: Record<OracleVerdict, string> = {
    verified: "Clear",
    authentic: "Clear",
    review: "Review",
    "likely-transcode": "Likely",
    "likely-upsample": "Likely",
    damaged: "Failed",
    inconclusive: file.oracle.measurements ? "Measured" : "Inconclusive",
  };
  return labels[file.oracle.verdict];
}

function oracleConfidenceDescription(file: AudioFileRecord): string {
  const state = oracleAnalysisState(file);
  if (state === "not-analyzed") {
    return "Metadata inventory only · Oracle Engine has not run";
  }
  if (state === "error") {
    return `No verdict issued · ${failureStageLabel(file)} error`;
  }
  if (state === "failed") {
    return "Deterministic integrity failure · complete evidence available";
  }
  if (
    ["possible-lossy-transcode", "possible-upsample"].includes(
      file.oracle.fidelity?.classification ?? "",
    )
  ) {
    return `${file.oracle.fidelity?.ruleStrength ?? "unrated"} heuristic rule strength · ${file.oracle.fidelity?.evidenceCoverage ?? 0}% evidence coverage`;
  }
  if (file.oracle.measurements) {
    return `Deterministic checks completed · ${file.oracle.scope}`;
  }
  return "No decoded-signal classification";
}

function failureStageLabel(file: AudioFileRecord): string {
  return (
    file.oracle.failure?.stage
      ?.split("-")
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" ") ?? "Unknown stage"
  );
}

function decodeStatusLabel(file: AudioFileRecord): string {
  if (file.oracle.measurements) return "Complete";
  const state = oracleAnalysisState(file);
  if (state === "not-analyzed") return "Not run";
  if (state === "error") return `Error · ${failureStageLabel(file)}`;
  return "Failed integrity";
}

function analysisPanelLabel(panel: AnalysisPanel): string {
  return panel === "quick" ? "Quick inspect" : panel;
}

function encodedChannelLabel(file: AudioFileRecord): string {
  const encodedMode = file.oracle.technical?.mp3ChannelMode;
  if (encodedMode) {
    return `${encodedMode} · ${file.channels ?? "?"} decoded channel${file.channels === 1 ? "" : "s"}`;
  }
  return (
    file.oracle.technical?.channelLayout ??
    file.channelMode ??
    (file.channels
      ? `${file.channels} decoded channel${file.channels === 1 ? "" : "s"}`
      : "Not reported")
  );
}

function quickIntegrityLabel(file: AudioFileRecord): string {
  const state = oracleAnalysisState(file);
  if (state === "not-analyzed") return "Not analyzed";
  if (state === "error") return `Stopped at ${failureStageLabel(file)}`;
  if (file.oracle.verdict === "damaged") return "Deterministic failure";
  return "Complete decode passed";
}

function acoustIdStatusLabel(file: AudioFileRecord): string {
  const status = file.oracle.technical?.fingerprint?.acoustIdLookup.status;
  if (status === "not-requested" || !status) {
    if (scanMode.value === "metadata-inventory") {
      return "Not run · metadata inventory does not fingerprint audio";
    }
    return acoustIdEnabled.value
      ? "Queued for recognition · re-identify if this remains"
      : "Disabled for this audit";
  }
  return status.replaceAll("-", " ");
}

function musicBrainzStatusLabel(file: AudioFileRecord): string {
  const status = file.oracle.technical?.musicBrainzEnrichment?.status;
  if (!status) {
    if (scanMode.value === "metadata-inventory") {
      return "Not run · metadata inventory uses local tags only";
    }
    return musicBrainzEnabled.value
      ? "Waiting for a recording identifier"
      : "Disabled for this audit";
  }
  if (status === "no-identifier") {
    return "No recording identifier available";
  }
  return status.replaceAll("-", " ");
}

function spectralColor(
  dbfs: number,
  floor: number,
  colormap = spectrogramColormap.value,
): string {
  const value = Math.max(0, Math.min(1, (dbfs - floor) / -floor));
  const palettes = {
    inferno: [[7, 8, 18], [38, 21, 78], [127, 32, 126], [225, 60, 75], [255, 170, 53], [255, 241, 159]],
    magma: [[0, 0, 4], [42, 17, 92], [114, 31, 129], [188, 55, 84], [249, 142, 8], [252, 253, 191]],
    viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  };
  const stops = palettes[colormap];
  const scaled = value * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const color = stops[index].map((channel, channelIndex) =>
    Math.round(channel + (stops[index + 1][channelIndex] - channel) * mix),
  );
  return `rgb(${color.join(",")})`;
}

async function loadSpectrogramInspection(): Promise<void> {
  let file = selected.value;
  if (!window.audioV || !file?.oracle.measurements) return;
  if (file.detailLevel === "summary" && activeSessionId.value) {
    await hydrateSelectedSessionFile();
    file = selected.value;
    if (!file?.oracle.measurements) return;
  }
  const request = ++spectrogramInspectionRequest;
  const requestedFftSize = spectrogramFftSize.value;
  const requestedChannelMode = spectrogramChannelMode.value;
  const persisted = file.oracle.measurements.spectrogramPyramid?.find(
    (spectrum) =>
      spectrum.fftSize === requestedFftSize &&
      requestedChannelMode === "per-channel power average" &&
      spectrum.slices.length > 0,
  );
  if (persisted) {
    inspectedSpectrum.value = null;
    spectrogramInspectionError.value = "";
    return;
  }
  const requestedFileId = file.id;
  spectrogramInspecting.value = true;
  spectrogramInspectionError.value = "";
  try {
    const spectrum = await window.audioV.inspectSpectrogram(
      file.path,
      requestedFftSize,
      requestedChannelMode,
    );
    if (
      request === spectrogramInspectionRequest &&
      selected.value?.id === requestedFileId &&
      spectrogramFftSize.value === requestedFftSize &&
      spectrogramChannelMode.value === requestedChannelMode
    ) {
      inspectedSpectrum.value = spectrum;
    }
  } catch (error) {
    if (request === spectrogramInspectionRequest) {
      spectrogramInspectionError.value =
        error instanceof Error ? error.message : "Detailed spectrum could not be measured.";
    }
  } finally {
    if (request === spectrogramInspectionRequest) {
      spectrogramInspecting.value = false;
    }
  }
}

async function renderSpectrogram(): Promise<void> {
  await nextTick();
  const canvas = spectrogramCanvas.value;
  const spectral = displaySpectrum.value;
  if (!canvas || !spectral || spectral.slices.length === 0) return;
  const bins = spectral.slices[0]?.levelsDbfs.length ?? 0;
  if (!bins) return;
  const visibleFraction = 1 / spectrogramZoom.value;
  const startFraction =
    spectrogramPan.value * Math.max(0, 1 - visibleFraction);
  const startIndex = Math.floor(startFraction * spectral.slices.length);
  const endIndex = Math.min(
    spectral.slices.length,
    Math.max(startIndex + 1, Math.ceil((startFraction + visibleFraction) * spectral.slices.length)),
  );
  const visibleSlices = spectral.slices.slice(startIndex, endIndex);
  canvas.width = visibleSlices.length;
  canvas.height = bins;
  const context = canvas.getContext("2d");
  if (!context) return;
  const pixels = context.createImageData(canvas.width, canvas.height);
  for (let x = 0; x < visibleSlices.length; x += 1) {
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
        visibleSlices[x].levelsDbfs[sourceBin],
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

function waveformPointsPath(
  points:
    | NonNullable<
        NonNullable<AudioFileRecord["oracle"]["measurements"]>["waveform"]
      >["points"]
    | undefined,
): string {
  if (!points?.length) return "";
  const visibleFraction = 1 / comparisonZoom.value;
  const startFraction =
    comparisonPan.value * Math.max(0, 1 - visibleFraction);
  const startIndex = Math.floor(startFraction * points.length);
  const endIndex = Math.min(
    points.length,
    Math.max(
      startIndex + 1,
      Math.ceil((startFraction + visibleFraction) * points.length),
    ),
  );
  const visiblePoints = points.slice(startIndex, endIndex);
  const x = (index: number) =>
    (index / Math.max(1, visiblePoints.length - 1)) * 1_000;
  const y = (sample: number) => 60 - Math.max(-1, Math.min(1, sample)) * 54;
  const upper = visiblePoints
    .map((point, index) => `${x(index).toFixed(2)},${y(point.maximum).toFixed(2)}`)
    .join(" L ");
  const lower = [...visiblePoints]
    .reverse()
    .map((point, reverseIndex) => {
      const index = visiblePoints.length - 1 - reverseIndex;
      return `${x(index).toFixed(2)},${y(point.minimum).toFixed(2)}`;
    })
    .join(" L ");
  return `M ${upper} L ${lower} Z`;
}

function waveformPath(file: AudioFileRecord | undefined): string {
  return waveformPointsPath(file?.oracle.measurements?.waveform?.points);
}

function residualWaveformPath(): string {
  return waveformPointsPath(
    signalComparison.value?.residualVisual.waveform.points,
  );
}

function hasComparisonVisualEvidence(
  file: AudioFileRecord | undefined,
): boolean {
  return Boolean(
    file?.oracle.measurements?.waveform?.points.length &&
      file.oracle.measurements.spectrogram.slices.length,
  );
}

function comparisonVisualMessage(slot: "a" | "b"): string {
  const state = comparisonVisualState.value[slot];
  if (state.status !== "ready") return state.message;
  const file = slot === "a" ? compareA.value : compareB.value;
  return hasComparisonVisualEvidence(file)
    ? ""
    : `File ${slot.toUpperCase()} has no decoded visual evidence.`;
}

function drawComparisonSpectrum(
  canvas: HTMLCanvasElement | null,
  file: AudioFileRecord | undefined,
): void {
  const spectral = file?.oracle.measurements?.spectrogram;
  drawSpectrumMeasurements(canvas, spectral);
}

function drawSpectrumMeasurements(
  canvas: HTMLCanvasElement | null,
  spectral: SpectrogramMeasurements | null | undefined,
): void {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  if (!spectral?.slices.length) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 1;
    canvas.height = 1;
    return;
  }
  const bins = spectral.slices[0]?.levelsDbfs.length ?? 0;
  if (!bins) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 1;
    canvas.height = 1;
    return;
  }
  const visibleFraction = 1 / comparisonZoom.value;
  const startFraction =
    comparisonPan.value * Math.max(0, 1 - visibleFraction);
  const startIndex = Math.floor(startFraction * spectral.slices.length);
  const endIndex = Math.min(
    spectral.slices.length,
    Math.max(
      startIndex + 1,
      Math.ceil((startFraction + visibleFraction) * spectral.slices.length),
    ),
  );
  const visibleSlices = spectral.slices.slice(startIndex, endIndex);
  canvas.width = visibleSlices.length;
  canvas.height = bins;
  const pixels = context.createImageData(canvas.width, canvas.height);
  for (let x = 0; x < canvas.width; x += 1) {
    for (let bin = 0; bin < bins; bin += 1) {
      const color = spectralColor(
        visibleSlices[x].levelsDbfs[bin],
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

function drawComparisonComposite(): void {
  const canvas = compareSpectrogramComposite.value;
  const sourceA = compareSpectrogramA.value;
  const sourceB = compareSpectrogramB.value;
  if (!canvas || !sourceA || !sourceB || !sourceA.width || !sourceB.width) {
    return;
  }
  canvas.width = Math.min(sourceA.width, sourceB.width);
  canvas.height = Math.min(sourceA.height, sourceB.height);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (comparisonVisualMode.value === "blink") {
    context.drawImage(
      comparisonBlinkFrame.value === "a" ? sourceA : sourceB,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return;
  }
  context.drawImage(sourceA, 0, 0, canvas.width, canvas.height);
  if (comparisonVisualMode.value === "wipe") {
    const split = Math.round(canvas.width * comparisonWipe.value);
    context.save();
    context.beginPath();
    context.rect(split, 0, canvas.width - split, canvas.height);
    context.clip();
    context.drawImage(sourceB, 0, 0, canvas.width, canvas.height);
    context.restore();
    context.fillStyle = "rgba(255,255,255,0.9)";
    context.fillRect(Math.max(0, split - 1), 0, 2, canvas.height);
    return;
  }
  context.globalAlpha = comparisonOpacity.value;
  context.drawImage(sourceB, 0, 0, canvas.width, canvas.height);
  context.globalAlpha = 1;
}

function drawComparisonDifference(): void {
  const canvas = compareSpectrogramDifference.value;
  const spectrumA = compareA.value?.oracle.measurements?.spectrogram;
  const spectrumB = compareB.value?.oracle.measurements?.spectrogram;
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  if (!spectrumA?.slices.length || !spectrumB?.slices.length) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 1;
    canvas.height = 1;
    return;
  }
  const sourceWidth = Math.min(
    spectrumA.slices.length,
    spectrumB.slices.length,
  );
  const visibleFraction = 1 / Math.max(1, comparisonZoom.value);
  const startFraction = comparisonPan.value * (1 - visibleFraction);
  const width = Math.max(2, Math.round(sourceWidth * visibleFraction));
  const height = Math.min(
    spectrumA.slices[0].levelsDbfs.length,
    spectrumB.slices[0].levelsDbfs.length,
  );
  canvas.width = width;
  canvas.height = height;
  const pixels = context.createImageData(width, height);
  for (let x = 0; x < width; x += 1) {
    const sourceFraction =
      startFraction +
      (x / Math.max(1, width - 1)) * visibleFraction;
    const indexA = Math.round(
      sourceFraction * (spectrumA.slices.length - 1),
    );
    const indexB = Math.round(
      sourceFraction * (spectrumB.slices.length - 1),
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
  drawSpectrumMeasurements(
    compareResidualSpectrogram.value,
    signalComparison.value?.residualVisual.spectrogram,
  );
  drawComparisonComposite();
}

function resetComparisonChannelMappings(): void {
  const count = Math.min(compareA.value?.channels ?? 0, compareB.value?.channels ?? 0);
  comparisonChannelMappings.value = Array.from(
    { length: count },
    (_, channel) => ({ leftChannel: channel, rightChannel: channel }),
  );
}

function addComparisonChannelMapping(): void {
  const leftCount = compareA.value?.channels ?? 0;
  const rightCount = compareB.value?.channels ?? 0;
  const usedLeft = new Set(
    comparisonChannelMappings.value.map((mapping) => mapping.leftChannel),
  );
  const usedRight = new Set(
    comparisonChannelMappings.value.map((mapping) => mapping.rightChannel),
  );
  const leftChannel = Array.from(
    { length: leftCount },
    (_, channel) => channel,
  ).find((channel) => !usedLeft.has(channel));
  const rightChannel = Array.from(
    { length: rightCount },
    (_, channel) => channel,
  ).find((channel) => !usedRight.has(channel));
  if (leftChannel === undefined || rightChannel === undefined) return;
  comparisonChannelMappings.value = [
    ...comparisonChannelMappings.value,
    { leftChannel, rightChannel },
  ];
}

function removeComparisonChannelMapping(index: number): void {
  comparisonChannelMappings.value =
    comparisonChannelMappings.value.filter((_, candidate) => candidate !== index);
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
  if (comparisonMappingError.value) {
    signalComparison.value = null;
    signalComparisonError.value = comparisonMappingError.value;
    signalComparisonLoading.value = false;
    return;
  }
  const request = ++comparisonRequest;
  signalComparisonLoading.value = true;
  signalComparisonError.value = "";
  try {
    const result = await window.audioV.compareSignals(
      left.path,
      right.path,
      comparisonMappingMode.value === "explicit"
        ? comparisonChannelMappings.value
        : undefined,
      comparisonRegionSelection.value,
    );
    if (request === comparisonRequest) {
      signalComparison.value = result;
      if (comparisonRegionEnd.value <= comparisonRegionStart.value) {
        comparisonRegionStart.value = 0;
        comparisonRegionEnd.value = result.analyzedSeconds;
      }
      void renderComparisonVisuals();
    }
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

function measureComparisonRegion(): void {
  if (!comparisonRegionSelection.value) {
    signalComparisonError.value =
      "Choose a region whose end is later than its start.";
    return;
  }
  void analyzeComparisonSignals();
}

watch(
  () => [
    selected.value?.id,
    selected.value?.oracle.measuredAt,
    activePanel.value,
    spectrogramScale.value,
    spectrogramFloor.value,
    spectrogramFftSize.value,
    spectrogramChannelMode.value,
    spectrogramColormap.value,
    spectrogramZoom.value,
    spectrogramPan.value,
  ],
  () => void renderSpectrogram(),
);
watch(
  displaySpectrum,
  () => void renderSpectrogram(),
  { flush: "post" },
);
watch(
  () => [
    selected.value?.id,
    selected.value?.oracle.measuredAt,
    spectrogramFftSize.value,
    spectrogramChannelMode.value,
  ],
  () => {
    inspectedSpectrum.value = null;
    spectrogramZoom.value = 1;
    spectrogramPan.value = 0;
    spectrogramRegion.value = "Drag across the plot to measure a region";
    void loadSpectrogramInspection();
  },
);
watch(
  () => [
    activeSessionId.value,
    selected.value?.id,
    selected.value?.detailLevel,
  ],
  () => void hydrateSelectedSessionFile(),
);
watch(
  () => [
    compareA.value?.id,
    compareA.value?.oracle.measuredAt,
    compareB.value?.id,
    compareB.value?.oracle.measuredAt,
    comparisonMappingMode.value,
    JSON.stringify(comparisonChannelMappings.value),
    activeWorkspace.value,
  ],
  () => {
    void renderComparisonVisuals();
    if (activeWorkspace.value === "compare") void analyzeComparisonSignals();
  },
);
watch(
  () => [compareA.value?.id, compareB.value?.id],
  () => {
    resetComparisonChannelMappings();
    comparisonRegionStart.value = 0;
    comparisonRegionEnd.value = 0;
    comparisonZoom.value = 1;
    comparisonPan.value = 0;
    if (activeWorkspace.value === "compare") {
      void hydrateComparisonFile("a");
      void hydrateComparisonFile("b");
    }
  },
);
watch(
  () => [
    comparisonVisualMode.value,
    comparisonOpacity.value,
    comparisonWipe.value,
    comparisonZoom.value,
    comparisonPan.value,
    comparisonBlinkFrame.value,
  ],
  () => void renderComparisonVisuals(),
);
let tableResizeObserver: ResizeObserver | null = null;
let tableViewportFrame: number | null = null;

function measureTableViewport(): void {
  const element = tableBody.value;
  if (!element) return;
  const viewportHeight = element.clientHeight;
  const maximumScrollTop = Math.max(
    0,
    visibleFiles.value.length * virtualRowHeight - viewportHeight,
  );
  if (element.scrollTop > maximumScrollTop) {
    element.scrollTop = maximumScrollTop;
  }
  tableScrollTop.value = element.scrollTop;
  tableViewportHeight.value = viewportHeight;
}

function scheduleTableViewportMeasurement(): void {
  if (tableViewportFrame !== null) return;
  tableViewportFrame = requestAnimationFrame(() => {
    tableViewportFrame = null;
    measureTableViewport();
  });
}

watch(filter, () => {
  tableScrollTop.value = 0;
  if (tableBody.value) tableBody.value.scrollTop = 0;
  scheduleTableViewportMeasurement();
});
watch(auditResultSort, () => {
  tableScrollTop.value = 0;
  if (tableBody.value) tableBody.value.scrollTop = 0;
  scheduleTableViewportMeasurement();
});
watch(deliveryProfileId, (profileId) => {
  localStorage.setItem("audio-v.delivery-profile-v1", profileId);
});
watch(activeWorkspace, (workspace) => {
  if (workspace === "library") void refreshFingerprintLibrary();
  if (workspace === "audit") scheduleTableViewportMeasurement();
  if (workspace === "compare") {
    void hydrateComparisonFile("a");
    void hydrateComparisonFile("b");
  }
});
watch(tableBody, (element) => {
  tableResizeObserver?.disconnect();
  tableResizeObserver = null;
  if (!element) return;
  tableResizeObserver = new ResizeObserver(scheduleTableViewportMeasurement);
  tableResizeObserver.observe(element);
  scheduleTableViewportMeasurement();
});
watch(() => visibleFiles.value.length, () => {
  scheduleTableViewportMeasurement();
});
let removeScanProgressListener: (() => void) | null = null;
let removeHistoryCleanupListener: (() => void) | null = null;
let removeIdentityProgressListener: (() => void) | null = null;
let comparisonBlinkTimer: ReturnType<typeof setInterval> | null = null;
let progressFrame: number | null = null;
let queuedProgressFiles: AudioFileRecord[] = [];
let progressFileIndexById = new Map<string, number>();

function mergeQueuedProgressFiles(): void {
  if (queuedProgressFiles.length === 0) return;
  const next = files.value.slice();
  for (const entry of queuedProgressFiles) {
    const existingIndex = progressFileIndexById.get(entry.id);
    if (existingIndex === undefined) {
      progressFileIndexById.set(entry.id, next.length);
      next.push(entry);
    } else {
      next[existingIndex] = entry;
    }
  }
  queuedProgressFiles = [];
  files.value = next;
}

function flushQueuedProgressFiles(): void {
  if (progressFrame !== null) {
    cancelAnimationFrame(progressFrame);
    progressFrame = null;
  }
  if (queuedProgressFiles.length === 0) return;
  mergeQueuedProgressFiles();
  scheduleTableViewportMeasurement();
}

function queueProgressFile(file: AudioFileRecord): void {
  queuedProgressFiles.push(file);
  if (progressFrame !== null) return;
  progressFrame = requestAnimationFrame(() => {
    mergeQueuedProgressFiles();
    progressFrame = null;
    scheduleTableViewportMeasurement();
  });
}

async function hydrateSelectedSessionFile(): Promise<void> {
  const file = selected.value;
  const sessionId = activeSessionId.value;
  if (
    !window.audioV ||
    !file ||
    file.detailLevel !== "summary" ||
    !sessionId ||
    hydratingFileId.value === file.id
  ) {
    return;
  }
  hydratingFileId.value = file.id;
  try {
    const full = await window.audioV.openAuditSessionFile(
      sessionId,
      file.path,
    );
    if (
      activeSessionId.value === sessionId &&
      selected.value?.id === file.id
    ) {
      files.value = files.value.map((candidate) =>
        candidate.id === file.id ? full : candidate,
      );
    }
  } catch (error) {
    scanMessage.value =
      error instanceof Error
        ? `Saved detail could not be loaded · ${error.message}`
        : "Saved detail could not be loaded.";
  } finally {
    if (hydratingFileId.value === file.id) hydratingFileId.value = "";
  }
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
  void refreshFingerprintLibrary();
  void refreshAuditStorageStatus();
  void refreshAcceptanceRun();
  void ensureExternalIdentityPreferencesLoaded();
  void window.audioV?.externalIdentityServiceStatus().then((status) => {
    externalIdentityStatus.value = status;
    if (status.officialClientConfigured) {
      acoustIdValidationMessage.value =
        "Official Audio-V client identity available · no personal application key is required.";
    }
  });
  void window.audioV
    ?.validationStatus()
    .then((status) => {
      validationStatus.value = status;
    });
  removeScanProgressListener =
    window.audioV?.onScanProgress((progress) => {
      if (!isDiscovering.value) return;
      scanProgress.value = progress;
      if (progress.sessionId && activeSessionId.value !== progress.sessionId) {
        activeSessionId.value = progress.sessionId;
      }
      if (progress.resourceLimits) {
        effectiveResourceLimits.value = progress.resourceLimits;
      }
      if (progress.recovery) {
        recoveryStatus.value = progress.recovery.explanation;
      }
      if (progress.resourcePolicyExplanation) {
        resourcePolicyNotice.value = progress.resourcePolicyExplanation;
      }
      if (progress.sourceIo) {
        sourceIoNotice.value = progress.sourceIo.explanation;
      }
      if (progress.file) {
        queueProgressFile(progress.file);
        if (!selectedId.value) selectedId.value = progress.file.id;
      }
      if (isScanCancelling.value) return;
      if (progress.activity?.state === "delayed") {
        scanMessage.value = progress.activity.explanation;
        return;
      }
      if (progress.recovery?.stage === "safe-validation") {
        scanMessage.value =
          `Recovery validation · ${progress.completed.toLocaleString()} of ${progress.total.toLocaleString()} completed · ${progress.currentFile ?? "Preparing isolated file"}`;
        return;
      }
      if (progress.recovery?.stage === "restored-settings" && progress.total === 0) {
        scanMessage.value = progress.recovery.explanation;
        return;
      }
      if (progress.phase === "discovered") {
        scanMessage.value =
          scanMode.value === "metadata-inventory"
            ? `${progress.total.toLocaleString()} audio files discovered · starting metadata inventory`
            : `${progress.total.toLocaleString()} audio files discovered · starting complete decode${progress.resourcePolicyExplanation ? " · resource controls adjusted to the system-safe aggregate budget" : ""}`;
      } else if (progress.phase === "processing") {
        scanMessage.value =
          `${scanProgressTitle.value} · ${progress.currentFile ?? "Preparing file"}`;
      } else if (progress.phase === "checkpointing" && progress.checkpoint) {
        scanMessage.value = progress.checkpoint.explanation;
      } else if (progress.phase === "finalizing" && progress.finalization) {
        scanMessage.value = progress.finalization.explanation;
      } else if (progress.phase === "staging") {
        const transferred = progress.sourceIo?.transferredBytes;
        const totalBytes = progress.sourceIo?.sizeBytes;
        const transferPercent =
          transferred !== undefined && totalBytes
            ? Math.min(100, Math.round((transferred / totalBytes) * 100))
            : null;
        scanMessage.value = progress.sourceIo?.staged
          ? `Optimized mounted-source transfer complete · analyzing local staged copy · ${progress.currentFile}`
          : progress.sourceIo && transferred === undefined
            ? `Local staging unavailable · analyzing mounted source directly · ${progress.currentFile}`
            : `Optimizing mounted-source read${transferPercent === null ? "" : ` · ${transferPercent}%`} · ${progress.currentFile}`;
      } else if (progress.phase === "inventorying") {
        scanMessage.value = `${progress.completed.toLocaleString()} of ${progress.total.toLocaleString()} inventoried · ${progress.currentFile}`;
      } else if (progress.phase === "analyzing") {
        scanMessage.value = `${progress.completed.toLocaleString()} of ${progress.total.toLocaleString()} ${progress.fromCache ? "restored from verified cache" : "fully analyzed"} · ${progress.currentFile}`;
      }
    }) ?? null;
  removeHistoryCleanupListener =
    window.audioV?.onAuditHistoryCleanup((progress) => {
      historyMessage.value =
        progress.state === "cleaning"
          ? `${progress.explanation} · ${progress.deletedFiles.toLocaleString()} file record${progress.deletedFiles === 1 ? "" : "s"} reclaimed`
          : progress.explanation;
    }) ?? null;
  removeIdentityProgressListener =
    window.audioV?.onIdentityProgress((progress) => {
      identityBatchCompleted.value = progress.completed;
      identityBatchTotal.value = progress.total;
      identityBatchMessage.value =
        `${progress.completed.toLocaleString()} of ${progress.total.toLocaleString()} identified · ${progress.currentFile ?? "Preparing file"}`;
      if (progress.file) {
        files.value = files.value.map((file) =>
          file.id === progress.file!.id ? progress.file! : file,
        );
      }
    }) ?? null;
  comparisonBlinkTimer = setInterval(() => {
    if (
      activeWorkspace.value === "compare" &&
      comparisonVisualMode.value === "blink"
    ) {
      comparisonBlinkFrame.value =
        comparisonBlinkFrame.value === "a" ? "b" : "a";
    }
  }, 650);
  void window.audioV?.qaLoadConfiguredSource?.().then((source) => {
    if (source) void scanSource(source);
  });
  window.addEventListener("keydown", handleGlobalKeydown);
  scheduleTableViewportMeasurement();
});

async function loadExternalIdentityPreferences(): Promise<void> {
  if (!window.audioV) return;
  try {
    const preferences =
      await window.audioV.loadExternalIdentityPreferences();
    acoustIdEnabled.value = preferences.acoustIdEnabled;
    musicBrainzEnabled.value = preferences.musicBrainzEnabled;
    acoustIdApiKey.value = preferences.acoustIdApiKey;
    identityPreferencesMessage.value =
      preferences.protection === "os-encrypted"
        ? "Preferences restored · credentials are protected by the operating system."
        : "Preferences restored · secure credential storage is unavailable.";
    if (preferences.hasStoredAcoustIdApiKey) {
      acoustIdValidationState.value = "idle";
      acoustIdValidationMessage.value =
        "Stored application key restored · it will be checked before the next audit.";
    }
  } catch (error) {
    identityPreferencesMessage.value = desktopErrorMessage(
      error,
      "Saved external identity preferences could not be loaded.",
    );
  } finally {
    identityPreferencesLoaded.value = true;
  }
}

async function ensureExternalIdentityPreferencesLoaded(): Promise<void> {
  if (identityPreferencesLoaded.value) return;
  if (!identityPreferencesLoadPromise) {
    identityPreferencesLoadPromise =
      loadExternalIdentityPreferences().finally(() => {
        identityPreferencesLoadPromise = null;
      });
  }
  await identityPreferencesLoadPromise;
}

async function saveExternalIdentityPreferences(
  clearAcoustIdKey = false,
): Promise<boolean> {
  if (!window.audioV) return false;
  const request = ++identityPreferencesRequest;
  identityPreferencesSaving.value = true;
  identityPreferencesMessage.value = clearAcoustIdKey
    ? "Clearing the stored AcoustID key…"
    : "Saving external identity preferences…";
  const requestedKey = clearAcoustIdKey
    ? null
    : acoustIdApiKey.value.trim() || null;
  if (requestedKey) {
    acoustIdValidationState.value = "checking";
    acoustIdValidationMessage.value =
      "Checking and securely saving this application key…";
  }
  try {
    const saved = await window.audioV.saveExternalIdentityPreferences({
      acoustIdEnabled: clearAcoustIdKey ? false : acoustIdEnabled.value,
      musicBrainzEnabled: musicBrainzEnabled.value,
      acoustIdApiKey: requestedKey,
    });
    if (request !== identityPreferencesRequest) return true;
    acoustIdEnabled.value = saved.acoustIdEnabled;
    musicBrainzEnabled.value = saved.musicBrainzEnabled;
    acoustIdApiKey.value = saved.acoustIdApiKey;
    identityPreferencesMessage.value =
      "Saved for future Audio-V launches · not included in audit evidence.";
    acoustIdValidationState.value = saved.hasStoredAcoustIdApiKey
      ? "valid"
      : "idle";
    acoustIdValidationMessage.value = saved.hasStoredAcoustIdApiKey
      ? "Application key accepted and protected by the operating system."
      : "No personal application key is stored.";
    return true;
  } catch (error) {
    if (request !== identityPreferencesRequest) return false;
    const message = desktopErrorMessage(
      error,
      "External identity preferences could not be saved.",
    );
    identityPreferencesMessage.value = message;
    if (requestedKey || acoustIdEnabled.value) {
      acoustIdValidationState.value = "error";
      acoustIdValidationMessage.value = message;
    }
    return false;
  } finally {
    if (request === identityPreferencesRequest) {
      identityPreferencesSaving.value = false;
    }
  }
}

onUnmounted(() => {
  removeScanProgressListener?.();
  removeHistoryCleanupListener?.();
  removeIdentityProgressListener?.();
  if (comparisonBlinkTimer) clearInterval(comparisonBlinkTimer);
  if (progressFrame !== null) cancelAnimationFrame(progressFrame);
  if (tableViewportFrame !== null) cancelAnimationFrame(tableViewportFrame);
  tableResizeObserver?.disconnect();
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
    "library",
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

async function refreshAcceptanceRun(): Promise<void> {
  if (!window.audioV) return;
  try {
    latestAcceptanceRun.value = await window.audioV.latestAcceptanceRun();
  } catch (error) {
    acceptanceRunMessage.value = desktopErrorMessage(
      error,
      "Acceptance evidence could not be loaded.",
    );
  }
}

async function exportAcceptanceRun(): Promise<void> {
  if (!window.audioV || !latestAcceptanceRun.value) return;
  try {
    const result = await window.audioV.exportAcceptanceRun();
    acceptanceRunMessage.value = result.canceled
      ? "Acceptance evidence export canceled."
      : `Privacy-safe acceptance evidence exported · ${result.filePath}`;
  } catch (error) {
    acceptanceRunMessage.value = desktopErrorMessage(
      error,
      "Acceptance evidence could not be exported.",
    );
  }
}

async function openApplicationLogs(): Promise<void> {
  if (!window.audioV) return;
  const opened = await window.audioV.openApplicationLogs();
  diagnosticsMessage.value = opened
    ? "Opened Audio-V's local rotating JSONL log folder."
    : "Application logs are not available yet.";
}

async function refreshAuditStorageStatus(): Promise<void> {
  if (!window.audioV) return;
  try {
    auditStorageStatus.value = await window.audioV.auditStorageStatus();
    auditStorageMessage.value = auditStorageStatus.value.optimizationRecommended
      ? `${formatBytes(auditStorageStatus.value.reclaimableBytes)} can be safely reclaimed.`
      : "Saved audit storage is within the compaction threshold.";
  } catch (error) {
    auditStorageMessage.value =
      error instanceof Error
        ? `Storage status unavailable · ${error.message}`
        : "Storage status is unavailable.";
  }
}

async function optimizeAuditStorage(): Promise<void> {
  if (!window.audioV || auditStorageOptimizing.value) return;
  auditStorageOptimizing.value = true;
  auditStorageMessage.value =
    "Optimizing saved audit storage… Audio-V remains open; do not start an audit or quit until this finishes.";
  try {
    const result = await window.audioV.optimizeAuditStorage();
    auditStorageStatus.value = result.after;
    auditStorageMessage.value =
      `Optimization complete · ${formatBytes(
        Math.max(
          0,
          result.before.databaseBytes - result.after.databaseBytes,
        ),
      )} reclaimed in ${formatDuration(result.elapsedMilliseconds / 1000)}.`;
  } catch (error) {
    auditStorageMessage.value =
      error instanceof Error
        ? `Storage was not optimized · ${error.message}`
        : "Storage was not optimized.";
  } finally {
    auditStorageOptimizing.value = false;
  }
}

async function scanSource(source: AudioSourceSelection): Promise<void> {
  await ensureExternalIdentityPreferencesLoaded();
  if (acoustIdEnabled.value) {
    if (!window.audioV) return;
    const normalizedApiKey = acoustIdApiKey.value.trim();
    if (!normalizedApiKey && externalIdentityStatus.value?.officialClientConfigured) {
      acoustIdValidationState.value = "valid";
      acoustIdValidationMessage.value =
        "Official Audio-V client identity selected · recognition is ready.";
    } else {
      isDiscovering.value = true;
      acoustIdValidationState.value = "checking";
      acoustIdValidationMessage.value =
        "Checking this application key with AcoustID…";
      scanMessage.value =
        "Validating the AcoustID application key before the audit starts…";
      try {
        await window.audioV.validateAcoustIdApiKey(normalizedApiKey);
        acoustIdApiKey.value = normalizedApiKey;
        acoustIdValidationState.value = "valid";
        acoustIdValidationMessage.value =
          "Application key accepted · external lookup is ready for this audit.";
        await saveExternalIdentityPreferences();
      } catch (error) {
        activeWorkspace.value = "settings";
        acoustIdValidationState.value = "error";
        acoustIdValidationMessage.value = desktopErrorMessage(
          error,
          "The AcoustID application key could not be validated.",
        );
        scanMessage.value = "AcoustID key needs attention in Settings";
        return;
      } finally {
        isDiscovering.value = false;
      }
    }
  }
  const mode = source.mode ?? scanMode.value;
  scanMode.value = mode;
  const requestedLimits = source.resourceLimits ?? {
    concurrency: analysisConcurrency.value,
    workerMemoryMb: analysisWorkerMemoryMb.value,
    ffmpegThreads: analysisFfmpegThreads.value,
    nativeProcessMemoryMb: analysisNativeMemoryMb.value,
  };
  analysisConcurrency.value = requestedLimits.concurrency;
  analysisWorkerMemoryMb.value = requestedLimits.workerMemoryMb;
  analysisFfmpegThreads.value = requestedLimits.ffmpegThreads;
  analysisNativeMemoryMb.value = requestedLimits.nativeProcessMemoryMb;
  const requestedSource = {
    ...source,
    mode,
    resourceLimits: requestedLimits,
    deliveryProfile: selectedDeliveryProfile.value,
    externalLookup: {
      acoustIdEnabled: acoustIdEnabled.value,
      musicBrainzEnabled: musicBrainzEnabled.value,
      ...(acoustIdEnabled.value && acoustIdApiKey.value
        ? { acoustIdApiKey: acoustIdApiKey.value }
        : {}),
    },
  };
  isDiscovering.value = true;
  scanProgress.value = {
    phase: "discovered",
    completed: 0,
    total: 0,
    currentFile: null,
    file: null,
    fromCache: false,
  };
  isScanPaused.value = false;
  isScanCancelling.value = false;
  auditNotices.value = [];
  scanFailureMessage.value = "";
  resourcePolicyNotice.value = "";
  sourceIoNotice.value = "";
  effectiveResourceLimits.value = null;
  recoveryStatus.value = "";
  files.value = [];
  progressFileIndexById = new Map();
  activeSessionId.value = "";
  selectedId.value = "";
  scanMessage.value =
    mode === "metadata-inventory"
      ? "Discovering files and inventorying declared technical metadata…"
      : "Discovering files and fully decoding every supported audio stream…";
  sourceRoot.value = source.label;

  try {
    const result = await window.audioV!.scanSelection(requestedSource);
    if (progressFrame !== null) {
      cancelAnimationFrame(progressFrame);
      progressFrame = null;
    }
    queuedProgressFiles = [];
    activeSessionId.value = result.sessionId ?? "";
    files.value = result.files;
    progressFileIndexById = new Map(
      result.files.map((file, index) => [file.id, index]),
    );
    auditNotices.value = result.warnings.filter(
      (warning) => warning !== resourcePolicyNotice.value,
    );
    const firstMeasured =
      result.files.find((file) => file.oracle.measurements) ?? result.files[0];
    selectedId.value = firstMeasured?.id ?? "";
    compareAId.value = result.files[0]?.id ?? "";
    compareBId.value = result.files[1]?.id ?? result.files[0]?.id ?? "";
    reportSelectedId.value = result.files[0]?.id ?? "";
    activePanel.value = "quick";
    filter.value = "all";
    const measured = result.files.filter(
      (file) => oracleAnalysisState(file) === "completed",
    ).length;
    const notAnalyzed = result.files.filter(
      (file) => oracleAnalysisState(file) === "not-analyzed",
    ).length;
    const analysisErrors = result.files.filter(
      (file) => oracleAnalysisState(file) === "error",
    ).length;
    const warnings = auditNotices.value.length
      ? ` · ${auditNotices.value.length} audit notice${auditNotices.value.length === 1 ? "" : "s"}`
      : "";
    scanMessage.value =
      `${result.files.length.toLocaleString()} files loaded` +
      `${measured ? ` · ${measured} analyzed` : ""}` +
      `${notAnalyzed ? ` · ${notAnalyzed} not analyzed` : ""}` +
      `${analysisErrors ? ` · ${analysisErrors} analysis error${analysisErrors === 1 ? "" : "s"}` : ""}` +
      `${result.unreadableCount ? ` · ${result.unreadableCount} failed integrity` : ""}` +
      warnings;
    await refreshAuditSessions();
    await hydrateSelectedSessionFile();
  } catch (error) {
    flushQueuedProgressFiles();
    const message =
      error instanceof Error ? error.message : "The selected source could not be scanned.";
    if (isScanCancelling.value && /cancel(?:ed|led)/i.test(message)) {
      auditNotices.value = [];
      scanFailureMessage.value = "";
      scanMessage.value =
        `Audit canceled cleanly · ${files.value.length.toLocaleString()} completed result${files.value.length === 1 ? "" : "s"} preserved in History`;
    } else {
      scanFailureMessage.value = message;
      scanMessage.value = message;
    }
  } finally {
    isDiscovering.value = false;
    isScanPaused.value = false;
    isScanCancelling.value = false;
    await refreshAuditSessions();
    await refreshAcceptanceRun();
  }
}

async function refreshAuditSessions(): Promise<void> {
  if (!window.audioV) return;
  recentSessions.value = await window.audioV.listAuditSessions();
  if (
    sourceRoot.value === "No source selected" &&
    files.value.length === 0
  ) {
    const interrupted = recentSessions.value.find(
      (session) => session.interrupted,
    );
    if (interrupted) {
      sourceRoot.value = interrupted.label;
      scanMessage.value =
        `${interrupted.completedCount.toLocaleString()} of ${interrupted.discoveredCount.toLocaleString()} files were checkpointed before the interruption · open History to resume safely`;
    }
  }
}

async function clearAuditHistory(): Promise<void> {
  if (
    !window.audioV ||
    historyClearing.value ||
    isDiscovering.value ||
    recentSessions.value.length === 0 ||
    !window.confirm(
      "Clear all saved audit history?\n\nThis removes completed, canceled, failed, and interrupted sessions. It does not delete source audio, reusable Oracle cache, or the separate Identity fingerprint index. This action cannot be undone.",
    )
  ) return;

  historyClearing.value = true;
  historyMessage.value = "Clearing saved audit sessions…";
  const wasViewingHistoricalSession = activeSessionId.value.length > 0;
  try {
    const result = await window.audioV.clearAuditHistory();
    recentSessions.value = [];
    if (wasViewingHistoricalSession) {
      files.value = [];
      activeSessionId.value = "";
      selectedId.value = "";
      compareAId.value = "";
      compareBId.value = "";
      reportSelectedId.value = "";
      scanProgress.value = null;
      auditNotices.value = [];
      scanFailureMessage.value = "";
      sourceRoot.value = "No source selected";
      scanMessage.value = "History cleared · ready for files or a folder";
    }
    historyMessage.value =
      `Cleared ${result.affected.toLocaleString()} saved audit session${result.affected === 1 ? "" : "s"}` +
      (result.retainedRunning
        ? ` · retained ${result.retainedRunning.toLocaleString()} running session${result.retainedRunning === 1 ? "" : "s"}`
        : result.cleanupPending
          ? " · reclaiming saved session records in the background"
          : " · source audio, Oracle cache, and Identity index were not changed");
  } catch (error) {
    historyMessage.value =
      error instanceof Error ? error.message : "Saved audit history could not be cleared.";
  } finally {
    historyClearing.value = false;
  }
}

async function refreshFingerprintLibrary(): Promise<void> {
  if (!window.audioV || fingerprintLibraryLoading.value) return;
  fingerprintLibraryLoading.value = true;
  try {
    fingerprintLibrary.value = await window.audioV.listFingerprintLibrary();
    fingerprintLibraryMessage.value =
      `${fingerprintLibrary.value.length.toLocaleString()} indexed fingerprint${fingerprintLibrary.value.length === 1 ? "" : "s"}`;
  } catch (error) {
    fingerprintLibraryMessage.value =
      error instanceof Error ? error.message : "Fingerprint index could not be loaded.";
  } finally {
    fingerprintLibraryLoading.value = false;
  }
}

async function identifyCurrentAudit(): Promise<void> {
  if (
    !window.audioV ||
    identityBatchRunning.value ||
    isDiscovering.value ||
    files.value.length === 0
  ) return;
  identityBatchRunning.value = true;
  identityBatchCompleted.value = 0;
  identityBatchTotal.value = files.value.length;
  identityBatchMessage.value =
    "Preparing bounded AcoustID recognition and MusicBrainz enrichment…";
  try {
    const result = await window.audioV.identifyFiles(
      files.value.map((file) => file.path),
      activeSessionId.value || undefined,
      acoustIdApiKey.value.trim() || undefined,
      true,
    );
    const updatedById = new Map(result.files.map((file) => [file.id, file]));
    files.value = files.value.map((file) => updatedById.get(file.id) ?? file);
    musicBrainzEnabled.value = true;
    identityBatchMessage.value =
      `Identity pass complete · ${result.matched.toLocaleString()} matched or corroborated · ${result.conflicts.toLocaleString()} metadata conflict${result.conflicts === 1 ? "" : "s"} · ${result.inconclusive.toLocaleString()} inconclusive` +
      (result.serviceErrors
        ? ` · ${result.serviceErrors.toLocaleString()} service error${result.serviceErrors === 1 ? "" : "s"}`
        : "");
  } catch (error) {
    identityBatchMessage.value = desktopErrorMessage(
      error,
      "The current audit could not be identified.",
    );
  } finally {
    identityBatchRunning.value = false;
  }
}

async function rebuildFingerprintLibrary(): Promise<void> {
  if (!window.audioV || fingerprintLibraryLoading.value) return;
  fingerprintLibraryLoading.value = true;
  try {
    const result = await window.audioV.rebuildFingerprintLibrary();
    fingerprintLibrary.value = await window.audioV.listFingerprintLibrary();
    fingerprintLibraryMessage.value =
      `Rebuilt from saved audit evidence · ${result.remaining.toLocaleString()} indexed`;
  } catch (error) {
    fingerprintLibraryMessage.value =
      error instanceof Error ? error.message : "Fingerprint index rebuild failed.";
  } finally {
    fingerprintLibraryLoading.value = false;
  }
}

async function pruneFingerprintLibrary(): Promise<void> {
  if (!window.audioV || fingerprintLibraryLoading.value) return;
  fingerprintLibraryLoading.value = true;
  try {
    const result = await window.audioV.pruneFingerprintLibrary();
    fingerprintLibrary.value = await window.audioV.listFingerprintLibrary();
    fingerprintLibraryMessage.value =
      `Pruned ${result.affected.toLocaleString()} missing source entr${result.affected === 1 ? "y" : "ies"} · ${result.remaining.toLocaleString()} remain`;
  } catch (error) {
    fingerprintLibraryMessage.value =
      error instanceof Error ? error.message : "Fingerprint index pruning failed.";
  } finally {
    fingerprintLibraryLoading.value = false;
  }
}

async function clearFingerprintLibrary(): Promise<void> {
  if (
    !window.audioV ||
    fingerprintLibraryLoading.value ||
    !window.confirm(
      "Clear every historical fingerprint? Saved audit sessions remain available and can rebuild the index later.",
    )
  ) return;
  fingerprintLibraryLoading.value = true;
  try {
    const result = await window.audioV.clearFingerprintLibrary();
    fingerprintLibrary.value = [];
    fingerprintLibraryMessage.value =
      `Cleared ${result.affected.toLocaleString()} historical fingerprint${result.affected === 1 ? "" : "s"}`;
  } catch (error) {
    fingerprintLibraryMessage.value =
      error instanceof Error ? error.message : "Fingerprint index could not be cleared.";
  } finally {
    fingerprintLibraryLoading.value = false;
  }
}

async function openAuditSession(sessionId: string): Promise<void> {
  if (!window.audioV || isDiscovering.value) return;
  loadingSessionId.value = sessionId;
  try {
    const session = await window.audioV.openAuditSession(sessionId);
    scanMode.value = session.source.mode ?? "full-audit";
    deliveryProfileId.value =
      session.source.deliveryProfile?.id ?? "none";
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
    await hydrateSelectedSessionFile();
  } catch (error) {
    scanMessage.value =
      error instanceof Error ? error.message : "The audit session could not be opened.";
  } finally {
    loadingSessionId.value = "";
  }
}

async function resumeAuditSession(
  session: AuditSessionSummary,
  strategy: AuditResumeStrategy = "adaptive-safe",
): Promise<void> {
  if (!window.audioV || isDiscovering.value) return;
  loadingSessionId.value = session.id;
  try {
    const plan = await window.audioV.prepareAuditSessionResume(
      session.id,
      strategy,
    );
    analysisConcurrency.value = plan.targetResourceLimits.concurrency;
    analysisWorkerMemoryMb.value = plan.targetResourceLimits.workerMemoryMb;
    analysisFfmpegThreads.value = plan.targetResourceLimits.ffmpegThreads;
    analysisNativeMemoryMb.value =
      plan.targetResourceLimits.nativeProcessMemoryMb;
    deliveryProfileId.value =
      plan.source.deliveryProfile?.id ?? "none";
    sourceRoot.value = plan.source.label;
    historyOpen.value = false;
    scanMessage.value =
      strategy === "previous-settings"
        ? `Resuming with the saved ${plan.targetResourceLimits.concurrency}-worker configuration by explicit request`
        : plan.quarantinedCandidateCount
          ? `${plan.quarantinedCandidateCount} repeatedly unstable file${plan.quarantinedCandidateCount === 1 ? " is" : "s are"} quarantined; remaining work will resume with the saved settings`
          : plan.safeCandidateCount
            ? `Validating ${plan.safeCandidateCount} previously active file${plan.safeCandidateCount === 1 ? "" : "s"} safely, then automatically restoring ${plan.targetResourceLimits.concurrency} workers`
            : `Resuming ${plan.completedCount.toLocaleString()} of ${plan.discoveredCount.toLocaleString()} checkpointed files with the saved settings`;
    await scanSource(plan.source);
  } catch (error) {
    scanMessage.value =
      error instanceof Error
        ? error.message
        : "The interrupted audit could not be resumed safely.";
  } finally {
    loadingSessionId.value = "";
  }
}

function applyResourcePreset(
  preset: "recovery-safe" | "balanced" | "performance",
): void {
  const presets: Record<
    typeof preset,
    AnalysisResourceLimits
  > = {
    "recovery-safe": {
      concurrency: 1,
      workerMemoryMb: 256,
      ffmpegThreads: 1,
      nativeProcessMemoryMb: 512,
    },
    balanced: {
      concurrency: 2,
      workerMemoryMb: 256,
      ffmpegThreads: 2,
      nativeProcessMemoryMb: 512,
    },
    performance: {
      concurrency: 8,
      workerMemoryMb: 256,
      ffmpegThreads: 2,
      nativeProcessMemoryMb: 512,
    },
  };
  const limits = presets[preset];
  analysisConcurrency.value = limits.concurrency;
  analysisWorkerMemoryMb.value = limits.workerMemoryMb;
  analysisFfmpegThreads.value = limits.ffmpegThreads;
  analysisNativeMemoryMb.value = limits.nativeProcessMemoryMb;
}

async function toggleScanPause(): Promise<void> {
  if (!window.audioV || !isDiscovering.value || isScanCancelling.value) return;
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
  if (source) await scanSource({ ...source, mode: scanMode.value });
}

function setComparisonVisualState(
  slot: "a" | "b",
  status: "idle" | "loading" | "ready" | "error",
  message: string,
): void {
  comparisonVisualState.value = {
    ...comparisonVisualState.value,
    [slot]: { status, message },
  };
}

function rememberComparisonFile(file: AudioFileRecord): void {
  comparisonFiles.value = [
    ...comparisonFiles.value.filter(
      (entry) => entry.id !== file.id && entry.path !== file.path,
    ),
    file,
  ];
}

async function hydrateComparisonFile(slot: "a" | "b"): Promise<void> {
  if (!window.audioV) return;
  const file = slot === "a" ? compareA.value : compareB.value;
  const request =
    slot === "a"
      ? ++comparisonVisualRequestA
      : ++comparisonVisualRequestB;
  if (!file) {
    setComparisonVisualState(
      slot,
      "idle",
      `Choose File ${slot.toUpperCase()}.`,
    );
    return;
  }
  if (hasComparisonVisualEvidence(file)) {
    setComparisonVisualState(
      slot,
      "ready",
      `File ${slot.toUpperCase()} visual evidence is ready.`,
    );
    await renderComparisonVisuals();
    return;
  }
  setComparisonVisualState(
    slot,
    "loading",
    `Loading File ${slot.toUpperCase()} waveform and spectrogram…`,
  );
  try {
    const sessionId =
      comparisonFileSessions.get(file.id) ??
      (files.value.some((candidate) => candidate.id === file.id)
        ? activeSessionId.value || undefined
        : undefined);
    const hydrated = await window.audioV.loadComparisonFile(
      file.path,
      sessionId,
    );
    const isCurrent =
      slot === "a"
        ? request === comparisonVisualRequestA &&
          compareAId.value === file.id
        : request === comparisonVisualRequestB &&
          compareBId.value === file.id;
    if (!isCurrent) return;
    rememberComparisonFile(hydrated);
    setComparisonVisualState(
      slot,
      hasComparisonVisualEvidence(hydrated) ? "ready" : "error",
      hasComparisonVisualEvidence(hydrated)
        ? `File ${slot.toUpperCase()} visual evidence is ready.`
        : `File ${slot.toUpperCase()} analysis completed without viewable waveform or spectrogram evidence.`,
    );
    await renderComparisonVisuals();
  } catch (error) {
    const isCurrent =
      slot === "a"
        ? request === comparisonVisualRequestA
        : request === comparisonVisualRequestB;
    if (!isCurrent) return;
    setComparisonVisualState(
      slot,
      "error",
      desktopErrorMessage(
        error,
        `File ${slot.toUpperCase()} visual evidence could not be loaded.`,
      ),
    );
    await renderComparisonVisuals();
  }
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
    if (result.sessionId) {
      comparisonFileSessions.set(file.id, result.sessionId);
    }
    rememberComparisonFile(file);
    if (slot === "a") compareAId.value = file.id;
    else compareBId.value = file.id;
    scanMessage.value =
      `Comparison file analyzed · loading visual evidence · ${file.name}`;
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
  if (!window.audioV || !isDiscovering.value || isScanCancelling.value) return;
  isScanCancelling.value = true;
  isScanPaused.value = false;
  scanMessage.value =
    "Cancelling active decoders now · preserving completed results and resumable history…";
  const accepted = await window.audioV.cancelScan();
  if (!accepted) {
    isScanCancelling.value = false;
    scanMessage.value = "The audit had already stopped.";
  }
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
      file.id === selected.value?.id
        ? { ...file, detailLevel: undefined, oracle }
        : file,
    );
    activePanel.value = "quick";
    scanMessage.value =
      oracle.analysisState === "failed"
        ? `Deterministic integrity failure · ${selected.value.name}`
        : oracle.analysisState === "error"
          ? `Analysis error at ${failureStageLabel({ ...selected.value, oracle })} · no integrity verdict issued`
          : `Complete decode and analysis finished · ${selected.value.name}`;
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
    (file) =>
      ["failed", "error"].includes(oracleAnalysisState(file)),
  );
  if (!failed.length) return;
  isAnalyzing.value = true;
  let completed = 0;
  try {
    for (const file of failed) {
      scanMessage.value = `Retrying incomplete or failed analyses · ${completed + 1} of ${failed.length} · ${file.name}`;
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
  const visibleFraction = 1 / spectrogramZoom.value;
  const startFraction =
    spectrogramPan.value * Math.max(0, 1 - visibleFraction);
  const startIndex = Math.floor(startFraction * spectral.slices.length);
  const endIndex = Math.min(
    spectral.slices.length,
    Math.max(
      startIndex + 1,
      Math.ceil((startFraction + visibleFraction) * spectral.slices.length),
    ),
  );
  const sliceIndex = Math.min(
    endIndex - 1,
    startIndex + Math.round(x * Math.max(0, endIndex - startIndex - 1)),
  );
  const binIndex = Math.min(
    spectral.slices[sliceIndex].levelsDbfs.length - 1,
    Math.round(
      (frequency / spectral.maxFrequencyHz) *
        (spectral.slices[sliceIndex].levelsDbfs.length - 1),
    ),
  );
  const visibleTimes = spectrogramVisibleTimes.value;
  const timeSeconds =
    visibleTimes.start + x * (visibleTimes.end - visibleTimes.start);
  spectrogramCursor.value =
    `${timeSeconds.toFixed(2)} s · ` +
    `${frequency >= 1_000 ? `${(frequency / 1_000).toFixed(2)} kHz` : `${Math.round(frequency)} Hz`} · ` +
    `${spectral.slices[sliceIndex].levelsDbfs[binIndex].toFixed(1)} dBFS`;
}

function spectrogramPoint(event: MouseEvent): { x: number; y: number } | null {
  const canvas = spectrogramCanvas.value;
  if (!canvas) return null;
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, 1 - (event.clientY - bounds.top) / bounds.height)),
  };
}

function beginSpectrogramRegion(event: MouseEvent): void {
  spectrogramSelectionStart.value = spectrogramPoint(event);
}

function finishSpectrogramRegion(event: MouseEvent): void {
  const start = spectrogramSelectionStart.value;
  const end = spectrogramPoint(event);
  const spectral = displaySpectrum.value;
  spectrogramSelectionStart.value = null;
  if (!start || !end || !spectral) return;
  const visible = spectrogramVisibleTimes.value;
  const time = (fraction: number) =>
    visible.start + fraction * (visible.end - visible.start);
  const frequency = (fraction: number) =>
    spectrogramScale.value === "linear"
      ? fraction * spectral.maxFrequencyHz
      : 20 * (spectral.maxFrequencyHz / 20) ** fraction;
  const startTime = Math.min(time(start.x), time(end.x));
  const endTime = Math.max(time(start.x), time(end.x));
  const lowFrequency = Math.min(frequency(start.y), frequency(end.y));
  const highFrequency = Math.max(frequency(start.y), frequency(end.y));
  spectrogramRegion.value =
    `${startTime.toFixed(2)}–${endTime.toFixed(2)} s · ` +
    `${(lowFrequency / 1_000).toFixed(2)}–${(highFrequency / 1_000).toFixed(2)} kHz`;
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

function spectrogramPng(spectral: SpectrogramMeasurements): string {
  const canvas = document.createElement("canvas");
  const bins = spectral.slices[0]?.levelsDbfs.length ?? 0;
  canvas.width = spectral.slices.length;
  canvas.height = bins;
  const context = canvas.getContext("2d");
  if (!context || !bins) return "";
  const pixels = context.createImageData(canvas.width, canvas.height);
  for (let x = 0; x < canvas.width; x += 1) {
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
      ).match(/\d+/g)!.map(Number);
      const offset = ((bins - 1 - bin) * canvas.width + x) * 4;
      pixels.data[offset] = color[0];
      pixels.data[offset + 1] = color[1];
      pixels.data[offset + 2] = color[2];
      pixels.data[offset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}

async function exportBatchSpectrograms(): Promise<void> {
  if (!window.audioV) return;
  const measuredFiles = files.value.filter(
    (file) => file.oracle.measurements,
  );
  if (!measuredFiles.length) {
    scanMessage.value = "No measured spectrograms are available to export";
    return;
  }
  try {
    const items: Array<{ fileName: string; dataUrl: string }> = [];
    for (let index = 0; index < measuredFiles.length; index += 1) {
      const file = measuredFiles[index];
      scanMessage.value =
        `Preparing spectrogram ${index + 1} of ${measuredFiles.length} · ${file.name}`;
      const persisted = file.oracle.measurements!.spectrogramPyramid?.find(
        (spectrum) =>
          spectrum.fftSize === spectrogramFftSize.value &&
          spectrogramChannelMode.value === "per-channel power average",
      );
      const spectral =
        (persisted?.slices.length ? persisted : null) ??
        await window.audioV.inspectSpectrogram(
          file.path,
          spectrogramFftSize.value,
          spectrogramChannelMode.value,
        );
      items.push({ fileName: file.name, dataUrl: spectrogramPng(spectral) });
    }
    const result = await window.audioV.exportSpectrogramBatch(items);
    scanMessage.value = result.canceled
      ? "Batch spectrogram export canceled"
      : `${result.exportedCount.toLocaleString()} spectrogram PNGs exported · ${result.filePath}`;
  } catch (error) {
    scanMessage.value =
      error instanceof Error
        ? `Batch spectrogram export failed · ${error.message}`
        : "Batch spectrogram export failed";
  }
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

function originSpectrum(file: AudioFileRecord): SpectrogramMeasurements | null {
  return (
    file.oracle.measurements?.originSpectrumSummary ??
    file.oracle.measurements?.spectrogram ??
    null
  );
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
  const strength =
    fidelity.ruleStrength && fidelity.ruleStrength !== "none"
      ? `${fidelity.ruleStrength} rule strength`
      : "No responsible origin classification";
  const stability =
    fidelity.stabilityPercent === null ||
    fidelity.stabilityPercent === undefined
      ? "stability unavailable"
      : `${fidelity.stabilityPercent}% regional stability`;
  return `${strength} · ${coverage} · ${stability}`;
}

function assessmentStatusLabel(
  file: AudioFileRecord,
  lane: "integrity" | "signal" | "origin" | "provenance" | "delivery",
): string {
  const assessment = file.oracle.assessments?.[lane];
  if (!assessment) return "Legacy result · re-run for v12 lanes";
  if (lane === "delivery") {
    const delivery = file.oracle.assessments?.delivery;
    return delivery?.status === "not-evaluated"
      ? "No delivery profile selected"
      : `${delivery?.status.replaceAll("-", " ") ?? "unavailable"} · ${delivery?.profile?.label ?? "profile unavailable"}`;
  }
  return assessment.status.replaceAll("-", " ");
}

function repairActionability(file: AudioFileRecord): {
  label: string;
  tone: "clear" | "review" | "failed";
  detail: string;
} {
  if (oracleAnalysisState(file) === "error") {
    return {
      label: "Analysis retry required",
      tone: "review",
      detail:
        "No damage verdict was issued. Retry the failed analysis stage before considering remediation.",
    };
  }
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
  if (oracleAnalysisState(file) === "error") {
    return `Audio-V stopped at ${failureStageLabel(file)}. Review the exact diagnostic evidence, confirm the bundled engine is available, and re-run analysis; do not replace or rewrite the source based on this processing error.`;
  }
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
  return (
    oracleAnalysisState(file) === "error" ||
    ["review", "likely-transcode", "likely-upsample", "damaged"].includes(
      file.oracle.verdict,
    )
  );
}

function reviewExplanation(file: AudioFileRecord): string {
  if (oracleAnalysisState(file) === "error") {
    return `Audio-V could not complete the ${failureStageLabel(file)} stage. This is an application or processing error, not evidence that the audio file is damaged.`;
  }
  if (file.oracle.verdict === "damaged") {
    return "Failed means Audio-V has deterministic evidence against the file itself, such as decoder-reported corruption or a decoded-audio checksum mismatch. Do not replace the original automatically; use the exact evidence to locate or restore a verified copy.";
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
    oracleAnalysisState(file) === "completed" &&
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
  return file.userReview?.status === "reviewed";
}

const reviewDispositionOptions: Array<{
  value: UserReviewDisposition;
  label: string;
  explanation: string;
}> = [
  {
    value: "acknowledged",
    label: "Acknowledged",
    explanation: "Seen, but no human conclusion has been recorded.",
  },
  {
    value: "accepted-intentional",
    label: "Accepted as intentional",
    explanation: "The measured condition appears deliberate and acceptable.",
  },
  {
    value: "confirmed-issue",
    label: "Confirmed issue",
    explanation: "Independent inspection supports the Oracle finding.",
  },
  {
    value: "false-positive",
    label: "Possible false positive",
    explanation: "Human inspection disagrees; Oracle evidence remains unchanged.",
  },
  {
    value: "remediated",
    label: "Remediated copy verified",
    explanation: "A separate corrected copy was created and checked.",
  },
  {
    value: "replacement-required",
    label: "Replacement required",
    explanation: "The source should be reacquired from a trusted copy.",
  },
  {
    value: "follow-up-required",
    label: "Follow-up required",
    explanation: "The result remains unresolved and needs more evidence.",
  },
];

function reviewDisposition(file: AudioFileRecord): UserReviewDisposition {
  return (
    reviewDispositionDrafts.value[file.id] ??
    file.userReview?.disposition ??
    "acknowledged"
  );
}

function reviewDispositionLabel(file: AudioFileRecord): string {
  return (
    reviewDispositionOptions.find(
      (option) => option.value === reviewDisposition(file),
    )?.label ?? "Acknowledged"
  );
}

function reviewDispositionExplanation(file: AudioFileRecord): string {
  return (
    reviewDispositionOptions.find(
      (option) => option.value === reviewDisposition(file),
    )?.explanation ?? reviewDispositionOptions[0].explanation
  );
}

function reviewNote(file: AudioFileRecord): string {
  return reviewNoteDrafts.value[file.id] ?? file.userReview?.note ?? "";
}

function updateReviewDisposition(
  file: AudioFileRecord,
  event: Event,
): void {
  reviewDispositionDrafts.value = {
    ...reviewDispositionDrafts.value,
    [file.id]: (event.target as HTMLSelectElement)
      .value as UserReviewDisposition,
  };
}

function updateReviewNote(file: AudioFileRecord, event: Event): void {
  reviewNoteDrafts.value = {
    ...reviewNoteDrafts.value,
    [file.id]: (event.target as HTMLTextAreaElement).value,
  };
}

function isReviewStatusUpdating(file: AudioFileRecord): boolean {
  return reviewStatusUpdatingIds.value.has(file.id);
}

async function setReviewed(
  file: AudioFileRecord,
  reviewed: boolean,
  announce = true,
  disposition: UserReviewDisposition = "acknowledged",
  note = "",
): Promise<void> {
  if (!window.audioV || !activeSessionId.value) {
    scanMessage.value = "A saved audit session is required to mark a file as reviewed.";
    return;
  }
  reviewStatusUpdatingIds.value = new Set([
    ...reviewStatusUpdatingIds.value,
    file.id,
  ]);
  try {
    const updated = await window.audioV.setFileReviewed(
      activeSessionId.value,
      file.path,
      reviewed,
      disposition,
      note,
    );
    files.value = files.value.map((candidate) =>
      candidate.id === file.id
        ? { ...candidate, userReview: updated.userReview }
        : candidate,
    );
    if (announce) {
      scanMessage.value = reviewed
        ? `Human disposition saved · Oracle verdict unchanged · ${file.name}`
        : `Human disposition removed · Oracle verdict unchanged · ${file.name}`;
    }
    const nextDispositionDrafts = { ...reviewDispositionDrafts.value };
    const nextNoteDrafts = { ...reviewNoteDrafts.value };
    delete nextDispositionDrafts[file.id];
    delete nextNoteDrafts[file.id];
    reviewDispositionDrafts.value = nextDispositionDrafts;
    reviewNoteDrafts.value = nextNoteDrafts;
  } catch (error) {
    scanMessage.value =
      error instanceof Error
        ? `Review status was not saved · ${error.message}`
        : "Review status was not saved.";
  } finally {
    reviewStatusUpdatingIds.value = new Set(
      [...reviewStatusUpdatingIds.value].filter((id) => id !== file.id),
    );
  }
}

function saveReviewDisposition(file: AudioFileRecord): void {
  void setReviewed(
    file,
    true,
    true,
    reviewDisposition(file),
    reviewNote(file),
  );
}

function clearReviewDisposition(file: AudioFileRecord): void {
  void setReviewed(file, false);
}

function cycleAuditResultSort(): void {
  auditResultSort.value =
    auditResultSort.value === "original"
      ? "verdict-ascending"
      : auditResultSort.value === "verdict-ascending"
        ? "verdict-descending"
        : "original";
}

function auditResultSortLabel(): string {
  if (auditResultSort.value === "verdict-ascending") {
    return "Verdict, Clear to Failed";
  }
  if (auditResultSort.value === "verdict-descending") {
    return "Verdict, Failed to Clear";
  }
  return "Verdict, original order";
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
  void nextTick(() => {
    if (reportDetail.value) reportDetail.value.scrollTop = 0;
  });
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
    await setReviewed(file, true, false);
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
      <button class="rail-item" :aria-current="activeWorkspace === 'library' ? 'page' : undefined" :class="{ active: activeWorkspace === 'library' }" @click="activeWorkspace = 'library'"><b aria-hidden="true">◎</b><small>Identity</small></button>
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
              <strong :title="sourceRoot">{{ sourceRoot }}</strong>
            </span>
          </div>
          <label
            class="scan-mode"
            :class="{ adjusted: Boolean(resourcePolicyNotice) }"
            :title="resourcePolicyNotice || 'Choose whether Audio-V performs a full Oracle audit or metadata inventory.'"
          >
            <small>{{ resourcePolicyNotice ? "Safe limits active" : "Run mode" }}</small>
            <select
              v-model="scanMode"
              :disabled="isDiscovering"
              title="Full Oracle Audit decodes and assesses every file. Metadata Inventory catalogs declared properties without issuing a verdict."
            >
              <option value="full-audit">Full Oracle audit</option>
              <option value="metadata-inventory">Metadata inventory</option>
            </select>
          </label>
          <button
            class="secondary-action files-action"
            :disabled="isDiscovering"
            @click="chooseSource('files')"
          >
            Choose files
          </button>
          <button
            v-if="isDiscovering"
            class="secondary-action pause-action"
            :disabled="
              isScanCancelling ||
              scanProgress?.phase === 'finalizing' ||
              scanProgress?.phase === 'complete'
            "
            :title="
              scanProgress?.phase === 'finalizing'
                ? 'File workers are complete; finalization cannot be paused. Cancellation remains available.'
                : undefined
            "
            @click="toggleScanPause"
          >
            {{ isScanCancelling ? "Stopping…" : isScanPaused ? "Resume" : "Pause" }}
          </button>
          <button
            class="primary-action"
            :class="{ cancelling: isScanCancelling }"
            :disabled="isScanCancelling"
            :aria-busy="isScanCancelling"
            @click="isDiscovering ? cancelScan() : chooseSource('folder')"
          >
            {{ isScanCancelling ? "Cancelling…" : isDiscovering ? "Cancel audit" : "Choose folder" }}
            <span>{{ isScanCancelling ? "■" : "›" }}</span>
          </button>
        </div>
      </header>

      <section v-if="historyOpen" class="session-history" aria-label="Recent audit sessions">
        <header>
          <div>
            <span class="eyebrow">Persistent audit history</span>
            <strong>Open completed evidence or resume an interrupted source</strong>
          </div>
          <div class="session-history-actions">
            <button
              class="secondary-action"
              :disabled="historyClearing"
              @click="refreshAuditSessions"
            >
              Refresh
            </button>
            <button
              class="danger-action"
              :disabled="historyClearing || isDiscovering || recentSessions.length === 0"
              @click="clearAuditHistory"
            >
              {{ historyClearing ? "Clearing…" : "Clear history" }}
            </button>
          </div>
        </header>
        <p
          v-if="historyMessage"
          class="session-history-message"
          role="status"
          aria-live="polite"
        >
          {{ historyMessage }}
        </p>
        <div v-if="recentSessions.length" class="session-history-list">
          <article v-for="session in recentSessions" :key="session.id">
            <div>
              <strong>{{ session.label }}</strong>
              <span>
                {{ session.completedCount.toLocaleString() }} / {{ session.discoveredCount.toLocaleString() }} files ·
                {{ session.warningCount }} warnings ·
                {{ new Date(session.updatedAt).toLocaleString() }}
              </span>
              <span v-if="session.interrupted" class="session-recovery-note">
                {{ session.recoveryCandidateCount.toLocaleString() }} in-flight file{{ session.recoveryCandidateCount === 1 ? "" : "s" }} will be validated safely before saved performance settings are restored
              </span>
            </div>
            <b :class="`session-${session.interrupted ? 'interrupted' : session.status}`">
              {{ session.interrupted ? "interrupted" : session.status }}
            </b>
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
              @click="resumeAuditSession(session, 'adaptive-safe')"
            >
              Resume adaptively
            </button>
            <button
              v-if="session.status !== 'completed'"
              :disabled="isDiscovering || loadingSessionId === session.id"
              title="Bypasses isolated validation and may repeat the previous crash."
              @click="resumeAuditSession(session, 'previous-settings')"
            >
              Use prior limits
            </button>
          </article>
        </div>
        <div v-else class="session-history-empty">No saved audit sessions yet.</div>
      </section>

      <template v-if="activeWorkspace === 'audit'">
      <section class="overview">
        <div
          class="verdict-ring"
          :class="{ scanning: isDiscovering, cancelling: isScanCancelling }"
          :style="{ '--sweep': isDiscovering ? scanProgressSweep : files.length ? '360deg' : '0deg' }"
          :role="isDiscovering ? 'progressbar' : undefined"
          :aria-label="isDiscovering ? scanProgressTitle : undefined"
          :aria-valuenow="isDiscovering ? scanProgressPercent : undefined"
          :aria-valuemin="isDiscovering ? 0 : undefined"
          :aria-valuemax="isDiscovering ? 100 : undefined"
        >
          <div>
            <strong>{{ isDiscovering ? `${scanProgressPercent}%` : files.length.toLocaleString() }}</strong>
            <span>
              {{
                isDiscovering
                  ? `${scanProgress?.completed ?? 0} / ${scanProgress?.total ?? "—"}`
                  : "files"
              }}
            </span>
          </div>
        </div>
        <div class="distribution">
          <span class="eyebrow">Verdict distribution</span>
          <div class="legend">
            <span><i class="clear"></i>Clear <b>{{ counts.clear }}</b></span>
            <span><i class="review"></i>Review <b>{{ counts.review }}</b></span>
            <span><i class="failed"></i>Failed <b>{{ counts.failed }}</b></span>
            <span class="workflow-state"><i class="pending"></i>Not analyzed <b>{{ counts.notAnalyzed }}</b></span>
            <span v-if="counts.analysisErrors" class="workflow-state"><i class="error"></i>Analysis error <b>{{ counts.analysisErrors }}</b></span>
          </div>
          <div
            v-if="isDiscovering"
            class="scan-progress"
            role="status"
            aria-live="polite"
          >
            <div>
              <strong>{{ scanProgressTitle }}</strong>
              <b>{{ scanProgressPercent }}%</b>
            </div>
            <span aria-hidden="true"><i :style="{ width: `${scanProgressPercent}%` }"></i></span>
            <small :title="scanProgress?.currentFile ?? undefined">
              {{
                isScanCancelling
                  ? "Stopping active work and checkpointing completed files…"
                  : scanProgress?.activity?.explanation
                    ?? scanProgress?.finalization?.explanation
                    ?? scanProgress?.checkpoint?.explanation
                    ?? scanProgress?.currentFile
                    ?? "Reading the selected source…"
              }}
            </small>
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
          <small :title="selected.path">{{ selected.path }}</small>
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
          <button :aria-pressed="filter === 'not-analyzed'" :class="{ active: filter === 'not-analyzed' }" @click="filter = 'not-analyzed'">
            Not analyzed {{ counts.notAnalyzed }}
          </button>
          <button v-if="counts.analysisErrors" :aria-pressed="filter === 'error'" :class="{ active: filter === 'error' }" @click="filter = 'error'">
            Errors {{ counts.analysisErrors }}
          </button>
          <button :aria-pressed="filter === 'failed'" :class="{ active: filter === 'failed' }" @click="filter = 'failed'">
            Failed {{ counts.failed }}
          </button>
          <button
            v-if="counts.failed || counts.analysisErrors"
            :disabled="isDiscovering || isAnalyzing"
            @click="retryFailedFiles"
          >
            Retry failed/errors
          </button>
          <span class="scan-state">{{ scanMessage }}</span>
        </div>
        <details
          v-if="scanFailureMessage"
          class="source-warnings"
          open
        >
          <summary>Audit workflow error</summary>
          <ul><li>{{ scanFailureMessage }}</li></ul>
          <p>This is an application or processing failure, not evidence that the source is damaged or inaccessible.</p>
        </details>
        <details
          v-if="auditNotices.length"
          class="source-warnings"
          :open="!isDiscovering"
        >
          <summary>
            {{ auditNotices.length }} audit notice{{ auditNotices.length === 1 ? "" : "s" }}
          </summary>
          <ul>
            <li v-for="notice in auditNotices" :key="notice">{{ notice }}</li>
          </ul>
          <p v-if="hasSourceAccessNotices">For mounted and network libraries, confirm the volume is connected, then re-select the folder so the operating system can grant this app access.</p>
          <p v-else>These notices describe optional or supplemental processing. They do not mean that the listed audio files failed integrity analysis.</p>
        </details>
        <div class="table-grid table-head">
          <span>File name</span><span>Format</span><span>Sample rate</span>
          <span>Bit depth</span><span>Duration</span><span>Bitrate</span>
          <span>Channels</span>
          <span class="sortable-heading">
            <button
              type="button"
              :aria-label="`${auditResultSortLabel()}. Activate to change sorting.`"
              :title="`${auditResultSortLabel()}. Click to change sorting.`"
              @click="cycleAuditResultSort"
            >
              Verdict
              <i aria-hidden="true">
                {{
                  auditResultSort === "verdict-ascending"
                    ? "↑"
                    : auditResultSort === "verdict-descending"
                      ? "↓"
                      : "↕"
                }}
              </i>
            </button>
          </span>
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
            <span class="row-verdict" :class="fileStateClass(file)">
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
            v-for="panel in (['quick', 'spectrogram', 'loudness', 'evidence'] as AnalysisPanel[])"
            :key="panel"
            role="tab"
            :aria-selected="activePanel === panel"
            :class="{ active: activePanel === panel }"
            @click="activePanel = panel"
          >
            {{ analysisPanelLabel(panel) }}
          </button>
          <span>
            {{
              selected.oracle.measurements
                ? "Complete decode, integrity, loudness, and spectrum analysis finished"
                : oracleAnalysisState(selected) === "not-analyzed"
                  ? "Metadata inventory complete · Oracle Engine has not analyzed this file"
                  : oracleAnalysisState(selected) === "error"
                    ? `Analysis stopped at ${failureStageLabel(selected)} · no integrity verdict issued`
                    : "Deterministic integrity evidence stopped the complete decode"
            }}
          </span>
        </nav>
        <div class="analysis-content">
          <div class="visualization">
            <section v-if="activePanel === 'quick'" class="quick-inspect">
              <header class="quick-verdict" :class="fileStateClass(selected)">
                <div>
                  <span class="eyebrow">One-file Oracle summary</span>
                  <h2>{{ shortVerdict(selected) }}</h2>
                  <strong>{{ selected.oracle.headline }}</strong>
                </div>
                <p>{{ reviewExplanation(selected) }}</p>
              </header>
              <div class="quick-grid">
                <article>
                  <span class="eyebrow">Format</span>
                  <strong>{{ selected.codec }} · {{ selected.container }}</strong>
                  <dl>
                    <div><dt>Resolution</dt><dd>{{ formatRate(selected.sampleRate) }} · {{ selected.bitDepth ? `${selected.bitDepth}-bit` : "bit depth not declared" }}</dd></div>
                    <div><dt>Bitrate</dt><dd>{{ formatBitrate(selected.bitrate) }}{{ selected.bitrateMode ? ` · ${selected.bitrateMode}` : "" }}</dd></div>
                    <div><dt>{{ selected.oracle.technical?.mp3ChannelMode ? "MP3 frame mode" : "Channels" }}</dt><dd>{{ encodedChannelLabel(selected) }}</dd></div>
                  </dl>
                </article>
                <article>
                  <span class="eyebrow">Signal</span>
                  <strong>{{ selected.oracle.measurements ? `${selected.oracle.measurements.integratedLufs?.toFixed(1) ?? "—"} LUFS` : "Not measured" }}</strong>
                  <dl>
                    <div><dt>Sample / true peak</dt><dd>{{ formatDb(selected.oracle.measurements?.samplePeakDbfs ?? null) }} / {{ selected.oracle.measurements?.truePeakDbtp === null || selected.oracle.measurements?.truePeakDbtp === undefined ? "—" : `${selected.oracle.measurements.truePeakDbtp.toFixed(2)} dBTP` }}</dd></div>
                    <div><dt>RMS / loudness range</dt><dd>{{ formatDb(selected.oracle.measurements?.rmsDbfs ?? null) }} / {{ selected.oracle.measurements?.loudnessRangeLu === null || selected.oracle.measurements?.loudnessRangeLu === undefined ? "—" : `${selected.oracle.measurements.loudnessRangeLu.toFixed(1)} LU` }}</dd></div>
                    <div><dt>DR meter</dt><dd>{{ selected.oracle.measurements?.drMeter === null || selected.oracle.measurements?.drMeter === undefined ? "—" : `DR${selected.oracle.measurements.drMeter.toFixed(1)}` }}</dd></div>
                  </dl>
                  <button @click="activePanel = 'loudness'">Open signal details</button>
                </article>
                <article>
                  <span class="eyebrow">Spectrum & origin</span>
                  <strong>{{ originAssessmentLabel(selected) }}</strong>
                  <dl>
                    <div><dt>Observed bandwidth</dt><dd>{{ formatHz(originSpectrum(selected)?.effectiveBandwidthHz) }}</dd></div>
                    <div><dt>Evidence coverage</dt><dd>{{ selected.oracle.fidelity ? `${selected.oracle.fidelity.evidenceCoverage}%` : "Not assessed" }}</dd></div>
                    <div><dt>Rule strength</dt><dd>{{ selected.oracle.fidelity?.ruleStrength?.replaceAll("-", " ") ?? "Not assessed" }}</dd></div>
                  </dl>
                  <button @click="activePanel = 'spectrogram'">Open spectrogram</button>
                </article>
                <article>
                  <span class="eyebrow">Integrity & next step</span>
                  <strong>{{ quickIntegrityLabel(selected) }}</strong>
                  <dl>
                    <div><dt>Clipped samples</dt><dd>{{ selected.oracle.measurements?.clippedSamples.toLocaleString() ?? "Not measured" }}</dd></div>
                    <div><dt>Waveform candidates</dt><dd>{{ selected.oracle.measurements?.defects ? `${selected.oracle.measurements.defects.clickPopCandidateCount} click/pop · ${selected.oracle.measurements.defects.stuckSampleCandidateCount} stuck` : "Not measured" }}</dd></div>
                    <div><dt>Evidence findings</dt><dd>{{ selected.oracle.evidence.length.toLocaleString() }}</dd></div>
                  </dl>
                  <button @click="activePanel = 'evidence'">Open evidence</button>
                </article>
              </div>
              <footer>
                Quick Inspect summarizes the same measured evidence used by the Oracle Engine.
                It does not create a second verdict or hide uncertainty.
              </footer>
            </section>

            <div v-else-if="activePanel === 'spectrogram'" class="spectrogram">
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
                        <option :value="512">Overview · 512 FFT</option>
                        <option :value="2048">Detail · 2,048 FFT</option>
                        <option :value="4096">Precision · 4,096 FFT</option>
                        <option :value="16384">Hi-Fi · 16,384 FFT</option>
                      </select>
                    </label>
                    <label>Channels
                      <select
                        v-model="spectrogramChannelMode"
                        :title="
                          spectrogramChannelMode === 'left-right difference'
                            ? 'L−R isolates stereo difference energy. A quieter or darker result is expected when the channels share similar content.'
                            : 'Left and Right use the same absolute dBFS color scale so their levels remain directly comparable.'
                        "
                      >
                        <option value="per-channel power average">Combined power</option>
                        <option value="left channel">Left</option>
                        <option value="right channel" :disabled="(selected.channels ?? 1) < 2">Right</option>
                        <option value="left-right difference" :disabled="(selected.channels ?? 1) < 2">L−R difference</option>
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
                    <label>Color
                      <select v-model="spectrogramColormap">
                        <option value="inferno">Inferno</option>
                        <option value="magma">Magma</option>
                        <option value="viridis">Viridis</option>
                      </select>
                    </label>
                    <button @click="exportSpectrogram">Export PNG</button>
                    <button @click="exportBatchSpectrograms">Batch PNG</button>
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
                    @mousedown="beginSpectrogramRegion"
                    @mouseup="finishSpectrogramRegion"
                  >Measured full-track audio spectrogram.</canvas>
                </div>
                <div class="spectrogram-time">
                  <span>{{ formatDuration(spectrogramVisibleTimes.start) }}</span>
                  <b>{{ spectrogramCursor }}</b>
                  <span>{{ formatDuration(spectrogramVisibleTimes.end) }}</span>
                </div>
                <div class="spectrogram-navigation">
                  <button :disabled="spectrogramZoom === 1" @click="spectrogramZoom = Math.max(1, spectrogramZoom / 2)">−</button>
                  <span>{{ spectrogramZoom }}× zoom</span>
                  <button :disabled="spectrogramZoom === 16" @click="spectrogramZoom = Math.min(16, spectrogramZoom * 2)">+</button>
                  <label>Pan <input v-model.number="spectrogramPan" type="range" min="0" max="1" step="0.01" :disabled="spectrogramZoom === 1"></label>
                  <b>{{ spectrogramRegion }}</b>
                </div>
              </div>
              <div
                v-else-if="hydratingFileId === selected.id"
                class="analysis-pending"
              >
                <span>STFT</span>
                <strong>Loading stored spectrum…</strong>
                <p>The completed audit evidence is being restored without decoding the file again.</p>
              </div>
              <div v-else-if="spectrogramInspecting" class="analysis-pending">
                <span>FFT</span>
                <strong>Measuring detailed spectrum…</strong>
                <p>The selected channel view is decoded on demand so library audits remain bounded.</p>
              </div>
              <div v-else class="analysis-pending">
                <span>STFT</span>
                <strong>Spectrogram not measured</strong>
                <p>
                  {{
                    oracleAnalysisState(selected) === "not-analyzed"
                      ? "Metadata Inventory does not decode signal data. Re-run this file with the Oracle Engine to measure its spectrogram."
                      : oracleAnalysisState(selected) === "error"
                        ? `Analysis stopped at ${failureStageLabel(selected)}. No file-integrity conclusion was made.`
                        : spectrogramInspectionError || "The deterministic integrity failure prevented a complete spectrogram. Review the exact decoder evidence."
                  }}
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
                  <span class="eyebrow">DR meter</span>
                  <strong>{{ selected.oracle.measurements.drMeter === null || selected.oracle.measurements.drMeter === undefined ? "—" : `DR ${selected.oracle.measurements.drMeter.toFixed(1)}` }}</strong>
                  <p>Windowed crest-to-RMS dynamics from FFmpeg drmeter; this complements LRA and PLR.</p>
                </article>
                <article v-if="selected.oracle.measurements.replayGain">
                  <span class="eyebrow">Calculated ReplayGain 2.0</span>
                  <strong>{{ selected.oracle.measurements.replayGain.trackGainDb === null ? "—" : `${selected.oracle.measurements.replayGain.trackGainDb.toFixed(2)} dB` }}</strong>
                  <p>
                    Track gain at −18 LUFS
                    <template v-if="selected.oracle.measurements.replayGain.albumGainDb !== null">
                      · album {{ selected.oracle.measurements.replayGain.albumGainDb.toFixed(2) }} dB across {{ selected.oracle.measurements.replayGain.albumTrackCount }} tracks
                    </template>.
                    {{ selected.oracle.measurements.replayGain.albumReason ?? "Album eligibility was not recorded by this earlier Oracle result." }}
                  </p>
                </article>
                <article>
                  <span class="eyebrow">Bit utilization</span>
                  <strong>{{ selected.oracle.measurements.bitUtilization?.effectiveBitDepth ?? "—" }}{{ selected.oracle.measurements.bitUtilization?.effectiveBitDepth ? ` of ${selected.oracle.measurements.bitUtilization.declaredBitDepth} bits` : "" }}</strong>
                  <p>{{ selected.oracle.measurements.bitUtilization?.classification?.replaceAll("-", " ") ?? "Not measured for this legacy result" }}. This can flag padded/truncated integer lossless PCM; it does not recover precision.</p>
                </article>
                <article v-if="selected.oracle.measurements.defects" class="clipping-diagnostics">
                  <span class="eyebrow">Waveform defect diagnostics</span>
                  <strong>{{ selected.oracle.measurements.defects.clickPopCandidateCount }} click/pop · {{ selected.oracle.measurements.defects.stuckSampleCandidateCount }} stuck</strong>
                  <p>{{ selected.oracle.measurements.defects.steepTransitionCandidateCount }} steep transition candidates. Findings trigger Review, never deterministic damage by themselves.</p>
                  <div class="clipping-timeline" role="img" aria-label="Waveform defect candidate timeline">
                    <i
                      v-for="(event, index) in selected.oracle.measurements.defects.events"
                      :key="`${event.kind}-${index}`"
                      :style="{
                        left: `${(event.startSeconds / selected.oracle.measurements.durationSeconds) * 100}%`,
                        width: `${Math.max(0.25, ((event.endSeconds - event.startSeconds) / selected.oracle.measurements.durationSeconds) * 100)}%`
                      }"
                      :title="`${event.kind} · channel ${event.channel + 1} · ${event.startSeconds.toFixed(4)}–${event.endSeconds.toFixed(4)} s`"
                    ></i>
                  </div>
                  <small>{{ selected.oracle.measurements.defects.limitation }}</small>
                </article>
                <article
                  v-if="selected.oracle.measurements.clipping"
                  class="clipping-diagnostics"
                >
                  <span class="eyebrow">Clipped samples</span>
                  <strong>{{ selected.oracle.measurements.clippedSamples.toLocaleString() }} · {{ selected.oracle.measurements.clipping.clippedSamplePercent.toFixed(6) }}%</strong>
                  <p>{{ selected.oracle.measurements.clipping.eventCount.toLocaleString() }} contiguous events · {{ selected.oracle.measurements.nearClippedSamples.toLocaleString() }} samples at or above −0.1 dBFS.</p>
                  <div class="clipping-timeline" role="img" :aria-label="`${selected.oracle.measurements.clipping.eventCount} clipping events across the track timeline`">
                    <i
                      v-for="(event, index) in selected.oracle.measurements.clipping.events"
                      :key="index"
                      :style="{
                        left: `${(event.startSeconds / selected.oracle.measurements.durationSeconds) * 100}%`,
                        width: `${Math.max(0.25, ((event.endSeconds - event.startSeconds) / selected.oracle.measurements.durationSeconds) * 100)}%`
                      }"
                      :title="`${event.startSeconds.toFixed(3)}–${event.endSeconds.toFixed(3)} s · ${event.clippedSamples} samples · channels ${event.channels.map((channel) => channel + 1).join(', ')}`"
                    ></i>
                  </div>
                  <dl>
                    <div v-for="(channel, index) in selected.oracle.measurements.perChannel" :key="index">
                      <dt>Channel {{ index + 1 }}</dt>
                      <dd>{{ channel.clippedSamples.toLocaleString() }} · {{ channel.clippedSamplePercent.toFixed(6) }}%</dd>
                    </div>
                  </dl>
                  <small :class="{ warning: selected.oracle.measurements.clipping.scaledClippingIndicator === 'possible-scaled-clipping' }">
                    {{ selected.oracle.measurements.clipping.scaledClippingIndicator === "possible-scaled-clipping"
                      ? `Possible scaled clipping · ${selected.oracle.measurements.clipping.scaledClippingCandidateSamples.toLocaleString()} repeated plateau samples`
                      : "No repeated plateau pattern detected" }}
                  </small>
                </article>
                <article class="stereo-diagnostic">
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
                <article class="stereo-diagnostic">
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
                  {{
                    oracleAnalysisState(selected) === "not-analyzed"
                      ? "Not analyzed"
                      : oracleAnalysisState(selected) === "error"
                        ? "Analysis could not be completed"
                        : "Complete stream decode failed"
                  }}
                </strong>
                <p>
                  {{
                    oracleAnalysisState(selected) === "not-analyzed"
                      ? "Run a Full Oracle Audit to measure loudness and signal quality."
                      : oracleAnalysisState(selected) === "error"
                        ? "Review the failure stage and diagnostic evidence; this is not a damage verdict."
                        : "Review the Evidence panel for the exact deterministic integrity evidence."
                  }}
                </p>
              </div>
            </div>

            <div v-else class="evidence-view">
              <section
                v-if="selected.oracle.failure"
                class="failure-explanation"
                :class="selected.oracle.failure.category"
              >
                <header>
                  <span class="eyebrow">
                    {{
                      selected.oracle.failure.category === "file-integrity"
                        ? "Deterministic file-integrity failure"
                        : "Analysis processing error"
                    }}
                  </span>
                  <strong>{{ failureStageLabel(selected) }}</strong>
                  <b>{{ selected.oracle.failure.code }}</b>
                </header>
                <p>{{ selected.oracle.failure.summary }}</p>
                <div>
                  <span>Exact evidence</span>
                  <code>{{ selected.oracle.failure.evidence }}</code>
                </div>
                <button
                  v-if="selected.oracle.failure.category === 'analysis-error'"
                  :disabled="isAnalyzing"
                  @click="analyzeSelected"
                >
                  Retry this analysis
                </button>
              </section>
              <section
                v-if="isReviewFile(selected)"
                class="review-workflow"
                :class="fileStateClass(selected)"
              >
                <div>
                  <span class="eyebrow">Why this needs attention</span>
                  <h2>{{ selected.oracle.headline }}</h2>
                  <p>{{ reviewExplanation(selected) }}</p>
                </div>
                <ol>
                  <li><b>1</b><span><strong>Understand</strong>Read the contradictory evidence and the plain-language interpretation.</span></li>
                  <li><b>2</b><span><strong>Verify</strong>Listen or compare with a trusted edition when the finding is heuristic.</span></li>
                  <li><b>3</b><span><strong>Decide</strong>Record what human review concluded without changing the Oracle verdict.</span></li>
                </ol>
                <div class="review-adjudication">
                  <div>
                    <span class="eyebrow">Human disposition</span>
                    <strong>{{ reviewDispositionLabel(selected) }}</strong>
                    <p>{{ reviewDispositionExplanation(selected) }}</p>
                  </div>
                  <label>
                    Review outcome
                    <select
                      :value="reviewDisposition(selected)"
                      @change="updateReviewDisposition(selected, $event)"
                    >
                      <option
                        v-for="option in reviewDispositionOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select>
                  </label>
                  <label>
                    Review note (optional)
                    <textarea
                      :value="reviewNote(selected)"
                      maxlength="1000"
                      rows="3"
                      placeholder="Record what was checked, compared, or decided."
                      @input="updateReviewNote(selected, $event)"
                    ></textarea>
                  </label>
                  <div class="review-adjudication-actions">
                    <button
                      :disabled="isReviewStatusUpdating(selected)"
                      @click="saveReviewDisposition(selected)"
                    >
                      {{ isReviewStatusUpdating(selected) ? "Saving…" : "Save disposition" }}
                    </button>
                    <button
                      v-if="isAcknowledged(selected)"
                      :disabled="isReviewStatusUpdating(selected)"
                      @click="clearReviewDisposition(selected)"
                    >
                      Clear disposition
                    </button>
                  </div>
                  <small>
                    Human review is reported separately. It never edits measured
                    evidence or converts Review or Failed into Clear.
                  </small>
                </div>
                <div class="review-actions">
                  <button @click="exportFileEvidence(selected)">Export evidence</button>
                  <button @click="revealSource(selected)">Reveal source</button>
                  <button
                    v-if="selected.oracle.failure?.category !== 'analysis-error'"
                    class="primary-review-action"
                    @click="openRepair(selected)"
                  >
                    Open repair options
                  </button>
                  <button
                    v-else
                    class="primary-review-action"
                    :disabled="isAnalyzing"
                    @click="analyzeSelected"
                  >
                    Retry analysis
                  </button>
                </div>
                <small v-if="isAcknowledged(selected)" class="reviewed-disclosure">
                  {{ reviewDispositionLabel(selected) }}
                  <template v-if="selected.userReview?.reviewedAt">
                    · {{ new Date(selected.userReview.reviewedAt).toLocaleString() }}
                  </template>
                  · Oracle verdict unchanged
                </small>
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
              <div v-if="selected.oracle.technical?.mp3ChannelMode"><dt>MP3 frame mode</dt><dd>{{ selected.oracle.technical.mp3ChannelMode }}</dd></div>
              <div><dt>Bitrate mode</dt><dd>{{ selected.bitrateMode ?? "Not probed" }}</dd></div>
              <div><dt>Packet bitrate p05 / p95</dt><dd>{{ selected.oracle.technical?.packetBitrateP05 === null || selected.oracle.technical?.packetBitrateP05 === undefined ? "Not available" : `${formatBitrate(selected.oracle.technical.packetBitrateP05)} / ${formatBitrate(selected.oracle.technical.packetBitrateP95)}` }}</dd></div>
              <div><dt>Packet bitrate deviation</dt><dd>{{ selected.oracle.technical?.packetBitrateStdDev === null || selected.oracle.technical?.packetBitrateStdDev === undefined ? "Not available" : formatBitrate(selected.oracle.technical.packetBitrateStdDev) }}</dd></div>
              <div><dt>Packet duration coverage</dt><dd>{{ selected.oracle.technical?.packetDurationCoverage === null || selected.oracle.technical?.packetDurationCoverage === undefined ? "Not available" : `${selected.oracle.technical.packetDurationCoverage.toFixed(2)}%` }}</dd></div>
              <div><dt>Decoder</dt><dd>{{ selected.oracle.measurements?.decoder ?? "Decode failed" }}</dd></div>
              <div>
                <dt>SHA-256</dt>
                <dd
                  class="hash-value"
                  :title="selected.oracle.technical?.fileSha256"
                  :aria-label="selected.oracle.technical?.fileSha256 ? `Full SHA-256 ${selected.oracle.technical.fileSha256}` : 'SHA-256 unavailable'"
                  :tabindex="selected.oracle.technical?.fileSha256 ? 0 : undefined"
                >
                  {{ selected.oracle.technical?.fileSha256.slice(0, 16) ?? "—" }}{{ selected.oracle.technical?.fileSha256 ? "…" : "" }}
                </dd>
              </div>
              <div v-if="selected.oracle.technical?.flacMd5"><dt>FLAC audio MD5</dt><dd>{{ selected.oracle.technical.flacMd5.status }}</dd></div>
              <div><dt>External checksums</dt><dd>{{ selected.oracle.technical?.externalChecksums?.length ? `${selected.oracle.technical.externalChecksums.filter((item) => item.status === "verified").length}/${selected.oracle.technical.externalChecksums.length} verified` : "No manifest entry" }}</dd></div>
              <div><dt>Stereo assessment</dt><dd>{{ selected.oracle.measurements?.stereoAssessment.replaceAll("-", " ") ?? "—" }}</dd></div>
              <div><dt>Side / mid energy</dt><dd>{{ selected.oracle.measurements?.sideToMidRatioDb === null || selected.oracle.measurements?.sideToMidRatioDb === undefined ? "—" : `${selected.oracle.measurements.sideToMidRatioDb.toFixed(1)} dB` }}</dd></div>
              <div><dt>Longest zero run</dt><dd>{{ selected.oracle.measurements ? `${selected.oracle.measurements.continuity.longestDigitalSilenceSeconds.toFixed(3)} s` : "—" }}</dd></div>
              <div><dt>Dropout candidates</dt><dd>{{ selected.oracle.measurements?.continuity.internalDigitalDropoutCount ?? "—" }}</dd></div>
              <div><dt>Origin assessment</dt><dd>{{ originAssessmentLabel(selected) }}</dd></div>
              <div><dt>Content Credentials</dt><dd>{{ selected.oracle.technical?.contentCredentials?.status?.replaceAll("-", " ") ?? "Not inspected" }}</dd></div>
              <div><dt>Chromaprint</dt><dd>{{ selected.oracle.technical?.fingerprint?.status ?? "Not measured" }}</dd></div>
              <div><dt>Acoustic matches</dt><dd>{{ selected.oracle.technical?.fingerprint?.matches.length ?? 0 }}</dd></div>
              <div><dt>AcoustID</dt><dd>{{ acoustIdStatusLabel(selected) }}</dd></div>
              <div><dt>MusicBrainz</dt><dd>{{ musicBrainzStatusLabel(selected) }}</dd></div>
              <div><dt>Identity result</dt><dd>{{ selected.oracle.technical?.identityAssessment?.status?.replaceAll("-", " ") ?? "Not assessed" }}</dd></div>
              <div><dt>ReplayGain</dt><dd>{{ selected.metadata?.replayGain.trackGainDb === null || selected.metadata?.replayGain.trackGainDb === undefined ? "Not tagged" : `${selected.metadata.replayGain.trackGainDb.toFixed(2)} dB track gain` }}</dd></div>
              <div><dt>Calculated ReplayGain</dt><dd>{{ selected.oracle.measurements?.replayGain?.trackGainDb === null || selected.oracle.measurements?.replayGain?.trackGainDb === undefined ? "Not measured" : `${selected.oracle.measurements.replayGain.trackGainDb.toFixed(2)} dB track${selected.oracle.measurements.replayGain.albumGainDb === null ? "" : ` · ${selected.oracle.measurements.replayGain.albumGainDb.toFixed(2)} dB album`}` }}</dd></div>
              <div v-if="selected.oracle.measurements?.replayGain"><dt>Album ReplayGain status</dt><dd>{{ selected.oracle.measurements.replayGain.albumReason ?? "Eligibility explanation unavailable for this earlier result" }}</dd></div>
              <div><dt>Cue sheet</dt><dd>{{ selected.metadata?.cueSheet.embedded ? "Embedded" : selected.metadata?.cueSheet.sidecarPaths.length ? `${selected.metadata.cueSheet.sidecarPaths.length} sidecar` : "None found" }}</dd></div>
              <div v-if="selected.oracle.technical?.repairProvenance"><dt>Audio-V action</dt><dd>−{{ selected.oracle.technical.repairProvenance.gainReductionDb.toFixed(2) }} dB · {{ selected.oracle.technical.repairProvenance.outputBitDepth }}-bit copy</dd></div>
            </dl>
            <section
              v-if="selected.oracle.assessments"
              class="origin-assessment-card"
            >
              <header>
                <span class="eyebrow">Oracle v12 evidence lanes</span>
                <strong>Separated assessment model</strong>
                <em>Only review-level evidence changes the overall verdict</em>
              </header>
              <p>Integrity, signal defects, spectral origin, provenance declarations, and delivery guidance are evaluated independently so an editable tag or delivery preference cannot masquerade as file damage.</p>
              <dl>
                <div><dt>File integrity</dt><dd>{{ assessmentStatusLabel(selected, "integrity") }}</dd></div>
                <div><dt>Signal defects</dt><dd>{{ assessmentStatusLabel(selected, "signal") }}</dd></div>
                <div><dt>Spectral origin</dt><dd>{{ assessmentStatusLabel(selected, "origin") }}</dd></div>
                <div><dt>Provenance</dt><dd>{{ assessmentStatusLabel(selected, "provenance") }}</dd></div>
                <div><dt>Delivery compliance</dt><dd>{{ assessmentStatusLabel(selected, "delivery") }}</dd></div>
              </dl>
              <ul v-if="selected.oracle.assessments.findings.length">
                <li
                  v-for="finding in selected.oracle.assessments.findings"
                  :key="finding.id"
                >
                  {{ finding.severity }} · {{ finding.lane }} · {{ finding.summary }}
                </li>
              </ul>
              <small v-else>No advisory or review-level findings were produced.</small>
            </section>
            <section class="origin-assessment-card">
              <header>
                <span class="eyebrow">Measured origin assessment</span>
                <strong>{{ originAssessmentLabel(selected) }}</strong>
                <em>{{ originConfidenceLabel(selected) }}</em>
              </header>
              <p>{{ originAssessmentSummary(selected) }}</p>
              <dl v-if="selected.oracle.measurements">
                <div><dt>Declared Nyquist</dt><dd>{{ formatHz((selected.sampleRate ?? 0) / 2) }}</dd></div>
                <div><dt>Observed bandwidth</dt><dd>{{ formatHz(originSpectrum(selected)?.effectiveBandwidthHz ?? null) }}</dd></div>
                <div><dt>Strongest cutoff</dt><dd>{{ formatHz(originSpectrum(selected)?.strongestCutoffHz ?? null) }}</dd></div>
                <div><dt>Cutoff strength</dt><dd>{{ originSpectrum(selected)?.cutoffDropDb === null || originSpectrum(selected)?.cutoffDropDb === undefined ? "—" : `${originSpectrum(selected)!.cutoffDropDb!.toFixed(1)} dB` }}</dd></div>
                <div><dt>Upper-band level</dt><dd>{{ originSpectrum(selected)?.upperBandLevelDbfs === null || originSpectrum(selected)?.upperBandLevelDbfs === undefined ? "—" : `${originSpectrum(selected)!.upperBandLevelDbfs!.toFixed(1)} dBFS` }}</dd></div>
                <div><dt>Evidence coverage</dt><dd>{{ selected.oracle.fidelity?.evidenceCoverage ?? 0 }}%</dd></div>
                <div><dt>Classifier FFT</dt><dd>{{ selected.oracle.fidelity?.analysisFftSize ?? "—" }}</dd></div>
                <div><dt>Regional stability</dt><dd>{{ selected.oracle.fidelity?.stabilityPercent === null || selected.oracle.fidelity?.stabilityPercent === undefined ? "—" : `${selected.oracle.fidelity.stabilityPercent}%` }}</dd></div>
                <div><dt>Independent indicators</dt><dd>{{ selected.oracle.fidelity?.independentIndicators?.length ?? 0 }}</dd></div>
                <div><dt>Assessment reason</dt><dd>{{ selected.oracle.fidelity?.reasonCode?.replaceAll("-", " ") ?? "Not assessed" }}</dd></div>
              </dl>
              <ul v-if="selected.oracle.fidelity?.basis.length">
                <li v-for="basis in selected.oracle.fidelity.basis" :key="basis">{{ basis }}</li>
              </ul>
              <small v-if="selected.oracle.fidelity">{{ selected.oracle.fidelity.limitation }}</small>
            </section>
            <section v-if="selected.metadata" class="origin-assessment-card">
              <header>
                <span class="eyebrow">Declared metadata inventory</span>
                <strong>{{ selected.metadata.title ?? "No title declared" }}</strong>
                <em>Editable labels, not provenance proof</em>
              </header>
              <p>Audio-V preserves declared tags as inventory evidence. These fields can help identify a recording or reveal generator strings, but they are not treated as authentic merely because they are present.</p>
              <dl>
                <div><dt>Artist</dt><dd>{{ selected.metadata.artists.join(", ") || "Not declared" }}</dd></div>
                <div><dt>Album</dt><dd>{{ selected.metadata.album ?? "Not declared" }}</dd></div>
                <div><dt>Genre</dt><dd>{{ selected.metadata.genres.join(", ") || "Not declared" }}</dd></div>
                <div><dt>BPM</dt><dd>{{ selected.metadata.bpm ?? "Not declared" }}</dd></div>
                <div><dt>ISRC</dt><dd>{{ selected.metadata.isrcs.join(", ") || "Not declared" }}</dd></div>
                <div><dt>MusicBrainz IDs</dt><dd>{{ selected.metadata.musicBrainzRecordingIds.length }}</dd></div>
                <div><dt>ReplayGain</dt><dd>{{ selected.metadata.replayGain.trackGainDb === null ? "Not declared" : `${selected.metadata.replayGain.trackGainDb.toFixed(2)} dB` }}</dd></div>
                <div><dt>Cue awareness</dt><dd>{{ selected.metadata.cueSheet.embedded ? "Embedded cue sheet" : selected.metadata.cueSheet.sidecarPaths.length ? `${selected.metadata.cueSheet.sidecarPaths.length} sidecar cue sheet(s)` : "No cue sheet found" }}</dd></div>
              </dl>
              <ul v-if="selected.metadata.tags.length">
                <li v-for="tag in selected.metadata.tags.slice(0, 12)" :key="`${tag.key}-${tag.value}`">
                  {{ tag.key }} · {{ tag.value }}
                </li>
              </ul>
              <small v-if="selected.metadata.tags.length > 12">{{ selected.metadata.tags.length - 12 }} additional declared tags are retained in JSON evidence exports.</small>
            </section>
            <section
              v-if="selected.oracle.technical"
              class="origin-assessment-card"
            >
              <header>
                <span class="eyebrow">Provenance &amp; identity</span>
                <strong>{{ selected.oracle.technical.contentCredentials?.status?.replaceAll("-", " ") ?? "Not inspected" }}</strong>
                <em>Offline deterministic inspection</em>
              </header>
              <p>{{ selected.oracle.technical.contentCredentials?.limitation }}</p>
              <dl>
                <div><dt>C2PA manifests</dt><dd>{{ selected.oracle.technical.contentCredentials?.manifestCount ?? 0 }}</dd></div>
                <div><dt>Claim generator</dt><dd>{{ selected.oracle.technical.contentCredentials?.claimGenerator ?? "Not declared" }}</dd></div>
                <div><dt>Signer</dt><dd>{{ selected.oracle.technical.contentCredentials?.signer ?? "Not declared" }}</dd></div>
                <div><dt>Source declarations</dt><dd>{{ selected.oracle.technical.contentCredentials?.digitalSourceTypes.join(", ") || "None" }}</dd></div>
                <div><dt>Metadata/signature indicators</dt><dd>{{ selected.oracle.technical.provenanceIndicators?.length ?? 0 }}</dd></div>
                <div><dt>Fingerprint matches</dt><dd>{{ selected.oracle.technical.fingerprint?.matches.length ?? 0 }}</dd></div>
                <div><dt>CD database eligibility</dt><dd>{{ selected.oracle.technical.discVerification?.status.replaceAll("-", " ") ?? "Not assessed" }}</dd></div>
                <div><dt>Disc layout</dt><dd>{{ selected.oracle.technical.discVerification?.layout.replaceAll("-", " ") ?? "Not assessed" }}</dd></div>
              </dl>
              <p v-if="selected.oracle.technical.discVerification">
                {{ selected.oracle.technical.discVerification.summary }}
                {{ selected.oracle.technical.discVerification.limitation }}
              </p>
              <ul v-if="selected.oracle.technical.provenanceIndicators?.length">
                <li v-for="indicator in selected.oracle.technical.provenanceIndicators" :key="`${indicator.type}-${indicator.identifier}-${indicator.source}`">
                  {{ indicator.identifier }} · {{ indicator.source }} · {{ indicator.interpretation }}
                </li>
              </ul>
              <ul v-if="selected.oracle.technical.fingerprint?.matches.length">
                <li v-for="match in selected.oracle.technical.fingerprint.matches" :key="match.filePath">
                  {{ match.fileName }} · {{ (match.similarity * 100).toFixed(1) }}% · {{ match.relationship.replaceAll("-", " ") }} · {{ match.source === "history-index" ? "historical library" : "current audit" }}
                </li>
              </ul>
              <ul v-if="selected.oracle.technical.fingerprint?.acoustIdLookup.recordingIds.length">
                <li v-for="(recordingId, index) in selected.oracle.technical.fingerprint.acoustIdLookup.recordingIds" :key="recordingId">
                  AcoustID {{ selected.oracle.technical.fingerprint.acoustIdLookup.score === null ? "match" : `${(selected.oracle.technical.fingerprint.acoustIdLookup.score * 100).toFixed(1)}%` }} · {{ selected.oracle.technical.fingerprint.acoustIdLookup.recordingTitles[index] || "Untitled recording" }} · MusicBrainz {{ recordingId }}
                </li>
              </ul>
              <dl v-if="selected.oracle.technical.musicBrainzEnrichment?.status === 'matched'">
                <div><dt>MusicBrainz recording</dt><dd>{{ selected.oracle.technical.musicBrainzEnrichment.title ?? "Untitled recording" }}</dd></div>
                <div><dt>Credited artists</dt><dd>{{ selected.oracle.technical.musicBrainzEnrichment.artists.map((artist) => artist.name).join(", ") || "Not listed" }}</dd></div>
                <div><dt>First release</dt><dd>{{ selected.oracle.technical.musicBrainzEnrichment.firstReleaseDate ?? "Not listed" }}</dd></div>
                <div><dt>ISRCs</dt><dd>{{ selected.oracle.technical.musicBrainzEnrichment.isrcs.join(", ") || "Not listed" }}</dd></div>
                <div><dt>Identity source</dt><dd>{{ selected.oracle.technical.musicBrainzEnrichment.source === "embedded-mbid" ? "Embedded MusicBrainz ID" : "AcoustID match candidate" }}</dd></div>
              </dl>
              <ul v-if="selected.oracle.technical.musicBrainzEnrichment?.releaseGroups.length">
                <li v-for="releaseGroup in selected.oracle.technical.musicBrainzEnrichment.releaseGroups" :key="releaseGroup.id">
                  {{ releaseGroup.title }} · {{ releaseGroup.primaryType ?? "Release group" }} · {{ releaseGroup.firstReleaseDate ?? "Date unknown" }}
                </li>
              </ul>
              <small v-if="selected.oracle.technical.musicBrainzEnrichment">
                {{ selected.oracle.technical.musicBrainzEnrichment.error ?? selected.oracle.technical.musicBrainzEnrichment.limitation }}
              </small>
            </section>
            <section
              v-if="selected.oracle.technical?.identityAssessment"
              class="origin-assessment-card identity-assessment-card"
              :class="selected.oracle.technical.identityAssessment.status"
            >
              <header>
                <span class="eyebrow">Parallel identity result</span>
                <strong>{{ selected.oracle.technical.identityAssessment.status.replaceAll("-", " ") }}</strong>
                <em>Independent of the Oracle quality verdict</em>
              </header>
              <p>{{ selected.oracle.technical.identityAssessment.summary }}</p>
              <dl>
                <div><dt>Evidence basis</dt><dd>{{ selected.oracle.technical.identityAssessment.basis?.replaceAll("-", " ") ?? "No external match" }}</dd></div>
                <div><dt>Providers</dt><dd>{{ selected.oracle.technical.identityAssessment.providers.join(", ") || "None" }}</dd></div>
                <div><dt>Recording ID</dt><dd class="hash-value" :title="selected.oracle.technical.identityAssessment.recordingId ?? undefined">{{ selected.oracle.technical.identityAssessment.recordingId ?? "Not identified" }}</dd></div>
                <div><dt>Identified title</dt><dd>{{ selected.oracle.technical.identityAssessment.title ?? "Not identified" }}</dd></div>
                <div><dt>Identified artists</dt><dd>{{ selected.oracle.technical.identityAssessment.artists.join(", ") || "Not identified" }}</dd></div>
              </dl>
              <ul v-if="selected.oracle.technical.identityAssessment.comparisons.length">
                <li
                  v-for="comparison in selected.oracle.technical.identityAssessment.comparisons"
                  :key="comparison.field"
                >
                  {{ comparison.field.replaceAll("-", " ") }} · {{ comparison.result }} · declared “{{ comparison.declared.join(", ") }}” · identified “{{ comparison.identified.join(", ") }}”
                </li>
              </ul>
              <small>{{ selected.oracle.technical.identityAssessment.limitation }}</small>
            </section>
            <section v-if="selected.oracle.cueTracks?.length" class="origin-assessment-card">
              <header>
                <span class="eyebrow">Cue-track analysis</span>
                <strong>{{ selected.oracle.cueTracks.length }} indexed tracks decoded</strong>
                <em>INDEX 01 programme and INDEX 00 pregap evidence</em>
              </header>
              <ul>
                <li v-for="track in selected.oracle.cueTracks" :key="`${track.trackNumber}-${track.index01Seconds}`">
                  {{ String(track.trackNumber).padStart(2, "0") }} · {{ track.title ?? "Untitled" }} · {{ track.verdict }} ·
                  {{ track.integratedLufs === null ? "loudness unavailable" : `${track.integratedLufs.toFixed(1)} LUFS` }} ·
                  {{ track.clippedSamples === null ? "decode error" : `${track.clippedSamples} clipped samples` }}
                  <template v-if="track.pregap">
                    · INDEX 00 {{ track.pregap.durationSeconds.toFixed(3) }} s · {{ track.pregap.verdict }}
                  </template>
                </li>
              </ul>
              <small>{{ selected.oracle.cueTracks[0].limitation }}</small>
            </section>
            <div class="oracle-card" :class="fileStateClass(selected)">
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

      <section v-else-if="activeWorkspace === 'library'" class="module-page">
        <header class="module-header">
          <div><span class="eyebrow">Historical identity library</span><h1>Fingerprint index</h1></div>
          <p>Browse acoustic identities retained from completed audits. This index stores Chromaprint evidence and source paths—not audio—and can be rebuilt from saved audit sessions.</p>
        </header>
        <section class="identity-batch-card">
          <div>
            <span class="eyebrow">Automatic recognition</span>
            <strong>Identify and enrich the current audit</strong>
            <p>Audio-V already bundles Chromaprint. This action sends each measured fingerprint and rounded duration to AcoustID, then asks MusicBrainz for readable recording details. Audio files are never uploaded, and the parallel identity result never changes the Oracle quality verdict.</p>
          </div>
          <button
            class="primary-action"
            :disabled="identityBatchRunning || isDiscovering || files.length === 0"
            @click="identifyCurrentAudit"
          >
            {{ identityBatchRunning ? "Identifying…" : "Identify current audit" }}
          </button>
          <div
            v-if="identityBatchRunning || identityBatchCompleted"
            class="identity-batch-progress"
            role="progressbar"
            aria-label="External identity lookup progress"
            :aria-valuenow="identityBatchCompleted"
            aria-valuemin="0"
            :aria-valuemax="Math.max(1, identityBatchTotal)"
          >
            <i :style="{ width: `${identityBatchTotal ? (identityBatchCompleted / identityBatchTotal) * 100 : 0}%` }"></i>
          </div>
          <small role="status" aria-live="polite">
            {{ identityBatchMessage }}
            {{ externalIdentityStatus?.explanation }}
          </small>
        </section>
        <div class="fingerprint-library-summary">
          <article><span>Indexed sources</span><strong>{{ fingerprintLibrarySummary.indexed.toLocaleString() }}</strong></article>
          <article><span>Exact duplicate members</span><strong>{{ fingerprintLibrarySummary.duplicateMembers.toLocaleString() }}</strong></article>
          <article><span>Missing source paths</span><strong>{{ fingerprintLibrarySummary.missing.toLocaleString() }}</strong></article>
        </div>
        <div class="fingerprint-library-toolbar">
          <label>
            Search identity library
            <input v-model="fingerprintLibraryFilter" type="search" placeholder="Filename, path, or fingerprint SHA-256">
          </label>
          <button :disabled="fingerprintLibraryLoading" @click="refreshFingerprintLibrary">Refresh</button>
          <button :disabled="fingerprintLibraryLoading" @click="rebuildFingerprintLibrary">Rebuild from history</button>
          <button :disabled="fingerprintLibraryLoading || fingerprintLibrarySummary.missing === 0" @click="pruneFingerprintLibrary">Prune missing</button>
          <button class="danger-action" :disabled="fingerprintLibraryLoading || fingerprintLibrarySummary.indexed === 0" @click="clearFingerprintLibrary">Clear index</button>
        </div>
        <p class="fingerprint-library-message" role="status" aria-live="polite">{{ fingerprintLibraryMessage }}</p>
        <div v-if="filteredFingerprintLibrary.length" class="fingerprint-library-table">
          <div class="fingerprint-library-head">
            <span>Source</span><span>Acoustic identity</span><span>Last seen</span><span>Status</span>
          </div>
          <article v-for="entry in filteredFingerprintLibrary" :key="entry.filePath">
            <div><strong>{{ entry.fileName }}</strong><small :title="entry.filePath">{{ entry.filePath }}</small></div>
            <div>
              <code
                class="hash-value"
                :title="entry.fingerprintSha256 ?? undefined"
                :aria-label="entry.fingerprintSha256 ? `Full fingerprint SHA-256 ${entry.fingerprintSha256}` : 'Fingerprint hash unavailable'"
                :tabindex="entry.fingerprintSha256 ? 0 : undefined"
              >
                {{ entry.fingerprintSha256?.slice(0, 20) ?? "No hash" }}{{ entry.fingerprintSha256 ? "…" : "" }}
              </code>
              <small>{{ entry.durationSeconds === null ? "Duration unavailable" : `${entry.durationSeconds.toFixed(1)} seconds` }} · {{ entry.exactDuplicateCount }} exact peer{{ entry.exactDuplicateCount === 1 ? "" : "s" }}</small>
            </div>
            <time :datetime="entry.lastSeenAt">{{ new Date(entry.lastSeenAt).toLocaleString() }}</time>
            <b :class="entry.fileExists ? 'source-present' : 'source-missing'">{{ entry.fileExists ? "Present" : "Missing" }}</b>
          </article>
        </div>
        <div v-else class="module-empty">
          {{ fingerprintLibraryLoading ? "Loading historical fingerprints…" : fingerprintLibraryFilter ? "No indexed fingerprints match this search." : "No historical fingerprints are indexed yet. Complete a Full Oracle Audit or rebuild from saved sessions." }}
        </div>
      </section>

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
        <section v-if="compareA && compareB" class="channel-mapping-panel">
          <header>
            <div>
              <span class="eyebrow">Channel mapping</span>
              <strong>Choose exactly which decoded channels participate in the null test</strong>
            </div>
            <label>
              Mapping policy
              <select v-model="comparisonMappingMode">
                <option value="automatic">Automatic position match</option>
                <option value="explicit">Explicit channel map</option>
              </select>
            </label>
          </header>
          <p v-if="comparisonMappingMode === 'automatic'">
            Full-track null testing runs only when channel counts match. Differing layouts retain the bounded alignment preview so Audio-V never invents a channel relationship.
          </p>
          <template v-else>
            <div
              v-for="(mapping, index) in comparisonChannelMappings"
              :key="index"
              class="channel-mapping-row"
            >
              <label>File A channel
                <select v-model.number="mapping.leftChannel">
                  <option v-for="channel in compareA.channels ?? 0" :key="channel" :value="channel - 1">Channel {{ channel }}</option>
                </select>
              </label>
              <span aria-hidden="true">→</span>
              <label>File B channel
                <select v-model.number="mapping.rightChannel">
                  <option v-for="channel in compareB.channels ?? 0" :key="channel" :value="channel - 1">Channel {{ channel }}</option>
                </select>
              </label>
              <button aria-label="Remove channel mapping" :disabled="comparisonChannelMappings.length === 1" @click="removeComparisonChannelMapping(index)">Remove</button>
            </div>
            <button
              class="secondary-action"
              :disabled="comparisonChannelMappings.length >= Math.min(compareA.channels ?? 0, compareB.channels ?? 0)"
              @click="addComparisonChannelMapping"
            >
              Add channel pair
            </button>
            <p :class="{ 'mapping-error': comparisonMappingError }">{{ comparisonMappingError || "Each source channel can be used once. Reordering is explicit in the exported comparison evidence." }}</p>
          </template>
        </section>
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
            <article><span>Track coverage</span><strong>{{ signalComparison.fullTrack ? `${signalComparison.durationCoveragePercent.toFixed(2)}%` : "Preview only" }}</strong></article>
            <article><span>Channels / frames</span><strong>{{ signalComparison.comparedChannels }} / {{ signalComparison.comparedFrames.toLocaleString() }}</strong></article>
          </div>
          <dl v-if="signalComparison?.perChannel.length" class="comparison-table">
            <div v-for="channel in signalComparison.perChannel" :key="channel.channel">
              <dt>A {{ channel.leftChannel + 1 }} → B {{ channel.rightChannel + 1 }}</dt>
              <dd>{{ channel.nullDepthDb === null ? "No null depth" : channel.nullDepthDb === Infinity ? "Exact decoded null" : `${channel.nullDepthDb.toFixed(2)} dB null depth` }}</dd>
            </div>
          </dl>
          <p v-if="signalComparison">{{ signalComparison.limitation }}</p>
          <p v-else-if="signalComparisonError">{{ signalComparisonError }}</p>
        </section>
        <section v-if="compareA && compareB" class="comparison-visuals">
          <header>
            <div>
              <span class="eyebrow">Measured visual comparison</span>
              <h2>Synchronized waveform, spectrum, and residual</h2>
            </div>
            <p>Every mode shares one zoom and horizontal position. Visual compositing never changes the decoded null evidence or Oracle verdict.</p>
          </header>
          <div class="comparison-view-controls">
            <div role="group" aria-label="Comparison visual mode">
              <button v-for="mode in (['stacked', 'overlay', 'wipe', 'blink'] as const)" :key="mode" :class="{ active: comparisonVisualMode === mode }" @click="comparisonVisualMode = mode">
                {{ mode }}
              </button>
            </div>
            <label>Zoom
              <input v-model.number="comparisonZoom" type="range" min="1" max="20" step="1">
              <b>{{ comparisonZoom }}×</b>
            </label>
            <label>Position
              <input v-model.number="comparisonPan" type="range" min="0" max="1" step="0.01" :disabled="comparisonZoom === 1">
            </label>
            <label v-if="comparisonVisualMode === 'overlay'">File B opacity
              <input v-model.number="comparisonOpacity" type="range" min="0" max="1" step="0.01">
              <b>{{ Math.round(comparisonOpacity * 100) }}%</b>
            </label>
            <label v-if="comparisonVisualMode === 'wipe'">Wipe position
              <input v-model.number="comparisonWipe" type="range" min="0" max="1" step="0.01">
              <b>{{ Math.round(comparisonWipe * 100) }}%</b>
            </label>
            <span v-if="comparisonVisualMode === 'blink'" class="blink-state">Showing File {{ comparisonBlinkFrame.toUpperCase() }} · alternates every 650 ms</span>
          </div>
          <div v-if="comparisonVisualMode === 'stacked'" class="waveform-stack">
            <article>
              <span>File A · {{ compareA.name }}</span>
              <p v-if="comparisonVisualMessage('a')" class="comparison-visual-placeholder" role="status">{{ comparisonVisualMessage("a") }}</p>
              <svg v-else viewBox="0 0 1000 120" preserveAspectRatio="none" role="img" :aria-label="`Waveform envelope for ${compareA.name}`">
                <line x1="0" y1="60" x2="1000" y2="60" />
                <path :d="waveformPath(compareA)" />
              </svg>
            </article>
            <article>
              <span>File B · {{ compareB.name }}</span>
              <p v-if="comparisonVisualMessage('b')" class="comparison-visual-placeholder" role="status">{{ comparisonVisualMessage("b") }}</p>
              <svg v-else viewBox="0 0 1000 120" preserveAspectRatio="none" role="img" :aria-label="`Waveform envelope for ${compareB.name}`">
                <line x1="0" y1="60" x2="1000" y2="60" />
                <path :d="waveformPath(compareB)" />
              </svg>
            </article>
          </div>
          <article v-else class="comparison-waveform-composite">
            <span>{{ comparisonVisualMode }} waveform · A aqua / B violet</span>
            <p v-if="comparisonVisualMessage('a') || comparisonVisualMessage('b')" class="comparison-visual-placeholder" role="status">
              {{ comparisonVisualMessage("a") || comparisonVisualMessage("b") }}
            </p>
            <svg v-else viewBox="0 0 1000 120" preserveAspectRatio="none" role="img" :aria-label="`${comparisonVisualMode} waveform comparison`">
              <defs>
                <clipPath id="comparison-wipe-clip">
                  <rect :x="comparisonWipe * 1000" y="0" :width="(1 - comparisonWipe) * 1000" height="120" />
                </clipPath>
              </defs>
              <line x1="0" y1="60" x2="1000" y2="60" />
              <path v-show="comparisonVisualMode !== 'blink' || comparisonBlinkFrame === 'a'" class="waveform-a" :d="waveformPath(compareA)" />
              <path
                v-show="comparisonVisualMode !== 'blink' || comparisonBlinkFrame === 'b'"
                class="waveform-b"
                :clip-path="comparisonVisualMode === 'wipe' ? 'url(#comparison-wipe-clip)' : undefined"
                :opacity="comparisonVisualMode === 'overlay' ? comparisonOpacity : 1"
                :d="waveformPath(compareB)"
              />
              <line v-if="comparisonVisualMode === 'wipe'" class="wipe-marker" :x1="comparisonWipe * 1000" y1="0" :x2="comparisonWipe * 1000" y2="120" />
            </svg>
          </article>
          <div class="spectrum-compare-grid">
            <article v-show="comparisonVisualMode === 'stacked'">
              <span>File A spectrum</span>
              <p v-if="comparisonVisualMessage('a')" class="comparison-visual-placeholder" role="status">{{ comparisonVisualMessage("a") }}</p>
              <canvas v-else ref="compareSpectrogramA" role="img" aria-label="Measured spectrum for comparison file A">Measured spectrum for comparison file A.</canvas>
            </article>
            <article v-show="comparisonVisualMode === 'stacked'">
              <span>File B spectrum</span>
              <p v-if="comparisonVisualMessage('b')" class="comparison-visual-placeholder" role="status">{{ comparisonVisualMessage("b") }}</p>
              <canvas v-else ref="compareSpectrogramB" role="img" aria-label="Measured spectrum for comparison file B">Measured spectrum for comparison file B.</canvas>
            </article>
            <article v-show="comparisonVisualMode !== 'stacked'" class="comparison-composite-spectrum">
              <span>{{ comparisonVisualMode }} spectrum · File A / File B</span>
              <p v-if="comparisonVisualMessage('a') || comparisonVisualMessage('b')" class="comparison-visual-placeholder" role="status">
                {{ comparisonVisualMessage("a") || comparisonVisualMessage("b") }}
              </p>
              <canvas v-else ref="compareSpectrogramComposite" role="img" :aria-label="`${comparisonVisualMode} spectrogram comparison`">Composite measured spectrum.</canvas>
            </article>
            <article class="difference-spectrum">
              <span>Difference · B − A</span>
              <p v-if="comparisonVisualMessage('a') || comparisonVisualMessage('b')" class="comparison-visual-placeholder" role="status">
                Waiting for both source spectra.
              </p>
              <canvas v-else ref="compareSpectrogramDifference" role="img" aria-label="Normalized spectral difference between comparison files">Normalized spectral difference between comparison files.</canvas>
              <small><i></i>More energy in A <b></b>Matched <em></em>More energy in B</small>
            </article>
            <article class="residual-spectrum">
              <span>Aligned residual · B − adjusted A</span>
              <canvas ref="compareResidualSpectrogram" role="img" aria-label="Spectrogram of the aligned residual signal">Measured residual spectrum.</canvas>
              <small>{{ signalComparison?.residualVisual.limitation ?? "Residual visualization is generated after decoded alignment completes." }}</small>
            </article>
          </div>
          <article v-if="signalComparison" class="residual-waveform">
            <span>Residual waveform · {{ signalComparison.residualVisual.peakDbfs === null ? "silent" : `${signalComparison.residualVisual.peakDbfs.toFixed(2)} dBFS peak` }}</span>
            <svg viewBox="0 0 1000 120" preserveAspectRatio="none" role="img" aria-label="Aligned residual waveform">
              <line x1="0" y1="60" x2="1000" y2="60" />
              <path :d="residualWaveformPath()" />
            </svg>
            <small v-if="signalComparison.residualVisual.peakDbfs === null">The aligned preview subtracts to digital silence; a flat residual is the expected result.</small>
          </article>
          <section v-if="signalComparison" class="comparison-region-panel">
            <header>
              <div><span class="eyebrow">Selected-region evidence</span><strong>Measure a specific aligned passage</strong></div>
              <button :disabled="signalComparisonLoading || !comparisonRegionSelection" @click="measureComparisonRegion">Measure selected region</button>
            </header>
            <div class="comparison-region-controls">
              <label>Start
                <input v-model.number="comparisonRegionStart" type="range" min="0" :max="comparisonRegionMaximum" step="0.1">
                <b>{{ comparisonRegionStart.toFixed(1) }} s</b>
              </label>
              <label>End
                <input v-model.number="comparisonRegionEnd" type="range" min="0" :max="comparisonRegionMaximum" step="0.1">
                <b>{{ comparisonRegionEnd.toFixed(1) }} s</b>
              </label>
            </div>
            <dl>
              <div><dt>Measured passage</dt><dd>{{ signalComparison.region.startSeconds.toFixed(2) }}–{{ signalComparison.region.endSeconds.toFixed(2) }} s</dd></div>
              <div><dt>Correlation</dt><dd>{{ signalComparison.region.sampleCorrelation.toFixed(6) }}</dd></div>
              <div><dt>Residual</dt><dd>{{ signalComparison.region.residualRmsDb.toFixed(2) }} dB</dd></div>
              <div><dt>Residual peak</dt><dd>{{ signalComparison.region.peakResidualDbfs === null ? "Silent" : `${signalComparison.region.peakResidualDbfs.toFixed(2)} dBFS` }}</dd></div>
            </dl>
            <small>{{ signalComparison.region.limitation }}</small>
          </section>
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
              <span class="row-verdict" :class="fileStateClass(file)"><i></i>{{ shortVerdict(file) }}<em v-if="isAcknowledged(file)">{{ reviewDispositionLabel(file) }} · verdict unchanged</em></span>
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
                v-else
                class="acknowledge-action"
                @click="openEvidence(file)"
              >
                {{ isAcknowledged(file) ? "Update review outcome" : "Record review outcome" }}
              </button>
              <span class="preservation-badge">Original remains untouched</span>
            </aside>
          </article>
        </div>
        <div v-else class="module-empty">{{ files.length ? "No current files require attention or remediation." : "Load and audit files before opening the remediation center." }}</div>
      </section>

      <section v-else-if="activeWorkspace === 'reports'" class="module-page reports-page">
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
          <article><span>Not analyzed</span><strong>{{ counts.notAnalyzed }}</strong></article>
          <article><span>Analysis errors</span><strong>{{ counts.analysisErrors }}</strong></article>
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
              <b :class="fileStateClass(file)">{{ shortVerdict(file) }}</b>
              <small>{{ file.oracle.headline }} · {{ file.oracle.scope }}</small>
            </button>
          </div>
          <article
            v-if="reportSelected"
            ref="reportDetail"
            class="report-detail"
            aria-live="polite"
          >
            <header>
              <div>
                <span class="eyebrow">Per-file evidence report</span>
                <h2>{{ reportSelected.name }}</h2>
                <p>{{ reportSelected.path }}</p>
              </div>
              <span class="report-verdict" :class="fileStateClass(reportSelected)">{{ shortVerdict(reportSelected) }}</span>
            </header>
            <section class="report-interpretation">
              <strong>{{ reportSelected.oracle.headline }}</strong>
              <p>{{ reportSelected.oracle.interpretation }}</p>
            </section>
            <section
              v-if="reportSelected.oracle.failure"
              class="failure-explanation report-failure"
              :class="reportSelected.oracle.failure.category"
            >
              <header>
                <span class="eyebrow">
                  {{
                    reportSelected.oracle.failure.category === "file-integrity"
                      ? "Deterministic file-integrity failure"
                      : "Analysis processing error"
                  }}
                </span>
                <strong>{{ failureStageLabel(reportSelected) }}</strong>
                <b>{{ reportSelected.oracle.failure.code }}</b>
              </header>
              <p>{{ reportSelected.oracle.failure.summary }}</p>
              <div><span>Exact evidence</span><code>{{ reportSelected.oracle.failure.evidence }}</code></div>
            </section>
            <div class="report-detail-grid">
              <section>
                <span class="eyebrow">Identity &amp; engine</span>
                <dl>
                  <div><dt>Analyzed</dt><dd>{{ reportSelected.oracle.measuredAt ? new Date(reportSelected.oracle.measuredAt).toLocaleString() : "Not measured" }}</dd></div>
                  <div><dt>Engine</dt><dd>{{ reportSelected.oracle.engineVersion }}</dd></div>
                  <div>
                    <dt>SHA-256</dt>
                    <dd
                      class="hash-value"
                      :title="reportSelected.oracle.technical?.fileSha256"
                      :aria-label="reportSelected.oracle.technical?.fileSha256 ? `Full SHA-256 ${reportSelected.oracle.technical.fileSha256}` : 'SHA-256 unavailable'"
                      :tabindex="reportSelected.oracle.technical?.fileSha256 ? 0 : undefined"
                    >
                      {{ reportSelected.oracle.technical?.fileSha256 ?? "Unavailable" }}
                    </dd>
                  </div>
                  <div><dt>Format</dt><dd>{{ audioFormatLabel(reportSelected) }}</dd></div>
                </dl>
              </section>
              <section>
                <span class="eyebrow">Decoded signal</span>
                <dl>
                  <div><dt>Decode</dt><dd>{{ decodeStatusLabel(reportSelected) }}</dd></div>
                  <div><dt>Integrated</dt><dd>{{ comparisonValue(reportSelected, "loudness") }}</dd></div>
                  <div><dt>True peak</dt><dd>{{ comparisonValue(reportSelected, "truePeak") }}</dd></div>
                  <div><dt>Clipped samples</dt><dd>{{ comparisonValue(reportSelected, "clipping") }}</dd></div>
                  <div><dt>Bandwidth</dt><dd>{{ comparisonValue(reportSelected, "bandwidth") }}</dd></div>
                  <div v-if="reportSelected.oracle.technical?.repairProvenance"><dt>Working copy</dt><dd>−{{ reportSelected.oracle.technical.repairProvenance.gainReductionDb.toFixed(2) }} dB · {{ reportSelected.oracle.technical.repairProvenance.outputBitDepth }}-bit</dd></div>
                </dl>
              </section>
            </div>
            <section
              v-if="reportSelected.oracle.assessments"
              class="report-origin"
            >
              <span class="eyebrow">Oracle v12 evidence lanes</span>
              <dl>
                <div><dt>File integrity</dt><dd>{{ assessmentStatusLabel(reportSelected, "integrity") }}</dd></div>
                <div><dt>Signal defects</dt><dd>{{ assessmentStatusLabel(reportSelected, "signal") }}</dd></div>
                <div><dt>Spectral origin</dt><dd>{{ assessmentStatusLabel(reportSelected, "origin") }}</dd></div>
                <div><dt>Provenance</dt><dd>{{ assessmentStatusLabel(reportSelected, "provenance") }}</dd></div>
                <div><dt>Delivery compliance</dt><dd>{{ assessmentStatusLabel(reportSelected, "delivery") }}</dd></div>
              </dl>
              <ul v-if="reportSelected.oracle.assessments.findings.length">
                <li
                  v-for="finding in reportSelected.oracle.assessments.findings"
                  :key="finding.id"
                >
                  {{ finding.severity }} · {{ finding.lane }} · {{ finding.summary }}
                </li>
              </ul>
            </section>
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
          <article><span>Decode integrity</span><strong>Strict plus confirmation decode</strong><p>Every selected stream is decoded from beginning to end. A strict decoder error is confirmed with a tolerant full pass before Audio-V can issue a deterministic Failed verdict.</p></article>
          <article><span>Oracle v12 policy</span><strong>Five independent evidence lanes</strong><p>File integrity, signal defects, spectral origin, provenance, and delivery guidance remain separate. Advisory inventory never masquerades as file damage.</p></article>
          <article><span>Metadata workflow</span><strong>Explicit inventory mode</strong><p>Catalog declared format, codec, duration, bitrate, sample rate, bit depth, and channels without decoding. Files remain Not analyzed until a Full Oracle Audit runs.</p></article>
          <article><span>Signal analysis</span><strong>Measured PCM and spectrum</strong><p>Peak, RMS, clipping, DC offset, channel relationship, and a real STFT spectrogram come from decoded samples.</p></article>
          <article><span>Broadcast loudness</span><strong>EBU R128 / BS.1770</strong><p>Integrated LUFS, loudness range, and oversampled true peak are measured by the bundled engine.</p></article>
          <article class="resource-controls delivery-profile-card">
            <span>Delivery conformance</span>
            <strong>Optional standards profile</strong>
            <p>Selecting a profile makes loudness and true-peak limits part of the next audit. Outside-target audio becomes Review—not Failed—and the chosen standard, readings, limits, and qualification are preserved in evidence and reports.</p>
            <label>Profile for future audits
              <select v-model="deliveryProfileId" :disabled="isDiscovering">
                <option value="none">None · measure only</option>
                <option value="ebu-r128-programme">EBU R 128 programme QC</option>
                <option value="atsc-a85">ATSC A/85 delivery</option>
                <option value="aes-streaming-track">AES internet music · track</option>
              </select>
            </label>
            <dl v-if="selectedDeliveryProfile" class="delivery-profile-targets">
              <div><dt>Target</dt><dd>{{ selectedDeliveryProfile.targetLoudnessLufs.toFixed(1) }} LUFS</dd></div>
              <div><dt>Accepted loudness</dt><dd>{{ selectedDeliveryProfile.minimumLoudnessLufs.toFixed(1) }} to {{ selectedDeliveryProfile.maximumLoudnessLufs.toFixed(1) }} LUFS</dd></div>
              <div><dt>Maximum true peak</dt><dd>{{ selectedDeliveryProfile.maximumTruePeakDbtp.toFixed(1) }} dBTP</dd></div>
              <div><dt>Reference</dt><dd><a :href="selectedDeliveryProfile.referenceUrl">{{ selectedDeliveryProfile.reference }}</a></dd></div>
            </dl>
            <small class="resource-budget-note">{{ selectedDeliveryProfile?.qualification ?? "No delivery target will affect the verdict. LUFS and dBTP remain measured evidence only." }}</small>
          </article>
          <article><span>Codec integrity</span><strong>FLAC audio MD5</strong><p>The decoded PCM is independently compared with the checksum stored in STREAMINFO; mismatch is a deterministic failure.</p></article>
          <article><span>Spectral origin</span><strong>4,096-point multi-region classifier</strong><p>Strong Review requires a repeatable band edge and corroborating evidence. Ordinal rule strength, evidence coverage, regional stability, and limitations remain distinct.</p></article>
          <article><span>Content provenance</span><strong>Offline C2PA verification</strong><p>Content Credentials are cryptographically inspected with remote manifest and OCSP fetching disabled. Valid credentials record claims; they do not certify truth or human authorship.</p></article>
          <article><span>Acoustic identity</span><strong>Chromaprint duplicates</strong><p>Local fingerprints identify same-recording and high-similarity candidates. Optional AcoustID lookup runs only after explicit opt-in; saved keys are protected by the operating system and never enter audit evidence.</p></article>
          <article><span>Metadata depth</span><strong>Tags, cue, ReplayGain</strong><p>Audio-V inventories identity tags, explains ReplayGain 2.0 album eligibility, and independently decodes cue INDEX 01 programme plus INDEX 00 pregap regions without becoming a tag editor.</p></article>
          <article class="resource-controls analysis-resource-card">
            <span>Analysis resources</span>
            <strong>Bounded worker controls</strong>
            <p>Changes apply to the next audit. These are per-file ceilings, not speed levels; Audio-V enforces an additional system-wide memory and CPU budget before creating workers.</p>
            <div class="resource-presets" aria-label="Analysis resource presets">
              <button :disabled="isDiscovering" @click="applyResourcePreset('recovery-safe')">Recovery safe</button>
              <button :disabled="isDiscovering" @click="applyResourcePreset('balanced')">Balanced</button>
              <button :disabled="isDiscovering" @click="applyResourcePreset('performance')">Performance</button>
            </div>
            <label>Concurrent files
              <select v-model.number="analysisConcurrency" :disabled="isDiscovering">
                <option :value="1">1</option><option :value="2">2</option><option :value="3">3</option><option :value="4">4</option>
                <option :value="5">5</option><option :value="6">6</option><option :value="7">7</option><option :value="8">8</option>
              </select>
            </label>
            <label>Memory per worker
              <select v-model.number="analysisWorkerMemoryMb" :disabled="isDiscovering">
                <option :value="128">128 MB</option><option :value="256">256 MB</option><option :value="384">384 MB</option><option :value="512">512 MB</option>
              </select>
            </label>
            <label>FFmpeg threads per file
              <select v-model.number="analysisFfmpegThreads" :disabled="isDiscovering">
                <option :value="1">1</option><option :value="2">2</option><option :value="4">4</option>
              </select>
            </label>
            <label>Native process memory
              <select v-model.number="analysisNativeMemoryMb" :disabled="isDiscovering">
                <option :value="256">256 MB</option><option :value="512">512 MB</option><option :value="1024">1 GB</option><option :value="2048">2 GB</option>
              </select>
            </label>
            <small
              class="resource-budget-note"
              :class="{ warning: requestedAggregateMemoryMb > 4096 || requestedAggregateThreads > 8 }"
            >
              {{ resourceControlWarning }}
            </small>
            <small v-if="effectiveResourceLimits" class="resource-budget-note effective">
              Effective audit limits: {{ effectiveResourceLimits.concurrency }} concurrent file{{ effectiveResourceLimits.concurrency === 1 ? "" : "s" }},
              {{ effectiveResourceLimits.workerMemoryMb }} MB worker heap,
              {{ effectiveResourceLimits.ffmpegThreads }} FFmpeg thread{{ effectiveResourceLimits.ffmpegThreads === 1 ? "" : "s" }} per file,
              and {{ effectiveResourceLimits.nativeProcessMemoryMb }} MB native memory.
            </small>
            <small v-if="recoveryStatus" class="resource-budget-note recovery">
              {{ recoveryStatus }}
            </small>
          </article>
          <article>
            <span>Mounted-source I/O</span>
            <strong>Single-transfer local staging</strong>
            <p>On macOS /Volumes sources and Windows UNC, mapped, or non-system drives, Audio-V uses up to four bounded 4 MB sequential transfer streams. Each active file is copied once to protected temporary storage, repeatedly decoded locally, then removed. Eight-way directory discovery reduces share latency without changing Oracle evidence.</p>
          </article>
          <article class="resource-controls external-service-card">
            <span>External identity services · recognition</span>
            <strong>AcoustID acoustic matching</strong>
            <p>AcoustID compares the local Chromaprint to its recognition database and returns candidate recording IDs. A personal application key is validated, encrypted with macOS Keychain or Windows credential protection, and stored only in this user profile. It is never placed in audit evidence.</p>
            <label><input v-model="acoustIdEnabled" type="checkbox" :disabled="isDiscovering || identityPreferencesSaving" @change="saveExternalIdentityPreferences()"> Recognize files with AcoustID on future audits</label>
            <label>AcoustID API key · optional override
              <input v-model="acoustIdApiKey" type="password" autocomplete="off" :disabled="isDiscovering || !acoustIdEnabled || identityPreferencesSaving" @input="acoustIdValidationState = 'idle'; acoustIdValidationMessage = 'Save to validate and protect this application key.'" @change="saveExternalIdentityPreferences()">
            </label>
            <div class="external-service-actions">
              <button :disabled="isDiscovering || identityPreferencesSaving" @click="saveExternalIdentityPreferences()">{{ identityPreferencesSaving ? "Saving…" : "Save identity settings" }}</button>
              <button class="secondary-action" :disabled="isDiscovering || identityPreferencesSaving || !acoustIdApiKey" @click="saveExternalIdentityPreferences(true)">Clear stored key</button>
            </div>
            <small
              class="credential-validation"
              :class="acoustIdValidationState"
              role="status"
              aria-live="polite"
            >{{ acoustIdValidationMessage }}</small>
            <small class="credential-validation idle">
              {{ externalIdentityStatus?.explanation ?? "Checking whether this build includes an official Audio-V client identity…" }}
            </small>
            <small class="credential-validation idle" role="status" aria-live="polite">{{ identityPreferencesMessage }}</small>
          </article>
          <article class="resource-controls external-service-card">
            <span>External identity services · enrichment</span>
            <strong>MusicBrainz recording details</strong>
            <p>MusicBrainz adds credited artists, ISRCs, first-release dates, and release-group context to an embedded MusicBrainz recording ID or the strongest AcoustID candidate. It needs no API key, obeys the public one-request-per-second limit, caches repeated IDs, and never changes the Oracle quality verdict.</p>
            <label><input v-model="musicBrainzEnabled" type="checkbox" :disabled="isDiscovering || identityPreferencesSaving" @change="saveExternalIdentityPreferences()"> Enrich identified recordings on future audits</label>
            <small class="credential-validation idle">
              Opt-in network lookup · one bounded recording request per unique file identity. Very large libraries can take substantially longer.
            </small>
            <small class="credential-validation idle">{{ identityPreferencesMessage }}</small>
          </article>
          <article class="validation-disclosure">
            <span>Oracle validation basis</span>
            <strong>{{ validationStatusLabel }}</strong>
            <div class="validation-progress" role="progressbar" aria-label="Public independent licensed external references acquired" :aria-valuenow="validationStatus?.counts.publicIndependentReferences ?? validationStatus?.counts.publicIndependentMasters ?? 0" aria-valuemin="0" :aria-valuemax="validationStatus?.thresholds.targetIndependentMasters ?? 50">
              <i :style="{ width: `${validationProgress}%` }"></i>
            </div>
            <dl>
              <div><dt>Public references</dt><dd>{{ validationStatus?.counts.publicIndependentReferences ?? validationStatus?.counts.publicIndependentMasters ?? 0 }} / {{ validationStatus?.thresholds.targetIndependentMasters ?? 50 }}</dd></div>
              <div><dt>Source groups</dt><dd>{{ validationStatus?.counts.sourceGroups ?? validationStatus?.counts.contributorGroups ?? 0 }}</dd></div>
              <div><dt>Controlled cases</dt><dd>{{ validationStatus?.counts.generatedCases ?? 0 }}</dd></div>
              <div><dt>Scientific state</dt><dd>{{ validationClaimLabel(validationStatus?.claimLevel) }}</dd></div>
            </dl>
            <p>{{ validationClaimDetail(validationStatus) }}</p>
            <small>Corpus {{ validationStatus?.corpusVersion ?? "—" }} · Synthetic fixtures and derivatives never increase the independent-reference count.</small>
          </article>
          <article><span>Open-source license</span><strong>AGPL-3.0-only</strong><p>Code remains available under strong copyleft. Audio-V and Oracle Engine names and artwork remain governed by the trademark policy.</p></article>
          <article class="storage-maintenance">
            <div class="storage-maintenance-copy">
              <span>Saved audit storage</span>
              <strong>Local evidence database</strong>
              <p>{{ auditStorageMessage }}</p>
              <small v-if="auditStorageStatus">
                {{ auditStorageStatus.autoVacuum === "incremental" ? "Bounded automatic reclamation is enabled for future history cleanup." : "This legacy database needs one full optimization before bounded reclamation can begin." }}
              </small>
            </div>
            <div class="storage-maintenance-console">
              <div class="storage-metrics">
                <div>
                  <span>Live evidence</span>
                  <strong>{{ auditStorageStatus ? formatBytes(auditStorageStatus.liveBytes) : "—" }}</strong>
                </div>
                <div>
                  <span>Reclaimable</span>
                  <strong :class="{ available: auditStorageStatus?.optimizationRecommended }">
                    {{ auditStorageStatus ? formatBytes(auditStorageStatus.reclaimableBytes) : "—" }}
                  </strong>
                </div>
              </div>
              <div
                class="storage-capacity"
                role="progressbar"
                aria-label="Live evidence as a percentage of saved audit database storage"
                :aria-valuenow="Math.round(auditStorageLivePercent)"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <i :style="{ width: `${auditStorageLivePercent}%` }"></i>
              </div>
              <div class="storage-maintenance-action">
                <small v-if="auditStorageStatus">
                  {{ formatBytes(auditStorageStatus.databaseBytes) }} total on disk
                </small>
                <button
                  class="secondary-action"
                  :disabled="isDiscovering || auditStorageOptimizing || !auditStorageStatus?.optimizationRecommended"
                  @click="optimizeAuditStorage"
                >
                  {{ auditStorageOptimizing ? "Optimizing…" : auditStorageStatus?.optimizationRecommended ? "Reclaim unused storage" : "Storage optimized" }}
                </button>
              </div>
            </div>
          </article>
          <article class="acceptance-evidence-card">
            <span>Acceptance and soak evidence</span>
            <strong>{{ latestAcceptanceRun ? `${latestAcceptanceRun.status} · Audio-V ${latestAcceptanceRun.application.version}` : "Awaiting the first recorded audit" }}</strong>
            <p>{{ acceptanceRunMessage }}</p>
            <dl v-if="latestAcceptanceRun">
              <div><dt>Platform</dt><dd>{{ latestAcceptanceRun.application.platform }} · {{ latestAcceptanceRun.application.architecture }} · {{ latestAcceptanceRun.application.packaged ? "packaged" : "source" }}</dd></div>
              <div><dt>Workload</dt><dd>{{ latestAcceptanceRun.workload.completedCount.toLocaleString() }} / {{ latestAcceptanceRun.workload.discoveredCount.toLocaleString() }} files · {{ formatBytes(latestAcceptanceRun.workload.completedBytes) }}</dd></div>
              <div><dt>Elapsed</dt><dd>{{ formatDuration(latestAcceptanceRun.timing.elapsedMilliseconds / 1000) }} · {{ latestAcceptanceRun.timing.filesPerMinute.toFixed(1) }} files/min</dd></div>
              <div><dt>Peak sampled working set</dt><dd>{{ formatBytes(latestAcceptanceRun.resources.peakTotalWorkingSetBytes) }} across {{ latestAcceptanceRun.resources.sampleCount.toLocaleString() }} samples</dd></div>
              <div><dt>Database growth</dt><dd>{{ latestAcceptanceRun.storage.databaseGrowthBytes === null ? "Unavailable" : formatBytes(Math.max(0, latestAcceptanceRun.storage.databaseGrowthBytes)) }}</dd></div>
              <div><dt>Cancellation response</dt><dd>{{ latestAcceptanceRun.timing.cancellationLatencyMilliseconds === null ? "Not requested" : `${latestAcceptanceRun.timing.cancellationLatencyMilliseconds.toLocaleString()} ms` }}</dd></div>
              <div><dt>Source</dt><dd>{{ latestAcceptanceRun.source.storageKind }} · {{ latestAcceptanceRun.source.mode }}</dd></div>
              <div><dt>Recovery</dt><dd>{{ latestAcceptanceRun.recovery.strategy ?? "Not a recovery run" }}{{ latestAcceptanceRun.recovery.quarantinedCandidateCount ? ` · ${latestAcceptanceRun.recovery.quarantinedCandidateCount} quarantined` : "" }}</dd></div>
            </dl>
            <button class="secondary-action" :disabled="!latestAcceptanceRun" @click="exportAcceptanceRun">Export acceptance evidence</button>
            <small>No filenames, paths, hashes, tags, audio evidence, or service credentials are included.</small>
          </article>
          <article><span>Support diagnostics</span><strong>Privacy-safe export and local application logs</strong><p>{{ diagnosticsMessage }}</p><div class="resource-presets"><button class="secondary-action" @click="exportDiagnostics">Export diagnostics</button><button class="secondary-action" @click="openApplicationLogs">Open log folder</button></div></article>
          <article><span>Keyboard workflow</span><strong>Fast navigation</strong><p>Use {{ primaryModifier }}+O for files, {{ primaryModifier }}+Shift+O for a folder, and {{ primaryModifier }}+1–6 for workspaces.</p></article>
        </div>
      </section>

      <footer class="statusbar">
        <span
          role="status"
          aria-live="polite"
          :title="sourceIoNotice || scanMessage"
        ><i></i>{{ scanMessage }}</span>
        <span>{{ files.length.toLocaleString() }} files in session</span>
        <span>Oracle evidence lanes &amp; forensics scope v12</span>
      </footer>
    </main>
  </div>
</template>
