import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectAudioFile, scanSources } from "../electron/scanner";
import { analyzeAudioFile } from "../electron/oracle/oracle-engine";
import { pcmWave } from "./helpers/wave-fixture";

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(process.cwd(), "tests/.tmp-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("inspectAudioFile", () => {
  it("reports real PCM metadata without inventing a bitrate mode", async () => {
    const directory = await makeTemporaryDirectory();
    const filePath = path.join(directory, "reference.wav");
    await fs.writeFile(filePath, pcmWave({ channels: 2 }));

    const result = await inspectAudioFile(filePath);

    expect(result.container).toMatch(/WAVE/i);
    expect(result.sampleRate).toBe(44_100);
    expect(result.bitDepth).toBe(16);
    expect(result.channels).toBe(2);
    expect(result.lossless).toBe(true);
    expect(result.bitrateMode).toBeNull();
    expect(result.overallFileBitrate).toBeGreaterThan(1_400_000);
    expect(result.scanError).toBeNull();
    expect(result.oracle.verdict).toBe("inconclusive");
    expect(result.oracle.analysisState).toBe("not-analyzed");
    expect(result.oracle.measuredAt).toBeNull();
  });

  it("does not classify a metadata-probe failure as proven damage", async () => {
    const directory = await makeTemporaryDirectory();
    const filePath = path.join(directory, "malformed.mp3");
    await fs.writeFile(filePath, Buffer.from("not an MPEG audio stream"));

    const result = await inspectAudioFile(filePath);

    expect(result.scanError).not.toBeNull();
    expect(result.oracle.verdict).toBe("inconclusive");
    expect(result.oracle.analysisState).toBe("error");
    expect(result.oracle.confidence).toBeNull();
    expect(result.oracle.headline).toBe("Metadata inventory error");
    expect(result.oracle.failure).toMatchObject({
      category: "analysis-error",
      stage: "metadata-probe",
      code: "METADATA_PROBE_ERROR",
    });
  });
});

describe("scanSources", () => {
  it("runs metadata inventory without invoking the Oracle decoder", async () => {
    const directory = await makeTemporaryDirectory();
    const filePath = path.join(directory, "inventory.wav");
    await fs.writeFile(filePath, pcmWave({ channels: 2 }));
    let oracleInvocations = 0;

    const result = await scanSources(
      {
        kind: "files",
        label: "Metadata inventory",
        paths: [filePath],
        mode: "metadata-inventory",
      },
      undefined,
      {
        analyzeFile: async () => {
          oracleInvocations += 1;
          throw new Error("Oracle must not run in metadata inventory mode.");
        },
      },
    );

    expect(oracleInvocations).toBe(0);
    expect(result.files[0].oracle.analysisState).toBe("not-analyzed");
    expect(result.files[0].oracle.verdict).toBe("inconclusive");
    expect(result.files[0].oracle.measurements).toBeNull();
    expect(result.files[0].sampleRate).toBe(44_100);
    expect(result.files[0].channels).toBe(2);
    expect(result.unreadableCount).toBe(0);
  });

  it("deduplicates selected files, scans nested folders, and skips hidden files", async () => {
    const directory = await makeTemporaryDirectory();
    const nested = path.join(directory, "album");
    await fs.mkdir(nested);
    const first = path.join(directory, "first.wav");
    const second = path.join(nested, "second.wav");
    await fs.writeFile(first, pcmWave());
    await fs.writeFile(second, pcmWave({ sampleRate: 48_000 }));
    await fs.writeFile(path.join(directory, ".hidden.wav"), pcmWave());
    await fs.writeFile(path.join(directory, "cover.jpg"), Buffer.from("image"));

    const result = await scanSources({
      kind: "folder",
      label: directory,
      paths: [directory, first],
    });

    expect(result.files.map((file) => file.name)).toEqual([
      "first.wav",
      "second.wav",
    ]);
    expect(result.files.every((file) => file.oracle.measurements !== null)).toBe(true);
    expect(result.files.every((file) => file.oracle.measuredAt !== null)).toBe(true);
    expect(result.unreadableCount).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it("returns source warnings without aborting valid files", async () => {
    const directory = await makeTemporaryDirectory();
    const valid = path.join(directory, "valid.wav");
    const unsupported = path.join(directory, "notes.txt");
    await fs.writeFile(valid, pcmWave());
    await fs.writeFile(unsupported, "notes");

    const result = await scanSources({
      kind: "files",
      label: "mixed selection",
      paths: [valid, unsupported],
    });

    expect(result.files).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("unsupported file type");
  });

  it("reports discovery and incremental full-decode progress", async () => {
    const directory = await makeTemporaryDirectory();
    await fs.writeFile(path.join(directory, "one.wav"), pcmWave());
    await fs.writeFile(path.join(directory, "two.wav"), pcmWave());
    const progress: Array<{ phase: string; completed: number }> = [];

    await scanSources(
      { kind: "folder", label: directory, paths: [directory] },
      (update) =>
        progress.push({ phase: update.phase, completed: update.completed }),
    );

    expect(progress[0]).toEqual({ phase: "discovered", completed: 0 });
    expect(progress.filter((update) => update.phase === "analyzing")).toHaveLength(2);
    expect(progress.at(-1)).toEqual({ phase: "complete", completed: 2 });
  });

  it("honors adaptive bounded analysis concurrency", async () => {
    const directory = await makeTemporaryDirectory();
    for (let index = 0; index < 4; index += 1) {
      await fs.writeFile(
        path.join(directory, `${index}.wav`),
        pcmWave({ seconds: 0.1 }),
      );
    }
    let active = 0;
    let maximumActive = 0;

    const result = await scanSources(
      { kind: "folder", label: directory, paths: [directory] },
      undefined,
      {
        concurrency: 3,
        analyzeFile: async (filePath, signal) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          try {
            return await analyzeAudioFile(filePath, signal);
          } finally {
            active -= 1;
          }
        },
      },
    );

    expect(result.files).toHaveLength(4);
    expect(maximumActive).toBe(3);
  });

  it("turns adjacent checksum manifests into Oracle identity evidence", async () => {
    const directory = await makeTemporaryDirectory();
    const audioPath = path.join(directory, "verified.wav");
    const bytes = pcmWave({ seconds: 0.2 });
    await fs.writeFile(audioPath, bytes);
    const md5 = createHash("md5").update(bytes).digest("hex");
    await fs.writeFile(
      path.join(directory, "album.md5"),
      `${md5}  verified.wav\n`,
    );

    const verified = await scanSources({
      kind: "files",
      label: "checksum test",
      paths: [audioPath],
    });
    expect(
      verified.files[0].oracle.technical?.externalChecksums[0],
    ).toMatchObject({ algorithm: "md5", status: "verified" });
    expect(
      verified.files[0].oracle.evidence.some(
        (item) => item.id === "external-checksum-md5-0",
      ),
    ).toBe(true);

    await fs.writeFile(
      path.join(directory, "album.md5"),
      `${"0".repeat(32)}  verified.wav\n`,
    );
    const mismatch = await scanSources({
      kind: "files",
      label: "checksum mismatch",
      paths: [audioPath],
    });
    expect(mismatch.files[0].oracle.verdict).toBe("review");
    expect(mismatch.files[0].oracle.headline).toBe(
      "External checksum mismatch",
    );
  });

  it("links copied recordings by their local Chromaprint identity", async () => {
    const directory = await makeTemporaryDirectory();
    const fixture = path.join(
      process.cwd(),
      "tests",
      "fixtures",
      "fidelity-engine",
      "wideband-source-44.flac",
    );
    await fs.copyFile(fixture, path.join(directory, "original.flac"));
    await fs.copyFile(fixture, path.join(directory, "copy.flac"));

    const result = await scanSources({
      kind: "folder",
      label: "fingerprint relationship",
      paths: [directory],
    });

    expect(result.files).toHaveLength(2);
    expect(
      result.files.every(
        (file) =>
          file.oracle.technical?.fingerprint.matches[0]?.relationship ===
          "same-fingerprint",
      ),
    ).toBe(true);
    expect(
      result.files.every(
        (file) =>
          file.oracle.technical?.fingerprint.matches[0]?.similarity === 1,
      ),
    ).toBe(true);
  });
});
