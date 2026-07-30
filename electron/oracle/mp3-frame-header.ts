import { open } from "node:fs/promises";
import type { Mp3ChannelMode } from "../../shared/contracts";

const maximumProbeBytes = 256 * 1024;

interface ParsedMp3FrameHeader {
  version: 1 | 2 | 2.5;
  layer: 1 | 2 | 3;
  sampleRate: number;
  frameLength: number;
  channelMode: Mp3ChannelMode;
}

const mpeg1Bitrates = {
  1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
} as const;
const mpeg2Bitrates = {
  1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
} as const;
const sampleRates = {
  1: [44_100, 48_000, 32_000],
  2: [22_050, 24_000, 16_000],
  2.5: [11_025, 12_000, 8_000],
} as const;
const channelModes: Mp3ChannelMode[] = [
  "Stereo",
  "Joint Stereo",
  "Dual Channel",
  "Mono",
];

function parsedHeader(
  bytes: Uint8Array,
  offset: number,
): ParsedMp3FrameHeader | null {
  if (
    offset < 0 ||
    offset + 4 > bytes.length ||
    bytes[offset] !== 0xff ||
    (bytes[offset + 1] & 0xe0) !== 0xe0
  ) {
    return null;
  }
  const versionBits = (bytes[offset + 1] >> 3) & 0x03;
  const layerBits = (bytes[offset + 1] >> 1) & 0x03;
  if (versionBits === 1 || layerBits === 0) return null;
  const version: ParsedMp3FrameHeader["version"] =
    versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
  const layer: ParsedMp3FrameHeader["layer"] =
    layerBits === 3 ? 1 : layerBits === 2 ? 2 : 3;
  const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
  const sampleRateIndex = (bytes[offset + 2] >> 2) & 0x03;
  if (
    bitrateIndex === 0 ||
    bitrateIndex === 0x0f ||
    sampleRateIndex === 0x03
  ) {
    return null;
  }
  const bitrate =
    (version === 1 ? mpeg1Bitrates : mpeg2Bitrates)[layer][bitrateIndex];
  const sampleRate = sampleRates[version][sampleRateIndex];
  const padding = (bytes[offset + 2] >> 1) & 0x01;
  const frameLength =
    layer === 1
      ? Math.floor((12 * bitrate * 1_000) / sampleRate + padding) * 4
      : Math.floor(
          ((layer === 3 && version !== 1 ? 72 : 144) *
            bitrate *
            1_000) /
            sampleRate +
            padding,
        );
  if (frameLength < 24) return null;
  return {
    version,
    layer,
    sampleRate,
    frameLength,
    channelMode: channelModes[(bytes[offset + 3] >> 6) & 0x03],
  };
}

export function parseMp3ChannelMode(
  bytes: Uint8Array,
): Mp3ChannelMode | null {
  for (let offset = 0; offset + 4 <= bytes.length; offset += 1) {
    const header = parsedHeader(bytes, offset);
    if (!header) continue;
    const nextOffset = offset + header.frameLength;
    const next = parsedHeader(bytes, nextOffset);
    if (
      next &&
      next.version === header.version &&
      next.layer === header.layer &&
      next.sampleRate === header.sampleRate
    ) {
      return header.channelMode;
    }
    offset += 3;
  }
  return null;
}

function id3AudioOffset(header: Uint8Array): number {
  if (
    header.length < 10 ||
    header[0] !== 0x49 ||
    header[1] !== 0x44 ||
    header[2] !== 0x33
  ) {
    return 0;
  }
  const size =
    ((header[6] & 0x7f) << 21) |
    ((header[7] & 0x7f) << 14) |
    ((header[8] & 0x7f) << 7) |
    (header[9] & 0x7f);
  const footerBytes = (header[5] & 0x10) !== 0 ? 10 : 0;
  return 10 + size + footerBytes;
}

export async function inspectMp3ChannelMode(
  filePath: string,
): Promise<Mp3ChannelMode | null> {
  const handle = await open(filePath, "r");
  try {
    const header = Buffer.alloc(10);
    const headerRead = await handle.read(header, 0, header.length, 0);
    const audioOffset = id3AudioOffset(header.subarray(0, headerRead.bytesRead));
    const stat = await handle.stat();
    const probeLength = Math.min(
      maximumProbeBytes,
      Math.max(0, stat.size - audioOffset),
    );
    if (probeLength < 4) return null;
    const probe = Buffer.alloc(probeLength);
    const read = await handle.read(probe, 0, probeLength, audioOffset);
    return parseMp3ChannelMode(probe.subarray(0, read.bytesRead));
  } finally {
    await handle.close();
  }
}
