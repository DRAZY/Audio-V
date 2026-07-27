import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeAudioFile } from "../electron/oracle/oracle-engine";
import { runEngine } from "../electron/oracle/ffmpeg-runtime";
import { createTruePeakSafeCopy } from "../electron/repair-engine";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function attachedPictureCount(filePath: string): Promise<number> {
  const result = await runEngine("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v",
    "-show_streams",
    "-of",
    "json",
    filePath,
  ]);
  const parsed = JSON.parse(result.stdout.toString("utf8")) as {
    streams?: Array<{ disposition?: { attached_pic?: number } }>;
  };
  return (parsed.streams ?? []).filter(
    (stream) => stream.disposition?.attached_pic === 1,
  ).length;
}

async function formatTags(filePath: string): Promise<Record<string, string>> {
  const result = await runEngine("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format_tags",
    "-of",
    "json",
    filePath,
  ]);
  const parsed = JSON.parse(result.stdout.toString("utf8")) as {
    format?: { tags?: Record<string, string> };
  };
  return parsed.format?.tags ?? {};
}

describe("createTruePeakSafeCopy", () => {
  it("creates an integrity-verified FLAC copy without modifying the source", async () => {
    const directory = await fs.mkdtemp(
      path.join(process.cwd(), "tests/.tmp-repair-"),
    );
    const source = path.join(
      process.cwd(),
      "tests",
      "fixtures",
      "audio-engine",
      "reference.flac",
    );
    const output = path.join(directory, "safe-copy.flac");
    try {
      const sourceBefore = await fs.readFile(source);
      const reduction = await createTruePeakSafeCopy(source, output, 0.3, 24);
      const sourceAfter = await fs.readFile(source);
      const result = await analyzeAudioFile(output);

      expect(reduction).toBeCloseTo(1.3, 6);
      expect(sha256(sourceAfter)).toBe(sha256(sourceBefore));
      expect(result.verdict).not.toBe("damaged");
      expect(result.technical?.bitsPerRawSample).toBe(24);
      expect(result.measurements?.decodeIntegrity).toBe("complete");
      expect(result.technical?.flacMd5?.status).toBe("verified");
      expect(result.measurements?.truePeakDbtp).toBeLessThanOrEqual(-0.9);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves a 16-bit source by default and supports an explicit 24-bit working copy", async () => {
    const directory = await fs.mkdtemp(
      path.join(process.cwd(), "tests/.tmp-repair-depth-"),
    );
    const reference = path.join(
      process.cwd(),
      "tests",
      "fixtures",
      "audio-engine",
      "reference-24bit.wav",
    );
    const source = path.join(directory, "source-16bit.flac");
    const preserved = path.join(directory, "preserved-16bit.flac");
    const processingCopy = path.join(directory, "processing-24bit.flac");
    try {
      await runEngine("ffmpeg", [
        "-nostdin",
        "-v",
        "error",
        "-i",
        reference,
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=16x16",
        "-map",
        "0:a:0",
        "-map",
        "1:v:0",
        "-sample_fmt",
        "s16",
        "-c:a",
        "flac",
        "-c:v",
        "mjpeg",
        "-frames:v",
        "1",
        "-disposition:v",
        "attached_pic",
        source,
      ]);
      const sourceResult = await analyzeAudioFile(source);
      await createTruePeakSafeCopy(source, preserved, 0.3, 16);
      await createTruePeakSafeCopy(source, processingCopy, 0.3, 24);
      const preservedResult = await analyzeAudioFile(preserved);
      const processingResult = await analyzeAudioFile(processingCopy);

      expect(sourceResult.technical?.bitsPerRawSample).toBe(16);
      expect(preservedResult.technical?.bitsPerRawSample).toBe(16);
      expect(preservedResult.technical?.sampleRate).toBe(
        sourceResult.technical?.sampleRate,
      );
      expect(preservedResult.technical?.channels).toBe(
        sourceResult.technical?.channels,
      );
      expect(preservedResult.technical?.flacMd5?.status).toBe("verified");
      expect(preservedResult.technical?.repairProvenance).toMatchObject({
        action: "true_peak_safe_copy",
        outputBitDepth: 16,
        targetDbtp: -1,
      });
      expect(await attachedPictureCount(preserved)).toBe(1);
      expect(await formatTags(preserved)).toMatchObject({
        AUDIO_V_ACTION: "true_peak_safe_copy",
        AUDIO_V_OUTPUT_BIT_DEPTH: "16",
      });
      expect(processingResult.technical?.bitsPerRawSample).toBe(24);
      expect(processingResult.technical?.flacMd5?.status).toBe("verified");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite the protected source", async () => {
    const source = path.join(
      process.cwd(),
      "tests",
      "fixtures",
      "audio-engine",
      "reference.flac",
    );
    await expect(createTruePeakSafeCopy(source, source, 0.3, 24)).rejects.toThrow(
      /cannot be overwritten/,
    );
  });
});
