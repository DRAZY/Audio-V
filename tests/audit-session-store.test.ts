import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditSessionStore } from "../electron/audit-session-store";
import { scanSources } from "../electron/scanner";
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
});
