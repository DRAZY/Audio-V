import { createReadStream, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export type SourceStorageKind =
  | "local"
  | "network"
  | "removable-or-mounted";

export interface StagedSourceFile {
  analysisPath: string;
  storageKind: SourceStorageKind;
  staged: boolean;
  sizeBytes: number;
  explanation: string;
  cleanup(): Promise<void>;
}

const transferBufferBytes = 4 * 1024 * 1024;
const maximumStagedFileBytes = 16 * 1024 * 1024 * 1024;
const stagingPrefix = "audio-v-source-";
let reservedStagingBytes = 0;
let staleCleanup: Promise<void> | null = null;

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EPERM",
    );
  }
}

async function cleanupStaleStagingDirectories(): Promise<void> {
  const temporaryRoot = tmpdir();
  const entries = await fs
    .readdir(temporaryRoot, { withFileTypes: true })
    .catch(() => []);
  await Promise.all(
    entries.flatMap((entry) => {
      const match = entry.isDirectory()
        ? new RegExp(`^${stagingPrefix}(\\d+)-`, "u").exec(entry.name)
        : null;
      if (!match) return [];
      const ownerPid = Number(match[1]);
      if (ownerPid === process.pid || processIsRunning(ownerPid)) return [];
      return [
        fs
          .rm(path.join(temporaryRoot, entry.name), {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 100,
          })
          .catch(() => undefined),
      ];
    }),
  );
}

export function classifySourceStorage(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
  systemDrive = process.env.SystemDrive ?? "C:",
): SourceStorageKind {
  if (platform === "win32") {
    const normalized = path.win32.normalize(filePath);
    if (normalized.startsWith("\\\\")) return "network";
    const root = path.win32.parse(normalized).root.replace(/[\\/]$/u, "");
    return root &&
      root.toLocaleLowerCase("en-US") !==
        systemDrive.replace(/[\\/]$/u, "").toLocaleLowerCase("en-US")
      ? "removable-or-mounted"
      : "local";
  }
  const normalized = path.posix.normalize(filePath);
  if (
    (platform === "darwin" && normalized.startsWith("/Volumes/")) ||
    (platform === "linux" &&
      ["/media/", "/mnt/", "/run/media/"].some((prefix) =>
        normalized.startsWith(prefix),
      ))
  ) {
    return "removable-or-mounted";
  }
  return "local";
}

function canceled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Audio analysis canceled.");
}

export async function stageSourceFile(
  filePath: string,
  signal?: AbortSignal,
  storageKind = classifySourceStorage(filePath),
  onTransferProgress?: (transferredBytes: number, totalBytes: number) => void,
): Promise<StagedSourceFile> {
  const source = path.resolve(filePath);
  const stat = await fs.stat(source);
  const direct = (explanation: string): StagedSourceFile => ({
    analysisPath: source,
    storageKind,
    staged: false,
    sizeBytes: stat.size,
    explanation,
    cleanup: async () => undefined,
  });
  if (storageKind === "local") {
    return direct("The source is on local storage; Audio-V analyzes it in place.");
  }
  canceled(signal);
  staleCleanup ??= cleanupStaleStagingDirectories();
  await staleCleanup;
  const temporaryRoot = tmpdir();
  const capacity = await fs.statfs(temporaryRoot).catch(() => null);
  const availableBytes = capacity
    ? Number(capacity.bavail) * Number(capacity.bsize)
    : Number.POSITIVE_INFINITY;
  const unreservedBytes = Math.max(0, availableBytes - reservedStagingBytes);
  if (
    stat.size > maximumStagedFileBytes ||
    stat.size > unreservedBytes * 0.5
  ) {
    return direct(
      "Local staging was skipped because the file exceeds the safe temporary-space budget.",
    );
  }

  const directory = await fs.mkdtemp(
    path.join(temporaryRoot, `${stagingPrefix}${process.pid}-`),
  );
  reservedStagingBytes += stat.size;
  let reservationHeld = true;
  const releaseReservation = () => {
    if (!reservationHeld) return;
    reservationHeld = false;
    reservedStagingBytes = Math.max(0, reservedStagingBytes - stat.size);
  };
  const stagedPath = path.join(
    directory,
    `source${path.extname(source).toLocaleLowerCase()}`,
  );
  try {
    let transferredBytes = 0;
    const sourceStream = createReadStream(source, {
      highWaterMark: transferBufferBytes,
    });
    sourceStream.on("data", (chunk: string | Buffer) => {
      transferredBytes +=
        typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      onTransferProgress?.(transferredBytes, stat.size);
    });
    await pipeline(
      sourceStream,
      createWriteStream(stagedPath, { highWaterMark: transferBufferBytes }),
      { signal },
    );
    canceled(signal);
    return {
      analysisPath: stagedPath,
      storageKind,
      staged: true,
      sizeBytes: stat.size,
      explanation:
        "Audio-V copied this mounted source once with a 4 MB sequential transfer buffer, then performs repeated decode and forensic passes against local temporary storage.",
      cleanup: async () => {
        releaseReservation();
        await fs
          .rm(directory, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 100,
          })
          .catch(() => undefined);
      },
    };
  } catch (error) {
    releaseReservation();
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
    canceled(signal);
    return direct(
      `Local staging was unavailable, so Audio-V analyzed the mounted source directly (${error instanceof Error ? error.message : "copy failed"}).`,
    );
  }
}
