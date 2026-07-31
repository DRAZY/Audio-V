import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { splitForGroup } from "./validation-corpus.mjs";

const supportedAudioExtensions = new Set([
  ".aif",
  ".aiff",
  ".flac",
  ".wav",
  ".wave",
]);

async function walk(directory) {
  const output = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(entryPath)));
    else if (entry.isFile()) output.push(entryPath);
  }
  return output;
}

function normalizedRelative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function stableId(datasetId, sourceId) {
  const digest = createHash("sha256")
    .update(`${datasetId}:${sourceId}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return `AVC-M-${datasetId.replaceAll("-", "").toUpperCase()}-${digest}`;
}

function genericCandidate(dataset, root, filePath) {
  const sourceId = normalizedRelative(root, filePath);
  const basename = path.basename(filePath, path.extname(filePath));
  return {
    id: stableId(dataset.id, sourceId),
    sourceId,
    groupId: `${dataset.id}:${sourceId}`,
    filePath,
    title: basename,
    artist: dataset.displayName,
    category: "unspecified",
    stratum: "unspecified",
  };
}

async function discoverSlakh(dataset, root, files) {
  return files
    .filter(
      (filePath) =>
        path.basename(filePath).toLowerCase() === "mix.flac" &&
        /^Track\d+$/u.test(path.basename(path.dirname(filePath))),
    )
    .map((filePath) => {
      const trackId = path.basename(path.dirname(filePath));
      const sourceId = `${trackId}/mix.flac`;
      return {
        id: stableId(dataset.id, sourceId),
        sourceId,
        groupId: `${dataset.id}:${trackId}`,
        filePath,
        title: trackId,
        artist: "Slakh2100",
        category: "synthesized-mixture",
        stratum: "synthesized-mixture",
      };
    });
}

async function discoverMusan(dataset, root, files) {
  const licenseFiles = files.filter(
    (filePath) => path.basename(filePath).toLowerCase() === "license",
  );
  function nearestLicense(filePath) {
    return licenseFiles
      .filter((licensePath) => {
        const relative = path.relative(path.dirname(licensePath), filePath);
        return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
      })
      .sort(
        (left, right) =>
          path.dirname(right).length - path.dirname(left).length,
      )[0];
  }
  return files
    .filter((filePath) => path.extname(filePath).toLowerCase() === ".wav")
    .map((filePath) => {
      const candidate = genericCandidate(dataset, root, filePath);
      const parts = candidate.sourceId.split("/");
      const categoryIndex = parts.findIndex((part) =>
        ["music", "noise", "speech"].includes(part.toLowerCase()),
      );
      const category =
        categoryIndex >= 0 ? parts[categoryIndex].toLowerCase() : "unspecified";
      const collection =
        categoryIndex >= 0 && parts[categoryIndex + 1]
          ? parts[categoryIndex + 1].toLowerCase()
          : "unspecified";
      const licenseFilePath = nearestLicense(filePath);
      return {
        ...candidate,
        category,
        stratum: `${category}:${collection}`,
        licenseFilePath: licenseFilePath ?? null,
        licenseEvidence: licenseFilePath
          ? normalizedRelative(root, licenseFilePath)
          : null,
      };
    });
}

async function discoverMaestro(dataset, root, files) {
  const metadataPath = files.find(
    (filePath) =>
      /^maestro-v3\.0\.0\.json$/u.test(path.basename(filePath).toLowerCase()),
  );
  if (!metadataPath) {
    throw new Error(
      "MAESTRO import requires maestro-v3.0.0.json inside the selected root.",
    );
  }
  const rawMetadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  const metadata = Array.isArray(rawMetadata)
    ? rawMetadata
    : Object.keys(rawMetadata.audio_filename ?? {})
        .sort((left, right) => Number(left) - Number(right))
        .map((index) =>
          Object.fromEntries(
            Object.entries(rawMetadata).map(([field, values]) => [
              field,
              values?.[index],
            ]),
          ),
        );
  if (metadata.length === 0) {
    throw new Error(
      "MAESTRO metadata must be a non-empty row array or official column-oriented JSON object.",
    );
  }
  const metadataRoot = path.dirname(metadataPath);
  const candidates = [];
  for (const item of metadata) {
    const audioFilename = String(item.audio_filename ?? "");
    if (!audioFilename) continue;
    const filePath = path.join(metadataRoot, ...audioFilename.split("/"));
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    const composer = String(item.canonical_composer ?? "Unknown composer");
    const title = String(item.canonical_title ?? path.basename(audioFilename));
    const compositionIdentity = `${composer}:${title}`
      .normalize("NFKC")
      .toLowerCase();
    candidates.push({
      id: stableId(dataset.id, audioFilename),
      sourceId: audioFilename,
      groupId: `${dataset.id}:composition:${createHash("sha256")
        .update(compositionIdentity)
        .digest("hex")
        .slice(0, 20)}`,
      filePath,
      title,
      artist: composer,
      category: `piano-${String(item.split ?? "unspecified")}`,
      stratum: "recorded-piano",
    });
  }
  return candidates;
}

async function discoverEbu(dataset, root, files) {
  return files
    .filter((filePath) => supportedAudioExtensions.has(path.extname(filePath).toLowerCase()))
    .map((filePath) => {
      const track = Number.parseInt(path.basename(filePath), 10);
      const category =
        track <= 2
          ? "alignment-signal"
          : track <= 7
            ? "artificial-signal"
            : track <= 43
              ? "single-instrument"
              : track <= 48
                ? "vocal"
                : track <= 54
                  ? "speech"
                  : track <= 60
                    ? "solo-instrument"
                    : track <= 64
                      ? "vocal-orchestra"
                      : track <= 68
                        ? "orchestra"
                        : "pop-music";
      return {
        ...genericCandidate(dataset, root, filePath),
        category,
        stratum: `ebu-sqam:${category}`,
      };
    });
}

async function discoverMusdb(dataset, root, files) {
  return files
    .filter(
      (filePath) =>
        path.basename(filePath).toLowerCase() === "mixture.wav" &&
        ["train", "test"].includes(
          path.basename(path.dirname(path.dirname(filePath))).toLowerCase(),
        ),
    )
    .map((filePath) => {
      const trackName = path.basename(path.dirname(filePath));
      const partition = path.basename(path.dirname(path.dirname(filePath)));
      const sourceId = `${partition}/${trackName}/mixture.wav`;
      return {
        id: stableId(dataset.id, sourceId),
        sourceId,
        groupId: `${dataset.id}:${trackName.normalize("NFKC").toLowerCase()}`,
        filePath,
        title: trackName,
        artist: "MUSDB18-HQ",
        category: `mixture-${partition.toLowerCase()}`,
        stratum: `mixture-${partition.toLowerCase()}`,
      };
    });
}

const adapters = {
  "slakh2100": discoverSlakh,
  "musan": discoverMusan,
  "maestro": discoverMaestro,
  "ebu-sqam": discoverEbu,
  "musdb18-hq": discoverMusdb,
};

export async function discoverDatasetCandidates(dataset, sourceRoot) {
  const root = path.resolve(sourceRoot);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) {
    throw new Error(`Dataset root is not a directory: ${root}`);
  }
  const adapter = adapters[dataset.import.adapter];
  if (!adapter) {
    throw new Error(`No adapter is available for ${dataset.import.adapter}.`);
  }
  const candidates = await adapter(dataset, root, await walk(root));
  return candidates
    .filter((candidate) =>
      supportedAudioExtensions.has(path.extname(candidate.filePath).toLowerCase()),
    )
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

export function selectBalancedCandidates(
  candidates,
  limit,
  selectionPolicy,
  redistributable,
) {
  const uniqueGroups = [];
  const seenGroups = new Set();
  for (const candidate of candidates) {
    if (seenGroups.has(candidate.groupId)) continue;
    seenGroups.add(candidate.groupId);
    uniqueGroups.push(candidate);
  }
  if (!redistributable) {
    const byCategory = new Map();
    for (const candidate of uniqueGroups) {
      const category = candidate.category ?? "unspecified";
      const population = byCategory.get(category) ?? [];
      population.push(candidate);
      byCategory.set(category, population);
    }
    const rankedCategories = [...byCategory.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, population]) => ({
        category,
        population: population.sort((left, right) => {
          const leftHash = createHash("sha256")
            .update(left.groupId)
            .digest("hex");
          const rightHash = createHash("sha256")
            .update(right.groupId)
            .digest("hex");
          return leftHash.localeCompare(rightHash);
        }),
      }));
    const selected = [];
    while (selected.length < limit) {
      let added = false;
      for (const entry of rankedCategories) {
        const candidate = entry.population.shift();
        if (!candidate) continue;
        selected.push(candidate);
        added = true;
        if (selected.length === limit) break;
      }
      if (!added) break;
    }
    return selected;
  }
  const quotas = {
    development: Math.floor(
      (limit * selectionPolicy.developmentPercent) / 100,
    ),
    calibration: Math.floor(
      (limit * selectionPolicy.calibrationPercent) / 100,
    ),
    test: 0,
  };
  quotas.test = limit - quotas.development - quotas.calibration;
  const bySplit = {
    development: [],
    calibration: [],
    test: [],
  };
  for (const candidate of uniqueGroups) {
    bySplit[splitForGroup(candidate.groupId)].push(candidate);
  }
  function stratumRoundRobin(population) {
    const categories = new Map();
    for (const candidate of population) {
      const category =
        candidate.stratum ?? candidate.category ?? "unspecified";
      const items = categories.get(category) ?? [];
      items.push(candidate);
      categories.set(category, items);
    }
    const categoryIds = [...categories.keys()].sort();
    const offsets = new Map(categoryIds.map((category) => [category, 0]));
    const output = [];
    while (output.length < population.length) {
      let added = false;
      for (const category of categoryIds) {
        const offset = offsets.get(category);
        const item = categories.get(category)[offset];
        if (!item) continue;
        output.push(item);
        offsets.set(category, offset + 1);
        added = true;
      }
      if (!added) break;
    }
    return output;
  }
  const categoryIds = [
    ...new Set(uniqueGroups.map((candidate) => candidate.category ?? "unspecified")),
  ].sort();
  const categoryQuotas = Object.fromEntries(
    categoryIds.map((category, index) => [
      category,
      Math.floor(limit / categoryIds.length) +
        (index < limit % categoryIds.length ? 1 : 0),
    ]),
  );
  const pools = Object.fromEntries(
    ["development", "calibration", "test"].map((split) => [
      split,
      Object.fromEntries(
        categoryIds.map((category) => [
          category,
          stratumRoundRobin(
            bySplit[split].filter(
              (candidate) =>
                (candidate.category ?? "unspecified") === category,
            ),
          ),
        ]),
      ),
    ]),
  );
  const selected = [];
  const selectedIds = new Set();
  for (const split of ["development", "calibration", "test"]) {
    while (
      selected.filter((candidate) => splitForGroup(candidate.groupId) === split)
        .length < quotas[split]
    ) {
      let added = false;
      for (const category of categoryIds) {
        if (categoryQuotas[category] <= 0) continue;
        const candidate = pools[split][category].shift();
        if (!candidate) continue;
        selected.push(candidate);
        selectedIds.add(candidate.id);
        categoryQuotas[category] -= 1;
        added = true;
        if (
          selected.filter(
            (item) => splitForGroup(item.groupId) === split,
          ).length >= quotas[split]
        ) {
          break;
        }
      }
      if (!added) break;
    }
  }
  for (const candidate of uniqueGroups) {
    if (selected.length >= limit) break;
    if (selectedIds.has(candidate.id)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.id);
  }
  return selected;
}
