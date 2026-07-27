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
    result.engineVersions?.[0] !== "0.6.0-oracle-v8"
  ) {
    throw new Error(
      `Packaged runtime returned an unexpected audit result: ${JSON.stringify(result)}`,
    );
  }
  console.log(
    `Verified packaged ${target} runtime: one FLAC fully analyzed as ${result.verdicts[0]} by ${result.engineVersions[0]}.`,
  );
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}
