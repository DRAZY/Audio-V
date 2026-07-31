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

async function digestFile(filePath, algorithms) {
  const hashes = Object.fromEntries(
    [...new Set(algorithms)].map((algorithm) => [
      algorithm,
      createHash(algorithm),
    ]),
  );
  for await (const chunk of createReadStream(filePath)) {
    for (const hash of Object.values(hashes)) hash.update(chunk);
  }
  return Object.fromEntries(
    Object.entries(hashes).map(([algorithm, hash]) => [
      algorithm,
      hash.digest("hex"),
    ]),
  );
}

const args = argumentsMap(process.argv.slice(2));
const datasetId = required(args, "dataset");
const archivePath = path.resolve(required(args, "file"));
const registry = await readJson(externalDatasetsPath);
const validation = validateExternalDatasets(registry);
if (validation.errors.length) throw new Error(validation.errors.join("\n"));
const dataset = registry.datasets.find((item) => item.id === datasetId);
if (!dataset) throw new Error(`Unknown external dataset ${datasetId}.`);
const transportUrl =
  args.get("transport-url") ?? dataset.official.archiveUrl ?? null;
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
const [publishedAlgorithm, expectedPublishedChecksum] =
  dataset.official.archiveChecksum?.split(":") ?? [];
const digests = await digestFile(
  archivePath,
  [publishedAlgorithm, "sha256"].filter(Boolean),
);
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
const sha256 = digests.sha256;
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
    transportUrl,
    transportedFromOfficialUrl:
      transportUrl === (dataset.official.archiveUrl ?? null),
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
