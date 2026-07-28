import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicationLogger } from "../electron/application-logger";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("ApplicationLogger", () => {
  it("writes structured errors and rotates bounded JSONL files", async () => {
    const directory = await fs.mkdtemp(
      path.join(process.cwd(), "tests/.tmp-application-log-"),
    );
    temporaryDirectories.push(directory);
    const logger = new ApplicationLogger(directory, 64 * 1024, 2);
    for (let index = 0; index < 100; index += 1) {
      logger.log("error", "scan.file-infrastructure-error", {
        filePath: `/library/file-${index}.flac`,
        error: Object.assign(new Error("worker timeout"), {
          code: "ORACLE_WORKER_TIMEOUT",
          attempts: 2,
        }),
        padding: "x".repeat(1_000),
      });
    }

    const current = await fs.readFile(
      path.join(directory, "audio-v.jsonl"),
      "utf8",
    );
    const rotated = await fs.readFile(
      path.join(directory, "audio-v.jsonl.1"),
      "utf8",
    );
    const entry = JSON.parse(current.trim().split("\n").at(-1)!) as {
      event: string;
      data: { error: { code: string; attempts: number } };
    };
    expect(entry.event).toBe("scan.file-infrastructure-error");
    expect(entry.data.error).toMatchObject({
      code: "ORACLE_WORKER_TIMEOUT",
      attempts: 2,
    });
    expect(rotated.length).toBeGreaterThan(0);
    await expect(
      fs.stat(path.join(directory, "audio-v.jsonl.3")),
    ).rejects.toThrow();
    logger.close();
  });
});
