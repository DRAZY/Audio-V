import { promises as fs } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const lock = JSON.parse(
  await fs.readFile(path.join(projectRoot, "package-lock.json"), "utf8"),
);
const sections = [
  "Audio-V third-party software notices",
  "Generated from production dependencies in package-lock.json.",
  "",
  "The Audio-V project license has not yet been selected. The notices below",
  "cover third-party runtime packages and do not grant a license to Audio-V.",
  "",
];

for (const [packagePath, lockEntry] of Object.entries(lock.packages ?? {})) {
  if (
    packagePath === "" ||
    !packagePath.startsWith("node_modules/") ||
    lockEntry.dev === true ||
    lockEntry.optional === true
  ) {
    continue;
  }

  const absolutePackagePath = path.join(projectRoot, packagePath);
  let packageJson;
  try {
    packageJson = JSON.parse(
      await fs.readFile(path.join(absolutePackagePath, "package.json"), "utf8"),
    );
  } catch {
    continue;
  }

  const licenseName =
    packageJson.license ??
    (Array.isArray(packageJson.licenses)
      ? packageJson.licenses.map((entry) => entry.type).join(" OR ")
      : "UNKNOWN");
  const repository =
    typeof packageJson.repository === "string"
      ? packageJson.repository
      : packageJson.repository?.url;

  sections.push("=".repeat(78));
  sections.push(
    `${packageJson.name ?? packagePath.slice("node_modules/".length)} ${packageJson.version ?? lockEntry.version ?? ""}`,
  );
  sections.push(`License: ${licenseName}`);
  if (repository) sections.push(`Source: ${repository}`);

  const names = await fs.readdir(absolutePackagePath);
  const licenseFile = names
    .filter((name) => /^(licen[sc]e|copying|notice)(\..*)?$/i.test(name))
    .sort((left, right) => left.localeCompare(right))[0];

  if (licenseFile) {
    sections.push("");
    sections.push(
      await fs.readFile(path.join(absolutePackagePath, licenseFile), "utf8"),
    );
  } else {
    sections.push("License text was not included in the installed package.");
  }
  sections.push("");
}

await fs.writeFile(
  path.join(projectRoot, "build", "THIRD_PARTY_NOTICES.txt"),
  `${sections.join("\n").trim()}\n`,
  "utf8",
);

console.log("Wrote build/THIRD_PARTY_NOTICES.txt.");
