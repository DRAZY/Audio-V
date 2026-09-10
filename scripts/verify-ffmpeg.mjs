import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const engines = {
  "mac-arm64": {
    ffmpeg: null,
    ffprobe: null,
    source: "FFmpeg 8.1.2 source release; local static LGPL build",
  },
  "mac-x64": {
    ffmpeg: null,
    ffprobe: null,
    source: "FFmpeg 8.1.2 source release; local static LGPL build",
  },
  "mac-universal": {
    ffmpeg: null,
    ffprobe: null,
    source:
      "FFmpeg 8.1.2 source release; combined x86_64 and arm64 static LGPL build",
  },
  "win-x64": {
    "ffmpeg.exe":
      "9c60da6c0b083110d59084ea39f60ae149aa3e031c3b4bb4f573fafa1c1e7cea",
    "ffprobe.exe":
      "67176fa62f89f94c3bcd379fd05677a25651569a2eb8880ec2194e62c82be412",
    source:
      "BtbN FFmpeg-Builds n8.1 win64 LGPL static build, retained monthly autobuild-2026-08-31-13-27",
  },
};

const platformTargets =
  process.platform === "darwin"
    ? ["mac-arm64", "mac-x64", "mac-universal"]
    : process.platform === "win32"
      ? ["win-x64"]
      : [];
if (platformTargets.length === 0) {
  throw new Error(`Engine verification is not supported on ${process.platform}.`);
}

for (const target of platformTargets) {
  const metadata = engines[target];
  const directory = path.join(process.cwd(), "vendor", "ffmpeg", target);
  const provenance = { target, source: metadata.source, binaries: {} };
  for (const [name, expected] of Object.entries(metadata)) {
    if (name === "source") continue;
    const binaryPath = path.join(directory, name);
    const bytes = await fs.readFile(binaryPath);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (expected && actual !== expected) {
      throw new Error(`${target}/${name}: expected ${expected}, got ${actual}`);
    }
    provenance.binaries[name] = { sha256: actual };
  }
  await fs.writeFile(
    path.join(directory, "ENGINE_PROVENANCE.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
}

const nativeTarget = process.arch === "x64" ? "mac-x64" : "mac-arm64";
if (process.platform === "darwin") {
  for (const executable of ["ffmpeg", "ffprobe"]) {
    const architectures = execFileSync(
      "lipo",
      [
        "-archs",
        path.join(
          process.cwd(),
          "vendor",
          "ffmpeg",
          "mac-universal",
          executable,
        ),
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split(/\s+/)
      .sort();
    if (architectures.join(" ") !== "arm64 x86_64") {
      throw new Error(
        `mac-universal/${executable} does not contain both arm64 and x86_64.`,
      );
    }
  }
  const version = execFileSync(
    path.join(process.cwd(), "vendor", "ffmpeg", nativeTarget, "ffmpeg"),
    ["-buildconf"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (
    !version.includes("--disable-gpl") ||
    !version.includes("--disable-nonfree") ||
    version.includes("--enable-gpl") ||
    version.includes("--enable-nonfree")
  ) {
    throw new Error("The native FFmpeg engine is not an LGPL-only build.");
  }
}

console.log("Verified FFmpeg/ffprobe engine checksums and LGPL build policy.");
