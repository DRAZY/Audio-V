import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OracleCache } from "../electron/oracle-cache";
import { scanSources } from "../electron/scanner";
import { pcmWave } from "./helpers/wave-fixture";

describe("OracleCache", () => {
  it("persists completed analyses and invalidates changed files", async () => {
    const directory = await fs.mkdtemp(
      path.join(process.cwd(), "tests/.tmp-cache-"),
    );
    try {
      const audioPath = path.join(directory, "cached.wav");
      const cachePath = path.join(directory, "oracle-cache.json");
      await fs.writeFile(audioPath, pcmWave({ seconds: 0.2 }));
      const source = {
        kind: "files" as const,
        label: "cache test",
        paths: [audioPath],
      };
      const initialCache = new OracleCache(cachePath);
      await scanSources(source, undefined, { cache: initialCache });
      await initialCache.flush();

      const restored: boolean[] = [];
      const reloadedCache = new OracleCache(cachePath);
      await scanSources(
        source,
        (progress) => {
          if (progress.file) restored.push(progress.fromCache);
        },
        { cache: reloadedCache },
      );
      expect(restored).toEqual([true]);

      await fs.writeFile(audioPath, pcmWave({ seconds: 0.3 }));
      const invalidated: boolean[] = [];
      await scanSources(
        source,
        (progress) => {
          if (progress.file) invalidated.push(progress.fromCache);
        },
        { cache: reloadedCache },
      );
      expect(invalidated).toEqual([false]);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
