import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const publicRelease = process.argv.includes("--public");
const licenseCandidates = ["LICENSE", "LICENSE.md", "COPYING"];
let license = null;
for (const candidate of licenseCandidates) {
  try {
    await access(path.join(root, candidate));
    license = candidate;
    break;
  } catch {
    // Continue through the explicit candidates.
  }
}

const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const expectedTag = `v${packageJson.version}`;
const actualTag = process.env.GITHUB_REF_NAME ?? null;
const failures = [];

if (!license) {
  const message =
    "No project LICENSE file exists. Public source is not legally open source until the copyright holder selects and adds a license.";
  if (publicRelease) failures.push(message);
  else console.warn(`WARNING: ${message}`);
}
if (publicRelease && actualTag !== expectedTag) {
  failures.push(
    `Release tag ${actualTag ?? "(missing)"} does not match package version ${expectedTag}.`,
  );
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Release policy verified (${license ?? "development mode; license pending"}, expected tag ${expectedTag}).`,
  );
}
