import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const targets =
  process.platform === "darwin"
    ? ["mac-arm64", "mac-x64", "mac-universal", "win-x64"]
    : process.platform === "win32"
      ? ["win-x64"]
      : [];
if (!targets.length) throw new Error(`Unsupported platform: ${process.platform}`);

for (const target of targets) {
  const directory = path.join(process.cwd(), "vendor", "ffmpeg", target);
  const provenance = JSON.parse(
    await fs.readFile(
      path.join(directory, "ANALYSIS_TOOL_PROVENANCE.json"),
      "utf8",
    ),
  );
  for (const [name, expected] of Object.entries(provenance.binaries)) {
    const bytes = await fs.readFile(path.join(directory, name));
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected.sha256) {
      throw new Error(`${target}/${name} checksum mismatch.`);
    }
  }
  const settings = JSON.parse(
    await fs.readFile(
      path.join(directory, "c2pa-offline-settings.json"),
      "utf8",
    ),
  );
  if (
    settings.verify?.remote_manifest_fetch !== false ||
    settings.verify?.ocsp_fetch !== false
  ) {
    throw new Error(`${target}: C2PA deterministic inspection is not offline.`);
  }
  for (const license of [
    "C2PATOOL_LICENSE_APACHE.txt",
    "C2PATOOL_LICENSE_MIT.txt",
    "CHROMAPRINT_LICENSE.txt",
  ]) {
    const text = await fs.readFile(path.join(directory, license), "utf8");
    if (text.length < 500) {
      throw new Error(`${target}/${license} is missing or incomplete.`);
    }
  }
}

if (process.platform === "darwin") {
  const native = process.arch === "x64" ? "mac-x64" : "mac-arm64";
  const directory = path.join(process.cwd(), "vendor", "ffmpeg", native);
  const c2paVersion = execFileSync(path.join(directory, "c2patool"), ["--version"], {
    encoding: "utf8",
  });
  const fingerprintVersion = execFileSync(path.join(directory, "fpcalc"), ["-version"], {
    encoding: "utf8",
  });
  if (!c2paVersion.includes("0.27.3") || !fingerprintVersion.includes("1.6.0")) {
    throw new Error("Analysis-tool version verification failed.");
  }
}

console.log("Verified offline C2PA and Chromaprint analysis tools.");
