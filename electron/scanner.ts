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

const supportedExtensions = new Set<string>(AUDIO_EXTENSIONS);

export interface OracleRecordCache {
  get(filePath: string): Promise<AudioFileRecord | null>;
  set(record: AudioFileRecord): Promise<void>;
  flush(): Promise<void>;
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

function attachFingerprintRelationships(files: AudioFileRecord[]): AudioFileRecord[] {
  return files.map((file, index) => {
    const technical = file.oracle.technical;
    if (!technical || technical.fingerprint.status !== "measured") return file;
    const matches = files.flatMap((candidate, candidateIndex) => {
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
      }];
    });
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
  });
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
  const filesBeforeRelationships = files;
  files = attachFingerprintRelationships(filesBeforeRelationships);
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
