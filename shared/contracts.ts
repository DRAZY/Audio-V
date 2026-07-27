export const AUDIO_EXTENSIONS = [
  ".aac",
  ".aif",
  ".aiff",
  ".alac",
  ".ape",
  ".dsf",
  ".dff",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".opus",
  ".wav",
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
  nearClippedSamples: number;
}

export interface SpectrogramSlice {
  timeSeconds: number;
  levelsDbfs: number[];
}

export interface SpectrogramMeasurements {
  algorithm: "STFT";
  channelMode: "per-channel power average";
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
  continuity: SignalContinuityMeasurements;
  waveform: WaveformMeasurements | null;
  spectrogram: SpectrogramMeasurements;
  spectrogramPyramid?: SpectrogramMeasurements[];
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
  flacMd5: FlacMd5Integrity | null;
  externalChecksums: ExternalChecksumVerification[];
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
    | "oracle-integrity-fidelity-v5";
  verdict: OracleVerdict;
  confidence: number | null;
  headline: string;
  interpretation: string;
  evidence: OracleEvidence[];
  measurements: SignalMeasurements | null;
  technical: StreamTechnicalAnalysis | null;
  fidelity: FidelityAssessment | null;
  measuredAt: string | null;
}

export interface AudioFileRecord {
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
  scanError: string | null;
  oracle: OracleResult;
}

export interface AudioSourceSelection {
  kind: "files" | "folder";
  paths: string[];
  label: string;
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

export interface DecodedSignalComparison {
  method: "Audio-V aligned PCM preview v1";
  sampleRate: 8000;
  analyzedSeconds: number;
  offsetSeconds: number;
  envelopeCorrelation: number;
  sampleCorrelation: number;
  polarity: "same" | "inverted" | "inconclusive";
  gainDifferenceDb: number | null;
  residualRmsDb: number;
  relationship:
    | "aligned-equivalent"
    | "strongly-related"
    | "possibly-related"
    | "distinct";
  limitation: string;
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
  phase: "discovered" | "analyzing" | "complete";
  completed: number;
  total: number;
  currentFile: string | null;
  file: AudioFileRecord | null;
  fromCache: boolean;
}

export interface ReportExportResult {
  canceled: boolean;
  filePath: string | null;
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

export type DesktopPlatform = "aix" | "android" | "darwin" | "freebsd" | "haiku" | "linux" | "openbsd" | "sunos" | "win32" | "cygwin" | "netbsd";

export interface AudioVDesktopApi {
  qaLoadConfiguredSource?(): Promise<AudioSourceSelection | null>;
  selectFiles(): Promise<AudioSourceSelection | null>;
  selectCompareFile(): Promise<AudioSourceSelection | null>;
  selectFolder(): Promise<AudioSourceSelection | null>;
  scanSelection(source: AudioSourceSelection): Promise<ScanSelectionResult>;
  listAuditSessions(): Promise<AuditSessionSummary[]>;
  openAuditSession(sessionId: string): Promise<StoredAuditSession>;
  compareSignals(
    leftPath: string,
    rightPath: string,
  ): Promise<DecodedSignalComparison>;
  onScanProgress(listener: (progress: ScanProgressUpdate) => void): () => void;
  pauseScan(): Promise<boolean>;
  resumeScan(): Promise<boolean>;
  cancelScan(): Promise<boolean>;
  analyzeFile(filePath: string, sessionId?: string): Promise<OracleResult>;
  exportReport(
    request: ReportExportRequest,
    format?: ReportExportFormat,
  ): Promise<ReportExportResult>;
  exportSpectrogram(
    fileName: string,
    dataUrl: string,
  ): Promise<ReportExportResult>;
  exportDiagnostics(): Promise<ReportExportResult>;
  revealFile(filePath: string): Promise<boolean>;
  createTruePeakSafeCopy(
    filePath: string,
    targetBitDepth: 16 | 24,
  ): Promise<RepairCopyResult>;
  platform(): Promise<DesktopPlatform>;
}
