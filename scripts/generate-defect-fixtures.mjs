import { promises as fs } from "node:fs";
import path from "node:path";

const sampleRate = 48_000;
const seconds = 2;
const frameCount = sampleRate * seconds;
const outputDirectory = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "defect-engine",
);

function wave(samples) {
  const dataSize = samples.length * 2;
  const output = Buffer.alloc(44 + dataSize);
  output.write("RIFF", 0);
  output.writeUInt32LE(36 + dataSize, 4);
  output.write("WAVE", 8);
  output.write("fmt ", 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36);
  output.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples.length; index += 1) {
    output.writeInt16LE(
      Math.max(-32_768, Math.min(32_767, Math.round(samples[index] * 32_767))),
      44 + index * 2,
    );
  }
  return output;
}

function cleanSignal() {
  return Array.from(
    { length: frameCount },
    (_, frame) => 0.2 * Math.sin((2 * Math.PI * 440 * frame) / sampleRate),
  );
}

await fs.mkdir(outputDirectory, { recursive: true });

const clean = cleanSignal();
const click = cleanSignal();
for (let frame = sampleRate - 4; frame <= sampleRate + 4; frame += 1) {
  click[frame] = frame === sampleRate ? 0.9 : 0;
}
const stuck = cleanSignal();
for (
  let frame = Math.round(sampleRate * 0.9);
  frame < Math.round(sampleRate * 1.05);
  frame += 1
) {
  stuck[frame] = 0.2;
}

await Promise.all([
  fs.writeFile(path.join(outputDirectory, "clean-control.wav"), wave(clean)),
  fs.writeFile(path.join(outputDirectory, "labeled-click.wav"), wave(click)),
  fs.writeFile(path.join(outputDirectory, "labeled-stuck-sample.wav"), wave(stuck)),
]);

console.log("Generated deterministic native PCM defect fixtures.");
