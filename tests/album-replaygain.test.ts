import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { measureAlbumReplayGain } from "../electron/oracle/album-replaygain";
import { runEngine } from "../electron/oracle/ffmpeg-runtime";

let temporaryDirectory = "";

afterEach(async () => {
  if (temporaryDirectory) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = "";
  }
});

describe("measureAlbumReplayGain", () => {
  it("concatenates complete tracks and calculates an RG2 album gain", async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(process.cwd(), "tests", ".tmp-album-rg-"),
    );
    const files = [
      path.join(temporaryDirectory, "01.wav"),
      path.join(temporaryDirectory, "02.wav"),
    ];
    for (const [index, file] of files.entries()) {
      await runEngine("ffmpeg", [
        "-nostdin", "-hide_banner", "-v", "error",
        "-f", "lavfi", "-i", `sine=frequency=${440 + index * 110}:duration=0.5`,
        "-c:a", "pcm_s16le", "-y", file,
      ]);
    }

    const result = await measureAlbumReplayGain(files);

    expect(Number.isFinite(result.integratedLufs)).toBe(true);
    expect(result.gainDb).toBeCloseTo(-18 - result.integratedLufs, 2);
  });

  it("supports digital album groups larger than the 99-track CD convention", async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(process.cwd(), "tests", ".tmp-large-album-rg-"),
    );
    const file = path.join(temporaryDirectory, "track.wav");
    await runEngine("ffmpeg", [
      "-nostdin", "-hide_banner", "-v", "error",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=0.01",
      "-c:a", "pcm_s16le", "-y", file,
    ]);

    const result = await measureAlbumReplayGain(
      Array.from({ length: 154 }, () => file),
    );

    expect(Number.isFinite(result.integratedLufs)).toBe(true);
    expect(result.gainDb).toBeCloseTo(-18 - result.integratedLufs, 2);
  });
});
