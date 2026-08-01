import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ChecksumAlgorithm,
  ExternalChecksumVerification,
} from "../shared/contracts";

const manifestExtensions = new Set([
  ".md5",
  ".sha",
  ".sha1",
  ".sha256",
  ".sha512",
]);

export interface ChecksumManifestEntry {
  algorithm: ChecksumAlgorithm;
  expected: string;
  filePath: string;
  manifestPath: string;
}

function algorithmForHash(hash: string): ChecksumAlgorithm | null {
  if (/^[a-f0-9]{32}$/i.test(hash)) return "md5";
  if (/^[a-f0-9]{40}$/i.test(hash)) return "sha1";
  if (/^[a-f0-9]{64}$/i.test(hash)) return "sha256";
  if (/^[a-f0-9]{128}$/i.test(hash)) return "sha512";
  return null;
}

function fallbackAlgorithm(manifestPath: string): ChecksumAlgorithm | null {
  const extension = path.extname(manifestPath).toLowerCase();
  if (extension === ".md5") return "md5";
  if (extension === ".sha" || extension === ".sha1") return "sha1";
  if (extension === ".sha256") return "sha256";
  if (extension === ".sha512") return "sha512";
  return null;
}

function resolveListedFile(manifestPath: string, listedName: string): string {
  const normalizedName =
    path.sep === "\\" ? listedName : listedName.replaceAll("\\", "/");
  return path.resolve(path.dirname(manifestPath), normalizedName);
}

export function isChecksumManifest(filePath: string): boolean {
  return manifestExtensions.has(path.extname(filePath).toLowerCase());
}

export function parseChecksumManifest(
  manifestPath: string,
  contents: string,
): ChecksumManifestEntry[] {
  const entries: ChecksumManifestEntry[] = [];
  const singleFileName = path.basename(
    manifestPath,
    path.extname(manifestPath),
  );

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    const bsdMatch = line.match(
      /^(MD5|SHA1|SHA256|SHA512)\s*\((.+)\)\s*=\s*([a-f0-9]+)$/iu,
    );
    if (bsdMatch) {
      const algorithm = algorithmForHash(bsdMatch[3]);
      if (algorithm) {
        entries.push({
          algorithm,
          expected: bsdMatch[3].toLowerCase(),
          filePath: resolveListedFile(manifestPath, bsdMatch[2]),
          manifestPath,
        });
      }
      continue;
    }

    const gnuMatch = line.match(/^([a-f0-9]+)\s+[* ]?(.+)$/iu);
    if (gnuMatch) {
      const algorithm = algorithmForHash(gnuMatch[1]);
      if (algorithm) {
        entries.push({
          algorithm,
          expected: gnuMatch[1].toLowerCase(),
          filePath: resolveListedFile(manifestPath, gnuMatch[2]),
          manifestPath,
        });
      }
      continue;
    }

    const algorithm = algorithmForHash(line) ?? fallbackAlgorithm(manifestPath);
    if (algorithm && /^[a-f0-9]+$/iu.test(line)) {
      entries.push({
        algorithm,
        expected: line.toLowerCase(),
        filePath: resolveListedFile(manifestPath, singleFileName),
        manifestPath,
      });
    }
  }

  return entries;
}

export async function readChecksumManifest(
  manifestPath: string,
): Promise<ChecksumManifestEntry[]> {
  return parseChecksumManifest(
    manifestPath,
    await fs.readFile(manifestPath, "utf8"),
  );
}

async function hashFile(
  filePath: string,
  algorithms: ChecksumAlgorithm[],
  signal?: AbortSignal,
): Promise<Map<ChecksumAlgorithm, string>> {
  if (algorithms.length === 0) return new Map();
  const hashes = new Map(
    [...new Set(algorithms)].map((algorithm) => [
      algorithm,
      createHash(algorithm),
    ]),
  );
  for await (const chunk of createReadStream(filePath, { signal })) {
    for (const hash of hashes.values()) hash.update(chunk);
  }
  return new Map(
    [...hashes].map(([algorithm, hash]) => [algorithm, hash.digest("hex")]),
  );
}

/**
 * Verify a file against the checksum manifest entries that name it.
 *
 * Two distinct paths are involved and they are not always the same file:
 *
 * - `matchPath` is the file's identity, the location a manifest refers to. It
 *   decides which entries apply.
 * - `filePath` is where the bytes are actually read from. The scanner may hand
 *   over a staged temp copy instead of the original, which is what
 *   stageSourceFile produces for slow or remote storage.
 *
 * These used to be one parameter. When the caller passed a staged copy, entries
 * naming the original were filtered against the temp path, matched nothing, and
 * the function returned an empty list. That reads as "this file has no manifest"
 * rather than as an error, so sidecar verification silently did nothing on any
 * platform where staging kicked in. Keeping them separate is what prevents that.
 */
export async function verifyChecksumEntries(
  filePath: string,
  entries: ChecksumManifestEntry[],
  knownHashes: Partial<Record<ChecksumAlgorithm, string>> = {},
  signal?: AbortSignal,
  matchPath: string = filePath,
): Promise<ExternalChecksumVerification[]> {
  const resolvedFile = path.resolve(matchPath);
  const relevant = entries.filter(
    (entry) => path.resolve(entry.filePath) === resolvedFile,
  );
  if (relevant.length === 0) return [];

  const missingAlgorithms = relevant
    .map((entry) => entry.algorithm)
    .filter((algorithm) => !knownHashes[algorithm]);
  const calculated = await hashFile(
    filePath,
    missingAlgorithms,
    signal,
  );
  return relevant.map((entry) => {
    const actual =
      knownHashes[entry.algorithm] ?? calculated.get(entry.algorithm)!;
    return {
      algorithm: entry.algorithm,
      expected: entry.expected,
      calculated: actual,
      manifestPath: entry.manifestPath,
      status: actual === entry.expected ? "verified" : "mismatch",
    };
  });
}
