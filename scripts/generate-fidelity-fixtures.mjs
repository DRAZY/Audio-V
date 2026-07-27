import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const ffmpeg = process.env.FFMPEG_FIXTURE_GENERATOR ?? "/opt/homebrew/bin/ffmpeg";
const output = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "fidelity-engine",
);
await fs.mkdir(output, { recursive: true });

function run(args) {
  execFileSync(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args]);
}

const source48 = path.join(output, "wideband-source-48.flac");
const source44 = path.join(output, "wideband-source-44.flac");
const lossyMp3 = path.join(output, ".intermediate-128.mp3");

run([
  "-f", "lavfi",
  "-i", "anoisesrc=color=white:sample_rate=48000:amplitude=0.08:duration=3:seed=41017",
  "-c:a", "flac",
  source48,
]);
run([
  "-f", "lavfi",
  "-i", "anoisesrc=color=white:sample_rate=44100:amplitude=0.08:duration=3:seed=9127",
  "-c:a", "flac",
  source44,
]);
run([
  "-f", "lavfi",
  "-i", "anoisesrc=color=white:sample_rate=96000:amplitude=0.08:duration=3:seed=77191",
  "-c:a", "flac",
  path.join(output, "native-wideband-96.flac"),
]);
run([
  "-i", source48,
  "-c:a", "libmp3lame",
  "-b:a", "128k",
  lossyMp3,
]);
run([
  "-i", lossyMp3,
  "-c:a", "flac",
  path.join(output, "mp3-128-transcoded-to-flac.flac"),
]);
run([
  "-i", source44,
  "-ar", "96000",
  "-c:a", "flac",
  path.join(output, "upsampled-44-to-96.flac"),
]);
run([
  "-f", "lavfi",
  "-i", "anoisesrc=color=white:sample_rate=44100:amplitude=0.08:duration=3:seed=53117",
  "-af", "lowpass=f=12000",
  "-c:a", "flac",
  path.join(output, "intentional-lowpass-44.flac"),
]);
run([
  "-f", "lavfi",
  "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
  "-t", "3",
  "-c:a", "flac",
  path.join(output, "digital-silence-44.flac"),
]);
run([
  "-f", "lavfi",
  "-i", "anoisesrc=color=white:sample_rate=44100:amplitude=0.08:duration=1:seed=7117",
  "-c:a", "flac",
  path.join(output, "short-wideband-44.flac"),
]);
run([
  "-f", "lavfi",
  "-i", "sine=frequency=1000:sample_rate=44100:duration=3",
  "-c:a", "flac",
  path.join(output, "tonal-source-44.flac"),
]);
await fs.rm(lossyMp3, { force: true });

console.log("Generated deterministic fidelity validation fixtures.");
