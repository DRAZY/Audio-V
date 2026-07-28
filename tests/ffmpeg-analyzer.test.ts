import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeWithFfmpeg } from "../electron/oracle/ffmpeg-analyzer";
import { analyzeAudioFile } from "../electron/oracle/oracle-engine";

const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "audio-engine");

const supportedFixtures = [
  ["reference-24bit.wav", "pcm_s24le"],
  ["reference.flac", "flac"],
  ["reference-cbr.mp3", "mp3"],
  ["reference-vbr.mp3", "mp3"],
  ["reference-aac.m4a", "aac"],
  ["reference-alac.m4a", "alac"],
  ["reference.ogg", "vorbis"],
  ["reference.opus", "opus"],
  ["reference.aiff", "pcm_s24be"],
  ["reference.wv", "wavpack"],
] as const;

describe("FFmpeg Oracle analyzer", () => {
  it.each(supportedFixtures)(
    "fully decodes and measures %s",
    async (name, codec) => {
      const result = await analyzeWithFfmpeg(path.join(fixtureRoot, name));

      expect(result.technical.codecName).toBe(codec);
      expect(result.technical.codecLongName.toLowerCase()).not.toBe("unknown");
      expect(result.measurements.decodeIntegrity).toBe("complete");
      expect(result.measurements.frames).toBeGreaterThan(0);
      expect(result.measurements.integratedLufs).not.toBeNull();
      expect(result.measurements.truePeakDbtp).not.toBeNull();
      expect(result.measurements.spectrogram.slices.length).toBeGreaterThan(0);
      expect(
        result.measurements.spectrogramPyramid?.map(
          (spectrum) => spectrum.fftSize,
        ),
      ).toEqual([512, 2048]);
      expect(result.originSpectrum.fftSize).toBe(4096);
      expect(result.originSpectrum.slices.length).toBeGreaterThan(0);
      expect(result.measurements.originSpectrumSummary).toMatchObject({
        fftSize: 4096,
        slices: [],
      });
      expect(result.measurements.spectrogram.effectiveBandwidthHz).toBeGreaterThan(0);
      expect(result.technical.fileSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(result.technical.packetBitrateP05).not.toBeNull();
      expect(result.technical.packetBitrateP95).not.toBeNull();
      expect(result.technical.packetBitrateStdDev).not.toBeNull();
      expect(result.technical.packetDurationCoverage).toBeGreaterThan(90);
      expect(result.measurements.replayGain.trackGainDb).toBeCloseTo(
        -18 - result.measurements.integratedLufs!,
        2,
      );
      if (codec === "flac") {
        expect(result.technical.flacMd5?.status).toBe("verified");
      }
    },
  );

  it("distinguishes constant and variable MP3 packet bitrates", async () => {
    const cbr = await analyzeWithFfmpeg(
      path.join(fixtureRoot, "reference-cbr.mp3"),
    );
    const vbr = await analyzeWithFfmpeg(
      path.join(fixtureRoot, "reference-vbr.mp3"),
    );

    expect(cbr.technical.bitrateMode).toBe("CBR");
    expect(vbr.technical.bitrateMode).toBe("VBR");
    expect(vbr.technical.packetBitrateMaximum).toBeGreaterThan(
      vbr.technical.packetBitrateMinimum!,
    );
  });

  it("fails a truncated stream instead of accepting its metadata", async () => {
    const result = await analyzeAudioFile(
      path.join(fixtureRoot, "truncated.flac"),
    );

    expect(result.verdict).toBe("damaged");
    expect(result.measurements).toBeNull();
    expect(result.evidence[0].disposition).toBe("contradicts");
  });

  it("fails a FLAC whose decoded audio MD5 differs from STREAMINFO", async () => {
    const temporaryDirectory = await fs.mkdtemp(
      path.join(process.cwd(), "tests/.tmp-flac-md5-"),
    );
    try {
      const bytes = await fs.readFile(path.join(fixtureRoot, "reference.flac"));
      bytes[26] ^= 0xff;
      const filePath = path.join(temporaryDirectory, "md5-mismatch.flac");
      await fs.writeFile(filePath, bytes);

      const result = await analyzeAudioFile(filePath);

      expect(result.verdict).toBe("damaged");
      expect(result.headline).toBe("FLAC audio checksum failed");
      expect(result.technical?.flacMd5?.status).toBe("mismatch");
      expect(
        result.evidence.find((item) => item.id === "flac-streaminfo-md5")
          ?.disposition,
      ).toBe("contradicts");
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("stops before decoding when analysis is canceled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      analyzeAudioFile(
        path.join(fixtureRoot, "reference.flac"),
        controller.signal,
      ),
    ).rejects.toThrow(/canceled/i);
  });
});
import { promises as fs } from "node:fs";
