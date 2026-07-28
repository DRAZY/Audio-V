export const AUDIO_EXTENSIONS = [
  ".3g2",
  ".3gp",
  ".ac3",
  ".aac",
  ".aif",
  ".aiff",
  ".alac",
  ".amr",
  ".ape",
  ".au",
  ".caf",
  ".dsf",
  ".eac3",
  ".ec3",
  ".flac",
  ".m4b",
  ".m4a",
  ".mka",
  ".mkv",
  ".mp2",
  ".mp3",
  ".mp4",
  ".mpa",
  ".mpc",
  ".oga",
  ".ogg",
  ".opus",
  ".ra",
  ".ram",
  ".snd",
  ".spx",
  ".tak",
  ".tta",
  ".voc",
  ".wav",
  ".weba",
  ".webm",
  ".wma",
  ".wv"
] as const;

export type OracleVerdict =
  | "verified"
  | "authentic"
  | "review"
  | "likely-transcode"
  | "likely-upsample"
  | "damaged"
  | "inconclusive";

export type AnalysisMode = "full-audit" | "metadata-inventory";
export type OracleAnalysisState =
  | "not-analyzed"
  | "completed"
  | "failed"
  | "error";
export type OracleFailureStage =
  | "metadata-probe"
  | "stream-probe"
  | "full-decode"
  | "signal-measurement"
  | "integrity-verification"
  | "oracle-engine";

export interface OracleFailure {
  category: "file-integrity" | "analysis-error";
  stage: OracleFailureStage;
  code: string;
  summary: string;
  evidence: string;
}

export type EvidenceKind = "deterministic" | "measured" | "heuristic";

export interface OracleEvidence {
  id: string;
  label: string;
  summary: string;
  kind: EvidenceKind;
  disposition: "supports" | "contradicts" | "neutral";
}

export interface ChannelMeasurements {
  samplePeakDbfs: number | null;
  rmsDbfs: number | null;
  dcOffset: number;
  clippedSamples: number;
  clippedSamplePercent: number;
  nearClippedSamples: number;
  scaledClippingCandidateSamples: number;
}

export interface ClippingEvent {
  startSeconds: number;
  endSeconds: number;
  clippedSamples: number;
  peakAmplitude: number;
  channels: number[];
}

export interface ClippingDiagnostics {
  clippedSamplePercent: number;
  eventCount: number;
  events: ClippingEvent[];
  eventsTruncated: boolean;
  scaledClippingIndicator:
    | "not-detected"
    | "possible-scaled-clipping";
  scaledClippingCandidateSamples: number;
  limitation: string;
}

export interface SpectrogramSlice {
  timeSeconds: number;
  levelsDbfs: number[];
}

export interface SpectrogramMeasurements {
  algorithm: "STFT";
  channelMode:
    | "per-channel power average"
    | "left channel"
    | "right channel"
    | "left-right difference";
  fftSize: number;
  hopSize: number;
  window: "Hann";
  frequencyScale: "linear";
  floorDbfs: -120;
  maxFrequencyHz: number;
  effectiveBandwidthHz: number | null;
  strongestCutoffHz: number | null;
  cutoffDropDb: number | null;
  upperBandLevelDbfs: number | null;
  durationSeconds: number;
  slices: SpectrogramSlice[];
}

export interface WaveformPoint {
  timeSeconds: number;
  minimum: number;
  maximum: number;
  rms: number;
}

export interface WaveformMeasurements {
  mix: "per-channel envelope";
  pointCount: number;
  points: WaveformPoint[];
}

export interface FlacMd5Integrity {
  storedMd5: string;
  calculatedMd5: string | null;
  status: "verified" | "mismatch" | "not-stored" | "unsupported-depth";
}

export type ChecksumAlgorithm = "md5" | "sha1" | "sha256" | "sha512";

export interface ExternalChecksumVerification {
  algorithm: ChecksumAlgorithm;
  expected: string;
  calculated: string;
  manifestPath: string;
  status: "verified" | "mismatch";
}

export interface SignalContinuityMeasurements {
  exactDigitalSilenceFrames: number;
  longestDigitalSilenceSeconds: number;
  internalDigitalDropoutCount: number;
  discontinuityCandidateCount: number;
}

export interface SignalDefectEvent {
  startSeconds: number;
  endSeconds: number;
  channel: number;
  amplitude: number;
  kind: "click-pop-candidate" | "stuck-sample-candidate";
}

export interface SignalDefectDiagnostics {
  clickPopCandidateCount: number;
  stuckSampleCandidateCount: number;
  steepTransitionCandidateCount: number;
  events: SignalDefectEvent[];
  eventsTruncated: boolean;
  limitation: string;
}

export interface ComputedReplayGain {
  standard: "ReplayGain 2.0 / ITU-R BS.1770";
  referenceLufs: -18;
  trackGainDb: number | null;
  trackPeak: number | null;
  albumGainDb: number | null;
  albumPeak: number | null;
  albumGroup: string | null;
  albumTrackCount: number;
  albumStatus: "calculated" | "unavailable";
  albumReason: string;
  limitation: string;
}

export interface BitUtilizationAssessment {
  applicable: boolean;
  declaredBitDepth: number | null;
  effectiveBitDepth: number | null;
  unusedLeastSignificantBits: number | null;
  classification:
    | "fully-utilized"
    | "possible-bit-padding"
    | "insufficient-signal"
    | "not-applicable";
  limitation: string;
}

export interface SignalMeasurements {
  standard: "Audio-V PCM measurement v1" | "Audio-V signal measurement v2";
  decoder: string | null;
  decodeIntegrity: "complete";
  sampleRate: number;
  channels: number;
  frames: number;
  durationSeconds: number;
  samplePeakDbfs: number | null;
  rmsDbfs: number | null;
  clippedSamples: number;
  nearClippedSamples: number;
  clipping: ClippingDiagnostics;
  stereoCorrelation: number | null;
  duplicatedMono: boolean | null;
  stereoAssessment:
    | "mono"
    | "dual-mono"
    | "near-mono"
    | "stereo-content"
    | "inconclusive";
  sideToMidRatioDb: number | null;
  perChannel: ChannelMeasurements[];
  integratedLufs: number | null;
  loudnessRangeLu: number | null;
  truePeakDbtp: number | null;
  peakToLoudnessRatioLu: number | null;
  crestFactorDb: number | null;
  drMeter: number | null;
  drMeterPerChannel: Array<number | null>;
  replayGain: ComputedReplayGain;
  bitUtilization: BitUtilizationAssessment;
  continuity: SignalContinuityMeasurements;
  defects: SignalDefectDiagnostics;
  waveform: WaveformMeasurements | null;
  spectrogram: SpectrogramMeasurements;
  spectrogramPyramid?: SpectrogramMeasurements[];
}

export interface ContentCredentialsAssessment {
  status:
    | "not-present"
    | "valid"
    | "valid-untrusted-signer"
    | "invalid"
    | "unsupported"
    | "tool-error";
  manifestCount: number;
  activeManifest: string | null;
  claimGenerator: string | null;
  signer: string | null;
  signedAt: string | null;
  digitalSourceTypes: string[];
  validationErrors: string[];
  networkAccess: "disabled";
  limitation: string;
}

export interface ProvenanceIndicator {
  type: "generator-metadata" | "watermark-signature" | "content-credential";
  identifier: string;
  source: string;
  value: string;
  interpretation: string;
}

export interface AcoustIdLookup {
  status: "not-requested" | "matched" | "no-match" | "service-error";
  acoustId: string | null;
  score: number | null;
  recordingIds: string[];
  recordingTitles: string[];
  error: string | null;
}

export interface ChromaprintAssessment {
  status: "measured" | "unavailable" | "error";
  algorithm: "Chromaprint 1.6.0";
  durationSeconds: number | null;
  fingerprint: string | null;
  rawFingerprint: number[];
  fingerprintSha256: string | null;
  matches: Array<{
    filePath: string;
    fileName: string;
    similarity: number;
    relationship: "same-fingerprint" | "high-similarity";
    source?: "current-audit" | "history-index";
    lastSeenAt?: string;
  }>;
  acoustIdLookup: AcoustIdLookup;
  limitation: string;
}

export interface FingerprintIndexCandidate {
  filePath: string;
  fileName: string;
  fingerprintSha256: string | null;
  rawFingerprint: number[];
  durationSeconds: number | null;
  lastSeenAt: string;
}

export interface FingerprintLibraryEntry {
  filePath: string;
  fileName: string;
  fingerprintSha256: string | null;
  durationSeconds: number | null;
  engineVersion: string;
  lastSeenAt: string;
  fileExists: boolean;
  exactDuplicateCount: number;
}

export interface FingerprintLibraryMutationResult {
  affected: number;
  remaining: number;
}

export interface MetadataInventory {
  title: string | null;
  artists: string[];
  album: string | null;
  albumArtists: string[];
  composers: string[];
  genres: string[];
  date: string | null;
  year: number | null;
  trackNumber: number | null;
  trackTotal: number | null;
  discNumber: number | null;
  discTotal: number | null;
  bpm: number | null;
  isrcs: string[];
  musicBrainzRecordingIds: string[];
  acoustId: string | null;
  replayGain: {
    trackGainDb: number | null;
    trackPeak: number | null;
    albumGainDb: number | null;
    albumPeak: number | null;
  };
  cueSheet: {
    embedded: boolean;
    sidecarPaths: string[];
    trackCount: number;
    tracks: CueTrackDefinition[];
  };
  tags: Array<{ key: string; value: string }>;
}

export interface CueTrackDefinition {
  trackNumber: number;
  title: string | null;
  performer: string | null;
  sourcePath: string;
  index00Seconds: number | null;
  index01Seconds: number;
  endSeconds: number | null;
}

export interface CuePregapAnalysis {
  startSeconds: number;
  durationSeconds: number;
  analysisState: "completed" | "error";
  verdict: "clear" | "review" | "error";
  samplePeakDbfs: number | null;
  integratedLufs: number | null;
  truePeakDbtp: number | null;
  clippedSamples: number | null;
  clickPopCandidates: number | null;
  stuckSampleCandidates: number | null;
  failure: string | null;
}

export interface CueTrackAnalysis extends CueTrackDefinition {
  durationSeconds: number;
  analysisState: "completed" | "error";
  verdict: "clear" | "review" | "error";
  samplePeakDbfs: number | null;
  integratedLufs: number | null;
  truePeakDbtp: number | null;
  replayGainTrackDb: number | null;
  clippedSamples: number | null;
  clickPopCandidates: number | null;
  stuckSampleCandidates: number | null;
  pregap: CuePregapAnalysis | null;
  failure: string | null;
  limitation: string;
}

export interface StreamTechnicalAnalysis {
  backend: string;
  fileSha256: string;
  codecName: string;
  codecLongName: string;
  profile: string | null;
  container: string;
  sampleFormat: string;
  sampleRate: number;
  channels: number;
  channelLayout: string | null;
  bitsPerRawSample: number | null;
  streamBitrate: number | null;
  durationSeconds: number | null;
  bitrateMode: "CBR" | "VBR" | null;
  packetCount: number;
  packetBitrateMinimum: number | null;
  packetBitrateMaximum: number | null;
  packetBitrateAverage: number | null;
  packetBitrateP05: number | null;
  packetBitrateP95: number | null;
  packetBitrateStdDev: number | null;
  packetDurationCoverage: number | null;
  flacMd5: FlacMd5Integrity | null;
  externalChecksums: ExternalChecksumVerification[];
  metadata: MetadataInventory;
  contentCredentials: ContentCredentialsAssessment;
  provenanceIndicators: ProvenanceIndicator[];
  fingerprint: ChromaprintAssessment;
  repairProvenance: {
    action: "true_peak_safe_copy";
    targetDbtp: number;
    gainReductionDb: number;
    outputBitDepth: 16 | 24;
  } | null;
}

export interface FidelityAssessment {
  classification:
    | "no-strong-spectral-anomaly"
    | "bandwidth-limited"
    | "possible-lossy-transcode"
    | "possible-upsample"
    | "inconclusive";
  reasonCode:
    | "insufficient-duration"
    | "unmeasurable-bandwidth"
    | "unstable-cutoff"
    | "no-strong-anomaly"
    | "bandwidth-limited"
    | "possible-lossy-transcode"
    | "possible-upsample";
  confidence: number | null;
  confidenceType: "rule-strength-v1" | null;
  evidenceCoverage: number;
  basis: string[];
  limitation: string;
}

export interface OracleResult {
  schemaVersion: 1;
  engineVersion: string;
  scope:
    | "metadata-only"
    | "pcm-integrity-signal-v1"
    | "ffmpeg-decode-signal-loudness-v2"
    | "oracle-integrity-fidelity-v3"
    | "oracle-integrity-fidelity-v4"
    | "oracle-integrity-fidelity-v5"
    | "oracle-integrity-fidelity-v6"
    | "oracle-integrity-fidelity-v7"
    | "oracle-integrity-provenance-v8"
    | "oracle-integrity-forensics-v9"
    | "oracle-integrity-forensics-v10";
  verdict: OracleVerdict;
  analysisState?: OracleAnalysisState;
  failure?: OracleFailure | null;
  confidence: number | null;
  headline: string;
  interpretation: string;
  evidence: OracleEvidence[];
  measurements: SignalMeasurements | null;
  technical: StreamTechnicalAnalysis | null;
  fidelity: FidelityAssessment | null;
  cueTracks?: CueTrackAnalysis[];
  measuredAt: string | null;
}

export interface AudioFileRecord {
  detailLevel?: "summary";
  id: string;
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
  durationSeconds: number | null;
  codec: string;
  container: string;
  codecProfile: string | null;
  encoder: string | null;
  lossless: boolean | null;
  bitrate: number | null;
  overallFileBitrate: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  channelMode: string | null;
  bitrateMode: string | null;
  metadata: MetadataInventory;
  scanError: string | null;
  oracle: OracleResult;
  userReview?: {
    status: "reviewed";
    reviewedAt: string;
  };
}

export interface AudioSourceSelection {
  kind: "files" | "folder";
  paths: string[];
  label: string;
  mode?: AnalysisMode;
  resourceLimits?: AnalysisResourceLimits;
  recovery?: AuditRecoveryState;
  externalLookup?: {
    acoustIdEnabled: boolean;
    acoustIdApiKey?: string;
  };
}

export interface AnalysisResourceLimits {
  concurrency: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  workerMemoryMb: 128 | 256 | 384 | 512;
  ffmpegThreads: 1 | 2 | 4;
  nativeProcessMemoryMb: 256 | 512 | 1024 | 2048;
}

export type AuditResumeStrategy = "adaptive-safe" | "previous-settings";

export interface AuditRecoveryState {
  strategy: AuditResumeStrategy;
  attempt: number;
  candidatePaths: string[];
  safeCandidatePaths: string[];
  quarantinedCandidatePaths: string[];
  targetResourceLimits: AnalysisResourceLimits;
}

export type AuditSessionStatus =
  | "running"
  | "completed"
  | "canceled"
  | "failed";

export interface AuditSessionSummary {
  id: string;
  label: string;
  source: AudioSourceSelection;
  status: AuditSessionStatus;
  interrupted: boolean;
  recoveryCandidateCount: number;
  discoveredCount: number;
  completedCount: number;
  warningCount: number;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StoredAuditSession extends AuditSessionSummary {
  warnings: string[];
  files: AudioFileRecord[];
}

export interface AuditResumePlan {
  sessionId: string;
  source: AudioSourceSelection;
  strategy: AuditResumeStrategy;
  targetResourceLimits: AnalysisResourceLimits;
  safeResourceLimits: AnalysisResourceLimits;
  completedCount: number;
  discoveredCount: number;
  recoveryCandidateCount: number;
  recoveryCandidateNames: string[];
  safeCandidateCount: number;
  quarantinedCandidateCount: number;
}

export interface DecodedSignalComparison {
  method:
    | "Audio-V aligned PCM preview v1"
    | "Audio-V full-track multichannel null v2"
    | "Audio-V explicit channel-map null v3";
  sampleRate: number;
  analyzedSeconds: number;
  offsetSeconds: number;
  envelopeCorrelation: number;
  sampleCorrelation: number;
  polarity: "same" | "inverted" | "inconclusive";
  gainDifferenceDb: number | null;
  residualRmsDb: number;
  fullTrack: boolean;
  comparedChannels: number;
  comparedFrames: number;
  durationCoveragePercent: number;
  perChannel: Array<{
    channel: number;
    leftChannel: number;
    rightChannel: number;
    sampleCorrelation: number | null;
    residualRmsDb: number;
    peakResidualDbfs: number | null;
    nullDepthDb: number;
  }>;
  relationship:
    | "aligned-equivalent"
    | "strongly-related"
    | "possibly-related"
    | "distinct";
  limitation: string;
}

export interface ComparisonChannelMapping {
  leftChannel: number;
  rightChannel: number;
}

export interface ScanSelectionResult {
  sessionId?: string;
  source: AudioSourceSelection;
  scannedAt: string;
  files: AudioFileRecord[];
  unreadableCount: number;
  warnings: string[];
}

export interface ScanProgressUpdate {
  phase:
    | "discovered"
    | "processing"
    | "staging"
    | "checkpointing"
    | "inventorying"
    | "analyzing"
    | "complete";
  completed: number;
  total: number;
  currentFile: string | null;
  file: AudioFileRecord | null;
  fromCache: boolean;
  checkpoint?: {
    state: "queued" | "writing" | "saved" | "stalled";
    pendingFiles: number;
    explanation: string;
  };
  activity?: {
    state: "delayed";
    elapsedSeconds: number;
    explanation: string;
  };
  sessionId?: string;
  resourceLimits?: AnalysisResourceLimits;
  resourcePolicyExplanation?: string | null;
  recovery?: {
    stage: "safe-validation" | "restored-settings" | "quarantine";
    explanation: string;
    targetResourceLimits: AnalysisResourceLimits;
  };
  sourceIo?: {
    storageKind: "local" | "network" | "removable-or-mounted";
    staged: boolean;
    sizeBytes: number;
    transferredBytes?: number;
    explanation: string;
  };
}

export interface ReportExportResult {
  canceled: boolean;
  filePath: string | null;
}

export interface BatchSpectrogramExportResult extends ReportExportResult {
  exportedCount: number;
}

export type ReportExportFormat = "json" | "csv" | "pdf" | "xlsx" | "docx";

export type ReportExportRequest =
  | {
      scope: "session";
      sessionId: string;
    }
  | {
      scope: "file";
      filePath: string;
    };

export interface RepairCopyResult {
  canceled: boolean;
  filePath: string | null;
  file: AudioFileRecord | null;
}

export interface OracleValidationStatus {
  schema: "Audio-V real-world validation status v1";
  generatedAt: string;
  corpusVersion: string;
  readiness:
    | "awaiting-source-masters"
    | "pilot-building"
    | "pilot-ready"
    | "target-corpus-ready";
  infrastructurePassed: boolean;
  milestoneAchieved: boolean;
  claimLevel:
    | "synthetic-regression-only"
    | "pilot-real-world-evidence"
    | "real-world-corpus-present-not-probability-calibrated";
  counts: {
    independentMasters: number;
    publicIndependentMasters: number;
    privateChallengeMasters: number;
    contributorGroups: number;
    redistributableMasters: number;
    generatedCases: number;
    bySplit: Record<string, number>;
  };
  thresholds: {
    pilotIndependentMasters: number;
    targetIndependentMasters: number;
    minimumCasesPerMaster: number;
  };
  latestScorecard: {
    status: string;
    engineVersion: string;
    measuredAt: string;
    acceptedClassificationRate: {
      numerator: number;
      denominator: number;
      percent: number | null;
    };
  } | null;
  limitations: string[];
}

export type DesktopPlatform = "aix" | "android" | "darwin" | "freebsd" | "haiku" | "linux" | "openbsd" | "sunos" | "win32" | "cygwin" | "netbsd";

export interface AudioVDesktopApi {
  qaLoadConfiguredSource?(): Promise<AudioSourceSelection | null>;
  selectFiles(): Promise<AudioSourceSelection | null>;
  selectCompareFile(): Promise<AudioSourceSelection | null>;
  selectFolder(): Promise<AudioSourceSelection | null>;
  scanSelection(source: AudioSourceSelection): Promise<ScanSelectionResult>;
  listAuditSessions(): Promise<AuditSessionSummary[]>;
  openAuditSession(sessionId: string): Promise<StoredAuditSession>;
  openAuditSessionFile(
    sessionId: string,
    filePath: string,
  ): Promise<AudioFileRecord>;
  setFileReviewed(
    sessionId: string,
    filePath: string,
    reviewed: boolean,
  ): Promise<AudioFileRecord>;
  prepareAuditSessionResume(
    sessionId: string,
    strategy?: AuditResumeStrategy,
  ): Promise<AuditResumePlan>;
  compareSignals(
    leftPath: string,
    rightPath: string,
    channelMapping?: ComparisonChannelMapping[],
  ): Promise<DecodedSignalComparison>;
  listFingerprintLibrary(): Promise<FingerprintLibraryEntry[]>;
  rebuildFingerprintLibrary(): Promise<FingerprintLibraryMutationResult>;
  pruneFingerprintLibrary(): Promise<FingerprintLibraryMutationResult>;
  clearFingerprintLibrary(): Promise<FingerprintLibraryMutationResult>;
  onScanProgress(listener: (progress: ScanProgressUpdate) => void): () => void;
  pauseScan(): Promise<boolean>;
  resumeScan(): Promise<boolean>;
  cancelScan(): Promise<boolean>;
  analyzeFile(filePath: string, sessionId?: string): Promise<OracleResult>;
  inspectSpectrogram(
    filePath: string,
    fftSize: 512 | 2048 | 4096 | 16384,
    channelMode: SpectrogramMeasurements["channelMode"],
  ): Promise<SpectrogramMeasurements>;
  exportReport(
    request: ReportExportRequest,
    format?: ReportExportFormat,
  ): Promise<ReportExportResult>;
  exportSpectrogram(
    fileName: string,
    dataUrl: string,
  ): Promise<ReportExportResult>;
  exportSpectrogramBatch(
    items: Array<{ fileName: string; dataUrl: string }>,
  ): Promise<BatchSpectrogramExportResult>;
  validationStatus(): Promise<OracleValidationStatus>;
  exportDiagnostics(): Promise<ReportExportResult>;
  revealFile(filePath: string): Promise<boolean>;
  createTruePeakSafeCopy(
    filePath: string,
    targetBitDepth: 16 | 24,
  ): Promise<RepairCopyResult>;
  platform(): Promise<DesktopPlatform>;
}
