import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const releaseDirectory = path.resolve("release");
const supportedArtifacts = /\.(dmg|exe)$/i;
const artifacts = (await readdir(releaseDirectory))
  .filter((name) => supportedArtifacts.test(name))
  .sort();

if (artifacts.length === 0) {
  throw new Error("No DMG or EXE artifacts were found in release/.");
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
