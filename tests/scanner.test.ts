import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectAudioFile, scanSources } from "../electron/scanner";
import { analyzeAudioFile } from "../electron/oracle/oracle-engine";
import { runEngine } from "../electron/oracle/ffmpeg-runtime";
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
  it("records why album ReplayGain is or is not available", async () => {
    const directory = await makeTemporaryDirectory();
    const files = [
      path.join(directory, "01.flac"),
      path.join(directory, "02.flac"),
    ];
    for (const [index, filePath] of files.entries()) {
      await runEngine("ffmpeg", [
        "-nostdin", "-hide_banner", "-v", "error",
        "-f", "lavfi", "-i",
        `sine=frequency=${440 + index * 110}:sample_rate=48000:duration=0.5`,
        "-metadata", "album=Eligibility Suite",
        "-metadata", "album_artist=Audio-V",
        "-metadata", `track=${index + 1}`,
        "-c:a", "flac", "-y", filePath,
      ]);
    }

    const grouped = await scanSources({
      kind: "files",
      label: "ReplayGain album",
      paths: files,
    });
    expect(
      grouped.files.every(
        (file) =>
          file.oracle.measurements?.replayGain.albumStatus === "calculated" &&
          file.oracle.measurements.replayGain.albumTrackCount === 2,
      ),
    ).toBe(true);
    expect(
      grouped.files[0].oracle.measurements?.replayGain.albumReason,
    ).toContain("matching album identity");

    const untaggedPath = path.join(directory, "untagged.wav");
    await fs.writeFile(untaggedPath, pcmWave());
    const untagged = await scanSources({
      kind: "files",
      label: "No album tag",
      paths: [untaggedPath],
    });
    expect(
      untagged.files[0].oracle.measurements?.replayGain.albumReason,
    ).toContain("no declared album identity");
  });

  it("decodes cue INDEX 01 tracks as independent evidence segments", async () => {
    const directory = await makeTemporaryDirectory();
    const filePath = path.join(directory, "album.wav");
    await fs.writeFile(filePath, pcmWave({ seconds: 2 }));
    await fs.writeFile(
      path.join(directory, "album.cue"),
      [
        'FILE "album.wav" WAVE',
        "  TRACK 01 AUDIO",
        '    TITLE "First"',
        "    INDEX 01 00:00:00",
        "  TRACK 02 AUDIO",
        '    TITLE "Second"',
        "    INDEX 00 00:00:60",
        "    INDEX 01 00:01:00",
      ].join("\n"),
    );

    const result = await scanSources({
      kind: "files",
      label: "Cue image",
      paths: [filePath],
    });

    expect(result.files[0].metadata.cueSheet.trackCount).toBe(2);
    expect(result.files[0].oracle.cueTracks).toHaveLength(2);
    expect(result.files[0].oracle.cueTracks?.map((track) => track.title)).toEqual([
      "First",
      "Second",
    ]);
    expect(
      result.files[0].oracle.cueTracks?.every(
        (track) => track.analysisState === "completed",
      ),
    ).toBe(true);
    expect(result.files[0].oracle.cueTracks?.[0].durationSeconds).toBeCloseTo(
      0.8,
      2,
    );
    expect(result.files[0].oracle.cueTracks?.[1].pregap?.analysisState).toBe(
      "completed",
    );
    expect(
      result.files[0].oracle.cueTracks?.[1].pregap?.durationSeconds,
    ).toBeCloseTo(0.2, 6);
  });

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

  it("follows directory aliases without looping when scanning mounted-style trees", async () => {
    const directory = await makeTemporaryDirectory();
    const mountedLibrary = path.join(directory, "Mounted Library");
    const album = path.join(mountedLibrary, "Album");
    await fs.mkdir(album, { recursive: true });
    await fs.writeFile(path.join(album, "network-track.wav"), pcmWave());
    await fs.symlink(album, path.join(mountedLibrary, "Album alias"), "dir");
    await fs.symlink(mountedLibrary, path.join(album, "Library loop"), "dir");

    const result = await scanSources({
      kind: "folder",
      label: mountedLibrary,
      paths: [mountedLibrary],
    });

    expect(result.files.map((file) => file.name)).toEqual(["network-track.wav"]);
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
    const progress: Array<{
      phase: string;
      completed: number;
      currentFile: string | null;
    }> = [];

    await scanSources(
      { kind: "folder", label: directory, paths: [directory] },
      (update) =>
        progress.push({
          phase: update.phase,
          completed: update.completed,
          currentFile: update.currentFile,
        }),
    );

    expect(progress[0]).toEqual({
      phase: "discovered",
      completed: 0,
      currentFile: null,
    });
    expect(progress.filter((update) => update.phase === "processing")).toHaveLength(2);
    expect(
      progress
        .filter((update) => update.phase === "processing")
        .map((update) => update.currentFile)
        .sort(),
    ).toEqual(["one.wav", "two.wav"]);
    expect(progress.filter((update) => update.phase === "analyzing")).toHaveLength(2);
    expect(progress.at(-1)).toEqual({
      phase: "complete",
      completed: 2,
      currentFile: null,
    });
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
