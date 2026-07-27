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
      "d9f64f4ffc0eab208dfcccc56e8945285ebdd9f2ab225c36d8fcdab1a08db5e1",
    "ffprobe.exe":
      "c73591e23b361d4c81dcf85870b4006513d4c7d00d1345fac7a249b035cd01a1",
    source:
      "BtbN FFmpeg-Builds n8.1 win64 LGPL static build, 2026-07-24",
  },
};

for (const [target, metadata] of Object.entries(engines)) {
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
