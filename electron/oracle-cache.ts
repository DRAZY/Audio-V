import { promises as fs } from "node:fs";
import path from "node:path";
import type { AudioFileRecord } from "../shared/contracts";

const cacheSchema = "Audio-V Oracle cache v4";
const maximumEntries = 300;

interface CacheEntry {
  sizeBytes: number;
  modifiedMilliseconds: number;
  cachedAt: string;
  record: AudioFileRecord;
}

interface CacheDocument {
  schema: typeof cacheSchema;
  entries: Record<string, CacheEntry>;
}

export class OracleCache {
  readonly #filePath: string;
  readonly #entries = new Map<string, CacheEntry>();
  #loaded = false;
  #dirty = false;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async #load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const document = JSON.parse(
        await fs.readFile(this.#filePath, "utf8"),
      ) as CacheDocument;
      if (document.schema !== cacheSchema) return;
      for (const [filePath, entry] of Object.entries(document.entries)) {
        this.#entries.set(filePath, entry);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.#entries.clear();
      }
    }
  }

  async get(filePath: string): Promise<AudioFileRecord | null> {
    await this.#load();
    const normalized = path.resolve(filePath);
    const entry = this.#entries.get(normalized);
    if (!entry) return null;
    try {
      const stat = await fs.stat(normalized);
      if (
        stat.size !== entry.sizeBytes ||
        stat.mtimeMs !== entry.modifiedMilliseconds
      ) {
        this.#entries.delete(normalized);
        this.#dirty = true;
        return null;
      }
      return entry.record;
    } catch {
      this.#entries.delete(normalized);
      this.#dirty = true;
      return null;
    }
  }

  async set(record: AudioFileRecord): Promise<void> {
    await this.#load();
    const normalized = path.resolve(record.path);
    const stat = await fs.stat(normalized);
    this.#entries.set(normalized, {
      sizeBytes: stat.size,
      modifiedMilliseconds: stat.mtimeMs,
      cachedAt: new Date().toISOString(),
      record,
    });
    this.#dirty = true;
  }

  async flush(): Promise<void> {
    await this.#load();
    if (!this.#dirty) return;
    const entries = [...this.#entries.entries()]
      .sort(
        (left, right) =>
          Date.parse(right[1].cachedAt) - Date.parse(left[1].cachedAt),
      )
      .slice(0, maximumEntries);
    const document: CacheDocument = {
      schema: cacheSchema,
      entries: Object.fromEntries(entries),
    };
    await fs.mkdir(path.dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.tmp-${process.pid}`;
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify(document)}\n`,
      "utf8",
    );
    await fs.rename(temporaryPath, this.#filePath);
    this.#dirty = false;
  }
}
