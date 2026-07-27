import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseFile } from "music-metadata";
import {
  AUDIO_EXTENSIONS,
  type AudioSourceSelection,
  type AudioFileRecord,
  type OracleResult,
  type ScanProgressUpdate,
  type ScanSelectionResult,
  type FingerprintIndexCandidate,
} from "../shared/contracts";
import {
  analyzeAudioFile,
  engineVersion as currentOracleEngineVersion,
} from "./oracle/oracle-engine";
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
  metadataProvenanceIndicators,
} from "./oracle/analysis-tools";
import { analyzeCueTracks } from "./oracle/cue-track-analyzer";
import { measureAlbumReplayGain } from "./oracle/album-replaygain";

const supportedExtensions = new Set<string>(AUDIO_EXTENSIONS);

export interface OracleRecordCache {
  get(filePath: string): Promise<AudioFileRecord | null>;
  set(record: AudioFileRecord): Promise<void>;
  flush(): Promise<void>;
  findFingerprintCandidates?(
    filePath: string,
    limit?: number,
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

async function collectAudioFiles(
  root: string,
  warnings: string[],
  checksumManifests?: Set<string>,
): Promise<string[]> {
  const discovered: string[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;

    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      warnings.push(
        `${current}: ${error instanceof Error ? error.message : "Directory could not be read"}`,
      );
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      } else if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (
        entry.isFile() &&
        supportedExtensions.has(path.extname(entry.name).toLowerCase())
      ) {
        discovered.push(entryPath);
      } else if (entry.isFile() && isChecksumManifest(entryPath)) {
        checksumManifests?.add(entryPath);
      }
    }
  }

  return discovered.sort((left, right) => left.localeCompare(right));
}

async function collectNearbyChecksumManifests(
  filePath: string,
  checksumManifests: Set<string>,
  warnings: string[],
): Promise<void> {
  try {
    const entries = await fs.readdir(path.dirname(filePath), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.isFile()) {
        const entryPath = path.join(path.dirname(filePath), entry.name);
        if (isChecksumManifest(entryPath)) checksumManifests.add(entryPath);
      }
    }
  } catch (error) {
    warnings.push(
      `${path.dirname(filePath)}: ${error instanceof Error ? error.message : "Checksum manifests could not be discovered"}`,
    );
  }
}

async function loadChecksumEntries(
  manifestPaths: Set<string>,
  warnings: string[],
): Promise<ChecksumManifestEntry[]> {
  const entries: ChecksumManifestEntry[] = [];
  for (const manifestPath of [...manifestPaths].sort()) {
    try {
      const parsed = await readChecksumManifest(manifestPath);
      if (parsed.length === 0) {
        warnings.push(`${manifestPath}: no supported checksum entries found`);
      } else {
        entries.push(...parsed);
      }
    } catch (error) {
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
): Promise<AudioFileRecord> {
  if (!file.oracle.technical) return file;
  const relevantEntries = entriesByPath.get(path.resolve(file.path)) ?? [];
  const externalChecksums = await verifyChecksumEntries(
    file.path,
    relevantEntries,
    { sha256: file.oracle.technical.fileSha256 },
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
      confidence: mismatch && !alreadyDamaged ? 100 : file.oracle.confidence,
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
    },
  };
}

function attachMetadataProvenance(file: AudioFileRecord): AudioFileRecord {
  const technical = file.oracle.technical;
  if (!technical) return file;
  const metadataIndicators = metadataProvenanceIndicators(
    file.metadata.tags,
    [],
    technical.contentCredentials,
  ).filter((item) => item.type === "generator-metadata");
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
  const canPromoteToReview = ["verified", "authentic"].includes(
    file.oracle.verdict,
  );
  return {
    ...file,
    oracle: {
      ...file.oracle,
      verdict: canPromoteToReview ? "review" : file.oracle.verdict,
      headline: canPromoteToReview
        ? "Generator metadata requires review"
        : file.oracle.headline,
      interpretation: canPromoteToReview
        ? "The file contains editable metadata naming a known generative tool or service. This is an inventory indicator, not proof that the decoded audio was generated by that tool."
        : file.oracle.interpretation,
      evidence: [
        ...file.oracle.evidence.filter(
          (item) => !item.id.startsWith("generator-metadata-"),
        ),
        ...metadataIndicators.map((indicator, index) => ({
          id: `generator-metadata-${index}`,
          label: `Generator metadata · ${indicator.identifier}`,
          summary: `${indicator.source}: ${indicator.value}. ${indicator.interpretation}`,
          kind: "heuristic" as const,
          disposition: "contradicts" as const,
        })),
      ],
      technical: { ...technical, metadata: file.metadata, provenanceIndicators },
    },
  };
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

async function attachAlbumReplayGain(
  files: AudioFileRecord[],
  signal?: AbortSignal,
  warnings?: string[],
): Promise<AudioFileRecord[]> {
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

async function attachFingerprintRelationships(
  files: AudioFileRecord[],
  cache?: OracleRecordCache,
): Promise<AudioFileRecord[]> {
  return Promise.all(files.map(async (file, index) => {
    const technical = file.oracle.technical;
    if (!technical || technical.fingerprint.status !== "measured") return file;
    const currentMatches = files.flatMap((candidate, candidateIndex) => {
      if (candidateIndex === index) return [];
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
    const historical = cache?.findFingerprintCandidates
      ? await cache.findFingerprintCandidates(file.path)
      : [];
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
  }));
}

export async function inspectAudioFile(filePath: string): Promise<AudioFileRecord> {
  const stat = await fs.stat(filePath);
  const id = createHash("sha256")
    .update(`${filePath}\0${stat.size}\0${stat.mtimeMs}`)
    .digest("hex")
    .slice(0, 20);
  let scanError: string | null = null;

  try {
    const metadata = await parseFile(filePath, {
      duration: true,
      skipCovers: true,
    });
    const format = metadata.format;
    const metadataInventory = await buildMetadataInventory(filePath, metadata);
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
    onFileStored?: (
      file: AudioFileRecord,
      ordinal: number,
      fromCache: boolean,
    ) => void | Promise<void>;
    waitIfPaused?: () => Promise<void>;
    concurrency?: number;
  },
): Promise<ScanSelectionResult> {
  const warnings: string[] = [];
  const discovered: string[] = [];
  const checksumManifests = new Set<string>();
  const inventoryOnly = source.mode === "metadata-inventory";

  for (const selectedPath of source.paths) {
    try {
      const stat = await fs.stat(selectedPath);
      if (stat.isDirectory()) {
        discovered.push(
          ...(await collectAudioFiles(
            selectedPath,
            warnings,
            checksumManifests,
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
        );
      } else {
        warnings.push(`${selectedPath}: unsupported file type`);
      }
    } catch (error) {
      warnings.push(
        `${selectedPath}: ${error instanceof Error ? error.message : "Source could not be read"}`,
      );
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
    const filePath = filePaths[index];
    const analyzed = await (async () => {
        const cached = inventoryOnly
          ? null
          : await options?.cache?.get(filePath);
        if (
          cached &&
          cached.oracle.engineVersion === currentOracleEngineVersion &&
          cached.oracle.analysisState !== "not-analyzed"
        ) {
          let restored = attachMetadataProvenance(
            normalizeAudioRecordFormat(cached),
          );
          if (
            source.externalLookup?.acoustIdEnabled &&
            source.externalLookup.acoustIdApiKey &&
            restored.oracle.technical
          ) {
            restored.oracle.technical.fingerprint.acoustIdLookup =
              await lookupAcoustId(
                restored.oracle.technical.fingerprint,
                source.externalLookup.acoustIdApiKey,
                options?.signal,
                restored.path,
              );
          }
          return {
            file: await attachExternalChecksumEvidence(
              restored,
              checksumEntriesByPath,
            ),
            fromCache: true,
          };
        }
        const inspected = await inspectAudioFile(filePath);
        if (inventoryOnly) {
          return {
            file: normalizeAudioRecordFormat(inspected),
            fromCache: false,
          };
        }
        const oracle = await (options?.analyzeFile ?? analyzeAudioFile)(
          inspected.path,
          options?.signal,
        );
        const technical = oracle.technical;
        if (technical) technical.metadata = inspected.metadata;
        if (
          inspected.metadata.cueSheet.tracks.length > 0 &&
          (technical?.sampleRate ?? inspected.sampleRate) &&
          (technical?.channels ?? inspected.channels)
        ) {
          oracle.cueTracks = await analyzeCueTracks(
            inspected.metadata.cueSheet.tracks,
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
        if (
          source.externalLookup?.acoustIdEnabled &&
          source.externalLookup.acoustIdApiKey &&
          file.oracle.technical
        ) {
          file.oracle.technical.fingerprint.acoustIdLookup =
            await lookupAcoustId(
              file.oracle.technical.fingerprint,
              source.externalLookup.acoustIdApiKey,
              options?.signal,
              file.path,
            );
        }
        await options?.cache?.set(file);
        return {
          file: await attachExternalChecksumEvidence(
            file,
            checksumEntriesByPath,
          ),
          fromCache: false,
        };
      })();
      const { file, fromCache } = analyzed;
      filesByIndex[index] = file;
      completed += 1;
      await options?.onFileStored?.(file, index, fromCache);
      onProgress?.({
        phase: inventoryOnly ? "inventorying" : "analyzing",
        completed,
        total: filePaths.length,
        currentFile: file.name,
        file,
        fromCache,
      });
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
    const beforeAlbumGain = files;
    files = await attachAlbumReplayGain(files, options?.signal, warnings);
    await Promise.all(
      files.flatMap((file, index) =>
        file === beforeAlbumGain[index]
          ? []
          : [
              options?.cache?.set(file),
              options?.onFileStored?.(file, index, false),
            ],
      ),
    );
  }
  const filesBeforeRelationships = files;
  files = await attachFingerprintRelationships(
    filesBeforeRelationships,
    options?.cache,
  );
  await Promise.all(
    files.flatMap((file, index) =>
      file === filesBeforeRelationships[index]
        ? []
        : [options?.onFileStored?.(file, index, false)],
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
