import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync, gunzipSync } from "node:zlib";
import type {
  AudioFileRecord,
  AudioSourceSelection,
  AuditHistoryClearResult,
  AuditSessionStatus,
  AuditSessionSummary,
  StoredAuditSession,
  FingerprintIndexCandidate,
  FingerprintLibraryEntry,
  FingerprintLibraryMutationResult,
} from "../shared/contracts";
import {
  archiveAudioFileRecord,
  compactAudioFileRecord,
  restoreAudioFileDetails,
} from "../shared/compact-audio-record";

interface SessionRow {
  id: string;
  label: string;
  source_json: string;
  status: AuditSessionStatus;
  interrupted: number;
  discovered_count: number;
  completed_count: number;
  warnings_json: string;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface FileRow {
  record_json: string;
  evidence_key?: string | null;
  record_blob?: Uint8Array | null;
}

const schemaVersion = 7;
const crashRecoveryWarning =
  "Audio-V recovered this audit after the previous application process ended before the scan finished.";

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
        interrupted INTEGER NOT NULL DEFAULT 0,
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
        summary_json TEXT,
        evidence_key TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, file_path)
      );
      CREATE INDEX IF NOT EXISTS audit_files_session_ordinal
        ON audit_files(session_id, ordinal);
      CREATE INDEX IF NOT EXISTS audit_sessions_updated_at
        ON audit_sessions(updated_at DESC);
      CREATE TABLE IF NOT EXISTS audit_active_files (
        session_id TEXT NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        started_at TEXT NOT NULL,
        PRIMARY KEY (session_id, file_path)
      );
      CREATE INDEX IF NOT EXISTS audit_active_files_session
        ON audit_active_files(session_id);
      CREATE TABLE IF NOT EXISTS oracle_cache (
        file_path TEXT PRIMARY KEY,
        size_bytes INTEGER NOT NULL,
        modified_milliseconds REAL NOT NULL,
        engine_version TEXT NOT NULL,
        record_json TEXT NOT NULL,
        evidence_key TEXT,
        cached_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS oracle_cache_cached_at
        ON oracle_cache(cached_at DESC);
      CREATE TABLE IF NOT EXISTS oracle_evidence (
        evidence_key TEXT PRIMARY KEY,
        record_json TEXT NOT NULL,
        record_blob BLOB,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS fingerprint_index (
        file_path TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        fingerprint_sha256 TEXT,
        raw_fingerprint_json TEXT NOT NULL,
        duration_seconds REAL,
        engine_version TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS fingerprint_index_sha256
        ON fingerprint_index(fingerprint_sha256);
      CREATE INDEX IF NOT EXISTS fingerprint_index_last_seen
        ON fingerprint_index(last_seen_at DESC);
      CREATE TABLE IF NOT EXISTS application_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      PRAGMA user_version = ${schemaVersion};
    `);
    const sessionColumns = this.#database
      .prepare("PRAGMA table_info(audit_sessions)")
      .all() as unknown as Array<{ name: string }>;
    if (!sessionColumns.some((column) => column.name === "interrupted")) {
      this.#database.exec(
        "ALTER TABLE audit_sessions ADD COLUMN interrupted INTEGER NOT NULL DEFAULT 0",
      );
    }
    const fileColumns = this.#database
      .prepare("PRAGMA table_info(audit_files)")
      .all() as unknown as Array<{ name: string }>;
    if (!fileColumns.some((column) => column.name === "summary_json")) {
      this.#database.exec(
        "ALTER TABLE audit_files ADD COLUMN summary_json TEXT",
      );
    }
    if (!fileColumns.some((column) => column.name === "evidence_key")) {
      this.#database.exec(
        "ALTER TABLE audit_files ADD COLUMN evidence_key TEXT",
      );
    }
    const cacheColumns = this.#database
      .prepare("PRAGMA table_info(oracle_cache)")
      .all() as unknown as Array<{ name: string }>;
    if (!cacheColumns.some((column) => column.name === "evidence_key")) {
      this.#database.exec(
        "ALTER TABLE oracle_cache ADD COLUMN evidence_key TEXT",
      );
    }
    const evidenceColumns = this.#database
      .prepare("PRAGMA table_info(oracle_evidence)")
      .all() as unknown as Array<{ name: string }>;
    if (!evidenceColumns.some((column) => column.name === "record_blob")) {
      this.#database.exec(
        "ALTER TABLE oracle_evidence ADD COLUMN record_blob BLOB",
      );
    }
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

  markFileStarted(sessionId: string, filePath: string): void {
    this.#database
      .prepare(`
        INSERT INTO audit_active_files (session_id, file_path, started_at)
        VALUES (?, ?, ?)
        ON CONFLICT(session_id, file_path) DO UPDATE SET
          started_at = excluded.started_at
      `)
      .run(sessionId, path.resolve(filePath), new Date().toISOString());
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
            session_id, file_path, ordinal, from_cache, record_json,
            summary_json, evidence_key, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id, file_path) DO UPDATE SET
            ordinal = excluded.ordinal,
            from_cache = excluded.from_cache,
            record_json = excluded.record_json,
            summary_json = excluded.summary_json,
            evidence_key = COALESCE(excluded.evidence_key, audit_files.evidence_key),
            updated_at = excluded.updated_at
      `);
      for (const entry of entries) {
        const storedFile = this.#restoreSessionFileDetails(
          sessionId,
          entry.file,
        );
        const compactFile = compactAudioFileRecord(storedFile);
        const evidenceKey = this.#storeEvidence(storedFile, now);
        insert.run(
          sessionId,
          storedFile.path,
          entry.ordinal,
          entry.fromCache ? 1 : 0,
          JSON.stringify(compactFile),
          JSON.stringify(compactFile),
          evidenceKey,
          now,
        );
        this.#indexFingerprint(storedFile, now);
        this.#database
          .prepare(`
            DELETE FROM audit_active_files
            WHERE session_id = ? AND file_path = ?
          `)
          .run(sessionId, path.resolve(entry.file.path));
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
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare(`
          UPDATE audit_sessions
          SET status = ?, warnings_json = ?, updated_at = ?, finished_at = ?
          WHERE id = ?
        `)
        .run(status, JSON.stringify(warnings), now, now, sessionId);
      this.#database
        .prepare("DELETE FROM audit_active_files WHERE session_id = ?")
        .run(sessionId);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  recoverInterruptedSessions(): number {
    const rows = this.#database
      .prepare(`
        SELECT id, warnings_json
        FROM audit_sessions
        WHERE status = 'running'
      `)
      .all() as unknown as Array<{ id: string; warnings_json: string }>;
    if (rows.length === 0) return 0;
    const now = new Date().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const update = this.#database.prepare(`
        UPDATE audit_sessions
        SET status = 'canceled',
            interrupted = 1,
            warnings_json = ?,
            updated_at = ?,
            finished_at = ?
        WHERE id = ? AND status = 'running'
      `);
      for (const row of rows) {
        let warnings: string[] = [];
        try {
          const parsed = JSON.parse(row.warnings_json) as unknown;
          if (Array.isArray(parsed)) {
            warnings = parsed.filter(
              (warning): warning is string => typeof warning === "string",
            );
          }
        } catch {
          warnings = [];
        }
        if (!warnings.includes(crashRecoveryWarning)) {
          warnings.push(crashRecoveryWarning);
        }
        update.run(JSON.stringify(warnings), now, now, row.id);
      }
      this.#database.exec("COMMIT");
      return rows.length;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  getRecoveryCandidates(sessionId: string): string[] {
    const rows = this.#database
      .prepare(`
        SELECT file_path
        FROM audit_active_files
        WHERE session_id = ?
        ORDER BY started_at, file_path
      `)
      .all(sessionId) as unknown as Array<{ file_path: string }>;
    return rows.map((row) => row.file_path);
  }

  updateSessionFile(
    sessionId: string,
    filePath: string,
    record: AudioFileRecord,
  ): boolean {
    const now = new Date().toISOString();
    const storedRecord = this.#restoreSessionFileDetails(sessionId, record);
    const compactRecord = compactAudioFileRecord(storedRecord);
    const evidenceKey = this.#storeEvidence(storedRecord, now);
    const result = this.#database
      .prepare(`
        UPDATE audit_files
        SET record_json = ?, summary_json = ?,
          evidence_key = COALESCE(?, evidence_key), updated_at = ?
        WHERE session_id = ? AND file_path = ?
      `)
      .run(
        JSON.stringify(compactRecord),
        JSON.stringify(compactRecord),
        evidenceKey,
        now,
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

  clearHistory(): AuditHistoryClearResult {
    const terminalSessions = this.#database
      .prepare(`
        SELECT COUNT(*) AS count
        FROM audit_sessions
        WHERE status <> 'running'
      `)
      .get() as unknown as { count: number };
    const runningSessions = this.#database
      .prepare(`
        SELECT COUNT(*) AS count
        FROM audit_sessions
        WHERE status = 'running'
      `)
      .get() as unknown as { count: number };

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.exec(`
        DELETE FROM audit_sessions
        WHERE status <> 'running';

        DELETE FROM oracle_evidence
        WHERE NOT EXISTS (
          SELECT 1 FROM audit_files
          WHERE audit_files.evidence_key = oracle_evidence.evidence_key
        )
        AND NOT EXISTS (
          SELECT 1 FROM oracle_cache
          WHERE oracle_cache.evidence_key = oracle_evidence.evidence_key
        );
      `);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }

    return {
      affected: terminalSessions.count,
      retainedRunning: runningSessions.count,
    };
  }

  getSession(
    sessionId: string,
    compact = false,
  ): StoredAuditSession | null {
    const session = this.#database
      .prepare("SELECT * FROM audit_sessions WHERE id = ?")
      .get(sessionId) as unknown as SessionRow | undefined;
    if (!session) return null;
    const restoredFiles: AudioFileRecord[] = [];
    if (compact) {
      let offset = 0;
      while (true) {
        const page = this.#getCompactSessionFilesPage(
          sessionId,
          offset,
          100,
        );
        if (page.length === 0) break;
        restoredFiles.push(...page);
        offset += page.length;
      }
    } else {
      const files = this.#database
        .prepare(`
          SELECT record_json FROM audit_files
          WHERE session_id = ?
          ORDER BY ordinal, file_path
        `)
        .all(sessionId) as unknown as FileRow[];
      restoredFiles.push(
        ...files.map((row) =>
          this.#restoreSessionFileDetails(
            sessionId,
            JSON.parse(row.record_json) as AudioFileRecord,
          ),
        ),
      );
    }
    return {
      ...this.#summary(session),
      warnings: JSON.parse(session.warnings_json) as string[],
      files: restoredFiles,
    };
  }

  getSessionFile(
    sessionId: string,
    filePath: string,
  ): AudioFileRecord | null {
    const row = this.#database
      .prepare(`
        SELECT record_json
        FROM audit_files
        WHERE session_id = ? AND file_path = ?
      `)
      .get(sessionId, path.resolve(filePath)) as unknown as
      | FileRow
      | undefined;
    return row
      ? this.#restoreSessionFileDetails(
          sessionId,
          JSON.parse(row.record_json) as AudioFileRecord,
        )
      : null;
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
    return rows.map((row) =>
      this.#restoreSessionFileDetails(
        sessionId,
        JSON.parse(row.record_json) as AudioFileRecord,
      ),
    );
  }

  #getCompactSessionFilesPage(
    sessionId: string,
    offset: number,
    limit: number,
  ): AudioFileRecord[] {
    const rows = this.#database
      .prepare(`
        SELECT COALESCE(
          summary_json,
          json_set(
            json_remove(
              record_json,
              '$.oracle.measurements.waveform.points',
              '$.oracle.measurements.spectrogram.slices',
              '$.oracle.measurements.spectrogramPyramid'
            ),
            '$.detailLevel',
            'summary'
          )
        ) AS record_json
        FROM audit_files
        WHERE session_id = ?
        ORDER BY ordinal, file_path
        LIMIT ? OFFSET ?
      `)
      .all(
        sessionId,
        Math.max(1, Math.min(250, Math.trunc(limit))),
        Math.max(0, Math.trunc(offset)),
      ) as unknown as FileRow[];
    return rows.map(
      (row) => JSON.parse(row.record_json) as AudioFileRecord,
    );
  }

  async getCached(filePath: string): Promise<AudioFileRecord | null> {
    const normalized = path.resolve(filePath);
    const row = this.#database
      .prepare(`
        SELECT size_bytes, modified_milliseconds, engine_version, record_json,
          evidence_key
        FROM oracle_cache
        WHERE file_path = ?
      `)
      .get(normalized) as unknown as
      | {
          size_bytes: number;
          modified_milliseconds: number;
          engine_version: string;
          record_json: string;
          evidence_key: string | null;
        }
      | undefined;
    if (!row) return null;
    try {
      const stat = await fs.stat(normalized);
      const summary = JSON.parse(row.record_json) as AudioFileRecord;
      const record = row.evidence_key
        ? restoreAudioFileDetails(
            summary,
            this.#getEvidence(row.evidence_key),
          )
        : summary;
      if (
        stat.size !== row.size_bytes ||
        stat.mtimeMs !== row.modified_milliseconds ||
        record.oracle.engineVersion !== row.engine_version
      ) {
        this.deleteCached(normalized);
        return null;
      }
      if (!row.evidence_key && record.detailLevel !== "summary") {
        const evidenceKey = this.#storeEvidence(
          record,
          new Date().toISOString(),
        );
        this.#database
          .prepare(`
            UPDATE oracle_cache
            SET record_json = ?, evidence_key = ?
            WHERE file_path = ?
          `)
          .run(
            JSON.stringify(compactAudioFileRecord(record)),
            evidenceKey,
            normalized,
          );
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
    const existing = this.#database
      .prepare(`
        SELECT record_json, evidence_key
        FROM oracle_cache
        WHERE file_path = ?
      `)
      .get(normalized) as unknown as FileRow | undefined;
    const existingRecord = existing
      ? (JSON.parse(existing.record_json) as AudioFileRecord)
      : null;
    const cachedRecord = restoreAudioFileDetails(
      record,
      existing?.evidence_key
        ? this.#getEvidence(existing.evidence_key)
        : existingRecord,
    );
    const evidenceKey = this.#storeEvidence(
      cachedRecord,
      new Date().toISOString(),
    );
    const compactRecord = compactAudioFileRecord(cachedRecord);
    this.#database
      .prepare(`
        INSERT INTO oracle_cache (
          file_path, size_bytes, modified_milliseconds, engine_version,
          record_json, evidence_key, cached_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
          size_bytes = excluded.size_bytes,
          modified_milliseconds = excluded.modified_milliseconds,
          engine_version = excluded.engine_version,
          record_json = excluded.record_json,
          evidence_key = excluded.evidence_key,
          cached_at = excluded.cached_at
      `)
      .run(
        normalized,
        stat.size,
        stat.mtimeMs,
        cachedRecord.oracle.engineVersion,
        JSON.stringify(compactRecord),
        evidenceKey,
        new Date().toISOString(),
      );
    this.#indexFingerprint(cachedRecord, new Date().toISOString());
  }

  findFingerprintCandidates(
    filePath: string,
    limit = 100,
    durationSeconds?: number | null,
  ): FingerprintIndexCandidate[] {
    const rows = this.#database
      .prepare(`
        SELECT file_path, file_name, fingerprint_sha256,
          raw_fingerprint_json, duration_seconds, last_seen_at
        FROM fingerprint_index
        WHERE file_path <> ?
          AND (
            ? IS NULL OR
            duration_seconds BETWEEN ? AND ?
          )
        ORDER BY last_seen_at DESC
        LIMIT ?
      `)
      .all(
        path.resolve(filePath),
        durationSeconds ?? null,
        durationSeconds === null || durationSeconds === undefined
          ? null
          : Math.max(0, durationSeconds - 3),
        durationSeconds === null || durationSeconds === undefined
          ? null
          : durationSeconds + 3,
        Math.max(1, Math.min(1_000, Math.trunc(limit))),
      ) as unknown as Array<{
        file_path: string;
        file_name: string;
        fingerprint_sha256: string | null;
        raw_fingerprint_json: string;
        duration_seconds: number | null;
        last_seen_at: string;
      }>;
    return rows.map((row) => ({
      filePath: row.file_path,
      fileName: row.file_name,
      fingerprintSha256: row.fingerprint_sha256,
      rawFingerprint: JSON.parse(row.raw_fingerprint_json) as number[],
      durationSeconds: row.duration_seconds,
      lastSeenAt: row.last_seen_at,
    }));
  }

  async listFingerprintLibrary(limit = 5_000): Promise<FingerprintLibraryEntry[]> {
    const rows = this.#database
      .prepare(`
        SELECT file_path, file_name, fingerprint_sha256, duration_seconds,
          engine_version, last_seen_at,
          CASE
            WHEN fingerprint_sha256 IS NULL THEN 0
            ELSE (
              SELECT COUNT(*) - 1
              FROM fingerprint_index AS duplicate
              WHERE duplicate.fingerprint_sha256 =
                fingerprint_index.fingerprint_sha256
            )
          END AS exact_duplicate_count
        FROM fingerprint_index
        ORDER BY last_seen_at DESC, file_name COLLATE NOCASE
        LIMIT ?
      `)
      .all(Math.max(1, Math.min(20_000, Math.trunc(limit)))) as unknown as Array<{
        file_path: string;
        file_name: string;
        fingerprint_sha256: string | null;
        duration_seconds: number | null;
        engine_version: string;
        last_seen_at: string;
        exact_duplicate_count: number;
      }>;
    return Promise.all(rows.map(async (row) => ({
      filePath: row.file_path,
      fileName: row.file_name,
      fingerprintSha256: row.fingerprint_sha256,
      durationSeconds: row.duration_seconds,
      engineVersion: row.engine_version,
      lastSeenAt: row.last_seen_at,
      fileExists: await fs.access(row.file_path).then(() => true).catch(() => false),
      exactDuplicateCount: row.exact_duplicate_count,
    })));
  }

  rebuildFingerprintLibrary(): FingerprintLibraryMutationResult {
    const rows = this.#database
      .prepare(`
        SELECT record_json, updated_at
        FROM audit_files
        ORDER BY updated_at
      `)
      .all() as unknown as Array<{ record_json: string; updated_at: string }>;
    const before = this.fingerprintCount();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.exec("DELETE FROM fingerprint_index");
      for (const row of rows) {
        this.#indexFingerprint(
          JSON.parse(row.record_json) as AudioFileRecord,
          row.updated_at,
        );
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    const remaining = this.fingerprintCount();
    return { affected: Math.max(before, remaining), remaining };
  }

  async pruneMissingFingerprints(): Promise<FingerprintLibraryMutationResult> {
    const rows = this.#database
      .prepare("SELECT file_path FROM fingerprint_index")
      .all() as unknown as Array<{ file_path: string }>;
    const missing = (
      await Promise.all(rows.map(async (row) =>
        await fs.access(row.file_path).then(() => null).catch(() => row.file_path)
      ))
    ).filter((filePath): filePath is string => filePath !== null);
    if (missing.length > 0) {
      this.#database.exec("BEGIN IMMEDIATE");
      try {
        const remove = this.#database.prepare(
          "DELETE FROM fingerprint_index WHERE file_path = ?",
        );
        for (const filePath of missing) remove.run(filePath);
        this.#database.exec("COMMIT");
      } catch (error) {
        this.#database.exec("ROLLBACK");
        throw error;
      }
    }
    return { affected: missing.length, remaining: this.fingerprintCount() };
  }

  clearFingerprintLibrary(): FingerprintLibraryMutationResult {
    const affected = this.fingerprintCount();
    this.#database.exec("DELETE FROM fingerprint_index");
    return { affected, remaining: 0 };
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

  fingerprintCount(): number {
    const row = this.#database
      .prepare("SELECT COUNT(*) AS count FROM fingerprint_index")
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

  #indexFingerprint(record: AudioFileRecord, now: string): void {
    const fingerprint = record.oracle.technical?.fingerprint;
    if (
      !fingerprint ||
      fingerprint.status !== "measured" ||
      fingerprint.rawFingerprint.length === 0
    ) return;
    this.#database
      .prepare(`
        INSERT INTO fingerprint_index (
          file_path, file_name, fingerprint_sha256, raw_fingerprint_json,
          duration_seconds, engine_version, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
          file_name = excluded.file_name,
          fingerprint_sha256 = excluded.fingerprint_sha256,
          raw_fingerprint_json = excluded.raw_fingerprint_json,
          duration_seconds = excluded.duration_seconds,
          engine_version = excluded.engine_version,
          last_seen_at = excluded.last_seen_at
      `)
      .run(
        path.resolve(record.path),
        record.name,
        fingerprint.fingerprintSha256,
        JSON.stringify(fingerprint.rawFingerprint),
        fingerprint.durationSeconds,
        record.oracle.engineVersion,
        now,
      );
  }

  #restoreSessionFileDetails(
    sessionId: string,
    record: AudioFileRecord,
  ): AudioFileRecord {
    if (record.detailLevel !== "summary") return record;
    const existing = this.#database
      .prepare(`
        SELECT record_json, evidence_key
        FROM audit_files
        WHERE session_id = ? AND file_path = ?
      `)
      .get(sessionId, path.resolve(record.path)) as unknown as
      | FileRow
      | undefined;
    const existingRecord = existing
      ? (JSON.parse(existing.record_json) as AudioFileRecord)
      : null;
    if (existingRecord?.detailLevel !== "summary") {
      return restoreAudioFileDetails(record, existingRecord);
    }
    return restoreAudioFileDetails(
      record,
      existing?.evidence_key
        ? this.#getEvidence(existing.evidence_key)
        : null,
    );
  }

  #storeEvidence(record: AudioFileRecord, now: string): string | null {
    if (record.detailLevel === "summary") return null;
    const identity =
      record.oracle.technical?.fileSha256 ??
      `${record.id}:${record.sizeBytes}:${record.oracle.measuredAt}`;
    const evidenceKey = createHash("sha256")
      .update(`${record.oracle.engineVersion}\0${identity}`)
      .digest("hex");
    const existing = this.#database
      .prepare(`
        SELECT 1
        FROM oracle_evidence
        WHERE evidence_key = ?
      `)
      .get(evidenceKey);
    if (existing) return evidenceKey;
    const serialized = JSON.stringify(archiveAudioFileRecord(record));
    this.#database
      .prepare(`
        INSERT INTO oracle_evidence (
          evidence_key, record_json, record_blob, created_at
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(evidence_key) DO NOTHING
      `)
      .run(
        evidenceKey,
        JSON.stringify(compactAudioFileRecord(record)),
        gzipSync(serialized, { level: 1 }),
        now,
      );
    return evidenceKey;
  }

  #getEvidence(evidenceKey: string): AudioFileRecord | null {
    const evidence = this.#database
      .prepare(`
        SELECT record_json, record_blob
        FROM oracle_evidence
        WHERE evidence_key = ?
      `)
      .get(evidenceKey) as unknown as FileRow | undefined;
    if (!evidence) return null;
    if (evidence.record_blob) {
      return JSON.parse(
        gunzipSync(Buffer.from(evidence.record_blob)).toString("utf8"),
      ) as AudioFileRecord;
    }
    return JSON.parse(evidence.record_json) as AudioFileRecord;
  }

  #summary(row: SessionRow): AuditSessionSummary {
    const recoveryCandidate = this.#database
      .prepare(`
        SELECT COUNT(*) AS count
        FROM audit_active_files
        WHERE session_id = ?
      `)
      .get(row.id) as unknown as { count: number };
    return {
      id: row.id,
      label: row.label,
      source: JSON.parse(row.source_json) as AudioSourceSelection,
      status: row.status,
      interrupted: Boolean(row.interrupted),
      recoveryCandidateCount: recoveryCandidate.count,
      discoveredCount: row.discovered_count,
      completedCount: row.completed_count,
      warningCount: (JSON.parse(row.warnings_json) as string[]).length,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }
}
