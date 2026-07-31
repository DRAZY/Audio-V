import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

export const root = process.cwd();
export const corpusDirectory = process.env.AUDIO_V_VALIDATION_CORPUS_DIRECTORY
  ? path.resolve(process.env.AUDIO_V_VALIDATION_CORPUS_DIRECTORY)
  : path.join(root, "validation", "real-world");
export const corpusPath = path.join(corpusDirectory, "corpus.json");
export const recipesPath = path.join(corpusDirectory, "recipes.json");
export const externalDatasetsPath = path.join(
  corpusDirectory,
  "external-datasets.json",
);
export const audioDirectory = path.join(corpusDirectory, ".audio");
export const mastersDirectory = path.join(audioDirectory, "masters");
export const derivedDirectory = path.join(audioDirectory, "derived");
export const generatedDirectory = path.join(corpusDirectory, "generated");
export const generatedCasesPath = path.join(generatedDirectory, "cases.json");

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export function splitForGroup(groupId) {
  const byte = Number.parseInt(
    createHash("sha256").update(groupId).digest("hex").slice(0, 2),
    16,
  );
  const bucket = byte % 10;
  if (bucket < 6) return "development";
  if (bucket < 8) return "calibration";
  return "test";
}

export function validateCorpus(corpus) {
  const errors = [];
  if (corpus?.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (corpus?.corpusId !== "audio-v-real-world") {
    errors.push("corpusId must be audio-v-real-world");
  }
  if (!Array.isArray(corpus?.masters)) errors.push("masters must be an array");
  if (!/^\d+\.\d+\.\d+$/u.test(corpus?.corpusVersion ?? "")) {
    errors.push("corpusVersion must use semantic versioning");
  }
  if (
    !Number.isInteger(corpus?.policy?.pilotIndependentMasters) ||
    !Number.isInteger(corpus?.policy?.targetIndependentMasters) ||
    corpus.policy.pilotIndependentMasters > corpus.policy.targetIndependentMasters
  ) {
    errors.push("corpus pilot/target thresholds are invalid");
  }
  if (!Number.isInteger(corpus?.policy?.minimumCasesPerMaster)) {
    errors.push("minimumCasesPerMaster must be an integer");
  }
  if (
    !Number.isInteger(corpus?.policy?.analysisWindowSeconds) ||
    corpus.policy.analysisWindowSeconds < 30 ||
    corpus.policy.analysisWindowSeconds > 600
  ) {
    errors.push("analysisWindowSeconds must be an integer from 30 to 600");
  }
  const allowedSplits = new Set([
    "development",
    "calibration",
    "test",
    "challenge",
  ]);
  const allowedProvenance = new Set([
    "direct-master-export",
    "multitrack-render",
    "analog-transfer",
    "licensed-research-dataset",
  ]);
  const allowedPublicLicenses = new Set(corpus?.policy?.publicLicenses ?? []);
  const allowedResearchLicenses = new Set(
    corpus?.policy?.researchLicenses ?? [],
  );
  const allowedLicenses = new Set([
    ...allowedPublicLicenses,
    ...allowedResearchLicenses,
  ]);
  const ids = new Set();
  const groupSplits = new Map();
  for (const master of corpus?.masters ?? []) {
    if (!/^AVC-M-[A-Z0-9-]+$/u.test(master.id ?? "")) {
      errors.push(`Invalid master id: ${master.id ?? "(missing)"}`);
    }
    if (ids.has(master.id)) errors.push(`Duplicate master id: ${master.id}`);
    ids.add(master.id);
    if (!master.groupId) errors.push(`${master.id}: groupId is required`);
    if (!master.title || !master.artist) {
      errors.push(`${master.id}: title and artist are required`);
    }
    if (!allowedSplits.has(master.split)) {
      errors.push(`${master.id}: invalid split ${master.split}`);
    }
    const priorSplit = groupSplits.get(master.groupId);
    if (priorSplit && priorSplit !== master.split) {
      errors.push(
        `${master.id}: source group ${master.groupId} leaks across ${priorSplit} and ${master.split}`,
      );
    }
    groupSplits.set(master.groupId, master.split);
    if (
      master.split !== "challenge" &&
      master.split !== splitForGroup(master.groupId)
    ) {
      errors.push(
        `${master.id}: split must follow ${corpus.policy.splitStrategy}`,
      );
    }
    if (!String(master.file ?? "").startsWith(".audio/masters/")) {
      errors.push(`${master.id}: file must be under .audio/masters`);
    }
    if (!/^[a-f0-9]{64}$/u.test(master.sha256 ?? "")) {
      errors.push(`${master.id}: invalid SHA-256`);
    }
    if (!allowedLicenses.has(master.rights?.license)) {
      errors.push(`${master.id}: license is not allowed by corpus policy`);
    }
    if (
      master.rights?.redistributable &&
      !allowedPublicLicenses.has(master.rights?.license)
    ) {
      errors.push(
        `${master.id}: research-only license cannot be marked redistributable`,
      );
    }
    if (
      !master.rights?.agreementId ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(master.rights?.acceptedAt ?? "")
    ) {
      errors.push(`${master.id}: agreement acceptance is incomplete`);
    }
    if (typeof master.rights?.redistributable !== "boolean") {
      errors.push(`${master.id}: redistributable must be explicit`);
    }
    if (!master.rights?.attribution) {
      errors.push(`${master.id}: attribution is required`);
    }
    if (!allowedProvenance.has(master.provenance?.kind)) {
      errors.push(`${master.id}: provenance kind is invalid`);
    }
    if (!master.provenance?.chainOfCustody) {
      errors.push(`${master.id}: chain of custody is required`);
    }
    if (
      !Number.isInteger(master.technical?.sampleRate) ||
      !Number.isInteger(master.technical?.bitDepth) ||
      !Number.isInteger(master.technical?.channels)
    ) {
      errors.push(`${master.id}: technical properties are incomplete`);
    }
    if (master.dataset) {
      if (!/^[a-z0-9-]+$/u.test(master.dataset.id ?? "")) {
        errors.push(`${master.id}: external dataset id is invalid`);
      }
      if (
        !master.dataset.version ||
        !master.dataset.sourceId ||
        !master.dataset.category ||
        !master.dataset.stratum ||
        !master.dataset.officialUrl
      ) {
        errors.push(`${master.id}: external dataset identity is incomplete`);
      }
      if (
        master.dataset.id === "musan" &&
        (!master.dataset.licenseEvidence?.file ||
          !/^[a-f0-9]{64}$/u.test(
            master.dataset.licenseEvidence?.sha256 ?? "",
          ))
      ) {
        errors.push(`${master.id}: MUSAN component license evidence is required`);
      }
    }
  }
  return { errors, groupCount: groupSplits.size };
}

export function validateExternalDatasets(registry) {
  const errors = [];
  if (registry?.schemaVersion !== 1) {
    errors.push("external dataset schemaVersion must be 1");
  }
  if (!/^\d+\.\d+\.\d+$/u.test(registry?.registryVersion ?? "")) {
    errors.push("external dataset registryVersion must use semantic versioning");
  }
  if (!Array.isArray(registry?.datasets) || registry.datasets.length === 0) {
    errors.push("external dataset registry must contain at least one dataset");
    return { errors };
  }
  const splitTotal =
    Number(registry.selectionPolicy?.developmentPercent ?? 0) +
    Number(registry.selectionPolicy?.calibrationPercent ?? 0) +
    Number(registry.selectionPolicy?.testPercent ?? 0);
  if (splitTotal !== 100) {
    errors.push("external dataset split percentages must total 100");
  }
  if (registry.selectionPolicy?.neverBundleAudioWithApplication !== true) {
    errors.push("external dataset audio must never be bundled with the app");
  }
  const ids = new Set();
  const priorities = new Set();
  const allowedAdapters = new Set([
    "slakh2100",
    "musan",
    "maestro",
    "ebu-sqam",
    "musdb18-hq",
  ]);
  for (const dataset of registry.datasets) {
    if (!/^[a-z0-9-]+$/u.test(dataset.id ?? "")) {
      errors.push(`Invalid external dataset id: ${dataset.id ?? "(missing)"}`);
    }
    if (ids.has(dataset.id)) {
      errors.push(`Duplicate external dataset id: ${dataset.id}`);
    }
    ids.add(dataset.id);
    if (priorities.has(dataset.priority)) {
      errors.push(`Duplicate external dataset priority: ${dataset.priority}`);
    }
    priorities.add(dataset.priority);
    if (!allowedAdapters.has(dataset.import?.adapter)) {
      errors.push(`${dataset.id}: unsupported import adapter`);
    }
    if (!dataset.official?.homepage || !dataset.official?.download) {
      errors.push(`${dataset.id}: official source links are incomplete`);
    }
    if (!dataset.license?.identifier || !dataset.license?.url) {
      errors.push(`${dataset.id}: license record is incomplete`);
    }
    if (
      dataset.license?.redistributableInCorpus &&
      !dataset.license?.commercialUsePermitted
    ) {
      errors.push(
        `${dataset.id}: a public redistributable reference must permit commercial use`,
      );
    }
    if (!Number.isInteger(dataset.import?.defaultLimit)) {
      errors.push(`${dataset.id}: default import limit must be an integer`);
    }
  }
  return { errors };
}

export function validateRecipes(recipes, minimumCasesPerMaster) {
  const errors = [];
  if (recipes?.schemaVersion !== 1) {
    errors.push("recipe schemaVersion must be 1");
  }
  if (!Array.isArray(recipes?.recipes)) {
    errors.push("recipes must be an array");
    return { errors };
  }
  if (recipes.recipes.length < minimumCasesPerMaster) {
    errors.push(
      `Recipe set has ${recipes.recipes.length} cases; policy requires at least ${minimumCasesPerMaster} per master`,
    );
  }
  const ids = new Set();
  for (const recipe of recipes.recipes) {
    if (!/^[a-z0-9-]+$/u.test(recipe.id ?? "")) {
      errors.push(`Invalid recipe id: ${recipe.id ?? "(missing)"}`);
    }
    if (ids.has(recipe.id)) errors.push(`Duplicate recipe id: ${recipe.id}`);
    ids.add(recipe.id);
    if (!Array.isArray(recipe.acceptedClassifications)) {
      errors.push(`${recipe.id}: acceptedClassifications must be an array`);
    }
    if (
      recipe.acceptedClassifications?.length === 0 &&
      !recipe.expected
    ) {
      errors.push(`${recipe.id}: at least one expected outcome is required`);
    }
  }
  return { errors };
}

export function countBy(items, key) {
  return Object.fromEntries(
    [...items.reduce((counts, item) => {
      const value = typeof key === "function" ? key(item) : item[key];
      counts.set(value, (counts.get(value) ?? 0) + 1);
      return counts;
    }, new Map())].sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
}

export function binomialCdf(k, n, probability) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (probability <= 0) return 1;
  if (probability >= 1) return 0;
  let term = (1 - probability) ** n;
  let sum = term;
  for (let index = 0; index < k; index += 1) {
    term *= ((n - index) / (index + 1)) * (probability / (1 - probability));
    sum += term;
  }
  return Math.min(1, Math.max(0, sum));
}

export function clopperPearson(successes, total, alpha = 0.05) {
  if (total === 0) return { lower: null, upper: null };
  let lower =
    successes === total ? (alpha / 2) ** (1 / total) : 0;
  if (successes > 0 && successes < total) {
    let low = 0;
    let high = 1;
    const target = 1 - alpha / 2;
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const midpoint = (low + high) / 2;
      if (binomialCdf(successes - 1, total, midpoint) > target) low = midpoint;
      else high = midpoint;
    }
    lower = (low + high) / 2;
  }
  let upper =
    successes === 0 ? 1 - (alpha / 2) ** (1 / total) : 1;
  if (successes > 0 && successes < total) {
    let low = 0;
    let high = 1;
    const target = alpha / 2;
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const midpoint = (low + high) / 2;
      if (binomialCdf(successes, total, midpoint) > target) low = midpoint;
      else high = midpoint;
    }
    upper = (low + high) / 2;
  }
  return {
    lower: Number((lower * 100).toFixed(2)),
    upper: Number((upper * 100).toFixed(2)),
  };
}

export function ffmpegPath() {
  if (process.env.AUDIO_V_FFMPEG_PATH) return process.env.AUDIO_V_FFMPEG_PATH;
  const platformDirectory =
    process.platform === "darwin"
      ? `mac-${process.arch}`
      : process.platform === "win32"
        ? `win-${process.arch}`
        : `${process.platform}-${process.arch}`;
  return path.join(
    root,
    "vendor",
    "ffmpeg",
    platformDirectory,
    `ffmpeg${process.platform === "win32" ? ".exe" : ""}`,
  );
}

export function ffprobePath() {
  if (process.env.AUDIO_V_FFPROBE_PATH) return process.env.AUDIO_V_FFPROBE_PATH;
  return ffmpegPath().replace(
    /ffmpeg(?:\.exe)?$/u,
    `ffprobe${process.platform === "win32" ? ".exe" : ""}`,
  );
}
