export function pcmWave({
  sampleRate = 44_100,
  channels = 1,
  seconds = 1,
  amplitude = 12_000 / 32_768,
}: {
  sampleRate?: number;
  channels?: number;
  seconds?: number;
  amplitude?: number;
} = {}): Buffer {
  const bitsPerSample = 16;
  const frames = Math.round(sampleRate * seconds);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = frames * blockAlign;
  const output = Buffer.alloc(44 + dataSize);

  output.write("RIFF", 0);
  output.writeUInt32LE(36 + dataSize, 4);
  output.write("WAVE", 8);
  output.write("fmt ", 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(channels, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * blockAlign, 28);
  output.writeUInt16LE(blockAlign, 32);
  output.writeUInt16LE(bitsPerSample, 34);
  output.write("data", 36);
  output.writeUInt32LE(dataSize, 40);

  for (let frame = 0; frame < frames; frame += 1) {
    const sample = Math.max(
      -32_768,
      Math.min(
        32_767,
        Math.round(
          Math.sin((frame / sampleRate) * 440 * Math.PI * 2) *
            amplitude *
            32_768,
        ),
      ),
    );
    for (let channel = 0; channel < channels; channel += 1) {
      output.writeInt16LE(sample, 44 + frame * blockAlign + channel * 2);
    }
  }

  return output;
}
