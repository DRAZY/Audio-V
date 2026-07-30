import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.cwd();
const fixture = path.join(
  root,
  "tests",
  "fixtures",
  "fidelity-engine",
  "wideband-source-44.flac",
);
const temporary = path.join(root, "tmp", `cli-verification-${process.pid}`);
const output = path.join(temporary, "evidence.json");
await fs.mkdir(temporary, { recursive: true });

try {
  await run(process.execPath, [
    path.join(root, "dist-electron", "electron", "cli.js"),
    fixture,
    "--output",
    output,
    "--concurrency",
    "1",
    "--memory-mb",
    "128",
    "--ffmpeg-threads",
    "1",
    "--native-memory-mb",
    "512",
    "--fail-on",
    "never",
  ], { cwd: root, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  const evidenceText = await fs.readFile(output, "utf8");
  const evidence = JSON.parse(evidenceText);
  const file = evidence.files?.[0];
  const checks = {
    schema: evidence.schema === "Audio-V Oracle CLI evidence v1",
    oneFile: evidence.summary?.discovered === 1,
    engine: file?.oracle?.engineVersion === "0.10.0-oracle-v12",
    scope: file?.oracle?.scope === "oracle-integrity-forensics-v12",
    assessmentLanes:
      file?.oracle?.assessments?.integrity?.status === "passed" &&
      typeof file?.oracle?.assessments?.origin?.status === "string",
    contentCredentials:
      typeof file?.oracle?.technical?.contentCredentials?.status === "string",
    chromaprint:
      file?.oracle?.technical?.fingerprint?.status === "measured",
    resourcePolicy:
      evidence.source?.resourceLimits?.concurrency === 1 &&
      evidence.source?.resourceLimits?.workerMemoryMb === 128 &&
      evidence.source?.resourceLimits?.ffmpegThreads === 1 &&
      evidence.source?.resourceLimits?.nativeProcessMemoryMb === 512,
    noCredentialMaterial:
      !/acoustidApiKey|--acoustid-key/iu.test(evidenceText),
  };
  const passed = Object.values(checks).every(Boolean);
  await fs.writeFile(
    path.join(root, "build", "cli-validation-latest.json"),
    `${JSON.stringify({
      schema: "Audio-V headless CLI validation v1",
      measuredAt: new Date().toISOString(),
      checks,
      passed,
    }, null, 2)}\n`,
  );
  if (!passed) {
    throw new Error(`CLI validation failed: ${JSON.stringify(checks)}`);
  }
  console.log("Verified headless CLI v12 evidence lanes, native resource policy, and credential boundary.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
