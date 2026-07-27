import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzePcmWave } from "../electron/oracle/wave-decoder";
import { pcmWave } from "./helpers/wave-fixture";

const temporaryDirectories: string[] = [];

async function writeFixture(bytes: Buffer): Promise<string> {
  const directory = await fs.mkdtemp(path.join(process.cwd(), "tests/.tmp-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "fixture.wav");
  await fs.writeFile(filePath, bytes);
  return filePath;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("analyzePcmWave", () => {
  it("streams PCM frames into objective signal measurements", async () => {
    const filePath = await writeFixture(
      pcmWave({ sampleRate: 48_000, channels: 2, seconds: 0.5, amplitude: 0.5 }),
    );

    const result = await analyzePcmWave(filePath);

    expect(result.sampleRate).toBe(48_000);
    expect(result.channels).toBe(2);
    expect(result.frames).toBe(24_000);
    expect(result.durationSeconds).toBe(0.5);
    expect(result.samplePeakDbfs).toBeCloseTo(-6.0206, 2);
    expect(result.rmsDbfs).toBeCloseTo(-9.0309, 2);
    expect(result.duplicatedMono).toBe(true);
    expect(result.stereoCorrelation).toBeCloseTo(1, 6);
    expect(result.spectrogram.algorithm).toBe("STFT");
    expect(result.spectrogram.fftSize).toBe(512);
    expect(result.spectrogram.slices.length).toBeGreaterThan(10);
    expect(result.spectrogram.slices.length).toBeLessThanOrEqual(180);
    const averageByBin = result.spectrogram.slices[0].levelsDbfs.map((_, bin) =>
      result.spectrogram.slices.reduce(
        (sum, slice) => sum + slice.levelsDbfs[bin],
        0,
      ) / result.spectrogram.slices.length,
    );
    const dominantBin = averageByBin.indexOf(Math.max(...averageByBin));
    expect(dominantBin).toBeCloseTo((440 * 512) / 48_000, 0);
  });

  it("rejects truncated data as deterministic corruption", async () => {
    const valid = pcmWave({ seconds: 0.1 });
    const filePath = await writeFixture(valid.subarray(0, valid.length - 13));

    await expect(analyzePcmWave(filePath)).rejects.toThrow(
      /exceeds the file boundary|truncated/,
    );
  });

  it("rejects non-WAVE RIFF content", async () => {
    const invalid = Buffer.alloc(20);
    invalid.write("RIFF", 0);
    invalid.write("AVI ", 8);
    const filePath = await writeFixture(invalid);

    await expect(analyzePcmWave(filePath)).rejects.toThrow(
      /does not contain WAVE/,
    );
  });
});
