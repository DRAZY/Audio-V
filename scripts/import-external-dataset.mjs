import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  discoverDatasetCandidates,
  selectBalancedCandidates,
} from "./lib/external-dataset-adapters.mjs";
import {
  corpusPath,
  externalDatasetsPath,
  ffprobePath,
  mastersDirectory,
  readJson,
  sha256File,
  splitForGroup,
  validateCorpus,
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

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function probeAudio(filePath) {
  const probe = JSON.parse(
    execFileSync(
      ffprobePath(),
      [
        "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=codec_name,sample_rate,channels,bits_per_raw_sample,bits_per_sample",
        "-of", "json",
        filePath,
      ],
      { encoding: "utf8" },
    ),
  );
  const stream = probe.streams?.[0];
  if (!stream) throw new Error(`No primary audio stream found in ${filePath}.`);
  return {
    format: stream.codec_name,
    sampleRate: Number(stream.sample_rate),
    bitDepth: Number(stream.bits_per_raw_sample || stream.bits_per_sample || 16),
    channels: Number(stream.channels),
  };
}

async function placeReference(source, destination, storageMode) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (storageMode === "copy") {
    await fs.copyFile(source, destination);
    return "copy";
  }
  try {
    await fs.link(source, destination);
    return "hardlink";
  } catch (error) {
    if (!["EXDEV", "EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
      throw error;
    }
    await fs.copyFile(source, destination);
    return "copy-fallback";
  }
}

const args = argumentsMap(process.argv.slice(2));
const datasetId = required(args, "dataset");
const targetCorpusVersion = required(args, "corpus-version");
if (!/^\d+\.\d+\.\d+$/u.test(targetCorpusVersion)) {
  throw new Error("--corpus-version must use semantic versioning.");
}
const sourceRoot = path.resolve(required(args, "root"));
const registry = await readJson(externalDatasetsPath);
const registryValidation = validateExternalDatasets(registry);
if (registryValidation.errors.length) {
  throw new Error(registryValidation.errors.join("\n"));
}
const dataset = registry.datasets.find((entry) => entry.id === datasetId);
if (!dataset) {
  throw new Error(
    `Unknown dataset ${datasetId}. Available: ${registry.datasets.map((entry) => entry.id).join(", ")}.`,
  );
}
const requiresTermsEvidence = !dataset.license.redistributableInCorpus;
if (requiresTermsEvidence && args.get("terms-accepted") !== "true") {
  throw new Error(
    `${dataset.displayName} requires --terms-accepted true after reviewing ${dataset.license.url}.`,
  );
}
let termsEvidence = null;
if (requiresTermsEvidence) {
  const termsEvidencePath = path.resolve(required(args, "terms-evidence"));
  const termsEvidenceStat = await fs.stat(termsEvidencePath);
  if (!termsEvidenceStat.isFile()) {
    throw new Error("--terms-evidence must identify a local evidence file.");
  }
  termsEvidence = {
    file: path.basename(termsEvidencePath),
    sha256: await sha256File(termsEvidencePath),
    reviewedUrl: dataset.license.url,
    acceptedAt: new Date().toISOString().slice(0, 10),
  };
}
const storageMode = args.get("storage") ?? "hardlink";
if (!["copy", "hardlink"].includes(storageMode)) {
  throw new Error("--storage must be copy or hardlink.");
}
const limit = positiveInteger(
  args.get("limit") ?? String(dataset.import.defaultLimit),
  "--limit",
);
const candidates = await discoverDatasetCandidates(dataset, sourceRoot);
if (candidates.length === 0) {
  throw new Error(
    `No eligible ${dataset.displayName} audio references were found under ${sourceRoot}.`,
  );
}
const corpus = await readJson(corpusPath);
const currentVersionParts = corpus.corpusVersion.split(".").map(Number);
const targetVersionParts = targetCorpusVersion.split(".").map(Number);
const versionComparison =
  targetVersionParts[0] - currentVersionParts[0] ||
  targetVersionParts[1] - currentVersionParts[1] ||
  targetVersionParts[2] - currentVersionParts[2];
if (versionComparison < 0) {
  throw new Error(
    `--corpus-version ${targetCorpusVersion} cannot precede current corpus ${corpus.corpusVersion}.`,
  );
}
const existingIds = new Set(corpus.masters.map((master) => master.id));
const existingSources = new Set(
  corpus.masters
    .filter((master) => master.dataset)
    .map((master) => `${master.dataset.id}:${master.dataset.sourceId}`),
);
const eligible = candidates.filter(
    (candidate) =>
      !existingIds.has(candidate.id) &&
      !existingSources.has(`${dataset.id}:${candidate.sourceId}`),
  );
const selected = selectBalancedCandidates(
  eligible,
  limit,
  registry.selectionPolicy,
  dataset.license.redistributableInCorpus,
);
if (selected.length === 0) {
  console.log(
    `${dataset.displayName}: every discovered reference is already registered.`,
  );
  process.exit(0);
}
if (args.get("dry-run") === "true") {
  console.log(
    JSON.stringify(
      {
        dataset: dataset.id,
        root: sourceRoot,
        discovered: candidates.length,
        selected: selected.map(({ filePath, ...candidate }) => ({
          ...candidate,
          filePath,
          split: dataset.license.redistributableInCorpus
            ? splitForGroup(candidate.groupId)
            : "challenge",
        })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const createdFiles = [];
const storageCounts = {};
try {
  for (const candidate of selected) {
    const extension = path.extname(candidate.filePath).toLowerCase();
    const destinationName = `${candidate.id}${extension}`;
    const destination = path.join(mastersDirectory, destinationName);
    const storageResult = await placeReference(
      candidate.filePath,
      destination,
      storageMode,
    );
    createdFiles.push(destination);
    storageCounts[storageResult] = (storageCounts[storageResult] ?? 0) + 1;
    const sha256 = await sha256File(destination);
    const split = dataset.license.redistributableInCorpus
      ? splitForGroup(candidate.groupId)
      : "challenge";
    corpus.masters.push({
      id: candidate.id,
      groupId: candidate.groupId,
      split,
      title: candidate.title,
      artist: candidate.artist,
      file: `.audio/masters/${destinationName}`,
      sha256,
      dataset: {
        id: dataset.id,
        version: dataset.version,
        sourceId: candidate.sourceId,
        category: candidate.category,
        stratum: candidate.stratum,
        role: dataset.role,
        officialUrl: dataset.official.homepage,
        ...(candidate.licenseFilePath
          ? {
              licenseEvidence: {
                file: candidate.licenseEvidence,
                sha256: await sha256File(candidate.licenseFilePath),
              },
            }
          : termsEvidence
            ? { licenseEvidence: termsEvidence }
            : {}),
      },
      rights: {
        license: dataset.license.identifier,
        agreementId: `DATASET-REGISTRY-${registry.registryVersion}-${dataset.id}`,
        acceptedAt: new Date().toISOString().slice(0, 10),
        redistributable: dataset.license.redistributableInCorpus,
        attribution: `${dataset.displayName} · ${candidate.sourceId}`,
      },
      provenance: {
        kind: "licensed-research-dataset",
        acquiredAt: new Date().toISOString().slice(0, 10),
        chainOfCustody:
          `Imported from the operator-acquired ${dataset.displayName} ${dataset.version} dataset; ` +
          `source identity ${candidate.sourceId}; category ${candidate.category}.`,
      },
      technical: probeAudio(destination),
    });
  }
  corpus.masters.sort((left, right) => left.id.localeCompare(right.id));
  corpus.corpusVersion = targetCorpusVersion;
  const validation = validateCorpus(corpus);
  if (validation.errors.length) throw new Error(validation.errors.join("\n"));
  await writeJson(corpusPath, corpus);
} catch (error) {
  await Promise.all(createdFiles.map((filePath) => fs.rm(filePath, { force: true })));
  throw error;
}

console.log(
  `${dataset.displayName}: imported ${selected.length}/${candidates.length} discovered external references ` +
    `(${Object.entries(storageCounts).map(([mode, count]) => `${mode}=${count}`).join(", ")}).`,
);
console.log(
  dataset.license.redistributableInCorpus
    ? "References count toward the public corpus and remain excluded from the application package."
    : "References are challenge-only and do not count toward the public corpus target.",
);
