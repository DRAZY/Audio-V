import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const target = process.argv[2];
if (!["mac", "win"].includes(target)) {
  throw new Error("Usage: node scripts/verify-packaged-runtime.mjs <mac|win>");
}
if (
  (target === "mac" && process.platform !== "darwin") ||
  (target === "win" && process.platform !== "win32")
) {
  throw new Error(
    `${target === "mac" ? "macOS" : "Windows"} packaged-runtime verification must run on its native operating system. Cross-built artifacts can be structurally inspected here, but execution is intentionally not simulated.`,
  );
}
const root = process.cwd();
const executable =
  target === "mac"
    ? path.join(
        root,
        "release",
        "mac-arm64",
        "Audio-V.app",
        "Contents",
        "MacOS",
        "Audio-V",
      )
    : path.join(root, "release", "win-unpacked", "Audio-V.exe");
const temporaryDirectory = await fs.mkdtemp(
  path.join(os.tmpdir(), "audio-v-packaged-smoke-"),
);
const resultPath = path.join(temporaryDirectory, "result.json");
const source = path.join(
  root,
  "tests",
  "fixtures",
  "audio-engine",
  "reference.flac",
);

try {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        `--user-data-dir=${path.join(temporaryDirectory, "profile")}`,
        "--disable-gpu",
      ],
      {
        env: {
          ...process.env,
          AUDIO_V_ENABLE_QA: "1",
          AUDIO_V_QA_SOURCE: source,
          AUDIO_V_QA_RESULT_PATH: resultPath,
          ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        },
        stdio: "inherit",
      },
    );
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Packaged runtime audit timed out after 60 seconds."));
    }, 60_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  if (exitCode !== 0) {
    throw new Error(`Packaged runtime exited with code ${exitCode}.`);
  }
  const result = JSON.parse(await fs.readFile(resultPath, "utf8"));
  if (
    result.discovered !== 1 ||
    result.completed !== 1 ||
    !["verified", "review"].includes(result.verdicts?.[0]) ||
    result.engineVersions?.[0] !== "0.7.0-oracle-v9"
  ) {
    throw new Error(
      `Packaged runtime returned an unexpected audit result: ${JSON.stringify(result)}`,
    );
  }
  console.log(
    `Verified packaged ${target} runtime: one FLAC fully analyzed as ${result.verdicts[0]} by ${result.engineVersions[0]}.`,
  );
  const cliOutput = path.join(temporaryDirectory, "cli-evidence.json");
  const launcher =
    target === "mac"
      ? path.join(
          root,
          "release",
          "mac-arm64",
          "Audio-V.app",
          "Contents",
          "Resources",
          "cli",
          "audio-v-cli",
        )
      : path.join(
          root,
          "release",
          "win-unpacked",
          "resources",
          "cli",
          "Audio-V-CLI.cmd",
        );
  const cliCommand = target === "win" ? "cmd.exe" : launcher;
  const cliArguments = [
    ...(target === "win" ? ["/d", "/c", launcher] : []),
    source,
    "--output",
    cliOutput,
    "--concurrency",
    "1",
    "--ffmpeg-threads",
    "1",
    "--native-memory-mb",
    "512",
    "--fail-on",
    "never",
  ];
  const cliCode = await new Promise((resolve, reject) => {
    const child = spawn(cliCommand, cliArguments, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (cliCode !== 0) {
    throw new Error(`Packaged CLI exited with code ${cliCode}.`);
  }
  const cliEvidence = JSON.parse(await fs.readFile(cliOutput, "utf8"));
  if (
    cliEvidence.summary?.discovered !== 1 ||
    cliEvidence.files?.[0]?.oracle?.engineVersion !== "0.7.0-oracle-v9"
  ) {
    throw new Error("Packaged CLI did not produce v9 Oracle evidence.");
  }
  console.log(`Verified packaged ${target} CLI launcher and bundled engine.`);
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}
