import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const releaseDirectory = path.resolve("release");
const packageJson = JSON.parse(
  await readFile(path.resolve("package.json"), "utf8"),
);
const artifacts = [
  `Audio-V-${packageJson.version}-mac-arm64.dmg`,
  `Audio-V-${packageJson.version}-mac-universal.dmg`,
  `Audio-V-${packageJson.version}-win-x64.exe`,
  `Audio-V-Portable-${packageJson.version}-x64.exe`,
].sort();
const available = new Set(await readdir(releaseDirectory));
const missing = artifacts.filter((name) => !available.has(name));
if (missing.length) {
  throw new Error(`Current-version release artifacts are missing: ${missing.join(", ")}`);
}

const lines = [];
for (const artifact of artifacts) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(
    path.join(releaseDirectory, artifact),
  )) {
    hash.update(chunk);
  }
  const digest = hash.digest("hex");
  lines.push(`${digest}  ${artifact}`);
}

await writeFile(
  path.join(releaseDirectory, "SHA256SUMS.txt"),
  `${lines.join("\n")}\n`,
  "utf8",
);

console.log(`Wrote checksums for ${artifacts.length} release artifact(s).`);
