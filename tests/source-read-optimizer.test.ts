import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifySourceStorage,
  stageSourceFile,
} from "../electron/source-read-optimizer";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("source read optimization", () => {
  it("classifies mounted and network paths consistently across platforms", () => {
    expect(
      classifySourceStorage("\\\\studio-nas\\music\\track.flac", "win32"),
    ).toBe("network");
    expect(
      classifySourceStorage("Z:\\Music\\track.flac", "win32", "C:"),
    ).toBe("removable-or-mounted");
    expect(
      classifySourceStorage("/Volumes/Studio NAS/track.flac", "darwin"),
    ).toBe("removable-or-mounted");
    expect(classifySourceStorage("/Users/test/Music/track.flac", "darwin")).toBe(
      "local",
    );
  });

  it("stages a mounted source once and removes the temporary copy", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "audio-v-stage-test-"),
    );
    temporaryDirectories.push(directory);
    const source = path.join(directory, "source.flac");
    const contents = Buffer.alloc(2 * 1024 * 1024, 0x5a);
    await fs.writeFile(source, contents);

    const transferProgress: Array<[number, number]> = [];
    const staged = await stageSourceFile(
      source,
      undefined,
      "removable-or-mounted",
      (transferred, total) => transferProgress.push([transferred, total]),
    );
    expect(staged.staged).toBe(true);
    expect(staged.analysisPath).not.toBe(source);
    const stagedContents = await fs.readFile(staged.analysisPath);
    expect(stagedContents.length).toBe(contents.length);
    expect(Buffer.compare(stagedContents, contents)).toBe(0);
    expect(transferProgress.at(-1)).toEqual([contents.length, contents.length]);
    const stagedPath = staged.analysisPath;
    await staged.cleanup();
    await expect(fs.stat(stagedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
