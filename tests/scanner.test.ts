import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  attachFingerprintRelationships,
  inspectAudioFile,
  scanSources,
} from "../electron/scanner";
import { analyzeAudioFile } from "../electron/oracle/oracle-engine";
import { oracleFailureResult } from "../electron/oracle/oracle-engine";
import {
  OracleWorkerFailure,
  OracleWorkerPool,
} from "../electron/oracle/oracle-worker-pool";
import { runEngine } from "../electron/oracle/ffmpeg-runtime";
import type { AudioFileRecord } from "../shared/contracts";
import { deliveryProfiles } from "../shared/delivery-profiles";
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
  it("honors cancellation before source discovery begins", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      scanSources(
        { kind: "folder", label: "Canceled", paths: [process.cwd()] },
        undefined,
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/canceled/i);
  });

  it("cancels promptly while a cache or storage request is unresponsive", async () => {
    const directory = await makeTemporaryDirectory();
    const filePath = path.join(directory, "blocked-cache.wav");
    await fs.writeFile(filePath, pcmWave());
    const controller = new AbortController();
    const startedAt = Date.now();
    const scan = scanSources(
      { kind: "files", label: "Blocked cache", paths: [filePath] },
      undefined,
      {
        signal: controller.signal,
        cache: {
          get: () => new Promise<AudioFileRecord | null>(() => undefined),
          set: async () => undefined,
          flush: async () => undefined,
        },
      },
    );
    setTimeout(() => controller.abort(), 50);

    await expect(scan).rejects.toThrow(/canceled/i);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it("persists exhausted worker timeouts per file and continues the audit", async () => {
    const directory = await makeTemporaryDirectory();
    const filePaths = [
      path.join(directory, "timeout-one.wav"),
      path.join(directory, "timeout-two.wav"),
    ];
    await Promise.all(
      filePaths.map((filePath) => fs.writeFile(filePath, pcmWave())),
    );
    const pool = new OracleWorkerPool(
      path.join(process.cwd(), "tests/fixtures/blocking-oracle-worker.cjs"),
      1,
      128,
      { ffmpegThreads: 1, nativeProcessMemoryMb: 256 },
      100,
    );
    const stored: AudioFileRecord[] = [];
    try {
      const result = await scanSources(
        {
          kind: "folder",
          label: "Worker timeout isolation",
          paths: [directory],
        },
        undefined,
        {
          concurrency: 1,
          analyzeFile: async (filePath, signal) => {
            try {
              return await pool.analyze(filePath, signal);
            } catch (error) {
              if (!(error instanceof OracleWorkerFailure)) throw error;
              return oracleFailureResult(error);
            }
          },
          onFileStored: (file) => stored.push(file),
        },
      );

      expect(result.files).toHaveLength(2);
      expect(stored).toHaveLength(2);
      expect(result.files.map((file) => file.oracle.analysisState)).toEqual([
        "error",
        "error",
      ]);
      expect(
        result.files.every(
          (file) =>
            file.oracle.failure?.code === "ORACLE_WORKER_TIMEOUT" &&
            file.oracle.verdict === "inconclusive",
        ),
      ).toBe(true);
    } finally {
      await pool.close();
    }
  });

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

    const finalization: string[] = [];
    const deferred = await scanSources(
      {
        kind: "files",
        label: "Large-library ReplayGain policy",
        paths: files,
      },
      (progress) => {
        if (progress.finalization) {
          finalization.push(progress.finalization.explanation);
        }
      },
      { automaticAlbumReplayGainFileLimit: 1 },
    );
    expect(
      deferred.files.every(
        (file) =>
          file.oracle.measurements?.replayGain.albumStatus === "unavailable" &&
          file.oracle.measurements.replayGain.albumReason.includes(
            "deferred because this audit contains 2 files",
          ),
      ),
    ).toBe(true);
    expect(finalization.some((entry) => entry.includes("Track ReplayGain remains available")))
      .toBe(true);

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
    await fs.writeFile(filePath, pcmWave({ seconds: 2, channels: 2 }));
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
    expect(result.files[0].oracle.technical?.discVerification).toMatchObject({
      status: "eligible-not-verified",
      layout: "single-image-cue",
      ctdbEligible: true,
      accurateRipEligible: true,
      cueTrackCount: 2,
    });
    expect(
      result.files[0].oracle.technical?.discVerification?.limitation,
    ).toContain("Eligibility is not verification");
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

  it("analyzes a mounted source from one staged copy but preserves its source identity", async () => {
    const directory = await makeTemporaryDirectory();
    const sourcePath = path.join(directory, "mounted-source.wav");
    const stagedPath = path.join(directory, "staged-source.wav");
    const contents = pcmWave({ channels: 2 });
    await fs.writeFile(sourcePath, contents);
    await fs.writeFile(stagedPath, contents);
    let analyzedPath = "";
    let cleaned = false;

    const result = await scanSources(
      {
        kind: "files",
        label: "Mounted source",
        paths: [sourcePath],
      },
      undefined,
      {
        classifyStorage: () => "network",
        stageFile: async () => ({
          analysisPath: stagedPath,
          storageKind: "network",
          staged: true,
          sizeBytes: contents.length,
          explanation: "Test staging.",
          cleanup: async () => {
            cleaned = true;
          },
        }),
        analyzeFile: async (filePath, signal) => {
          analyzedPath = filePath;
          return analyzeAudioFile(filePath, signal);
        },
      },
    );

    expect(analyzedPath).toBe(stagedPath);
    expect(cleaned).toBe(true);
    expect(result.files[0].path).toBe(sourcePath);
    expect(result.files[0].name).toBe(path.basename(sourcePath));
    expect(result.files[0].oracle.analysisState).toBe("completed");
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

  it("quarantines an in-flight crash candidate without labeling it damaged", async () => {
    const directory = await makeTemporaryDirectory();
    const safePath = path.join(directory, "safe.wav");
    const suspectPath = path.join(directory, "suspect.wav");
    await fs.writeFile(safePath, pcmWave());
    await fs.writeFile(suspectPath, pcmWave());
    const started: string[] = [];

    const result = await scanSources(
      { kind: "folder", label: directory, paths: [directory] },
      undefined,
      {
        concurrency: 1,
        onFileStarted: (filePath) => started.push(filePath),
        recoveryQuarantine: new Map([
          [
            suspectPath,
            "suspect.wav was active when the previous process ended.",
          ],
        ]),
      },
    );

    expect(started).toEqual([safePath, suspectPath]);
    const safe = result.files.find((file) => file.path === safePath);
    const suspect = result.files.find((file) => file.path === suspectPath);
    expect(safe?.oracle.analysisState).toBe("completed");
    expect(suspect?.oracle).toMatchObject({
      verdict: "inconclusive",
      analysisState: "error",
      failure: {
        category: "analysis-error",
        code: "RECOVERY_QUARANTINED",
      },
    });
  });

  it("keeps rich evidence in persistence while returning bounded desktop summaries", async () => {
    const directory = await makeTemporaryDirectory();
    const audioPath = path.join(directory, "bounded.wav");
    await fs.writeFile(audioPath, pcmWave({ seconds: 1 }));
    const stored: AudioFileRecord[] = [];

    const result = await scanSources(
      { kind: "files", label: "Bounded result", paths: [audioPath] },
      undefined,
      {
        compactResults: true,
        onFileStored: (file) => stored.push(file),
      },
    );

    expect(stored[0].detailLevel).toBeUndefined();
    expect(
      stored[0].oracle.measurements?.spectrogramPyramid?.some(
        (spectrum) => spectrum.slices.length > 0,
      ),
    ).toBe(true);
    expect(result.files[0]).toMatchObject({ detailLevel: "summary" });
    expect(result.files[0].oracle.measurements?.spectrogram.slices).toEqual([]);
    expect(result.files[0].oracle.measurements?.spectrogramPyramid).toBeUndefined();
    expect(result.files[0].oracle.measurements?.waveform?.points).toEqual([]);
    expect(JSON.stringify(result.files[0]).length).toBeLessThan(
      JSON.stringify(stored[0]).length / 10,
    );
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
    expect(mismatch.files[0].oracle.confidence).toBeNull();
    expect(mismatch.files[0].oracle.assessments?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "external-checksum-mismatch",
          severity: "review",
          certainty: "deterministic",
        }),
      ]),
    );
  });

  it("inventories editable generator metadata without changing audio quality to Review", async () => {
    const directory = await makeTemporaryDirectory();
    const filePath = path.join(directory, "declared-generator.flac");
    await runEngine("ffmpeg", [
      "-nostdin",
      "-hide_banner",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=48000:duration=0.5",
      "-metadata",
      "comment=Created with Suno",
      "-c:a",
      "flac",
      "-y",
      filePath,
    ]);

    const result = await scanSources({
      kind: "files",
      label: "provenance inventory",
      paths: [filePath],
    });
    const file = result.files[0];

    expect(file.oracle.verdict).toBe("verified");
    expect(file.oracle.assessments?.provenance.status).toBe("declared");
    expect(
      file.oracle.evidence.find((item) =>
        item.id.startsWith("generator-metadata-"),
      )?.disposition,
    ).toBe("neutral");
  });

  it("bypasses cached evidence for adaptive recovery validation", async () => {
    const directory = await makeTemporaryDirectory();
    const audioPath = path.join(directory, "recovery.wav");
    await fs.writeFile(audioPath, pcmWave({ seconds: 0.2 }));
    const initial = await scanSources({
      kind: "files",
      label: "initial",
      paths: [audioPath],
    });
    let analyses = 0;

    const recovered = await scanSources(
      {
        kind: "files",
        label: "recovery",
        paths: [audioPath],
      },
      undefined,
      {
        cache: {
          get: async () => initial.files[0],
          set: async () => undefined,
          flush: async () => undefined,
        },
        bypassCachePaths: new Set([path.resolve(audioPath)]),
        analyzeFile: async (filePath, signal) => {
          analyses += 1;
          return analyzeAudioFile(filePath, signal);
        },
      },
    );

    expect(analyses).toBe(1);
    expect(recovered.files[0].oracle.analysisState).toBe("completed");
  });

  it("applies the selected delivery profile after cache reuse", async () => {
    const directory = await makeTemporaryDirectory();
    const audioPath = path.join(directory, "delivery.wav");
    await fs.writeFile(
      audioPath,
      pcmWave({ seconds: 1, amplitude: 0.2 }),
    );
    let cached: AudioFileRecord | null = null;
    const cache = {
      get: async () => cached,
      set: async (file: AudioFileRecord) => {
        cached = file;
      },
      flush: async () => undefined,
    };
    await scanSources(
      { kind: "files", label: "base", paths: [audioPath] },
      undefined,
      { cache },
    );
    expect(cached?.oracle.assessments?.delivery.status).toBe(
      "not-evaluated",
    );
    let cacheHit = false;
    const profiled = await scanSources(
      {
        kind: "files",
        label: "profiled",
        paths: [audioPath],
        deliveryProfile: deliveryProfiles["ebu-r128-programme"],
      },
      (progress) => {
        if (progress.file) cacheHit = progress.fromCache;
      },
      { cache },
    );

    expect(cacheHit).toBe(true);
    expect(
      profiled.files[0].oracle.assessments?.delivery.profile?.id,
    ).toBe("ebu-r128-programme");
    expect(
      profiled.files[0].oracle.assessments?.delivery.findingIds,
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^delivery-loudness-/),
        expect.stringMatching(/^delivery-true-peak-/),
      ]),
    );
    const switched = await scanSources(
      {
        kind: "files",
        label: "profile switched",
        paths: [audioPath],
        deliveryProfile: deliveryProfiles["atsc-a85"],
      },
      undefined,
      { cache },
    );
    expect(
      switched.files[0].oracle.assessments?.delivery.profile?.id,
    ).toBe("atsc-a85");
    expect(
      switched.files[0].oracle.assessments?.findings.some(
        (finding) =>
          finding.lane === "delivery" &&
          finding.summary.includes("EBU R 128"),
      ),
    ).toBe(false);
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
    }, undefined, { nearFingerprintRelationshipFileLimit: 0 });

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

  it("bounds historical fingerprint storage requests for a 640-file finalization", async () => {
    const files = Array.from({ length: 640 }, (_, index) => ({
      path: `/library/track-${index}.flac`,
      name: `track-${index}.flac`,
      oracle: {
        technical: {
          fingerprint: {
            status: "measured",
            fingerprintSha256: createHash("sha256")
              .update(`fingerprint-${index}`)
              .digest("hex"),
            rawFingerprint: Array.from(
              { length: 32 },
              (_value, word) => index + word,
            ),
            durationSeconds: 180 + (index % 240),
            matches: [],
          },
        },
      },
    })) as AudioFileRecord[];
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const lookupModes: boolean[] = [];
    const progress: number[] = [];

    const result = await attachFingerprintRelationships(files, {
      cache: {
        get: async () => null,
        set: async () => undefined,
        flush: async () => undefined,
        findFingerprintCandidates: async (
          _filePath,
          _limit,
          _durationSeconds,
          lookup,
        ) => {
          activeRequests += 1;
          maximumActiveRequests = Math.max(
            maximumActiveRequests,
            activeRequests,
          );
          lookupModes.push(lookup?.exactOnly === true);
          await new Promise((resolve) => setTimeout(resolve, 1));
          activeRequests -= 1;
          return [];
        },
      },
      historicalConcurrency: 4,
      onProgress: (completed) => progress.push(completed),
    });

    expect(result).toHaveLength(640);
    expect(maximumActiveRequests).toBeLessThanOrEqual(4);
    expect(lookupModes).toHaveLength(640);
    expect(lookupModes.every(Boolean)).toBe(true);
    expect(progress.at(-1)).toBe(640);
  });

  it("keeps the audit evidence complete when historical fingerprint enrichment fails", async () => {
    const files = Array.from({ length: 8 }, (_, index) => ({
      path: `/library/fallback-${index}.flac`,
      name: `fallback-${index}.flac`,
      oracle: {
        technical: {
          fingerprint: {
            status: "measured",
            fingerprintSha256: `fingerprint-${index}`,
            rawFingerprint: Array.from(
              { length: 32 },
              (_value, word) => index + word,
            ),
            durationSeconds: 200 + index,
            matches: [],
          },
        },
      },
    })) as AudioFileRecord[];
    const warnings: string[] = [];
    let requests = 0;

    const result = await attachFingerprintRelationships(files, {
      cache: {
        get: async () => null,
        set: async () => undefined,
        flush: async () => undefined,
        findFingerprintCandidates: async () => {
          requests += 1;
          throw new Error(
            "Audit storage did not complete find-fingerprints within 30 seconds.",
          );
        },
      },
      warnings,
      historicalConcurrency: 4,
    });

    expect(result).toHaveLength(files.length);
    expect(requests).toBeLessThanOrEqual(4);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Historical fingerprint enrichment was unavailable");
    expect(warnings[0]).toContain("every Oracle verdict remain complete");
  });

  it("completes scan finalization when persistent fingerprint storage times out", async () => {
    const directory = await makeTemporaryDirectory();
    const audioPath = path.join(directory, "storage-timeout.flac");
    await fs.copyFile(
      path.join(
        process.cwd(),
        "tests",
        "fixtures",
        "fidelity-engine",
        "wideband-source-44.flac",
      ),
      audioPath,
    );
    const finalizationProgress: Array<{ completed: number; total: number }> = [];

    const result = await scanSources(
      {
        kind: "files",
        label: "Fingerprint storage timeout",
        paths: [audioPath],
      },
      (progress) => {
        if (
          progress.phase === "finalizing" &&
          progress.finalization?.stage === "fingerprint-relationships"
        ) {
          finalizationProgress.push({
            completed: progress.finalization.completed,
            total: progress.finalization.total,
          });
        }
      },
      {
        cache: {
          get: async () => null,
          set: async () => undefined,
          flush: async () => undefined,
          findFingerprintCandidates: async () => {
            throw new Error(
              "Audit storage did not complete find-fingerprints within 30 seconds.",
            );
          },
        },
      },
    );

    expect(result.files).toHaveLength(1);
    expect(result.files[0].oracle.analysisState).toBe("completed");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(
      "Current-audit fingerprint relationships and every Oracle verdict remain complete",
    );
    expect(finalizationProgress.at(-1)).toEqual({
      completed: 1,
      total: 1,
    });
  });
});
