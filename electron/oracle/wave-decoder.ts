import { promises as fs } from "node:fs";
import type { SignalMeasurements } from "../../shared/contracts";
import { PcmMeasurementAccumulator } from "./pcm-measurements";
import { SpectrogramAccumulator } from "./spectrogram";

interface WaveFormat {
  encoding: "pcm" | "float";
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
}

interface WaveLayout {
  format: WaveFormat;
  dataOffset: number;
  dataSize: number;
}

const riffHeaderSize = 12;
const chunkHeaderSize = 8;

function parseWaveFormat(bytes: Buffer): WaveFormat {
  if (bytes.length < 16) throw new Error("WAVE fmt chunk is truncated.");
  let formatTag = bytes.readUInt16LE(0);
  const channels = bytes.readUInt16LE(2);
  const sampleRate = bytes.readUInt32LE(4);
  const blockAlign = bytes.readUInt16LE(12);
  const bitsPerSample = bytes.readUInt16LE(14);

  if (formatTag === 0xfffe) {
    if (bytes.length < 40) {
      throw new Error("WAVE_FORMAT_EXTENSIBLE fmt chunk is truncated.");
    }
    formatTag = bytes.readUInt16LE(24);
  }

  const encoding =
    formatTag === 1 ? "pcm" : formatTag === 3 ? "float" : null;
  if (!encoding) {
    throw new Error(`Unsupported WAVE encoding tag ${formatTag}.`);
  }
  if (!channels || !sampleRate || !blockAlign || !bitsPerSample) {
    throw new Error("WAVE fmt chunk contains invalid zero-valued fields.");
  }
  const bytesPerSample = bitsPerSample / 8;
  if (!Number.isInteger(bytesPerSample)) {
    throw new Error(`Unsupported ${bitsPerSample}-bit WAVE sample width.`);
  }
  if (blockAlign !== channels * bytesPerSample) {
    throw new Error("WAVE block alignment does not match its channel layout.");
  }
  if (
    (encoding === "pcm" && ![8, 16, 24, 32].includes(bitsPerSample)) ||
    (encoding === "float" && ![32, 64].includes(bitsPerSample))
  ) {
    throw new Error(
      `Unsupported ${bitsPerSample}-bit ${encoding.toUpperCase()} WAVE data.`,
    );
  }

  return { encoding, channels, sampleRate, bitsPerSample, blockAlign };
}

async function readExactly(
  handle: fs.FileHandle,
  length: number,
  position: number,
): Promise<Buffer> {
  const output = Buffer.alloc(length);
  const { bytesRead } = await handle.read(output, 0, length, position);
  if (bytesRead !== length) throw new Error("WAVE file is truncated.");
  return output;
}

async function readWaveLayout(
  handle: fs.FileHandle,
  fileSize: number,
): Promise<WaveLayout> {
  const header = await readExactly(handle, riffHeaderSize, 0);
  if (header.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("Only RIFF WAVE files are supported by the PCM preview engine.");
  }
  if (header.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("RIFF file does not contain WAVE audio.");
  }

  let position = riffHeaderSize;
  let format: WaveFormat | null = null;
  let dataOffset = -1;
  let dataSize = -1;

  while (position + chunkHeaderSize <= fileSize) {
    const chunk = await readExactly(handle, chunkHeaderSize, position);
    const chunkId = chunk.toString("ascii", 0, 4);
    const chunkSize = chunk.readUInt32LE(4);
    const payloadOffset = position + chunkHeaderSize;
    if (payloadOffset + chunkSize > fileSize) {
      throw new Error(`WAVE ${chunkId} chunk exceeds the file boundary.`);
    }

    if (chunkId === "fmt ") {
      format = parseWaveFormat(
        await readExactly(handle, chunkSize, payloadOffset),
      );
    } else if (chunkId === "data") {
      dataOffset = payloadOffset;
      dataSize = chunkSize;
    }

    position = payloadOffset + chunkSize + (chunkSize % 2);
    if (format && dataOffset >= 0) break;
  }

  if (!format) throw new Error("WAVE file has no fmt chunk.");
  if (dataOffset < 0) throw new Error("WAVE file has no data chunk.");
  if (dataSize % format.blockAlign !== 0) {
    throw new Error("WAVE data ends with an incomplete audio frame.");
  }
  return { format, dataOffset, dataSize };
}

function decodeSample(
  bytes: Buffer,
  offset: number,
  format: WaveFormat,
): number {
  if (format.encoding === "float") {
    return format.bitsPerSample === 32
      ? bytes.readFloatLE(offset)
      : bytes.readDoubleLE(offset);
  }
  if (format.bitsPerSample === 8) return (bytes.readUInt8(offset) - 128) / 128;
  if (format.bitsPerSample === 16) return bytes.readInt16LE(offset) / 32_768;
  if (format.bitsPerSample === 24) return bytes.readIntLE(offset, 3) / 8_388_608;
  return bytes.readInt32LE(offset) / 2_147_483_648;
}

export async function analyzePcmWave(
  filePath: string,
): Promise<SignalMeasurements> {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const layout = await readWaveLayout(handle, stat.size);
    const measurement = new PcmMeasurementAccumulator(
      layout.format.sampleRate,
      layout.format.channels,
    );
    const spectrogram = new SpectrogramAccumulator(
      layout.format.sampleRate,
      layout.format.channels,
      layout.dataSize / layout.format.blockAlign,
    );
    const bytesPerSample = layout.format.bitsPerSample / 8;
    const targetChunkBytes =
      Math.floor((256 * 1024) / layout.format.blockAlign) *
      layout.format.blockAlign;

    let remaining = layout.dataSize;
    let position = layout.dataOffset;
    while (remaining > 0) {
      const length = Math.min(remaining, targetChunkBytes);
      const bytes = await readExactly(handle, length, position);
      const samples = new Float64Array(length / bytesPerSample);
      for (
        let byteOffset = 0, sampleIndex = 0;
        byteOffset < bytes.length;
        byteOffset += bytesPerSample, sampleIndex += 1
      ) {
        samples[sampleIndex] = decodeSample(bytes, byteOffset, layout.format);
      }
      measurement.pushInterleaved(samples);
      spectrogram.pushInterleaved(samples);
      position += length;
      remaining -= length;
    }

    const measuredSpectrogram = spectrogram.finish();
    return {
      ...measurement.finish(),
      spectrogram: measuredSpectrogram,
      spectrogramPyramid: [measuredSpectrogram],
    };
  } finally {
    await handle.close();
  }
}
