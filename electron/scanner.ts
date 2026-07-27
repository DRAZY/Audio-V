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
import { analyzeAudioFile } from "./oracle/oracle-engine";
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

function metadataOnlyOracleResult(scanError: string | null): OracleResult {
  if (scanError) {
    return {
      schemaVersion: 1,
      engineVersion: "0.1.0",
      scope: "metadata-only",
      verdict: "inconclusive",
      confidence: null,
      headline: "Metadata unavailable",
      interpretation:
        "The metadata probe could not parse this file. That is not proof of stream damage; a full decode test has not run yet.",
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
    engineVersion: "0.1.0",
    scope: "metadata-only",
    verdict: "inconclusive",
    confidence: null,
    headline: "Metadata inspection complete",
    interpretation:
      "Technical metadata was discovered successfully. This file's codec is not decoded by the current engine, so Audio-V has not made a signal-integrity or fidelity claim.",
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
      scanError,
      oracle: metadataOnlyOracleResult(scanError),
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
      scanError,
      oracle: metadataOnlyOracleResult(scanError),
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
    checksumManifests,
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
        const cached = await options?.cache?.get(filePath);
        if (cached) {
          return {
            file: await attachExternalChecksumEvidence(
              normalizeAudioRecordFormat(cached),
              checksumEntriesByPath,
            ),
            fromCache: true,
          };
        }
        const inspected = await inspectAudioFile(filePath);
        const oracle = await (options?.analyzeFile ?? analyzeAudioFile)(
          inspected.path,
          options?.signal,
        );
        const technical = oracle.technical;
        const file = normalizeAudioRecordFormat({
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
        phase: "analyzing",
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
  const files = filesByIndex.filter(
    (file): file is AudioFileRecord => file !== undefined,
  );

  const result = {
    source,
    scannedAt: new Date().toISOString(),
    files,
    unreadableCount: files.filter(
      (file) => file.oracle.verdict === "damaged",
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
