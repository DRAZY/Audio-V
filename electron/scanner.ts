import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseFile } from "music-metadata";
import {
  AUDIO_EXTENSIONS,
  type AcoustIdLookup,
  type AudioSourceSelection,
  type AudioFileRecord,
  type OracleResult,
  type ScanProgressUpdate,
  type ScanSelectionResult,
  type FingerprintIndexCandidate,
} from "../shared/contracts";
import { compactAudioFileRecord } from "../shared/compact-audio-record";
import { assessDiscVerificationEligibility } from "../shared/disc-verification";
import { assessExternalIdentity } from "../shared/external-identity-assessment";
import {
  analyzeAudioFile,
  engineVersion as currentOracleEngineVersion,
} from "./oracle/oracle-engine";
import { applyDeliveryProfile } from "./oracle/delivery-profile";
import {
  audioCodecLabel,
  audioFormatLabel,
  isUsableAudioLabel,
} from "../shared/audio-format";
import {
  isChecksumManifest,
  readChecksumManifest,
  verifyChecksumEntries,
  type ChecksumManifestEntry,
} from "./checksum-verifier";
import {
  buildMetadataInventory,
  emptyMetadataInventory,
} from "./metadata-inventory";
import {
  lookupAcoustId,
  lookupMusicBrainzRecording,
  metadataProvenanceIndicators,
} from "./oracle/analysis-tools";
import { analyzeCueTracks } from "./oracle/cue-track-analyzer";
import { measureAlbumReplayGain } from "./oracle/album-replaygain";
import {
  classifySourceStorage,
  stageSourceFile,
  type SourceStorageKind,
  type StagedSourceFile,
} from "./source-read-optimizer";

const supportedExtensions = new Set<string>(AUDIO_EXTENSIONS);
const DEFAULT_AUTOMATIC_ALBUM_REPLAYGAIN_FILE_LIMIT = 1_000;
const DEFAULT_NEAR_FINGERPRINT_RELATIONSHIP_FILE_LIMIT = 2_000;
const DEFAULT_HISTORICAL_FINGERPRINT_FILE_LIMIT = 1_000;
const DEFAULT_HISTORICAL_NEAR_FINGERPRINT_FILE_LIMIT = 100;
const DEFAULT_HISTORICAL_FINGERPRINT_CONCURRENCY = 4;
const MAX_CURRENT_FINGERPRINT_CANDIDATES = 500;

function throwIfCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Audio analysis canceled.");
}

async function abortable<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation;
  throwIfCanceled(signal);
  let abort: (() => void) | null = null;
  const canceled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("Audio analysis canceled."));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([operation, canceled]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

function sourceReadError(sourcePath: string, error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  const message = error instanceof Error ? error.message : "Source could not be read";
  if (code === "EACCES" || code === "EPERM") {
    return `${sourcePath}: access was denied. Re-select the folder and allow Audio-V access to removable or network volumes in the operating-system privacy settings. (${message})`;
  }
  if (
    code === "ENOENT" ||
    code === "ENODEV" ||
    code === "ENXIO" ||
    code === "ENOTCONN" ||
    code === "EHOSTDOWN" ||
    code === "EHOSTUNREACH"
  ) {
    return `${sourcePath}: the external or network source is unavailable. Reconnect or remount it, then retry. (${message})`;
  }
  return `${sourcePath}: ${message}`;
}

export interface OracleRecordCache {
  get(filePath: string): Promise<AudioFileRecord | null>;
  set(record: AudioFileRecord): Promise<void>;
  flush(): Promise<void>;
  findFingerprintCandidates?(
    filePath: string,
    limit?: number,
    durationSeconds?: number | null,
    lookup?: {
      exactOnly: boolean;
      fingerprintSha256: string | null;
    },
  ): Promise<FingerprintIndexCandidate[]>;
}

function normalizeAudioRecordFormat(file: AudioFileRecord): AudioFileRecord {
  const technical = file.oracle.technical;
  const extension = file.extension || path.extname(file.path).slice(1);
  const codec =
    technical && isUsableAudioLabel(technical.codecLongName)
      ? technical.codecLongName
      : technical && isUsableAudioLabel(technical.codecName)
        ? audioCodecLabel(technical.codecName)
        : isUsableAudioLabel(file.codec)
          ? file.codec
          : audioFormatLabel({ extension, container: file.container });
  const container = isUsableAudioLabel(file.container)
    ? file.container
    : audioFormatLabel({ extension, codec });
  return { ...file, extension, codec, container };
}

function notAnalyzedOracleResult(scanError: string | null): OracleResult {
  if (scanError) {
    return {
      schemaVersion: 1,
      engineVersion: "metadata-inventory-v1",
      scope: "metadata-only",
      verdict: "inconclusive",
      analysisState: "error",
      failure: {
        category: "analysis-error",
        stage: "metadata-probe",
        code: "METADATA_PROBE_ERROR",
        summary: "Audio-V could not complete the metadata inventory for this file.",
        evidence: scanError,
      },
      confidence: null,
      headline: "Metadata inventory error",
      interpretation:
        "The metadata reader could not inventory this file. That is not evidence of audio damage, and the Oracle Engine has not analyzed its decoded signal.",
      evidence: [
        {
          id: "metadata-read",
          label: "Metadata discovery",
          summary: scanError,
          kind: "deterministic",
          disposition: "contradicts",
        },
      ],
      measurements: null,
      technical: null,
      fidelity: null,
      measuredAt: null,
    };
  }

  return {
    schemaVersion: 1,
    engineVersion: "metadata-inventory-v1",
    scope: "metadata-only",
    verdict: "inconclusive",
    analysisState: "not-analyzed",
    failure: null,
    confidence: null,
    headline: "Metadata inventoried · not analyzed",
    interpretation:
      "Container and stream metadata were inventoried without decoding the audio. No integrity, signal-quality, spectral-origin, or fidelity verdict has been issued.",
    evidence: [
      {
        id: "metadata-read",
        label: "Metadata discovery",
        summary: "Container and stream metadata parsed successfully.",
        kind: "deterministic",
        disposition: "neutral",
      },
    ],
    measurements: null,
    technical: null,
    fidelity: null,
    measuredAt: null,
  };
}

function recoveryQuarantinedOracleResult(reason: string): OracleResult {
  return {
    schemaVersion: 1,
    engineVersion: currentOracleEngineVersion,
    scope: "oracle-integrity-forensics-v12",
    verdict: "inconclusive",
    analysisState: "error",
    failure: {
      category: "analysis-error",
      stage: "oracle-engine",
      code: "RECOVERY_QUARANTINED",
      summary:
        "Audio-V skipped this file during safe recovery because it was active when the previous application process ended.",
      evidence: reason,
    },
    confidence: null,
    headline: "Quarantined during crash recovery",
    interpretation:
      "This is not evidence of file damage. The remaining source was resumed with conservative resource limits; analyze this file separately after the recovered audit completes.",
    evidence: [
      {
        id: "crash-recovery-quarantine",
        label: "Crash recovery",
        summary: reason,
        kind: "deterministic",
        disposition: "neutral",
      },
    ],
    measurements: null,
    technical: null,
    fidelity: null,
    assessments: {
      integrity: {
        status: "error",
        summary:
          "The prior process ended while this file was active; no integrity verdict was issued.",
      },
      signal: { status: "clear", findingIds: [] },
      origin: {
        status: "inconclusive",
        strength: "none",
        coveragePercent: 0,
        stabilityPercent: null,
        independentIndicatorCount: 0,
        findingIds: [],
      },
      provenance: { status: "none", findingIds: [] },
      delivery: {
        profile: null,
        status: "not-evaluated",
        measuredLoudnessLufs: null,
        measuredTruePeakDbtp: null,
        findingIds: [],
      },
      findings: [
        {
          id: "crash-recovery-quarantine",
          lane: "integrity",
          severity: "advisory",
          certainty: "deterministic",
          summary: reason,
          evidenceIds: ["crash-recovery-quarantine"],
        },
      ],
    },
    measuredAt: null,
  };
}

async function collectAudioFiles(
  root: string,
  warnings: string[],
  checksumManifests?: Set<string>,
  signal?: AbortSignal,
): Promise<string[]> {
  const discovered: string[] = [];
  const pending = [root];
  const visitedDirectories = new Set<string>();
  const directoryBatchSize = 8;

  while (pending.length > 0) {
    throwIfCanceled(signal);
    const batch = pending.splice(
      Math.max(0, pending.length - directoryBatchSize),
      directoryBatchSize,
    );
    const results = await Promise.all(
      batch.map(async (current) => {
        try {
          const canonicalDirectory = await abortable(
            fs.realpath(current),
            signal,
          );
          if (visitedDirectories.has(canonicalDirectory)) return null;
          visitedDirectories.add(canonicalDirectory);
        } catch (error) {
          warnings.push(sourceReadError(current, error));
          return null;
        }

        try {
          return {
            current,
            entries: await abortable(
              fs.readdir(current, { withFileTypes: true }),
              signal,
            ),
          };
        } catch (error) {
          warnings.push(sourceReadError(current, error));
          return null;
        }
      }),
    );
    for (const result of results) {
      if (!result) continue;
      for (const entry of result.entries) {
        throwIfCanceled(signal);
        if (entry.name.startsWith(".")) continue;
        const entryPath = path.join(result.current, entry.name);
        let isDirectory = entry.isDirectory();
        let isFile = entry.isFile();
        if (entry.isSymbolicLink() || (!isDirectory && !isFile)) {
          try {
            const stat = await abortable(fs.stat(entryPath), signal);
            isDirectory = stat.isDirectory();
            isFile = stat.isFile();
          } catch (error) {
            warnings.push(sourceReadError(entryPath, error));
            continue;
          }
        }
        if (isDirectory) {
          pending.push(entryPath);
        } else if (
          isFile &&
          supportedExtensions.has(path.extname(entry.name).toLowerCase())
        ) {
          discovered.push(entryPath);
        } else if (isFile && isChecksumManifest(entryPath)) {
          checksumManifests?.add(entryPath);
        }
      }
    }
  }

  return discovered.sort((left, right) => left.localeCompare(right));
}

async function collectNearbyChecksumManifests(
  filePath: string,
  checksumManifests: Set<string>,
  warnings: string[],
  signal?: AbortSignal,
): Promise<void> {
  throwIfCanceled(signal);
  try {
    const entries = await fs.readdir(path.dirname(filePath), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      throwIfCanceled(signal);
      if (entry.isFile()) {
        const entryPath = path.join(path.dirname(filePath), entry.name);
        if (isChecksumManifest(entryPath)) checksumManifests.add(entryPath);
      }
    }
  } catch (error) {
    throwIfCanceled(signal);
    warnings.push(sourceReadError(path.dirname(filePath), error));
  }
}

async function loadChecksumEntries(
  manifestPaths: Set<string>,
  warnings: string[],
  signal?: AbortSignal,
): Promise<ChecksumManifestEntry[]> {
  const entries: ChecksumManifestEntry[] = [];
  for (const manifestPath of [...manifestPaths].sort()) {
    throwIfCanceled(signal);
    try {
      const parsed = await readChecksumManifest(manifestPath);
      if (parsed.length === 0) {
        warnings.push(`${manifestPath}: no supported checksum entries found`);
      } else {
        entries.push(...parsed);
      }
    } catch (error) {
      throwIfCanceled(signal);
      warnings.push(
        `${manifestPath}: ${error instanceof Error ? error.message : "Checksum manifest could not be read"}`,
      );
    }
  }
  return entries;
}

async function attachExternalChecksumEvidence(
  file: AudioFileRecord,
  entriesByPath: ReadonlyMap<string, ChecksumManifestEntry[]>,
  signal?: AbortSignal,
  verificationPath = file.path,
): Promise<AudioFileRecord> {
  if (!file.oracle.technical) return file;
  const relevantEntries = entriesByPath.get(path.resolve(file.path)) ?? [];
  // Read the bytes from verificationPath, which may be a staged temp copy, but
  // match entries against file.path, which is the identity a manifest names.
  // Passing the staged path for both made every entry fail the match and the
  // whole verification silently return nothing.
  const externalChecksums = await verifyChecksumEntries(
    verificationPath,
    relevantEntries,
    { sha256: file.oracle.technical.fileSha256 },
    signal,
    file.path,
  );
  const priorEvidence = file.oracle.evidence.filter(
    (item) => !item.id.startsWith("external-checksum-"),
  );
  const mismatch = externalChecksums.some((item) => item.status === "mismatch");
  const evidence = externalChecksums.map((item, index) => ({
    id: `external-checksum-${item.algorithm}-${index}`,
    label: `${item.algorithm.toUpperCase()} manifest verification`,
    summary:
      item.status === "verified"
        ? `Verified ${item.calculated} against ${path.basename(item.manifestPath)}.`
        : `Expected ${item.expected}, calculated ${item.calculated}; manifest ${path.basename(item.manifestPath)} does not match this file.`,
    kind: "deterministic" as const,
    disposition:
      item.status === "verified"
        ? ("supports" as const)
        : ("contradicts" as const),
  }));
  const alreadyDamaged = file.oracle.verdict === "damaged";

  return {
    ...file,
    oracle: {
      ...file.oracle,
      verdict: mismatch && !alreadyDamaged ? "review" : file.oracle.verdict,
      confidence: file.oracle.confidence,
      headline:
        mismatch && !alreadyDamaged
          ? "External checksum mismatch"
          : file.oracle.headline,
      interpretation:
        mismatch && !alreadyDamaged
          ? "The file decodes, but its bytes do not match at least one supplied MD5/SHA manifest entry. This deterministically disproves identity against that manifest; it does not by itself prove which copy or manifest is authoritative."
          : file.oracle.interpretation,
      evidence: [...priorEvidence, ...evidence],
      technical: {
        ...file.oracle.technical,
        externalChecksums,
      },
      assessments:
        mismatch && file.oracle.assessments
          ? {
              ...file.oracle.assessments,
              provenance: {
                status:
                  file.oracle.assessments.provenance.status === "none"
                    ? "declared"
                    : file.oracle.assessments.provenance.status,
                findingIds: [
                  ...file.oracle.assessments.provenance.findingIds,
                  "external-checksum-mismatch",
                ],
              },
              findings: [
                ...file.oracle.assessments.findings.filter(
                  (finding) => finding.id !== "external-checksum-mismatch",
                ),
                {
                  id: "external-checksum-mismatch",
                  lane: "provenance",
                  severity: "review",
                  certainty: "deterministic",
                  summary:
                    "File bytes do not match at least one supplied checksum manifest entry; manifest authority remains external to Audio-V.",
                  evidenceIds: evidence
                    .filter((item) => item.disposition === "contradicts")
                    .map((item) => item.id),
                },
              ],
            }
          : file.oracle.assessments,
    },
  };
}

export function attachMetadataProvenance(
  file: AudioFileRecord,
): AudioFileRecord {
  const technical = file.oracle.technical;
  if (!technical) return file;
  const metadataIndicators = metadataProvenanceIndicators(
    file.metadata.tags,
    [],
    technical.contentCredentials,
  ).filter((item) => item.source.startsWith("metadata:"));
  const provenanceIndicators = [
    ...technical.provenanceIndicators,
    ...metadataIndicators,
  ].filter(
    (item, index, values) =>
      values.findIndex(
        (candidate) =>
          candidate.type === item.type &&
          candidate.identifier === item.identifier &&
          candidate.source === item.source &&
          candidate.value === item.value,
      ) === index,
  );
  if (metadataIndicators.length === 0) {
    return {
      ...file,
      oracle: {
        ...file.oracle,
        technical: { ...technical, metadata: file.metadata, provenanceIndicators },
      },
    };
  }
  const evidenceId = (
    indicator: (typeof metadataIndicators)[number],
    index: number,
  ) =>
    `${indicator.type === "format-marker" ? "format-marker" : "generator-metadata"}-${index}`;
  const provenanceFindingIds = metadataIndicators.map(evidenceId);
  return {
    ...file,
    oracle: {
      ...file.oracle,
      evidence: [
        ...file.oracle.evidence.filter(
          (item) =>
            !item.id.startsWith("generator-metadata-") &&
            !item.id.startsWith("format-marker-"),
        ),
        ...metadataIndicators.map((indicator, index) => ({
          id: evidenceId(indicator, index),
          label:
            `${indicator.type === "format-marker" ? "Format marker" : "Generator metadata"} · ${indicator.identifier}`,
          summary: `${indicator.source}: ${indicator.value}. ${indicator.interpretation}`,
          kind: "heuristic" as const,
          disposition: "neutral" as const,
        })),
      ],
      technical: { ...technical, metadata: file.metadata, provenanceIndicators },
      assessments: file.oracle.assessments
        ? {
            ...file.oracle.assessments,
            provenance: {
              status:
                file.oracle.assessments.provenance.status === "none"
                  ? "declared"
                  : file.oracle.assessments.provenance.status,
              findingIds: [
                ...file.oracle.assessments.provenance.findingIds.filter(
                  (id) =>
                    !id.startsWith("generator-metadata-") &&
                    !id.startsWith("format-marker-"),
                ),
                ...provenanceFindingIds,
              ],
            },
            findings: [
              ...file.oracle.assessments.findings.filter(
                (finding) =>
                  !finding.id.startsWith("generator-metadata-") &&
                  !finding.id.startsWith("format-marker-"),
              ),
              ...metadataIndicators.map((indicator, index) => ({
                id: evidenceId(indicator, index),
                lane: "provenance" as const,
                severity: "info" as const,
                certainty: "declared" as const,
                summary: `${indicator.identifier}: editable metadata inventory only; not proof of audio origin.`,
                evidenceIds: [evidenceId(indicator, index)],
              })),
            ],
          }
        : file.oracle.assessments,
    },
  };
}

export function attachDiscVerificationEligibility(
  file: AudioFileRecord,
): AudioFileRecord {
  if (!file.oracle.technical) return file;
  return {
    ...file,
    oracle: {
      ...file.oracle,
      technical: {
        ...file.oracle.technical,
        discVerification: assessDiscVerificationEligibility(file),
      },
    },
  };
}

function restoreOracleSourcePath(
  oracle: OracleResult,
  analysisPath: string,
  sourcePath: string,
): OracleResult {
  if (analysisPath === sourcePath) return oracle;
  const restore = (value: string) => value.replaceAll(analysisPath, sourcePath);
  return {
    ...oracle,
    interpretation: restore(oracle.interpretation),
    failure: oracle.failure
      ? {
          ...oracle.failure,
          summary: restore(oracle.failure.summary),
          evidence: restore(oracle.failure.evidence),
        }
      : null,
    evidence: oracle.evidence.map((entry) => ({
      ...entry,
      summary: restore(entry.summary),
    })),
  };
}

export async function attachExternalIdentityEvidence(
  file: AudioFileRecord,
  source: AudioSourceSelection,
  signal?: AbortSignal,
): Promise<AudioFileRecord> {
  const technical = file.oracle.technical;
  if (!technical) return file;
  let acoustIdLookup: AcoustIdLookup = {
    status: "not-requested",
    acoustId: null,
    score: null,
    recordingIds: [],
    recordingTitles: [],
    error: null,
  };
  if (
    source.externalLookup?.acoustIdEnabled &&
    source.externalLookup.acoustIdApiKey
  ) {
    acoustIdLookup = await lookupAcoustId(
      technical.fingerprint,
      source.externalLookup.acoustIdApiKey,
      signal,
      file.path,
    );
  }
  const musicBrainzEnrichment = source.externalLookup?.musicBrainzEnabled
    ? await lookupMusicBrainzRecording(
        file.metadata.musicBrainzRecordingIds,
        acoustIdLookup,
        signal,
      )
    : undefined;
  const identityAssessment = assessExternalIdentity(
    file.metadata,
    acoustIdLookup,
    musicBrainzEnrichment,
  );
  return {
    ...file,
    oracle: {
      ...file.oracle,
      technical: {
        ...technical,
        fingerprint: {
          ...technical.fingerprint,
          acoustIdLookup,
        },
        musicBrainzEnrichment,
        identityAssessment,
      },
    },
  };
}

function externalIdentityEvidencePending(
  file: AudioFileRecord,
  source: AudioSourceSelection,
): boolean {
  const technical = file.oracle.technical;
  if (!technical) return false;
  return Boolean(
    (source.externalLookup?.acoustIdEnabled &&
      source.externalLookup.acoustIdApiKey &&
      technical.fingerprint.acoustIdLookup.status === "not-requested") ||
      (source.externalLookup?.musicBrainzEnabled &&
        !technical.musicBrainzEnrichment),
  );
}

function popcount32(value: number): number {
  let candidate = value >>> 0;
  candidate -= (candidate >>> 1) & 0x55555555;
  candidate = (candidate & 0x33333333) + ((candidate >>> 2) & 0x33333333);
  return (((candidate + (candidate >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function fingerprintSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) return 0;
  let differingBits = 0;
  for (let index = 0; index < length; index += 1) {
    differingBits += popcount32((left[index] ^ right[index]) >>> 0);
  }
  const overlap = length / Math.max(left.length, right.length);
  return Number((overlap * (1 - differingBits / (length * 32))).toFixed(6));
}

function discloseDeferredAlbumReplayGain(
  file: AudioFileRecord,
  auditedFileCount: number,
  automaticFileLimit: number,
): AudioFileRecord {
  const measurements = file.oracle.measurements;
  if (
    auditedFileCount <= automaticFileLimit ||
    !measurements ||
    measurements.replayGain.albumStatus === "calculated"
  ) {
    return file;
  }
  return {
    ...file,
    oracle: {
      ...file.oracle,
      measurements: {
        ...measurements,
        replayGain: {
          ...measurements.replayGain,
          albumGainDb: null,
          albumPeak: null,
          albumGroup: null,
          albumTrackCount: 0,
          albumStatus: "unavailable",
          albumReason:
            `Album ReplayGain was deferred because this audit contains ${auditedFileCount.toLocaleString()} files. Track ReplayGain is complete; audit a specific album or a source with ${automaticFileLimit.toLocaleString()} files or fewer for exact album gain.`,
        },
      },
    },
  };
}

async function attachAlbumReplayGain(
  files: AudioFileRecord[],
  signal?: AbortSignal,
  warnings?: string[],
  automaticFileLimit = DEFAULT_AUTOMATIC_ALBUM_REPLAYGAIN_FILE_LIMIT,
): Promise<AudioFileRecord[]> {
  if (files.length > automaticFileLimit) return files;
  const identityGroups = new Map<string, AudioFileRecord[]>();
  const replacements = new Map<string, AudioFileRecord>();
  const setUnavailable = (file: AudioFileRecord, reason: string) => {
    const measurements = file.oracle.measurements;
    if (!measurements) return;
    replacements.set(file.path, {
      ...file,
      oracle: {
        ...file.oracle,
        measurements: {
          ...measurements,
          replayGain: {
            ...measurements.replayGain,
            albumGainDb: null,
            albumPeak: null,
            albumGroup: null,
            albumTrackCount: 0,
            albumStatus: "unavailable",
            albumReason: reason,
          },
        },
      },
    });
  };
  for (const file of files) {
    const measurements = file.oracle.measurements;
    const album = file.metadata.album?.trim();
    if (!measurements) continue;
    if (!album) {
      setUnavailable(
        file,
        "Album ReplayGain was not calculated because the file has no declared album identity.",
      );
      continue;
    }
    const artist =
      file.metadata.albumArtists[0] ?? file.metadata.artists[0] ?? "";
    const key =
      `${artist.trim().toLocaleLowerCase()}\0${album.toLocaleLowerCase()}`;
    const group = identityGroups.get(key) ?? [];
    group.push(file);
    identityGroups.set(key, group);
  }
  for (const [identityKey, identityGroup] of identityGroups) {
    const channelGroups = new Map<number, AudioFileRecord[]>();
    for (const file of identityGroup) {
      const channels = file.oracle.measurements?.channels;
      if (!channels) {
        setUnavailable(
          file,
          "Album ReplayGain was not calculated because decoded channel count is unavailable.",
        );
        continue;
      }
      const group = channelGroups.get(channels) ?? [];
      group.push(file);
      channelGroups.set(channels, group);
    }
    for (const [channels, group] of channelGroups) {
      if (group.length < 2) {
        setUnavailable(
          group[0],
          identityGroup.length > 1
            ? `Album identity matched other audited files, but no second track had the same ${channels}-channel layout.`
            : "Album ReplayGain requires at least two fully analyzed tracks with matching album identity and channel count.",
        );
        continue;
      }
      const key = `${identityKey}\0${channels}`;
      const ordered = [...group].sort(
      (left, right) =>
        (left.metadata.discNumber ?? 0) - (right.metadata.discNumber ?? 0) ||
        (left.metadata.trackNumber ?? 0) - (right.metadata.trackNumber ?? 0) ||
        left.path.localeCompare(right.path),
      );
      try {
        const album = await measureAlbumReplayGain(
          ordered.map((file) => file.path),
          signal,
        );
        const albumPeak = Math.max(
          ...ordered.map(
            (file) => file.oracle.measurements?.replayGain.trackPeak ?? 0,
          ),
        );
        for (const file of ordered) {
          const measurements = file.oracle.measurements!;
          replacements.set(file.path, {
            ...file,
            oracle: {
              ...file.oracle,
              measurements: {
                ...measurements,
                replayGain: {
                  ...measurements.replayGain,
                  albumGainDb: album.gainDb,
                  albumPeak,
                  albumGroup: key,
                  albumTrackCount: ordered.length,
                  albumStatus: "calculated",
                  albumReason:
                    `Calculated across ${ordered.length} fully decoded tracks with matching album identity and ${channels}-channel layout.`,
                  limitation:
                    "ReplayGain 2.0 album gain was calculated by concatenating the complete decoded tracks in disc/track order at the -18 LUFS reference.",
                },
              },
            },
          });
        }
      } catch (error) {
        throwIfCanceled(signal);
        const reason =
          `Album ReplayGain measurement failed: ${
            error instanceof Error ? error.message : "measurement failed"
          }`;
        for (const file of ordered) setUnavailable(file, reason);
        warnings?.push(`Album ReplayGain (${ordered[0].metadata.album}): ${reason}`);
      }
    }
  }
  return files.map((file) => replacements.get(file.path) ?? file);
}

export interface FingerprintRelationshipOptions {
  cache?: OracleRecordCache;
  signal?: AbortSignal;
  nearRelationshipFileLimit?: number;
  historicalMatchFileLimit?: number;
  historicalNearMatchFileLimit?: number;
  historicalConcurrency?: number;
  warnings?: string[];
  onProgress?: (completed: number, total: number, explanation: string) => void;
}

export async function attachFingerprintRelationships(
  files: AudioFileRecord[],
  options: FingerprintRelationshipOptions = {},
): Promise<AudioFileRecord[]> {
  const {
    cache,
    signal,
    warnings,
    onProgress,
    nearRelationshipFileLimit =
      DEFAULT_NEAR_FINGERPRINT_RELATIONSHIP_FILE_LIMIT,
    historicalMatchFileLimit = DEFAULT_HISTORICAL_FINGERPRINT_FILE_LIMIT,
    historicalNearMatchFileLimit =
      DEFAULT_HISTORICAL_NEAR_FINGERPRINT_FILE_LIMIT,
    historicalConcurrency = DEFAULT_HISTORICAL_FINGERPRINT_CONCURRENCY,
  } = options;
  const exactGroups = new Map<string, number[]>();
  const durationBuckets = new Map<number, number[]>();
  for (let index = 0; index < files.length; index += 1) {
    throwIfCanceled(signal);
    const fingerprint = files[index].oracle.technical?.fingerprint;
    if (!fingerprint || fingerprint.status !== "measured") continue;
    if (fingerprint.fingerprintSha256) {
      const group = exactGroups.get(fingerprint.fingerprintSha256) ?? [];
      group.push(index);
      exactGroups.set(fingerprint.fingerprintSha256, group);
    }
    if (
      files.length <= nearRelationshipFileLimit &&
      fingerprint.durationSeconds !== null
    ) {
      const bucket = Math.round(fingerprint.durationSeconds);
      const group = durationBuckets.get(bucket) ?? [];
      group.push(index);
      durationBuckets.set(bucket, group);
    }
  }
  const includeHistoricalMatches = files.length <= historicalMatchFileLimit;
  const includeHistoricalNearMatches =
    files.length <= historicalNearMatchFileLimit;
  const concurrency = Math.max(
    1,
    Math.min(8, Math.trunc(historicalConcurrency)),
  );
  let historicalMatchingAvailable = true;
  let historicalWarningAdded = false;
  const processFile = async (
    file: AudioFileRecord,
    index: number,
  ): Promise<AudioFileRecord> => {
    throwIfCanceled(signal);
    const technical = file.oracle.technical;
    if (!technical || technical.fingerprint.status !== "measured") return file;
    const candidateIndexes = new Set<number>();
    if (technical.fingerprint.fingerprintSha256) {
      for (
        const candidateIndex of
        exactGroups.get(technical.fingerprint.fingerprintSha256) ?? []
      ) {
        candidateIndexes.add(candidateIndex);
        if (candidateIndexes.size >= 101) break;
      }
    }
    if (
      files.length <= nearRelationshipFileLimit &&
      technical.fingerprint.durationSeconds !== null
    ) {
      const duration = Math.round(technical.fingerprint.durationSeconds);
      candidateSearch:
      for (let bucket = duration - 3; bucket <= duration + 3; bucket += 1) {
        for (const candidateIndex of durationBuckets.get(bucket) ?? []) {
          candidateIndexes.add(candidateIndex);
          if (
            candidateIndexes.size >= MAX_CURRENT_FINGERPRINT_CANDIDATES
          ) {
            break candidateSearch;
          }
        }
      }
    }
    const currentMatches = [...candidateIndexes].flatMap((candidateIndex) => {
      if (candidateIndex === index) return [];
      const candidate = files[candidateIndex];
      const other = candidate.oracle.technical?.fingerprint;
      if (!other || other.status !== "measured") return [];
      const sameFingerprint =
        technical.fingerprint.fingerprintSha256 !== null &&
        technical.fingerprint.fingerprintSha256 === other.fingerprintSha256;
      const overlappingFingerprintWords = Math.min(
        technical.fingerprint.rawFingerprint.length,
        other.rawFingerprint.length,
      );
      const similarity = sameFingerprint
        ? 1
        : fingerprintSimilarity(
            technical.fingerprint.rawFingerprint,
            other.rawFingerprint,
          );
      if (
        !sameFingerprint &&
        (overlappingFingerprintWords < 20 || similarity < 0.88)
      ) {
        return [];
      }
      return [{
        filePath: candidate.path,
        fileName: candidate.name,
        similarity,
        relationship: sameFingerprint
          ? ("same-fingerprint" as const)
          : ("high-similarity" as const),
        source: "current-audit" as const,
      }];
    });
    let historical: FingerprintIndexCandidate[] = [];
    if (
      includeHistoricalMatches &&
      historicalMatchingAvailable &&
      cache?.findFingerprintCandidates
    ) {
      try {
        historical = await abortable(
          cache.findFingerprintCandidates(
            file.path,
            100,
            technical.fingerprint.durationSeconds,
            {
              exactOnly: !includeHistoricalNearMatches,
              fingerprintSha256:
                technical.fingerprint.fingerprintSha256,
            },
          ),
          signal,
        );
      } catch (error) {
        throwIfCanceled(signal);
        historicalMatchingAvailable = false;
        if (!historicalWarningAdded) {
          historicalWarningAdded = true;
          warnings?.push(
            `Historical fingerprint enrichment was unavailable: ${
              error instanceof Error ? error.message : "lookup failed"
            } Current-audit fingerprint relationships and every Oracle verdict remain complete.`,
          );
        }
      }
    }
    throwIfCanceled(signal);
    const historicalMatches = historical.flatMap((candidate) => {
      if (currentMatches.some((match) => match.filePath === candidate.filePath)) {
        return [];
      }
      const sameFingerprint =
        technical.fingerprint.fingerprintSha256 !== null &&
        technical.fingerprint.fingerprintSha256 === candidate.fingerprintSha256;
      const overlap = Math.min(
        technical.fingerprint.rawFingerprint.length,
        candidate.rawFingerprint.length,
      );
      const similarity = sameFingerprint
        ? 1
        : fingerprintSimilarity(
            technical.fingerprint.rawFingerprint,
            candidate.rawFingerprint,
          );
      if (!sameFingerprint && (overlap < 20 || similarity < 0.88)) return [];
      return [{
        filePath: candidate.filePath,
        fileName: candidate.fileName,
        similarity,
        relationship: sameFingerprint
          ? ("same-fingerprint" as const)
          : ("high-similarity" as const),
        source: "history-index" as const,
        lastSeenAt: candidate.lastSeenAt,
      }];
    });
    const matches = [...currentMatches, ...historicalMatches]
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, 100);
    if (
      matches.length === technical.fingerprint.matches.length &&
      matches.every((match, matchIndex) => {
        const previous = technical.fingerprint.matches[matchIndex];
        return previous &&
          previous.filePath === match.filePath &&
          previous.similarity === match.similarity &&
          previous.relationship === match.relationship;
      })
    ) {
      return file;
    }
    return {
      ...file,
      oracle: {
        ...file.oracle,
        technical: {
          ...technical,
          fingerprint: { ...technical.fingerprint, matches },
        },
      },
    };
  };
  const results: AudioFileRecord[] = [];
  for (let start = 0; start < files.length; start += concurrency) {
    throwIfCanceled(signal);
    const batch = files.slice(start, start + concurrency);
    results.push(
      ...(await Promise.all(
        batch.map((file, offset) => processFile(file, start + offset)),
      )),
    );
    const completed = Math.min(files.length, start + batch.length);
    const historicalExplanation = !includeHistoricalMatches
      ? `Historical enrichment is deferred above ${historicalMatchFileLimit.toLocaleString()} files; current-audit exact relationships remain complete.`
      : includeHistoricalNearMatches
        ? "Linking current and historical exact and near-similarity fingerprints through a bounded storage queue."
        : `Linking indexed exact historical fingerprints through a bounded storage queue; historical near-similarity expansion is deferred above ${historicalNearMatchFileLimit.toLocaleString()} files.`;
    onProgress?.(completed, files.length, historicalExplanation);
  }
  return results;
}

export async function inspectAudioFile(
  filePath: string,
  signal?: AbortSignal,
): Promise<AudioFileRecord> {
  const stat = await abortable(fs.stat(filePath), signal);
  const id = createHash("sha256")
    .update(`${filePath}\0${stat.size}\0${stat.mtimeMs}`)
    .digest("hex")
    .slice(0, 20);
  let scanError: string | null = null;

  try {
    const metadata = await abortable(
      parseFile(filePath, {
        duration: true,
        skipCovers: true,
      }),
      signal,
    );
    const format = metadata.format;
    const metadataInventory = await abortable(
      buildMetadataInventory(filePath, metadata),
      signal,
    );
    if (
      !format.codec &&
      !format.sampleRate &&
      !format.numberOfChannels &&
      !format.duration
    ) {
      throw new Error("No readable audio stream metadata was found.");
    }

    return {
      id,
      path: filePath,
      name: path.basename(filePath),
      extension: path.extname(filePath).slice(1).toUpperCase(),
      sizeBytes: stat.size,
      durationSeconds: format.duration ?? null,
      codec: format.codec ?? format.container ?? "Unknown",
      container: format.container ?? "Unknown",
      codecProfile: format.codecProfile ?? null,
      encoder: format.tool ?? null,
      lossless: format.lossless ?? null,
      bitrate: format.bitrate ?? null,
      overallFileBitrate:
        format.duration && format.duration > 0
          ? (stat.size * 8) / format.duration
          : null,
      sampleRate: format.sampleRate ?? null,
      bitDepth: format.bitsPerSample ?? null,
      channels: format.numberOfChannels ?? null,
      channelMode: null,
      bitrateMode: null,
      metadata: metadataInventory,
      scanError,
      oracle: notAnalyzedOracleResult(scanError),
    };
  } catch (error) {
    throwIfCanceled(signal);
    scanError = error instanceof Error ? error.message : "Unknown parsing error";
    return {
      id,
      path: filePath,
      name: path.basename(filePath),
      extension: path.extname(filePath).slice(1).toUpperCase(),
      sizeBytes: stat.size,
      durationSeconds: null,
      codec: "Unknown",
      container: "Unknown",
      codecProfile: null,
      encoder: null,
      lossless: null,
      bitrate: null,
      overallFileBitrate: null,
      sampleRate: null,
      bitDepth: null,
      channels: null,
      channelMode: null,
      bitrateMode: null,
      metadata: emptyMetadataInventory,
      scanError,
      oracle: notAnalyzedOracleResult(scanError),
    };
  }
}

export async function scanSources(
  source: AudioSourceSelection,
  onProgress?: (progress: ScanProgressUpdate) => void,
  options?: {
    signal?: AbortSignal;
    cache?: OracleRecordCache;
    analyzeFile?: (
      filePath: string,
      signal?: AbortSignal,
    ) => Promise<OracleResult>;
    onDiscovered?: (
      filePaths: string[],
      warnings: string[],
    ) => void | Promise<void>;
    onFileStarted?: (filePath: string) => void | Promise<void>;
    onFileStored?: (
      file: AudioFileRecord,
      ordinal: number,
      fromCache: boolean,
    ) => void | Promise<void>;
    waitIfPaused?: () => Promise<void>;
    concurrency?: number;
    recoveryQuarantine?: ReadonlyMap<string, string>;
    bypassCachePaths?: ReadonlySet<string>;
    compactResults?: boolean;
    classifyStorage?: (filePath: string) => SourceStorageKind;
    stageFile?: (
      filePath: string,
      signal?: AbortSignal,
      storageKind?: SourceStorageKind,
      onTransferProgress?: (
        transferredBytes: number,
        totalBytes: number,
      ) => void,
    ) => Promise<StagedSourceFile>;
    automaticAlbumReplayGainFileLimit?: number;
    nearFingerprintRelationshipFileLimit?: number;
  },
): Promise<ScanSelectionResult> {
  throwIfCanceled(options?.signal);
  const warnings: string[] = [];
  const discovered: string[] = [];
  const checksumManifests = new Set<string>();
  const inventoryOnly = source.mode === "metadata-inventory";
  const automaticAlbumReplayGainFileLimit = Math.max(
    0,
    Math.trunc(
      options?.automaticAlbumReplayGainFileLimit ??
        DEFAULT_AUTOMATIC_ALBUM_REPLAYGAIN_FILE_LIMIT,
    ),
  );
  const nearFingerprintRelationshipFileLimit = Math.max(
    0,
    Math.trunc(
      options?.nearFingerprintRelationshipFileLimit ??
        DEFAULT_NEAR_FINGERPRINT_RELATIONSHIP_FILE_LIMIT,
    ),
  );

  for (const selectedPath of source.paths) {
    throwIfCanceled(options?.signal);
    try {
      const stat = await abortable(fs.stat(selectedPath), options?.signal);
      if (stat.isDirectory()) {
        discovered.push(
          ...(await collectAudioFiles(
            selectedPath,
            warnings,
            checksumManifests,
            options?.signal,
          )),
        );
      } else if (
        stat.isFile() &&
        supportedExtensions.has(path.extname(selectedPath).toLowerCase())
      ) {
        discovered.push(selectedPath);
        await collectNearbyChecksumManifests(
          selectedPath,
          checksumManifests,
          warnings,
          options?.signal,
        );
      } else {
        warnings.push(`${selectedPath}: unsupported file type`);
      }
    } catch (error) {
      throwIfCanceled(options?.signal);
      warnings.push(sourceReadError(selectedPath, error));
    }
  }

  const filePaths = [...new Set(discovered.map((entry) => path.resolve(entry)))]
    .sort((left, right) => {
      const byName = path.basename(left).localeCompare(path.basename(right));
      return byName || left.localeCompare(right);
    });
  const filesByIndex: Array<AudioFileRecord | undefined> = Array(
    filePaths.length,
  );
  const checksumEntries = await loadChecksumEntries(
    inventoryOnly ? new Set<string>() : checksumManifests,
    warnings,
    options?.signal,
  );
  const checksumEntriesByPath = new Map<string, ChecksumManifestEntry[]>();
  for (const entry of checksumEntries) {
    const resolvedPath = path.resolve(entry.filePath);
    const existing = checksumEntriesByPath.get(resolvedPath);
    if (existing) existing.push(entry);
    else checksumEntriesByPath.set(resolvedPath, [entry]);
  }
  await options?.onDiscovered?.(filePaths, warnings);
  onProgress?.({
    phase: "discovered",
    completed: 0,
    total: filePaths.length,
    currentFile: null,
    file: null,
    fromCache: false,
  });

  const concurrency = Math.max(
    1,
    Math.min(8, Math.trunc(options?.concurrency ?? 2)),
  );
  let nextIndex = 0;
  let completed = 0;
  const analyzeAtIndex = async (index: number): Promise<void> => {
    throwIfCanceled(options?.signal);
    const filePath = filePaths[index];
    await abortable(
      Promise.resolve(options?.onFileStarted?.(filePath)),
      options?.signal,
    );
    onProgress?.({
      phase: "processing",
      completed,
      total: filePaths.length,
      currentFile: path.basename(filePath),
      file: null,
      fromCache: false,
    });
    const delayedActivityTimer = setTimeout(() => {
      onProgress?.({
        phase: "processing",
        completed,
        total: filePaths.length,
        currentFile: path.basename(filePath),
        file: null,
        fromCache: false,
        activity: {
          state: "delayed",
          elapsedSeconds: 60,
          explanation:
            `${path.basename(filePath)} is taking longer than usual. The watchdog remains active and cancellation is available.`,
        },
      });
    }, 60_000);
    delayedActivityTimer.unref();
    try {
      const analyzed = await (async () => {
        const cached =
          inventoryOnly ||
          options?.bypassCachePaths?.has(path.resolve(filePath))
          ? null
          : await abortable(
              Promise.resolve(options?.cache?.get(filePath) ?? null),
              options?.signal,
            );
        if (
          cached &&
          cached.oracle.engineVersion === currentOracleEngineVersion &&
          (cached.oracle.analysisState === "completed" ||
            cached.oracle.analysisState === "failed" ||
            (cached.oracle.analysisState === undefined &&
              cached.oracle.measurements !== null))
        ) {
          let restored = attachMetadataProvenance(
            normalizeAudioRecordFormat(cached),
          );
          restored = attachDiscVerificationEligibility(restored);
          restored = await attachExternalIdentityEvidence(
            restored,
            source,
            options?.signal,
          );
          restored = discloseDeferredAlbumReplayGain(
            restored,
            filePaths.length,
            automaticAlbumReplayGainFileLimit,
          );
          return {
            file: await attachExternalChecksumEvidence(
              restored,
              checksumEntriesByPath,
              options?.signal,
            ),
            fromCache: true,
          };
        }
        const inspected = await inspectAudioFile(filePath, options?.signal);
        const recoveryReason = options?.recoveryQuarantine?.get(
          path.resolve(filePath),
        );
        if (!inventoryOnly && recoveryReason) {
          return {
            file: normalizeAudioRecordFormat({
              ...inspected,
              scanError: null,
              oracle: recoveryQuarantinedOracleResult(recoveryReason),
            }),
            fromCache: false,
          };
        }
        if (inventoryOnly) {
          return {
            file: normalizeAudioRecordFormat(inspected),
            fromCache: false,
          };
        }
        const storageKind =
          options?.classifyStorage?.(filePath) ??
          classifySourceStorage(filePath);
        if (storageKind !== "local") {
          onProgress?.({
            phase: "staging",
            completed,
            total: filePaths.length,
            currentFile: path.basename(filePath),
            file: null,
            fromCache: false,
          });
        }
        const staged = await (options?.stageFile ?? stageSourceFile)(
          filePath,
          options?.signal,
          storageKind,
          (transferredBytes, totalBytes) => {
            onProgress?.({
              phase: "staging",
              completed,
              total: filePaths.length,
              currentFile: path.basename(filePath),
              file: null,
              fromCache: false,
              sourceIo: {
                storageKind,
                staged: false,
                sizeBytes: totalBytes,
                transferredBytes,
                explanation:
                  "Transferring this mounted source once before repeated local analysis.",
              },
            });
          },
        );
        if (storageKind !== "local") {
          onProgress?.({
            phase: "staging",
            completed,
            total: filePaths.length,
            currentFile: path.basename(filePath),
            file: null,
            fromCache: false,
            sourceIo: {
              storageKind: staged.storageKind,
              staged: staged.staged,
              sizeBytes: staged.sizeBytes,
              transferredBytes: staged.staged
                ? staged.sizeBytes
                : undefined,
              explanation: staged.explanation,
            },
          });
        }
        try {
          const oracle = restoreOracleSourcePath(
            await (options?.analyzeFile ?? analyzeAudioFile)(
              staged.analysisPath,
              options?.signal,
            ),
            staged.analysisPath,
            filePath,
          );
          const technical = oracle.technical;
          if (technical) technical.metadata = inspected.metadata;
          if (
            inspected.metadata.cueSheet.tracks.length > 0 &&
            (technical?.sampleRate ?? inspected.sampleRate) &&
            (technical?.channels ?? inspected.channels)
          ) {
            oracle.cueTracks = await analyzeCueTracks(
              inspected.metadata.cueSheet.tracks.map((track) => ({
                ...track,
                sourcePath: staged.analysisPath,
              })),
              (technical?.sampleRate ?? inspected.sampleRate)!,
              (technical?.channels ?? inspected.channels)!,
              options?.signal,
            );
          }
          let file = normalizeAudioRecordFormat({
            ...inspected,
            codec: technical?.codecLongName ?? inspected.codec,
            container: technical?.container ?? inspected.container,
            codecProfile: technical?.profile ?? inspected.codecProfile,
            durationSeconds: technical?.durationSeconds ?? inspected.durationSeconds,
            bitrate: technical?.streamBitrate ?? inspected.bitrate,
            sampleRate: technical?.sampleRate ?? inspected.sampleRate,
            bitDepth: technical?.bitsPerRawSample ?? inspected.bitDepth,
            channels: technical?.channels ?? inspected.channels,
            channelMode: technical?.channelLayout ?? inspected.channelMode,
            bitrateMode: technical?.bitrateMode ?? inspected.bitrateMode,
            scanError: oracle.measurements ? null : inspected.scanError,
            oracle,
          });
          file = attachMetadataProvenance(file);
          file = attachDiscVerificationEligibility(file);
          file = discloseDeferredAlbumReplayGain(
            file,
            filePaths.length,
            automaticAlbumReplayGainFileLimit,
          );
          file = await attachExternalIdentityEvidence(
            file,
            source,
            options?.signal,
          );
          await abortable(
            Promise.resolve(options?.cache?.set(file)),
            options?.signal,
          );
          return {
            file: await attachExternalChecksumEvidence(
              file,
              checksumEntriesByPath,
              options?.signal,
              staged.analysisPath,
            ),
            fromCache: false,
          };
        } finally {
          await staged.cleanup();
        }
        })();
      let { file: baseFile } = analyzed;
      const { fromCache } = analyzed;
      if (
        !inventoryOnly &&
        externalIdentityEvidencePending(baseFile, source)
      ) {
        baseFile = await attachExternalIdentityEvidence(
          baseFile,
          source,
          options?.signal,
        );
        await abortable(
          Promise.resolve(options?.cache?.set(baseFile)),
          options?.signal,
        );
      }
      const file = {
        ...baseFile,
        oracle: applyDeliveryProfile(
          baseFile.oracle,
          source.deliveryProfile,
        ),
      };
      await abortable(
        Promise.resolve(options?.onFileStored?.(file, index, fromCache)),
        options?.signal,
      );
      const resultFile = options?.compactResults
        ? compactAudioFileRecord(file)
        : file;
      filesByIndex[index] = resultFile;
      completed += 1;
      onProgress?.({
        phase: inventoryOnly ? "inventorying" : "analyzing",
        completed,
        total: filePaths.length,
        currentFile: resultFile.name,
        file: resultFile,
        fromCache,
      });
    } finally {
      clearTimeout(delayedActivityTimer);
    }
  };
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, filePaths.length)) },
    async () => {
      while (true) {
        if (options?.signal?.aborted) {
          throw new Error("Audio analysis canceled.");
        }
        await options?.waitIfPaused?.();
        if (options?.signal?.aborted) {
          throw new Error("Audio analysis canceled.");
        }
        const index = nextIndex;
        nextIndex += 1;
        if (index >= filePaths.length) return;
        await analyzeAtIndex(index);
      }
    },
  );
  await Promise.all(workers);
  let files = filesByIndex.filter(
    (file): file is AudioFileRecord => file !== undefined,
  );
  if (!inventoryOnly) {
    const albumReplayGainDeferred =
      files.length > automaticAlbumReplayGainFileLimit;
    onProgress?.({
      phase: "finalizing",
      completed: files.length,
      total: filePaths.length,
      currentFile: null,
      file: null,
      fromCache: false,
      finalization: {
        stage: "album-replaygain",
        completed: albumReplayGainDeferred ? 1 : 0,
        total: 1,
        explanation: albumReplayGainDeferred
          ? `Album ReplayGain was deferred because this audit contains ${files.length.toLocaleString()} files. Track ReplayGain remains available; audit a specific album or a source with ${automaticAlbumReplayGainFileLimit.toLocaleString()} files or fewer for exact album gain.`
          : "Calculating exact album ReplayGain across eligible album groups.",
      },
    });
    const beforeAlbumGain = files;
    files = await attachAlbumReplayGain(
      files,
      options?.signal,
      warnings,
      automaticAlbumReplayGainFileLimit,
    );
    await Promise.all(
      files.flatMap((file, index) =>
        file === beforeAlbumGain[index]
          ? []
          : [
              abortable(
                Promise.resolve(options?.cache?.set(file)),
                options?.signal,
              ),
              abortable(
                Promise.resolve(options?.onFileStored?.(file, index, false)),
                options?.signal,
              ),
            ],
      ),
    );
  }
  const nearRelationshipsDeferred =
    files.length > nearFingerprintRelationshipFileLimit;
  onProgress?.({
    phase: "finalizing",
    completed: files.length,
    total: filePaths.length,
    currentFile: null,
    file: null,
    fromCache: false,
    finalization: {
      stage: "fingerprint-relationships",
      completed: 0,
      total: 1,
      explanation: nearRelationshipsDeferred
        ? `Linking exact Chromaprint duplicates. Near-match expansion is deferred above ${nearFingerprintRelationshipFileLimit.toLocaleString()} files to keep finalization bounded.`
        : "Linking exact and near-match Chromaprint relationships.",
    },
  });
  const filesBeforeRelationships = files;
  files = await attachFingerprintRelationships(
    filesBeforeRelationships,
    {
      cache: options?.cache,
      signal: options?.signal,
      nearRelationshipFileLimit: nearFingerprintRelationshipFileLimit,
      warnings,
      onProgress: (completed, total, explanation) =>
        onProgress?.({
          phase: "finalizing",
          completed: files.length,
          total: filePaths.length,
          currentFile: null,
          file: null,
          fromCache: false,
          finalization: {
            stage: "fingerprint-relationships",
            completed,
            total,
            explanation,
          },
        }),
    },
  );
  await Promise.all(
    files.flatMap((file, index) =>
      file === filesBeforeRelationships[index]
        ? []
        : [
            abortable(
              Promise.resolve(options?.onFileStored?.(file, index, false)),
              options?.signal,
            ),
          ],
    ),
  );

  const result = {
    source,
    scannedAt: new Date().toISOString(),
    files,
    unreadableCount: files.filter(
      (file) =>
        file.oracle.analysisState === "failed" ||
        file.oracle.verdict === "damaged",
    ).length,
    warnings,
  };
  onProgress?.({
    phase: "complete",
    completed: files.length,
    total: filePaths.length,
    currentFile: null,
    file: null,
    fromCache: false,
  });
  return result;
}
