import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const platform = process.argv[2];
if (!["mac", "win"].includes(platform)) {
  throw new Error(
    "Usage: node scripts/verify-release-artifacts.mjs <mac|win>",
  );
}
const root = process.cwd();
const release = path.join(root, "release");
const productVersion = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
).version;

async function requireFile(file, minimumBytes = 1) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size < minimumBytes) {
    throw new Error(`${file} is missing, not a file, or unexpectedly small.`);
  }
}

async function requireMagic(file, expected) {
  const handle = await fs.open(file, "r");
  try {
    const bytes = Buffer.alloc(expected.length);
    await handle.read(bytes, 0, bytes.length, 0);
    if (!bytes.equals(expected)) {
      throw new Error(`${file} has an unexpected file signature.`);
    }
  } finally {
    await handle.close();
  }
}

async function verifyResources(resources, engineNames) {
  await requireFile(path.join(resources, "app.asar"), 100_000);
  await requireFile(path.join(resources, "engine-manifest.json"), 100);
  await requireFile(path.join(resources, "THIRD_PARTY_NOTICES.txt"), 100);
  await requireFile(path.join(resources, "LICENSE.txt"), 30_000);
  await requireFile(path.join(resources, "NOTICE.txt"), 100);
  await requireFile(path.join(resources, "SOURCE_OFFER.md"), 100);
  await requireFile(path.join(resources, "TRADEMARKS.md"), 100);
  for (const engine of engineNames) {
    await requireFile(path.join(resources, "engine", engine), 1_000_000);
  }
}

if (platform === "mac") {
  const armDmg = path.join(
    release,
    `Audio-V-${productVersion}-mac-arm64.dmg`,
  );
  const universalDmg = path.join(
    release,
    `Audio-V-${productVersion}-mac-universal.dmg`,
  );
  await requireFile(armDmg, 10_000_000);
  await requireFile(universalDmg, 10_000_000);
  for (const directory of ["mac-arm64", "mac-universal"]) {
    const contents = path.join(release, directory, "Audio-V.app", "Contents");
    await requireFile(path.join(contents, "MacOS", "Audio-V"), 10_000);
    await verifyResources(path.join(contents, "Resources"), [
      "ffmpeg",
      "ffprobe",
    ]);
  }
  const universalExecutable = path.join(
    release,
    "mac-universal",
    "Audio-V.app",
    "Contents",
    "MacOS",
    "Audio-V",
  );
  const architectures = execFileSync("lipo", [
    "-archs",
    universalExecutable,
  ], { encoding: "utf8" }).trim().split(/\s+/u);
  if (!architectures.includes("arm64") || !architectures.includes("x86_64")) {
    throw new Error(
      `Universal application is missing an architecture: ${architectures.join(", ")}`,
    );
  }
  for (const engine of ["ffmpeg", "ffprobe"]) {
    const enginePath = path.join(
      release,
      "mac-universal",
      "Audio-V.app",
      "Contents",
      "Resources",
      "engine",
      engine,
    );
    const engineArchitectures = execFileSync("lipo", ["-archs", enginePath], {
      encoding: "utf8",
    }).trim().split(/\s+/u);
    if (
      !engineArchitectures.includes("arm64") ||
      !engineArchitectures.includes("x86_64")
    ) {
      throw new Error(
        `Universal ${engine} is missing an architecture: ${engineArchitectures.join(", ")}`,
      );
    }
  }
  try {
    execFileSync("codesign", [
      "--verify",
      "--deep",
      "--strict",
      path.join(release, "mac-universal", "Audio-V.app"),
    ], { stdio: "pipe" });
    throw new Error(
      "Unsigned package policy failed: the macOS app unexpectedly has a valid code signature.",
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Unsigned package policy failed")
    ) {
      throw error;
    }
  }
  console.log("Verified Apple Silicon and Universal unsigned macOS packages.");
} else {
  const installer = path.join(
    release,
    `Audio-V-${productVersion}-win-x64.exe`,
  );
  const portable = path.join(
    release,
    `Audio-V-Portable-${productVersion}-x64.exe`,
  );
  for (const executable of [installer, portable]) {
    await requireFile(executable, 10_000_000);
    await requireMagic(executable, Buffer.from("MZ"));
  }
  const unpacked = path.join(release, "win-unpacked");
  await requireMagic(path.join(unpacked, "Audio-V.exe"), Buffer.from("MZ"));
  await verifyResources(path.join(unpacked, "resources"), [
    "ffmpeg.exe",
    "ffprobe.exe",
  ]);
  if (process.platform === "win32") {
    for (const executable of [installer, portable]) {
      const status = execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(Get-AuthenticodeSignature -LiteralPath '${executable.replaceAll("'", "''")}').Status`,
        ],
        { encoding: "utf8" },
      ).trim();
      if (status !== "NotSigned") {
        throw new Error(
          `Unsigned package policy failed for ${executable}: ${status}`,
        );
      }
    }
  }
  console.log("Verified Windows installer, portable executable, and resources.");
}
