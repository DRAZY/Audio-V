import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
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

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function deterministicOrder(entries) {
  return [...entries].sort((left, right) => {
    const leftHash = createHash("sha256").update(left).digest("hex");
    const rightHash = createHash("sha256").update(right).digest("hex");
    return leftHash.localeCompare(rightHash) || left.localeCompare(right);
  });
}

function safeArchiveEntry(entry) {
  return (
    entry.length > 0 &&
    !path.isAbsolute(entry) &&
    !entry.split("/").includes("..")
  );
}

function slakhEntries(archivePath, candidateLimit) {
  const listing = execFileSync("tar", ["-tzf", archivePath], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  })
    .split(/\r?\n/u)
    .filter(Boolean);
  const candidates = listing.filter(
    (entry) =>
      safeArchiveEntry(entry) &&
      /(?:^|\/)(?:train|validation|test)\/Track\d+\/mix\.flac$/u.test(entry) &&
      !/(?:^|\/)omitted\//u.test(entry),
  );
  if (candidates.length === 0) {
    throw new Error("The Slakh archive contains no eligible Redux mixture files.");
  }
  return {
    discovered: candidates.length,
    selected: deterministicOrder(candidates).slice(0, candidateLimit),
  };
}

function normalizeMaestroMetadata(rawMetadata) {
  if (Array.isArray(rawMetadata)) return rawMetadata;
  return Object.keys(rawMetadata.audio_filename ?? {})
    .sort((left, right) => Number(left) - Number(right))
    .map((index) =>
      Object.fromEntries(
        Object.entries(rawMetadata).map(([field, values]) => [
          field,
          values?.[index],
        ]),
      ),
    );
}

function maestroEntries(archivePath, candidateLimit) {
  const listing = execFileSync("unzip", ["-Z1", archivePath], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  })
    .split(/\r?\n/u)
    .filter(Boolean);
  const metadataEntry = listing.find(
    (entry) =>
      safeArchiveEntry(entry) &&
      path.basename(entry).toLowerCase() === "maestro-v3.0.0.json",
  );
  if (!metadataEntry) {
    throw new Error("The MAESTRO archive does not contain maestro-v3.0.0.json.");
  }
  const metadata = normalizeMaestroMetadata(
    JSON.parse(
      execFileSync("unzip", ["-p", archivePath, metadataEntry], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      }),
    ),
  );
  const entriesBySuffix = new Map(
    listing
      .filter((entry) => safeArchiveEntry(entry) && /\.wav$/iu.test(entry))
      .map((entry) => [
        entry.replace(/^.*?maestro-v3\.0\.0\//u, ""),
        entry,
      ]),
  );
  const uniqueCompositions = new Map();
  for (const item of metadata) {
    const audioFilename = String(item.audio_filename ?? "");
    const entry = entriesBySuffix.get(audioFilename);
    if (!entry) continue;
    const composition = `${item.canonical_composer ?? ""}:${item.canonical_title ?? ""}`
      .normalize("NFKC")
      .toLowerCase();
    if (!uniqueCompositions.has(composition)) {
      uniqueCompositions.set(composition, entry);
    }
  }
  const candidates = [...uniqueCompositions.values()];
  if (candidates.length === 0) {
    throw new Error("The MAESTRO archive contains no metadata-linked WAV files.");
  }
  return {
    discovered: candidates.length,
    selected: [
      metadataEntry,
      ...deterministicOrder(candidates).slice(0, candidateLimit),
    ],
  };
}

const args = argumentsMap(process.argv.slice(2));
const datasetId = required(args, "dataset");
const archivePath = path.resolve(required(args, "file"));
const destinationRoot = path.resolve(required(args, "root"));
const candidateLimit = positiveInteger(
  args.get("candidate-limit") ?? "120",
  "--candidate-limit",
);
const registry = await readJson(externalDatasetsPath);
const validation = validateExternalDatasets(registry);
if (validation.errors.length) throw new Error(validation.errors.join("\n"));
const dataset = registry.datasets.find((item) => item.id === datasetId);
if (!dataset) throw new Error(`Unknown external dataset ${datasetId}.`);
const stat = await fs.stat(archivePath);
if (!stat.isFile()) throw new Error("External dataset archive must be a file.");
await fs.mkdir(destinationRoot, { recursive: true });

let plan;
let archiveCommand;
if (dataset.import.adapter === "slakh2100") {
  plan = slakhEntries(archivePath, candidateLimit);
  archiveCommand = [
    "tar",
    ["-xzf", archivePath, "-C", destinationRoot, ...plan.selected],
  ];
} else if (dataset.import.adapter === "maestro") {
  plan = maestroEntries(archivePath, candidateLimit);
  archiveCommand = [
    "unzip",
    ["-q", archivePath, ...plan.selected, "-d", destinationRoot],
  ];
} else {
  throw new Error(
    `${dataset.displayName} does not yet have a selective archive extractor; extract it with its publisher's documented method.`,
  );
}

if (args.get("dry-run") !== "true") {
  execFileSync(archiveCommand[0], archiveCommand[1], { stdio: "inherit" });
}
const receipt = {
  schema: "Audio-V selective external dataset extraction v1",
  datasetId,
  datasetVersion: dataset.version,
  archive: path.basename(archivePath),
  destinationRoot,
  discoveredEligibleEntries: plan.discovered,
  selectedEntries: plan.selected,
  candidateLimit,
  extracted: args.get("dry-run") !== "true",
  recordedAt: new Date().toISOString(),
};
await writeJson(
  path.join(destinationRoot, ".audio-v-extraction.json"),
  receipt,
);
console.log(
  `${dataset.displayName}: ${receipt.extracted ? "extracted" : "planned"} ` +
    `${plan.selected.length}/${plan.discovered} selected archive entries.`,
);
