import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchWithRetry } from "./fetch-with-retry.mjs";

const root = process.cwd();
const sourceUrl = "https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz";
const sourceSha256 =
  "464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c";
const windowsUrl =
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27/ffmpeg-n8.1.2-50-g1a748fe2cd-win64-lgpl-8.1.zip";
const windowsSha256 =
  "f6274bbd9c247f9e90c1bbed066b03ed4a3907cece2fb91be6dd352393936365";

async function download(url, destination, expectedSha256) {
  const response = await fetchWithRetry(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedSha256) {
    throw new Error(`Checksum mismatch for ${url}: expected ${expectedSha256}, got ${actual}`);
  }
  await fs.writeFile(destination, bytes);
}

async function writeEngineNotices(directory, source) {
  const licenseText = await fs.readFile(
    path.join(root, "vendor", "ffmpeg", "mac-arm64", "COPYING.LGPLv2.1"),
    "utf8",
  ).catch(() =>
    fetchWithRetry(
      "https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.1.2/COPYING.LGPLv2.1",
    ).then((response) => response.text()),
  );
  await fs.writeFile(path.join(directory, "COPYING.LGPLv2.1"), licenseText);
  await fs.writeFile(
    path.join(directory, "FFMPEG_LICENSE.txt"),
    "FFmpeg is distributed by Audio-V under the GNU Lesser General Public License version 2.1 or later. See COPYING.LGPLv2.1.\n",
  );
  await fs.writeFile(
    path.join(directory, "FFMPEG_README.txt"),
    `Bundled decoder source: ${source}\nAudio-V uses an LGPL-only build with GPL and nonfree components disabled.\n`,
  );
}

async function buildMacEngines(temporaryRoot) {
  const archive = path.join(temporaryRoot, "ffmpeg-8.1.2.tar.xz");
  await download(sourceUrl, archive, sourceSha256);
  execFileSync("tar", ["-xf", archive, "-C", temporaryRoot], { stdio: "inherit" });
  const sourceDirectory = path.join(temporaryRoot, "ffmpeg-8.1.2");
  const common = [
    "--disable-gpl",
    "--disable-nonfree",
    "--disable-version3",
    "--disable-doc",
    "--disable-debug",
    "--disable-ffplay",
    "--disable-network",
    "--disable-autodetect",
    "--enable-static",
    "--disable-shared",
    "--enable-small",
    "--extra-cflags=-mmacosx-version-min=12.0",
    "--extra-ldflags=-mmacosx-version-min=12.0",
  ];
  for (const architecture of ["x64", "arm64"]) {
    const output = path.join(root, "vendor", "ffmpeg", `mac-${architecture}`);
    const build = path.join(temporaryRoot, `build-${architecture}`);
    await fs.mkdir(build, { recursive: true });
    const configure = [
      `--prefix=${output}`,
      `--arch=${architecture === "x64" ? "x86_64" : "arm64"}`,
      `--cc=${architecture === "x64" ? "clang -arch x86_64" : "clang"}`,
      ...(architecture === "x64" ? ["--disable-x86asm"] : []),
      ...common,
    ];
    execFileSync(path.join(sourceDirectory, "configure"), configure, {
      cwd: build,
      stdio: "inherit",
    });
    execFileSync("make", ["-j", String(Math.max(2, os.cpus().length))], {
      cwd: build,
      stdio: "inherit",
    });
    await fs.mkdir(output, { recursive: true });
    for (const executable of ["ffmpeg", "ffprobe"]) {
      const destination = path.join(output, executable);
      await fs.copyFile(path.join(build, executable), destination);
      await fs.chmod(destination, 0o755);
    }
    await writeEngineNotices(output, sourceUrl);
  }
  const universalOutput = path.join(
    root,
    "vendor",
    "ffmpeg",
    "mac-universal",
  );
  await fs.mkdir(universalOutput, { recursive: true });
  for (const executable of ["ffmpeg", "ffprobe"]) {
    execFileSync(
      "lipo",
      [
        "-create",
        path.join(root, "vendor", "ffmpeg", "mac-x64", executable),
        path.join(root, "vendor", "ffmpeg", "mac-arm64", executable),
        "-output",
        path.join(universalOutput, executable),
      ],
      { stdio: "inherit" },
    );
  }
  await writeEngineNotices(universalOutput, sourceUrl);
}

async function provisionWindowsEngine(temporaryRoot) {
  const archive = path.join(temporaryRoot, "ffmpeg-win64.zip");
  const extracted = path.join(temporaryRoot, "extracted");
  const output = path.join(root, "vendor", "ffmpeg", "win-x64");
  await download(windowsUrl, archive, windowsSha256);
  await fs.mkdir(extracted, { recursive: true });
  execFileSync("tar.exe", ["-xf", archive, "-C", extracted], {
    stdio: "inherit",
  });
  const entries = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else entries.push(entryPath);
    }
  }
  await visit(extracted);
  const ffmpeg = entries.find((entry) => path.basename(entry) === "ffmpeg.exe");
  const ffprobe = entries.find((entry) => path.basename(entry) === "ffprobe.exe");
  if (!ffmpeg || !ffprobe) throw new Error("Downloaded archive has no FFmpeg tools.");
  await fs.mkdir(output, { recursive: true });
  await fs.copyFile(ffmpeg, path.join(output, "ffmpeg.exe"));
  await fs.copyFile(ffprobe, path.join(output, "ffprobe.exe"));
  await writeEngineNotices(output, windowsUrl);
}

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "audio-v-engine-"));
try {
  if (process.platform === "darwin") await buildMacEngines(temporaryRoot);
  else if (process.platform === "win32") await provisionWindowsEngine(temporaryRoot);
  else throw new Error(`Engine provisioning is not supported on ${process.platform}.`);
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

console.log(`Provisioned Audio-V engines for ${process.platform}.`);
