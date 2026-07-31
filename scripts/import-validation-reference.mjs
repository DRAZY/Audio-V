import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  corpusPath,
  corpusDirectory,
  ffprobePath,
  mastersDirectory,
  readJson,
  sha256File,
  splitForGroup,
  validateCorpus,
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

const args = argumentsMap(process.argv.slice(2));
const sourcePath = path.resolve(required(args, "file"));
const id = required(args, "id").toUpperCase();
const groupId = required(args, "group");
const license = required(args, "license");
const agreementId = required(args, "agreement");
const provenanceKind = required(args, "provenance");
const corpus = await readJson(corpusPath);

if (!corpus.policy.publicLicenses.includes(license)) {
  throw new Error(
    `${license} is not accepted for the public corpus. Allowed: ${corpus.policy.publicLicenses.join(", ")}.`,
  );
}
if (corpus.masters.some((master) => master.id === id)) {
  throw new Error(`${id} already exists in the corpus.`);
}

const sourceStat = await fs.stat(sourcePath);
if (!sourceStat.isFile()) throw new Error("The source reference must be a file.");
const extension = path.extname(sourcePath).toLowerCase();
if (![".wav", ".wave", ".flac", ".aif", ".aiff"].includes(extension)) {
  throw new Error("Validation references must be WAV, FLAC, AIFF, or AIF.");
}

const probe = JSON.parse(
  execFileSync(
    ffprobePath(),
    [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=codec_name,sample_rate,channels,bits_per_raw_sample,bits_per_sample",
      "-of", "json",
      sourcePath,
    ],
    { encoding: "utf8" },
  ),
);
const stream = probe.streams?.[0];
if (!stream) throw new Error("No primary audio stream was found.");
const sha256 = await sha256File(sourcePath);
const destinationName = `${id}${extension}`;
await fs.mkdir(mastersDirectory, { recursive: true });
await fs.copyFile(sourcePath, path.join(mastersDirectory, destinationName));

const existingGroup = corpus.masters.find((master) => master.groupId === groupId);
const requestedSplit = args.get("split");
if (
  requestedSplit &&
  requestedSplit !== "challenge" &&
  requestedSplit !== splitForGroup(groupId)
) {
  throw new Error(
    `--split must be challenge or the deterministic ${splitForGroup(groupId)} partition for this source group.`,
  );
}
const split =
  requestedSplit ?? existingGroup?.split ?? splitForGroup(groupId);
const today = new Date().toISOString().slice(0, 10);
corpus.masters.push({
  id,
  groupId,
  split,
  title: required(args, "title"),
  artist: required(args, "artist"),
  file: `.audio/masters/${destinationName}`,
  sha256,
  rights: {
    license,
    agreementId,
    acceptedAt: args.get("accepted-at") ?? today,
    redistributable: args.get("redistributable") !== "false",
    attribution: args.get("attribution") ?? required(args, "artist"),
  },
  provenance: {
    kind: provenanceKind,
    acquiredAt: args.get("acquired-at") ?? today,
    chainOfCustody: required(args, "chain"),
  },
  technical: {
    format: stream.codec_name,
    sampleRate: Number(stream.sample_rate),
    bitDepth: Number(stream.bits_per_raw_sample || stream.bits_per_sample || 24),
    channels: Number(stream.channels),
  },
});
corpus.masters.sort((left, right) => left.id.localeCompare(right.id));
const validation = validateCorpus(corpus);
if (validation.errors.length) {
  await fs.rm(path.join(mastersDirectory, destinationName), { force: true });
  throw new Error(validation.errors.join("\n"));
}
await writeJson(path.join(corpusDirectory, "corpus.json"), corpus);
console.log(
  `Imported ${id} into ${split}; SHA-256 ${sha256}. Audio remains git-ignored.`,
);
