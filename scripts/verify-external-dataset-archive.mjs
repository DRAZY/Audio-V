import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
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

async function digestFile(filePath, algorithm) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

const args = argumentsMap(process.argv.slice(2));
const datasetId = required(args, "dataset");
const archivePath = path.resolve(required(args, "file"));
const registry = await readJson(externalDatasetsPath);
const validation = validateExternalDatasets(registry);
if (validation.errors.length) throw new Error(validation.errors.join("\n"));
const dataset = registry.datasets.find((item) => item.id === datasetId);
if (!dataset) throw new Error(`Unknown external dataset ${datasetId}.`);
const stat = await fs.stat(archivePath);
if (!stat.isFile()) throw new Error("External dataset archive must be a file.");
if (
  dataset.official.archiveBytes &&
  stat.size !== dataset.official.archiveBytes
) {
  throw new Error(
    `${dataset.displayName} archive size mismatch: expected ${dataset.official.archiveBytes}, received ${stat.size}.`,
  );
}
let publishedChecksum = null;
if (dataset.official.archiveChecksum) {
  const [algorithm, expected] = dataset.official.archiveChecksum.split(":");
  const actual = await digestFile(archivePath, algorithm);
  if (actual !== expected) {
    throw new Error(
      `${dataset.displayName} ${algorithm.toUpperCase()} mismatch: expected ${expected}, received ${actual}.`,
    );
  }
  publishedChecksum = {
    algorithm,
    expected,
    actual,
    matched: true,
  };
}
const sha256 = await digestFile(archivePath, "sha256");
const receipt = {
  schema: "Audio-V external dataset acquisition receipt v1",
  verifiedAt: new Date().toISOString(),
  registryVersion: registry.registryVersion,
  dataset: {
    id: dataset.id,
    name: dataset.displayName,
    version: dataset.version,
    officialDownload: dataset.official.download,
    archiveUrl: dataset.official.archiveUrl ?? null,
    license: dataset.license.identifier,
  },
  archive: {
    filename: path.basename(archivePath),
    bytes: stat.size,
    sha256,
    publishedChecksum,
  },
  disposition: {
    audioBundledWithApplication: false,
    redistributableInCorpus: dataset.license.redistributableInCorpus,
    role: dataset.role,
  },
};
await writeJson(
  path.join(
    corpusDirectory,
    ".audio",
    "acquisitions",
    `${dataset.id}.json`,
  ),
  receipt,
);
console.log(
  `${dataset.displayName}: archive verified; SHA-256 ${sha256}.`,
);
