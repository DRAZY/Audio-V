import { execFileSync, spawnSync } from "node:child_process";
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

async function requireUnsignedPe(file) {
  const handle = await fs.open(file, "r");
  try {
    const dosHeader = Buffer.alloc(64);
    const dosRead = await handle.read(dosHeader, 0, dosHeader.length, 0);
    if (
      dosRead.bytesRead !== dosHeader.length ||
      dosHeader.toString("ascii", 0, 2) !== "MZ"
    ) {
      throw new Error(`${file} is not a readable PE executable.`);
    }
    const peOffset = dosHeader.readUInt32LE(0x3c);
    const peHeader = Buffer.alloc(176);
    const peRead = await handle.read(peHeader, 0, peHeader.length, peOffset);
    if (
      peRead.bytesRead !== peHeader.length ||
      peHeader.toString("ascii", 0, 4) !== "PE\u0000\u0000"
    ) {
      throw new Error(`${file} has an invalid PE header.`);
    }
    const optionalMagic = peHeader.readUInt16LE(24);
    const securityDirectoryOffset =
      optionalMagic === 0x10b ? 152 : optionalMagic === 0x20b ? 168 : null;
    if (securityDirectoryOffset === null) {
      throw new Error(
        `${file} has an unsupported PE optional-header format 0x${optionalMagic.toString(16)}.`,
      );
    }
    const certificateOffset = peHeader.readUInt32LE(securityDirectoryOffset);
    const certificateSize = peHeader.readUInt32LE(securityDirectoryOffset + 4);
    if (certificateOffset !== 0 || certificateSize !== 0) {
      throw new Error(
        `Unsigned package policy failed for ${file}: PE certificate table is present.`,
      );
    }
  } finally {
    await handle.close();
  }
}

function requireAdHocSignedApp(application) {
  execFileSync("codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=4",
    application,
  ], { stdio: "pipe" });
  const inspection = spawnSync("codesign", ["-dvvv", application], {
    encoding: "utf8",
  });
  const details = `${inspection.stdout ?? ""}\n${inspection.stderr ?? ""}`;
  if (
    inspection.status !== 0 ||
    !details.includes("Signature=adhoc") ||
    !details.includes("Identifier=app.audiov.desktop") ||
    !details.includes("Sealed Resources version=2")
  ) {
    throw new Error(
      `${application} is not a valid whole-bundle ad-hoc signature.`,
    );
  }
  if (
    details.includes("Authority=") ||
    (details.includes("TeamIdentifier=") &&
      !details.includes("TeamIdentifier=not set"))
  ) {
    throw new Error(
      `${application} unexpectedly contains a certificate identity.`,
    );
  }
}

async function requireQuarantineSafeSignature(application) {
  const verificationRoot = path.join(root, "tmp");
  await fs.mkdir(verificationRoot, { recursive: true });
  const temporary = await fs.mkdtemp(
    path.join(verificationRoot, "quarantine-signature-"),
  );
  const quarantinedCopy = path.join(temporary, "Audio-V.app");
  try {
    execFileSync("ditto", ["--noqtn", application, quarantinedCopy]);
    execFileSync("xattr", ["-cr", quarantinedCopy]);
    execFileSync("xattr", [
      "-w",
      "com.apple.quarantine",
      "0081;00000000;Audio-V;https://github.com/DRAZY/Audio-V",
      quarantinedCopy,
    ]);
    requireAdHocSignedApp(quarantinedCopy);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

async function verifyResources(resources, engineNames, cliName) {
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
  await requireFile(
    path.join(resources, "engine", "c2pa-offline-settings.json"),
    40,
  );
  await requireFile(path.join(resources, "cli", cliName), 50);
  await requireFile(
    path.join(resources, "engine", "ANALYSIS_TOOL_PROVENANCE.json"),
    100,
  );
  await requireFile(
    path.join(resources, "engine", "C2PATOOL_LICENSE_APACHE.txt"),
    1_000,
  );
  await requireFile(
    path.join(resources, "engine", "C2PATOOL_LICENSE_MIT.txt"),
    500,
  );
  await requireFile(
    path.join(resources, "engine", "CHROMAPRINT_LICENSE.txt"),
    1_000,
  );
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
    const application = path.dirname(contents);
    await requireFile(path.join(contents, "MacOS", "Audio-V"), 10_000);
    for (const permission of [
      "NSRemovableVolumesUsageDescription",
      "NSNetworkVolumesUsageDescription",
    ]) {
      const value = execFileSync("plutil", [
        "-extract",
        permission,
        "raw",
        "-o",
        "-",
        path.join(contents, "Info.plist"),
      ], { encoding: "utf8" }).trim();
      if (!value.includes("Audio-V")) {
        throw new Error(
          `${directory} is missing a meaningful ${permission} declaration.`,
        );
      }
    }
    await verifyResources(path.join(contents, "Resources"), [
      "ffmpeg",
      "ffprobe",
      "c2patool",
      "fpcalc",
    ], "audio-v-cli");
    requireAdHocSignedApp(application);
    await requireQuarantineSafeSignature(application);
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
  for (const engine of ["ffmpeg", "ffprobe", "c2patool", "fpcalc"]) {
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
  console.log(
    "Verified Apple Silicon and Universal ad-hoc-signed macOS packages without a Developer ID identity.",
  );
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
    await requireUnsignedPe(executable);
  }
  const unpacked = path.join(release, "win-unpacked");
  const unpackedExecutable = path.join(unpacked, "Audio-V.exe");
  await requireMagic(unpackedExecutable, Buffer.from("MZ"));
  await requireUnsignedPe(unpackedExecutable);
  await verifyResources(path.join(unpacked, "resources"), [
    "ffmpeg.exe",
    "ffprobe.exe",
    "c2patool.exe",
    "fpcalc.exe",
  ], "Audio-V-CLI.cmd");
  console.log("Verified Windows installer, portable executable, and resources.");
}
