import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditSessionStore } from "../electron/audit-session-store";
import { scanSources } from "../electron/scanner";
import { compactAudioFileRecord } from "../shared/compact-audio-record";
import { pcmWave } from "./helpers/wave-fixture";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("AuditSessionStore", () => {
  it("persists a completed audit with its source, progress, and evidence", async () => {
    const directory = await fs.mkdtemp(
      path.join(process.cwd(), "tests/.tmp-session-"),
    );
    temporaryDirectories.push(directory);
    const audioPath = path.join(directory, "session.wav");
    await fs.writeFile(audioPath, pcmWave({ seconds: 0.2 }));
    const source = {
      kind: "files" as const,
      label: "Persistent audit",
      paths: [audioPath],
    };
    const store = new AuditSessionStore(path.join(directory, "sessions.sqlite3"));

    try {
      const sessionId = store.create(source);
      const result = await scanSources(source, undefined, {
        onDiscovered: (files, warnings) =>
          store.markDiscovered(sessionId, files.length, warnings),
        onFileStored: (file, ordinal, fromCache) =>
          store.storeFile(sessionId, file, ordinal, fromCache),
      });
      store.finish(sessionId, "completed", result.warnings);

      const restored = store.getSession(sessionId);
      expect(restored).toMatchObject({
        id: sessionId,
        label: "Persistent audit",
        status: "completed",
        discoveredCount: 1,
        completedCount: 1,
        warningCount: 0,
      });
      expect(restored?.files[0].oracle.technical?.fileSha256).toMatch(
        /^[a-f0-9]{64}$/,
      );
      expect(store.listSessions()).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("retains partial results when an audit is canceled", async () => {
    const directory = await fs.mkdtemp(
      path.join(process.cwd(), "tests/.tmp-session-cancel-"),
    );
    temporaryDirectories.push(directory);
    const store = new AuditSessionStore(path.join(directory, "sessions.sqlite3"));
    const source = {
      kind: "folder" as const,
      label: "Interrupted audit",
      paths: [directory],
    };

    try {
      const sessionId = store.create(source);
      store.markDiscovered(sessionId, 3, []);
      store.finish(sessionId, "canceled", []);
      expect(store.getSession(sessionId)).toMatchObject({
        status: "canceled",
        discoveredCount: 3,
        completedCount: 0,
      });
    } finally {
      store.close();
    }
  });

  it("recovers an abruptly interrupted audit and isolates only in-flight files", async () => {
    const directory = await fs.mkdtemp(
      path.join(process.cwd(), "tests/.tmp-session-recovery-"),
    );
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "sessions.sqlite3");
    const completedPath = path.join(directory, "completed.wav");
    const inFlightPath = path.join(directory, "in-flight.wav");
    await fs.writeFile(completedPath, pcmWave({ seconds: 0.2 }));
    await fs.writeFile(inFlightPath, pcmWave({ seconds: 0.2 }));
    const source = {
      kind: "folder" as const,
      label: directory,
      paths: [directory],
    };
    const firstProcess = new AuditSessionStore(databasePath);
    const sessionId = firstProcess.create(source);
    firstProcess.markDiscovered(sessionId, 2, []);
    const completed = await scanSources({
      kind: "files",
      label: "Completed checkpoint",
      paths: [completedPath],
    });
    firstProcess.markFileStarted(sessionId, completedPath);
    firstProcess.markFileStarted(sessionId, inFlightPath);
    firstProcess.storeFile(sessionId, completed.files[0], 0, false);
    firstProcess.close();

    const recoveredProcess = new AuditSessionStore(databasePath);
    try {
      expect(recoveredProcess.recoverInterruptedSessions()).toBe(1);
      expect(recoveredProcess.recoverInterruptedSessions()).toBe(0);
      expect(recoveredProcess.getRecoveryCandidates(sessionId)).toEqual([
        inFlightPath,
      ]);
      expect(recoveredProcess.getSession(sessionId)).toMatchObject({
        status: "canceled",
        interrupted: true,
        recoveryCandidateCount: 1,
        discoveredCount: 2,
        completedCount: 1,
        warningCount: 1,
      });
    } finally {
      recoveredProcess.close();
    }
  });

  it("preserves rich evidence while restoring compact history summaries", async () => {
    const directory = await fs.mkdtemp(
      path.join(process.cwd(), "tests/.tmp-session-detail-"),
    );
    temporaryDirectories.push(directory);
    const audioPath = path.join(directory, "detail.wav");
    await fs.writeFile(audioPath, pcmWave({ seconds: 1 }));
    const result = await scanSources({
      kind: "files",
      label: "Detail payload",
      paths: [audioPath],
    });
    const store = new AuditSessionStore(path.join(directory, "sessions.sqlite3"));
    try {
      const sessionId = store.create({
        kind: "files",
        label: "Detail payload",
        paths: [audioPath],
      });
      store.storeFile(sessionId, result.files[0], 0, false);
      const summary = compactAudioFileRecord({
        ...result.files[0],
        oracle: {
          ...result.files[0].oracle,
          headline: "Updated summary evidence",
        },
      });
      store.storeFile(sessionId, summary, 0, false);

      const restoredFull = store.getSessionFile(sessionId, audioPath);
      const restoredSummary = store.getSession(sessionId, true)?.files[0];
      expect(restoredFull?.oracle.headline).toBe("Updated summary evidence");
      expect(
        restoredFull?.oracle.measurements?.spectrogramPyramid?.some(
          (spectrum) => spectrum.slices.length > 0,
        ),
      ).toBe(true);
      expect(restoredSummary).toMatchObject({ detailLevel: "summary" });
      expect(restoredSummary?.oracle.measurements?.spectrogram.slices).toEqual(
        [],
      );
      expect(JSON.stringify(restoredSummary).length).toBeLessThan(
        JSON.stringify(restoredFull).length / 10,
      );
    } finally {
      store.close();
    }
  });

  it("reuses SQLite-cached Oracle records and invalidates changed files", async () => {
    const directory = await fs.mkdtemp(
      path.join(process.cwd(), "tests/.tmp-session-cache-"),
    );
    temporaryDirectories.push(directory);
    const audioPath = path.join(directory, "cached.wav");
    await fs.writeFile(audioPath, pcmWave({ seconds: 0.2 }));
    const store = new AuditSessionStore(path.join(directory, "sessions.sqlite3"));

    try {
      const result = await scanSources({
        kind: "files",
        label: "Cache source",
        paths: [audioPath],
      });
      await store.setCached(result.files[0]);

      expect((await store.getCached(audioPath))?.id).toBe(result.files[0].id);
      expect(store.cacheCount()).toBe(1);

      await fs.writeFile(audioPath, pcmWave({ seconds: 0.3 }));
      expect(await store.getCached(audioPath)).toBeNull();
      expect(store.cacheCount()).toBe(0);
    } finally {
      store.close();
    }
  });

  it("imports the legacy JSON cache only once", async () => {
    const directory = await fs.mkdtemp(
      path.join(process.cwd(), "tests/.tmp-session-migration-"),
    );
    temporaryDirectories.push(directory);
    const audioPath = path.join(directory, "legacy.wav");
    await fs.writeFile(audioPath, pcmWave({ seconds: 0.2 }));
    const result = await scanSources({
      kind: "files",
      label: "Legacy source",
      paths: [audioPath],
    });
    const legacyPath = path.join(directory, "oracle-cache-v4.json");
    await fs.writeFile(
      legacyPath,
      JSON.stringify({
        schema: "Audio-V Oracle cache v4",
        entries: {
          [audioPath]: { record: result.files[0] },
        },
      }),
    );
    const store = new AuditSessionStore(path.join(directory, "sessions.sqlite3"));

    try {
      expect(await store.importLegacyCache(legacyPath)).toBe(1);
      expect(await store.importLegacyCache(legacyPath)).toBe(0);
      expect(store.cacheCount()).toBe(1);
    } finally {
      store.close();
    }
  });

  it("indexes measured fingerprints independently of cache invalidation", async () => {
    const directory = await fs.mkdtemp(
      path.join(process.cwd(), "tests/.tmp-fingerprint-index-"),
    );
    temporaryDirectories.push(directory);
    const firstPath = path.join(directory, "first.wav");
    const secondPath = path.join(directory, "second.wav");
    const bytes = pcmWave({ seconds: 6 });
    await fs.writeFile(firstPath, bytes);
    await fs.writeFile(secondPath, bytes);
    const store = new AuditSessionStore(path.join(directory, "sessions.sqlite3"));

    try {
      const result = await scanSources({
        kind: "files",
        label: "Fingerprint history",
        paths: [firstPath, secondPath],
      });
      const sessionId = store.create({
        kind: "files",
        label: "Fingerprint history",
        paths: [firstPath, secondPath],
      });
      store.storeFiles(
        sessionId,
        result.files.map((file, ordinal) => ({
          file,
          ordinal,
          fromCache: false,
        })),
      );
      store.finish(sessionId, "completed", []);
      await Promise.all(result.files.map((file) => store.setCached(file)));
      const candidates = store.findFingerprintCandidates(firstPath);

      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        filePath: secondPath,
        fingerprintSha256:
          result.files[1].oracle.technical?.fingerprint.fingerprintSha256,
      });
      expect(candidates[0].rawFingerprint.length).toBeGreaterThan(20);
      const library = await store.listFingerprintLibrary();
      expect(library).toHaveLength(2);
      expect(library.every((entry) => entry.exactDuplicateCount === 1)).toBe(true);

      await fs.rm(secondPath);
      const pruned = await store.pruneMissingFingerprints();
      expect(pruned).toEqual({ affected: 1, remaining: 1 });
      expect(store.clearFingerprintLibrary()).toEqual({
        affected: 1,
        remaining: 0,
      });
      expect(store.rebuildFingerprintLibrary().remaining).toBe(2);
      expect(
        (await store.listFingerprintLibrary()).filter(
          (entry) => !entry.fileExists,
        ),
      ).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});
