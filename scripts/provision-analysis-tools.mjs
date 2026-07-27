import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const downloads = {
  c2paMac: {
    url: "https://github.com/contentauth/c2pa-rs/releases/download/c2patool-v0.27.3/c2patool-v0.27.3-universal-apple-darwin.zip",
    sha256: "38c5be2af2d68887058d663cecd4212d8bbc7a0ce262e32f13b1c7e0f07c227e",
  },
  c2paWin: {
    url: "https://github.com/contentauth/c2pa-rs/releases/download/c2patool-v0.27.3/c2patool-v0.27.3-x86_64-pc-windows-msvc.zip",
    sha256: "bc721220ee17e64243cfc3666b574a6d0abfa67507f57a4201de752aafee4b53",
  },
  fingerprintMac: {
    url: "https://github.com/acoustid/chromaprint/releases/download/v1.6.0/chromaprint-fpcalc-1.6.0-macos-universal.tar.gz",
    sha256: "31f654cce8308fcb22869d043770eb66afffed95e8a548fd877f0e670c16d7ec",
  },
  fingerprintWin: {
    url: "https://github.com/acoustid/chromaprint/releases/download/v1.6.0/chromaprint-fpcalc-1.6.0-windows-x86_64.zip",
    sha256: "30179d3d0dc4cc92f1a0995c1a2e523fb4867724c2ee6a6ceae474f8e4d6937a",
  },
};

async function download(name, directory) {
  const entry = downloads[name];
  const destination = path.join(directory, name);
  const response = await fetch(entry.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${name} download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== entry.sha256) {
    throw new Error(`${name} archive checksum mismatch: ${actual}`);
  }
  await fs.writeFile(destination, bytes);
  return destination;
}

async function findFile(directory, name) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFile(entryPath, name);
      if (nested) return nested;
    } else if (entry.name === name) {
      return entryPath;
    }
  }
  return null;
}

async function installTarget(
  target,
  c2paSource,
  fingerprintSource,
  licenseTexts,
) {
  const directory = path.join(root, "vendor", "ffmpeg", target);
  await fs.mkdir(directory, { recursive: true });
  const windows = target.startsWith("win-");
  const c2paName = windows ? "c2patool.exe" : "c2patool";
  const fingerprintName = windows ? "fpcalc.exe" : "fpcalc";
  await fs.copyFile(c2paSource, path.join(directory, c2paName));
  await fs.copyFile(fingerprintSource, path.join(directory, fingerprintName));
  if (!windows) {
    await fs.chmod(path.join(directory, c2paName), 0o755);
    await fs.chmod(path.join(directory, fingerprintName), 0o755);
  }
  await fs.writeFile(
    path.join(directory, "c2pa-offline-settings.json"),
    `${JSON.stringify({
      version: 1,
      verify: {
        remote_manifest_fetch: false,
        ocsp_fetch: false,
      },
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(directory, "C2PATOOL_LICENSE_APACHE.txt"),
    licenseTexts.c2paApache,
  );
  await fs.writeFile(
    path.join(directory, "C2PATOOL_LICENSE_MIT.txt"),
    licenseTexts.c2paMit,
  );
  await fs.writeFile(
    path.join(directory, "CHROMAPRINT_LICENSE.txt"),
    licenseTexts.chromaprint,
  );
  const binaries = {};
  for (const name of [c2paName, fingerprintName]) {
    const bytes = await fs.readFile(path.join(directory, name));
    binaries[name] = {
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  await fs.writeFile(
    path.join(directory, "ANALYSIS_TOOL_PROVENANCE.json"),
    `${JSON.stringify({
      target,
      tools: {
        c2patool: {
          version: "0.27.3",
          license: "Apache-2.0 OR MIT",
          source: "https://github.com/contentauth/c2pa-rs",
        },
        fpcalc: {
          version: "1.6.0",
          license: "LGPL-2.1",
          source: "https://github.com/acoustid/chromaprint",
        },
      },
      binaries,
    }, null, 2)}\n`,
  );
}

const temporary = path.join(root, "tmp", `analysis-tools-${Date.now()}`);
await fs.mkdir(temporary, { recursive: true });
try {
  async function licenseText(url, name) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${name} license download failed: HTTP ${response.status}`);
    }
    return response.text();
  }
  const licenseTexts = {
    c2paApache: await licenseText(
      "https://raw.githubusercontent.com/contentauth/c2pa-rs/c2patool-v0.27.3/LICENSE-APACHE",
      "C2PA Apache",
    ),
    c2paMit: await licenseText(
      "https://raw.githubusercontent.com/contentauth/c2pa-rs/c2patool-v0.27.3/LICENSE-MIT",
      "C2PA MIT",
    ),
    chromaprint: await licenseText(
      "https://raw.githubusercontent.com/acoustid/chromaprint/v1.6.0/LICENSE.md",
      "Chromaprint",
    ),
  };
  const archives = Object.fromEntries(
    await Promise.all(
      Object.keys(downloads).map(async (name) => [name, await download(name, temporary)]),
    ),
  );
  const extracted = {};
  for (const [name, archive] of Object.entries(archives)) {
    const destination = path.join(temporary, `${name}-extracted`);
    await fs.mkdir(destination);
    execFileSync(process.platform === "win32" ? "tar.exe" : "tar", [
      "-xf",
      archive,
      "-C",
      destination,
    ]);
    extracted[name] = destination;
  }
  const c2paMac = await findFile(extracted.c2paMac, "c2patool");
  const c2paWin = await findFile(extracted.c2paWin, "c2patool.exe");
  const fingerprintMac = await findFile(extracted.fingerprintMac, "fpcalc");
  const fingerprintWin = await findFile(extracted.fingerprintWin, "fpcalc.exe");
  if (!c2paMac || !c2paWin || !fingerprintMac || !fingerprintWin) {
    throw new Error("One or more analysis-tool archives lacked the expected executable.");
  }
  for (const target of ["mac-arm64", "mac-x64", "mac-universal"]) {
    await installTarget(target, c2paMac, fingerprintMac, licenseTexts);
  }
  await installTarget(
    "win-x64",
    c2paWin,
    fingerprintWin,
    licenseTexts,
  );
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("Provisioned C2PA Tool 0.27.3 and Chromaprint fpcalc 1.6.0.");
