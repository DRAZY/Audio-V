import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AudioFileRecord,
  AudioSourceSelection,
  AuditSessionStatus,
  AuditSessionSummary,
  StoredAuditSession,
} from "../shared/contracts";

interface SessionRow {
  id: string;
  label: string;
  source_json: string;
  status: AuditSessionStatus;
  discovered_count: number;
  completed_count: number;
  warnings_json: string;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface FileRow {
  record_json: string;
}

const schemaVersion = 2;

export class AuditSessionStore {
  readonly #database: DatabaseSync;

  constructor(filePath: string) {
    this.#database = new DatabaseSync(filePath);
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS audit_sessions (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        source_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'canceled', 'failed')),
        discovered_count INTEGER NOT NULL DEFAULT 0,
        completed_count INTEGER NOT NULL DEFAULT 0,
        warnings_json TEXT NOT NULL DEFAULT '[]',
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS audit_files (
        session_id TEXT NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        from_cache INTEGER NOT NULL DEFAULT 0,
        record_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, file_path)
      );
      CREATE INDEX IF NOT EXISTS audit_files_session_ordinal
        ON audit_files(session_id, ordinal);
      CREATE INDEX IF NOT EXISTS audit_sessions_updated_at
        ON audit_sessions(updated_at DESC);
      CREATE TABLE IF NOT EXISTS oracle_cache (
        file_path TEXT PRIMARY KEY,
        size_bytes INTEGER NOT NULL,
        modified_milliseconds REAL NOT NULL,
        engine_version TEXT NOT NULL,
        record_json TEXT NOT NULL,
        cached_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS oracle_cache_cached_at
        ON oracle_cache(cached_at DESC);
      CREATE TABLE IF NOT EXISTS application_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      PRAGMA user_version = ${schemaVersion};
    `);
  }

  create(source: AudioSourceSelection): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.#database
      .prepare(`
        INSERT INTO audit_sessions (
          id, label, source_json, status, started_at, updated_at
        ) VALUES (?, ?, ?, 'running', ?, ?)
      `)
      .run(id, source.label, JSON.stringify(source), now, now);
    return id;
  }

  markDiscovered(sessionId: string, count: number, warnings: string[]): void {
    this.#database
      .prepare(`
        UPDATE audit_sessions
        SET discovered_count = ?, warnings_json = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(count, JSON.stringify(warnings), new Date().toISOString(), sessionId);
  }

  storeFile(
    sessionId: string,
    file: AudioFileRecord,
    ordinal: number,
    fromCache: boolean,
  ): void {
    this.storeFiles(sessionId, [{ file, ordinal, fromCache }]);
  }

  storeFiles(
    sessionId: string,
    entries: Array<{
      file: AudioFileRecord;
      ordinal: number;
      fromCache: boolean;
    }>,
  ): void {
    if (entries.length === 0) return;
    const now = new Date().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const insert = this.#database.prepare(`
          INSERT INTO audit_files (
            session_id, file_path, ordinal, from_cache, record_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id, file_path) DO UPDATE SET
            ordinal = excluded.ordinal,
            from_cache = excluded.from_cache,
            record_json = excluded.record_json,
            updated_at = excluded.updated_at
        `);
      for (const entry of entries) {
        insert.run(
          sessionId,
          entry.file.path,
          entry.ordinal,
          entry.fromCache ? 1 : 0,
          JSON.stringify(entry.file),
          now,
        );
      }
      this.#database
        .prepare(`
          UPDATE audit_sessions
          SET completed_count = (
            SELECT COUNT(*) FROM audit_files WHERE session_id = ?
          ), updated_at = ?
          WHERE id = ?
        `)
        .run(sessionId, now, sessionId);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  finish(
    sessionId: string,
    status: Exclude<AuditSessionStatus, "running">,
    warnings: string[],
  ): void {
    const now = new Date().toISOString();
    this.#database
      .prepare(`
        UPDATE audit_sessions
        SET status = ?, warnings_json = ?, updated_at = ?, finished_at = ?
        WHERE id = ?
      `)
      .run(status, JSON.stringify(warnings), now, now, sessionId);
  }

  updateSessionFile(
    sessionId: string,
    filePath: string,
    record: AudioFileRecord,
  ): boolean {
    const result = this.#database
      .prepare(`
        UPDATE audit_files
        SET record_json = ?, updated_at = ?
        WHERE session_id = ? AND file_path = ?
      `)
      .run(
        JSON.stringify(record),
        new Date().toISOString(),
        sessionId,
        path.resolve(filePath),
      );
    return result.changes > 0;
  }

  listSessions(limit = 25): AuditSessionSummary[] {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = this.#database
      .prepare(`
        SELECT * FROM audit_sessions
        ORDER BY updated_at DESC
        LIMIT ?
      `)
      .all(safeLimit) as unknown as SessionRow[];
    return rows.map((row) => this.#summary(row));
  }

  getSession(sessionId: string): StoredAuditSession | null {
    const session = this.#database
      .prepare("SELECT * FROM audit_sessions WHERE id = ?")
      .get(sessionId) as unknown as SessionRow | undefined;
    if (!session) return null;
    const files = this.#database
      .prepare(`
        SELECT record_json FROM audit_files
        WHERE session_id = ?
        ORDER BY ordinal, file_path
      `)
      .all(sessionId) as unknown as FileRow[];
    return {
      ...this.#summary(session),
      warnings: JSON.parse(session.warnings_json) as string[],
      files: files.map(
        (row) => JSON.parse(row.record_json) as AudioFileRecord,
      ),
    };
  }

  getSessionSummary(sessionId: string): AuditSessionSummary | null {
    const session = this.#database
      .prepare("SELECT * FROM audit_sessions WHERE id = ?")
      .get(sessionId) as unknown as SessionRow | undefined;
    return session ? this.#summary(session) : null;
  }

  getSessionFilesPage(
    sessionId: string,
    offset: number,
    limit = 250,
  ): AudioFileRecord[] {
    const safeOffset = Math.max(0, Math.trunc(offset));
    const safeLimit = Math.max(1, Math.min(1_000, Math.trunc(limit)));
    const rows = this.#database
      .prepare(`
        SELECT record_json FROM audit_files
        WHERE session_id = ?
        ORDER BY ordinal, file_path
        LIMIT ? OFFSET ?
      `)
      .all(sessionId, safeLimit, safeOffset) as unknown as FileRow[];
    return rows.map(
      (row) => JSON.parse(row.record_json) as AudioFileRecord,
    );
  }

  async getCached(filePath: string): Promise<AudioFileRecord | null> {
    const normalized = path.resolve(filePath);
    const row = this.#database
      .prepare(`
        SELECT size_bytes, modified_milliseconds, engine_version, record_json
        FROM oracle_cache
        WHERE file_path = ?
      `)
      .get(normalized) as unknown as
      | {
          size_bytes: number;
          modified_milliseconds: number;
          engine_version: string;
          record_json: string;
        }
      | undefined;
    if (!row) return null;
    try {
      const stat = await fs.stat(normalized);
      const record = JSON.parse(row.record_json) as AudioFileRecord;
      if (
        stat.size !== row.size_bytes ||
        stat.mtimeMs !== row.modified_milliseconds ||
        record.oracle.engineVersion !== row.engine_version
      ) {
        this.deleteCached(normalized);
        return null;
      }
      return record;
    } catch {
      this.deleteCached(normalized);
      return null;
    }
  }

  async setCached(record: AudioFileRecord): Promise<void> {
    const normalized = path.resolve(record.path);
    const stat = await fs.stat(normalized);
    this.#database
      .prepare(`
        INSERT INTO oracle_cache (
          file_path, size_bytes, modified_milliseconds, engine_version,
          record_json, cached_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
          size_bytes = excluded.size_bytes,
          modified_milliseconds = excluded.modified_milliseconds,
          engine_version = excluded.engine_version,
          record_json = excluded.record_json,
          cached_at = excluded.cached_at
      `)
      .run(
        normalized,
        stat.size,
        stat.mtimeMs,
        record.oracle.engineVersion,
        JSON.stringify(record),
        new Date().toISOString(),
      );
  }

  deleteCached(filePath: string): void {
    this.#database
      .prepare("DELETE FROM oracle_cache WHERE file_path = ?")
      .run(path.resolve(filePath));
  }

  cacheCount(): number {
    const row = this.#database
      .prepare("SELECT COUNT(*) AS count FROM oracle_cache")
      .get() as unknown as { count: number };
    return row.count;
  }

  async importLegacyCache(filePath: string): Promise<number> {
    const migrationKey = "legacy-oracle-cache-v4-imported";
    const migrated = this.#database
      .prepare("SELECT value FROM application_metadata WHERE key = ?")
      .get(migrationKey);
    if (migrated) return 0;

    let imported = 0;
    try {
      const document = JSON.parse(await fs.readFile(filePath, "utf8")) as {
        schema?: string;
        entries?: Record<string, { record?: AudioFileRecord }>;
      };
      if (document.schema === "Audio-V Oracle cache v4") {
        for (const entry of Object.values(document.entries ?? {})) {
          if (!entry.record?.path) continue;
          try {
            await this.setCached(entry.record);
            imported += 1;
          } catch {
            // A missing or changed source is intentionally not migrated.
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.#database
      .prepare(`
        INSERT INTO application_metadata (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(migrationKey, new Date().toISOString());
    return imported;
  }

  close(): void {
    this.#database.close();
  }

  #summary(row: SessionRow): AuditSessionSummary {
    return {
      id: row.id,
      label: row.label,
      source: JSON.parse(row.source_json) as AudioSourceSelection,
      status: row.status,
      discoveredCount: row.discovered_count,
      completedCount: row.completed_count,
      warningCount: (JSON.parse(row.warnings_json) as string[]).length,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }
}
