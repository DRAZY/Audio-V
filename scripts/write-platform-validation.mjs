import { promises as fs } from "node:fs";
import path from "node:path";
import {
  analyzeAudioFile,
  engineVersion,
} from "../dist-electron/electron/oracle/oracle-engine.js";

const root = process.cwd();
const fixtures = [
  ["audio-engine", "reference.flac"],
  ["fidelity-engine", "mp3-128-transcoded-to-flac.flac"],
  ["fidelity-engine", "upsampled-44-to-96.flac"],
];

function rounded(value, digits = 6) {
  return typeof value === "number" && Number.isFinite(value)
    ? Number(value.toFixed(digits))
    : null;
}

const records = [];
for (const [directory, name] of fixtures) {
  const result = await analyzeAudioFile(
    path.join(root, "tests", "fixtures", directory, name),
  );
  const signal = result.measurements;
  const technical = result.technical;
  const spectrum = signal?.spectrogram;
  records.push({
    fixture: `${directory}/${name}`,
    engineVersion: result.engineVersion,
    scope: result.scope,
    verdict: result.verdict,
    originClassification: result.fidelity?.classification ?? null,
    originReason: result.fidelity?.reasonCode ?? null,
    fileSha256: technical?.fileSha256 ?? null,
    codec: technical?.codecName ?? null,
    sampleRate: signal?.sampleRate ?? null,
    channels: signal?.channels ?? null,
    frames: signal?.frames ?? null,
    durationSeconds: rounded(signal?.durationSeconds),
    samplePeakDbfs: rounded(signal?.samplePeakDbfs),
    rmsDbfs: rounded(signal?.rmsDbfs),
    integratedLufs: rounded(signal?.integratedLufs),
    loudnessRangeLu: rounded(signal?.loudnessRangeLu),
    truePeakDbtp: rounded(signal?.truePeakDbtp),
    effectiveBandwidthHz: rounded(spectrum?.effectiveBandwidthHz, 2),
    strongestCutoffHz: rounded(spectrum?.strongestCutoffHz, 2),
    cutoffDropDb: rounded(spectrum?.cutoffDropDb),
  });
}

const output = {
  schema: "Audio-V cross-platform validation snapshot v1",
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  engineVersion,
  fixtures: records,
};
const outputPath = path.join(
  root,
  "build",
  `platform-validation-${process.platform}-${process.arch}.json`,
);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${path.relative(root, outputPath)}.`);
