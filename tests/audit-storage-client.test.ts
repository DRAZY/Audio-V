import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditStorageClient } from "../electron/storage/audit-storage-client";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("AuditStorageClient recovery", () => {
  it("times out a lost response and restarts storage for later requests", async () => {
    const directory = await fs.mkdtemp(
      path.join(process.cwd(), "tests/.tmp-storage-client-"),
    );
    temporaryDirectories.push(directory);
    const client = new AuditStorageClient(
      path.join(
        process.cwd(),
        "tests/fixtures/recovering-storage-worker.cjs",
      ),
      path.join(directory, "audit.sqlite3"),
      100,
    );

    await expect(client.listSessions()).rejects.toThrow(
      /did not complete list-sessions/i,
    );
    await expect(client.listSessions()).resolves.toEqual([]);
    await client.close();
  });
});
