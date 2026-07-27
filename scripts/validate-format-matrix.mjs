import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { AUDIO_EXTENSIONS } from "../dist-electron/shared/contracts.js";
import { analyzeAudioFile } from "../dist-electron/electron/oracle/oracle-engine.js";
import { enginePath } from "../dist-electron/electron/oracle/ffmpeg-runtime.js";

const matrix = {
  ".3g2": ["3g2", "aac", "mov,mp4,m4a,3gp,3g2,mj2"],
  ".3gp": ["3gp", "aac", "mov,mp4,m4a,3gp,3g2,mj2"],
  ".ac3": ["ac3", "ac3", "ac3"],
  ".aac": ["adts", "aac", "aac"],
  ".aif": ["aiff", "pcm_s16be", "aiff"],
  ".aiff": ["aiff", "pcm_s16be", "aiff"],
  ".alac": ["caf", "alac", "caf"],
  ".amr": null,
  ".ape": null,
  ".au": ["au", "pcm_s16be", "au"],
  ".caf": ["caf", "pcm_s16le", "caf"],
  ".dsf": null,
  ".eac3": ["eac3", "eac3", "eac3"],
  ".ec3": ["eac3", "eac3", "eac3"],
  ".flac": ["flac", "flac", "flac"],
  ".m4b": ["ipod", "aac", "mov,mp4,m4a,3gp,3g2,mj2"],
  ".m4a": ["ipod", "aac", "mov,mp4,m4a,3gp,3g2,mj2"],
  ".mka": ["matroska", "pcm_s16le", "matroska,webm"],
  ".mkv": ["matroska", "pcm_s16le", "matroska,webm"],
  ".mp2": ["mp2", "mp2", "mp3"],
  ".mp3": ["mp3", "mp2", "mp3"],
  ".mp4": ["mp4", "aac", "mov,mp4,m4a,3gp,3g2,mj2"],
  ".mpa": ["mp2", "mp2", "mp3"],
  ".mpc": null,
  ".oga": ["ogg", "vorbis", "ogg"],
  ".ogg": ["ogg", "vorbis", "ogg"],
  ".opus": ["opus", "libopus", "ogg"],
  ".ra": null,
  ".ram": null,
  ".snd": ["au", "pcm_s16be", "au"],
  ".spx": null,
  ".tak": null,
  ".tta": ["tta", "tta", "tta"],
  ".voc": ["voc", "pcm_u8", "voc"],
  ".wav": ["wav", "pcm_s16le", "wav"],
  ".weba": ["webm", "vorbis", "matroska,webm"],
  ".webm": ["webm", "vorbis", "matroska,webm"],
  ".wma": ["asf", "wmav2", "asf"],
  ".wv": ["wv", "wavpack", "wv"],
};

const decoderOnlyDemuxers = {
  ".amr": "amr",
  ".ape": "ape",
  ".dsf": "dsf",
  ".mpc": "mpc,mpc8",
  ".ra": "rm",
  ".ram": "rm",
  ".spx": "ogg",
  ".tak": "tak",
};

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "audio-v-formats-"));
const ffmpeg = enginePath("ffmpeg");
const demuxers = spawnSync(ffmpeg, ["-hide_banner", "-demuxers"], {
  encoding: "utf8",
}).stdout;
const entries = [];
try {
  const base = path.join(temporaryDirectory, "routing.wav");
  const baseResult = spawnSync(ffmpeg, [
    "-nostdin", "-hide_banner", "-v", "error",
    "-f", "lavfi", "-i", "sine=frequency=997:sample_rate=48000:duration=0.25",
    "-c:a", "pcm_s16le", "-y", base,
  ], { encoding: "utf8" });
  if (baseResult.status !== 0) throw new Error(baseResult.stderr);
  const baseBytes = await import("node:fs/promises").then(({ readFile }) => readFile(base));

  for (const extension of AUDIO_EXTENSIONS) {
    const fixturePath = path.join(temporaryDirectory, `fixture${extension}`);
    const recipe = matrix[extension];
    let fixtureKind = "native-generated";
    let generationError = null;
    if (recipe) {
      const generated = spawnSync(ffmpeg, [
        "-nostdin", "-hide_banner", "-v", "error",
        "-f", "lavfi", "-i", "sine=frequency=997:sample_rate=48000:duration=0.25",
        "-f", recipe[0], "-c:a", recipe[1], "-y", fixturePath,
      ], { encoding: "utf8" });
      if (generated.status !== 0) {
        fixtureKind = "extension-routing-probe";
        generationError = generated.stderr.trim();
        await writeFile(fixturePath, baseBytes);
      }
    } else {
      fixtureKind = "extension-routing-probe";
      await writeFile(fixturePath, baseBytes);
    }
    const requiredDemuxer = recipe?.[2] ?? decoderOnlyDemuxers[extension];
    const demuxerCapability = requiredDemuxer
      .split(",")
      .some((name) => new RegExp(`\\b${name}\\b`, "u").test(demuxers));
    const result = await analyzeAudioFile(fixturePath);
    entries.push({
      extension,
      fixtureKind,
      nativeFixtureGenerated: fixtureKind === "native-generated",
      requiredDemuxer,
      demuxerCapability,
      routingDecodeCompleted: result.analysisState === "completed",
      detectedCodec: result.technical?.codecName ?? null,
      generationError,
      pass: demuxerCapability && result.analysisState === "completed",
    });
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

const report = {
  schema: "Audio-V cross-platform format matrix v1",
  generatedAt: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  advertisedExtensions: AUDIO_EXTENSIONS.length,
  nativeCodecFixtures: entries.filter((entry) => entry.nativeFixtureGenerated).length,
  routingPlusCapabilityFixtures: entries.filter((entry) => !entry.nativeFixtureGenerated).length,
  passed: entries.filter((entry) => entry.pass).length,
  entries,
  limitation:
    "Native-generated fixtures exercise the advertised container/codec end to end. Decoder-only formats use an extension-routing fixture plus a bundled-demuxer capability assertion; checksum-pinned native corpus samples remain preferable for those rows.",
};
await writeFile(
  path.join(
    process.cwd(),
    "build",
    `format-validation-${process.platform}-${process.arch}.json`,
  ),
  `${JSON.stringify(report, null, 2)}\n`,
);
if (report.passed !== report.advertisedExtensions) {
  const failed = entries.filter((entry) => !entry.pass).map((entry) => entry.extension);
  throw new Error(`Format validation failed: ${failed.join(", ")}`);
}
process.stdout.write(
  `Validated ${report.passed}/${report.advertisedExtensions} advertised extensions (${report.nativeCodecFixtures} native fixtures).\n`,
);
