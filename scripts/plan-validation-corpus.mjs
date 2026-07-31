import path from "node:path";
import {
  externalDatasetsPath,
  readJson,
  root,
  validateExternalDatasets,
  writeJson,
} from "./lib/validation-corpus.mjs";

const registry = await readJson(externalDatasetsPath);
const validation = validateExternalDatasets(registry);
if (validation.errors.length) throw new Error(validation.errors.join("\n"));

const datasets = registry.datasets
  .slice()
  .sort((left, right) => left.priority - right.priority)
  .map((dataset) => ({
    priority: dataset.priority,
    id: dataset.id,
    name: dataset.displayName,
    version: dataset.version,
    role: dataset.role,
    readiness: dataset.status,
    countsTowardPublicTarget: dataset.license.redistributableInCorpus,
    license: dataset.license.identifier,
    access: dataset.official.access,
    download: dataset.official.download,
    archiveBytes: dataset.official.archiveBytes ?? null,
    archiveChecksum: dataset.official.archiveChecksum ?? null,
    defaultImportLimit: dataset.import.defaultLimit,
    recommendedUse: dataset.recommendedUse,
    limitations: dataset.limitations,
    importCommand:
      `npm run corpus:import:dataset -- --dataset ${dataset.id} ` +
      `--root "/path/to/${dataset.id}" --limit ${dataset.import.defaultLimit}` +
      (["manual-terms-review", "manual-approval"].includes(dataset.status)
        ? " --terms-accepted true"
        : ""),
  }));

const output = {
  schema: "Audio-V external corpus acquisition plan v1",
  generatedAt: new Date().toISOString(),
  registryVersion: registry.registryVersion,
  policy: registry.selectionPolicy,
  summary: {
    datasets: datasets.length,
    directAccess: datasets.filter((dataset) => dataset.access === "direct").length,
    publicCorpusSources: datasets.filter(
      (dataset) => dataset.countsTowardPublicTarget,
    ).length,
    challengeOnlySources: datasets.filter(
      (dataset) => !dataset.countsTowardPublicTarget,
    ).length,
  },
  datasets,
};
await writeJson(
  path.join(root, "build", "corpus-acquisition-plan-latest.json"),
  output,
);
console.log(
  `External corpus plan: ${datasets.length} datasets; ` +
    `${output.summary.publicCorpusSources} public and ${output.summary.challengeOnlySources} challenge-only.`,
);
