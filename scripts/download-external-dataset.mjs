import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  corpusDirectory,
  externalDatasetsPath,
  readJson,
  validateExternalDatasets,
  writeJson,
} from "./lib/validation-corpus.mjs";

function argumentsMap(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith("--") || values[index + 1] === undefined) {
      throw new Error(`Expected --name value arguments; received ${key ?? "(end)"}.`);
    }
    result.set(key.slice(2), values[index + 1]);
  }
  return result;
}

function required(args, name) {
  const value = args.get(name);
  if (!value) throw new Error(`Missing required --${name} value.`);
  return value;
}

function positiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${label} must be an integer from 1 through ${maximum}.`);
  }
  return parsed;
}

function archiveFilename(dataset) {
  if (dataset.official.archiveFilename) {
    return dataset.official.archiveFilename;
  }
  const basename = path.basename(new URL(dataset.official.archiveUrl).pathname);
  return basename === "content" ? `${dataset.id}.archive` : basename;
}

function rangePlan(totalBytes, partCount) {
  const partBytes = Math.ceil(totalBytes / partCount);
  const ranges = [];
  for (let start = 0, index = 0; start < totalBytes; start += partBytes, index += 1) {
    ranges.push({
      index,
      start,
      end: Math.min(totalBytes - 1, start + partBytes - 1),
    });
  }
  return ranges;
}

async function digestFile(filePath, algorithms) {
  const handle = await fs.open(filePath, "r");
  const hashes = Object.fromEntries(
    [...new Set(algorithms)].map((algorithm) => [
      algorithm,
      createHash(algorithm),
    ]),
  );
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  try {
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      for (const hash of Object.values(hashes)) {
        hash.update(buffer.subarray(0, bytesRead));
      }
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return Object.fromEntries(
    Object.entries(hashes).map(([algorithm, hash]) => [
      algorithm,
      hash.digest("hex"),
    ]),
  );
}

async function fetchRange(url, range, handle, signal) {
  const response = await fetch(url, {
    headers: { Range: `bytes=${range.start}-${range.end}` },
    redirect: "follow",
    signal,
  });
  if (response.status !== 206) {
    throw new Error(
      `Range ${range.index} returned HTTP ${response.status}; expected 206 Partial Content.`,
    );
  }
  const expectedContentRange = `bytes ${range.start}-${range.end}/`;
  const contentRange = response.headers.get("content-range") ?? "";
  if (!contentRange.startsWith(expectedContentRange)) {
    throw new Error(
      `Range ${range.index} returned unexpected Content-Range ${contentRange || "(missing)"}.`,
    );
  }
  if (!response.body) {
    throw new Error(`Range ${range.index} returned no response body.`);
  }
  let position = range.start;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    if (position + buffer.length - 1 > range.end) {
      throw new Error(`Range ${range.index} exceeded its declared byte boundary.`);
    }
    await handle.write(buffer, 0, buffer.length, position);
    position += buffer.length;
  }
  if (position !== range.end + 1) {
    throw new Error(
      `Range ${range.index} ended at byte ${position - 1}; expected ${range.end}.`,
    );
  }
}

const args = argumentsMap(process.argv.slice(2));
const datasetId = required(args, "dataset");
const concurrency = positiveInteger(args.get("concurrency") ?? "8", "--concurrency", 16);
const partCount = positiveInteger(args.get("parts") ?? "48", "--parts", 128);
const registry = await readJson(externalDatasetsPath);
const validation = validateExternalDatasets(registry);
if (validation.errors.length) throw new Error(validation.errors.join("\n"));
const dataset = registry.datasets.find((item) => item.id === datasetId);
if (!dataset) throw new Error(`Unknown external dataset ${datasetId}.`);
if (
  dataset.official.access !== "direct" ||
  !dataset.official.archiveUrl ||
  !dataset.official.archiveBytes
) {
  throw new Error(
    `${dataset.displayName} is not registered for direct, byte-bounded acquisition.`,
  );
}

const downloadDirectory = path.join(corpusDirectory, ".audio", "downloads");
const destination = path.join(
  downloadDirectory,
  args.get("file") ?? archiveFilename(dataset),
);
const progressPath = `${destination}.parts.json`;
const ranges = rangePlan(dataset.official.archiveBytes, partCount);
await fs.mkdir(downloadDirectory, { recursive: true });

let progress;
let newProgress = false;
try {
  progress = await readJson(progressPath);
  if (
    progress.datasetId !== datasetId ||
    progress.url !== dataset.official.archiveUrl ||
    progress.bytes !== dataset.official.archiveBytes ||
    progress.parts !== ranges.length
  ) {
    throw new Error(
      `Existing acquisition state does not match ${dataset.displayName}; remove ${progressPath} to restart.`,
    );
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  newProgress = true;
  progress = {
    schema: "Audio-V segmented external dataset acquisition v1",
    datasetId,
    url: dataset.official.archiveUrl,
    bytes: dataset.official.archiveBytes,
    parts: ranges.length,
    completed: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

if (newProgress) {
  try {
    const existing = await fs.stat(destination);
    if (existing.isFile() && existing.size > 0 && existing.size < dataset.official.archiveBytes) {
      progress.completed = ranges
        .filter((range) => range.end < existing.size)
        .map((range) => range.index);
      progress.resumedSequentialPrefixBytes = existing.size;
      console.log(
        `${dataset.displayName}: preserving ${progress.completed.length} complete segment(s) from an existing sequential partial download.`,
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

let handle;
try {
  handle = await fs.open(destination, "r+");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  handle = await fs.open(destination, "w+");
}
await handle.truncate(dataset.official.archiveBytes);
const completed = new Set(progress.completed);
const pending = ranges.filter((range) => !completed.has(range.index));
const controller = new AbortController();
let saveChain = Promise.resolve();
let nextIndex = 0;

function saveProgress() {
  progress.completed = [...completed].sort((left, right) => left - right);
  progress.updatedAt = new Date().toISOString();
  saveChain = saveChain.then(() => writeJson(progressPath, progress));
  return saveChain;
}

async function worker() {
  while (nextIndex < pending.length) {
    const range = pending[nextIndex];
    nextIndex += 1;
    let finalError;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        await fetchRange(dataset.official.archiveUrl, range, handle, controller.signal);
        completed.add(range.index);
        await saveProgress();
        const downloadedBytes = ranges
          .filter((entry) => completed.has(entry.index))
          .reduce((sum, entry) => sum + entry.end - entry.start + 1, 0);
        const percent = ((downloadedBytes / dataset.official.archiveBytes) * 100).toFixed(1);
        console.log(
          `${dataset.displayName}: segment ${range.index + 1}/${ranges.length} complete (${percent}%).`,
        );
        finalError = null;
        break;
      } catch (error) {
        finalError = error;
        if (attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
        }
      }
    }
    if (finalError) {
      controller.abort();
      throw finalError;
    }
  }
}

try {
  await saveProgress();
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, pending.length || 1) },
      () => worker(),
    ),
  );
  await saveChain;
} finally {
  await handle.close();
}

const stat = await fs.stat(destination);
if (stat.size !== dataset.official.archiveBytes) {
  throw new Error(
    `${dataset.displayName} archive size mismatch: expected ${dataset.official.archiveBytes}, received ${stat.size}.`,
  );
}
const [publishedAlgorithm, expectedPublishedChecksum] =
  dataset.official.archiveChecksum?.split(":") ?? [];
console.log(
  `${dataset.displayName}: calculating final publisher checksum and SHA-256 receipt.`,
);
const digests = await digestFile(
  destination,
  [publishedAlgorithm, "sha256"].filter(Boolean),
);
let publishedChecksum = null;
if (dataset.official.archiveChecksum) {
  const actual = digests[publishedAlgorithm];
  if (actual !== expectedPublishedChecksum) {
    throw new Error(
      `${dataset.displayName} ${publishedAlgorithm.toUpperCase()} mismatch: expected ${expectedPublishedChecksum}, received ${actual}.`,
    );
  }
  publishedChecksum = {
    algorithm: publishedAlgorithm,
    expected: expectedPublishedChecksum,
    actual,
    matched: true,
  };
}
await writeJson(
  path.join(corpusDirectory, ".audio", "acquisitions", `${dataset.id}.json`),
  {
    schema: "Audio-V external dataset acquisition receipt v1",
    verifiedAt: new Date().toISOString(),
    registryVersion: registry.registryVersion,
    dataset: {
      id: dataset.id,
      name: dataset.displayName,
      version: dataset.version,
      officialDownload: dataset.official.download,
      archiveUrl: dataset.official.archiveUrl,
      license: dataset.license.identifier,
    },
    archive: {
      filename: path.basename(destination),
      bytes: stat.size,
      sha256: digests.sha256,
      publishedChecksum,
      transportUrl: dataset.official.archiveUrl,
      transportedFromOfficialUrl: true,
    },
    disposition: {
      audioBundledWithApplication: false,
      redistributableInCorpus: dataset.license.redistributableInCorpus,
      role: dataset.role,
    },
  },
);
await fs.rm(progressPath, { force: true });
console.log(
  `${dataset.displayName}: acquisition verified at ${destination}; SHA-256 ${digests.sha256}.`,
);
