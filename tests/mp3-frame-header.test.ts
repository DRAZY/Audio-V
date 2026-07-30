import { describe, expect, it } from "vitest";
import {
  parseMp3ChannelMode,
} from "../electron/oracle/mp3-frame-header";
import type { Mp3ChannelMode } from "../shared/contracts";

function mpeg1Layer3Frames(mode: Mp3ChannelMode): Uint8Array {
  const modeIndex: Record<Mp3ChannelMode, number> = {
    Stereo: 0,
    "Joint Stereo": 1,
    "Dual Channel": 2,
    Mono: 3,
  };
  // MPEG-1 Layer III, 128 kbps, 44.1 kHz: 417 bytes per frame.
  const frameLength = Math.floor((144 * 128_000) / 44_100);
  const bytes = new Uint8Array(frameLength * 2);
  for (const offset of [0, frameLength]) {
    bytes.set(
      [0xff, 0xfb, 0x90, modeIndex[mode] << 6],
      offset,
    );
  }
  return bytes;
}

describe("MP3 frame-header channel mode", () => {
  it.each([
    "Stereo",
    "Joint Stereo",
    "Dual Channel",
    "Mono",
  ] as Mp3ChannelMode[])("parses %s from consecutive MPEG frames", (mode) => {
    expect(parseMp3ChannelMode(mpeg1Layer3Frames(mode))).toBe(mode);
  });

  it("ignores noise before a valid frame sequence", () => {
    const frames = mpeg1Layer3Frames("Joint Stereo");
    const bytes = new Uint8Array(frames.length + 19);
    bytes.fill(0x53, 0, 19);
    bytes.set(frames, 19);
    expect(parseMp3ChannelMode(bytes)).toBe("Joint Stereo");
  });

  it("does not classify arbitrary data as an MP3 channel mode", () => {
    expect(parseMp3ChannelMode(new Uint8Array(1024).fill(0x53))).toBeNull();
  });

  it("requires a compatible second frame instead of trusting one sync word", () => {
    const bytes = mpeg1Layer3Frames("Stereo");
    bytes.fill(0, 417);
    expect(parseMp3ChannelMode(bytes)).toBeNull();
  });
});
