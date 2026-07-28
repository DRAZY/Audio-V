import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";

export type ApplicationLogLevel = "debug" | "info" | "warn" | "error";

export interface ApplicationLogEntry {
  timestamp: string;
  level: ApplicationLogLevel;
  event: string;
  processId: number;
  data?: Record<string, unknown>;
}

function serializable(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: value.cause ? serializable(value.cause) : undefined,
      ...Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== "stack"),
      ),
    };
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serializable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializable(entry)]),
    );
  }
  return value;
}

export class ApplicationLogger {
  readonly directory: string;
  readonly filePath: string;
  readonly #maximumBytes: number;
  readonly #retainedFiles: number;
  #currentBytes = 0;
  #descriptor: number | null = null;

  constructor(
    directory: string,
    maximumBytes = 8 * 1024 * 1024,
    retainedFiles = 4,
  ) {
    this.directory = directory;
    this.filePath = path.join(directory, "audio-v.jsonl");
    this.#maximumBytes = Math.max(64 * 1024, maximumBytes);
    this.#retainedFiles = Math.max(1, retainedFiles);
    mkdirSync(directory, { recursive: true });
    this.#currentBytes = existsSync(this.filePath)
      ? statSync(this.filePath).size
      : 0;
    this.#descriptor = openSync(this.filePath, "a");
  }

  log(
    level: ApplicationLogLevel,
    event: string,
    data?: Record<string, unknown>,
  ): void {
    try {
      const entry: ApplicationLogEntry = {
        timestamp: new Date().toISOString(),
        level,
        event,
        processId: process.pid,
        ...(data ? { data: serializable(data) as Record<string, unknown> } : {}),
      };
      const line = `${JSON.stringify(entry)}\n`;
      const bytes = Buffer.byteLength(line);
      if (this.#currentBytes + bytes > this.#maximumBytes) this.#rotate();
      if (this.#descriptor === null) return;
      writeSync(this.#descriptor, line, undefined, "utf8");
      this.#currentBytes += bytes;
    } catch {
      // Logging must never become an application failure.
    }
  }

  #rotate(): void {
    if (this.#descriptor !== null) {
      closeSync(this.#descriptor);
      this.#descriptor = null;
    }
    for (let index = this.#retainedFiles; index >= 1; index -= 1) {
      const source =
        index === 1 ? this.filePath : `${this.filePath}.${index - 1}`;
      const destination = `${this.filePath}.${index}`;
      if (!existsSync(source)) continue;
      if (index === this.#retainedFiles && existsSync(destination)) {
        unlinkSync(destination);
      }
      renameSync(source, destination);
    }
    this.#currentBytes = 0;
    this.#descriptor = openSync(this.filePath, "a");
  }

  close(): void {
    if (this.#descriptor === null) return;
    closeSync(this.#descriptor);
    this.#descriptor = null;
  }
}
