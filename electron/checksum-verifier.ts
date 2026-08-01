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
 * Resolve a path into a form safe to compare with `===`.
 *
 * Windows and macOS both use case-insensitive filesystems by default, so the
 * same file legitimately reaches us spelled differently: a manifest line saying
 * `Album\Track.flac` against a scan that walked `album\track.flac`, or a drive
 * letter that arrives as `d:\` from one source and `D:\` from another. A plain
 * `path.resolve(a) === path.resolve(b)` treats those as different files.
 *
 * That comparison gates whether a manifest entry is considered relevant at all,
 * so a miss did not surface as a mismatch, which the user would see. It returned
 * an empty list, and sidecar .md5/.sha256 verification silently reported nothing
 * on Windows while appearing to work.
 *
 * Case folding only where the platform is actually case-insensitive: doing it on
 * Linux would wrongly equate two genuinely distinct files.
 */
export function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" || process.platform === "darwin"
    ? resolved.toLowerCase()
    : resolved;
}

export async function verifyChecksumEntries(
  filePath: string,
  entries: ChecksumManifestEntry[],
  knownHashes: Partial<Record<ChecksumAlgorithm, string>> = {},
  signal?: AbortSignal,
): Promise<ExternalChecksumVerification[]> {
  const resolvedFile = comparablePath(filePath);
  const relevant = entries.filter(
    (entry) => comparablePath(entry.filePath) === resolvedFile,
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
