import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseChecksumManifest,
  verifyChecksumEntries,
} from "../electron/checksum-verifier";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("checksum manifests", () => {
  it("parses GNU, BSD, and filename-specific checksum formats", () => {
    const manifest = path.join("/library", "album.sha256");
    const entries = parseChecksumManifest(
      manifest,
      [
        `${"a".repeat(32)} *track-one.flac`,
        `SHA256 (disc/track-two.wav) = ${"b".repeat(64)}`,
      ].join("\n"),
    );

    expect(entries).toEqual([
      expect.objectContaining({
        algorithm: "md5",
        expected: "a".repeat(32),
        filePath: path.resolve("/library", "track-one.flac"),
      }),
      expect.objectContaining({
        algorithm: "sha256",
        expected: "b".repeat(64),
        filePath: path.resolve("/library", "disc/track-two.wav"),
      }),
    ]);

    expect(
      parseChecksumManifest(
        path.join("/library", "track-three.flac.sha512"),
        "c".repeat(128),
      )[0],
    ).toMatchObject({
      algorithm: "sha512",
      filePath: path.resolve("/library", "track-three.flac"),
    });
  });

  it("calculates every requested digest in one file pass and reports mismatch", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "audio-v-checksum-"),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "track.flac");
    const contents = Buffer.from("Audio-V checksum fixture");
    await fs.writeFile(filePath, contents);
    const md5 = createHash("md5").update(contents).digest("hex");
    const entries = parseChecksumManifest(
      path.join(directory, "checksums.txt.md5"),
      `${md5}  track.flac\n${"0".repeat(64)}  track.flac`,
    );

    const results = await verifyChecksumEntries(filePath, entries);

    expect(results.map((item) => item.status)).toEqual([
      "verified",
      "mismatch",
    ]);
    expect(results[0].algorithm).toBe("md5");
    expect(results[1].algorithm).toBe("sha256");
  });

  it("verifies a staged copy against entries naming the original file", async () => {
    // The scanner reads bytes from a staged temp copy when stageSourceFile
    // decides the source is slow or remote, while manifests still name the
    // original. Passing the staged path as both the read location and the
    // identity made every entry fail the match, so verification returned an
    // empty list and reported nothing rather than failing. That is why sidecar
    // checksums silently stopped working on Windows, where staging engages and
    // macOS runs direct.
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "audio-v-checksum-staged-"),
    );
    temporaryDirectories.push(directory);
    const originalPath = path.join(directory, "track.flac");
    const contents = Buffer.from("Audio-V staged fixture");
    await fs.writeFile(originalPath, contents);

    // A byte-identical copy standing in for what stageSourceFile produces,
    // deliberately under a different name so the paths cannot coincide.
    const stagedPath = path.join(directory, "staged-copy.tmp");
    await fs.writeFile(stagedPath, contents);

    const md5 = createHash("md5").update(contents).digest("hex");
    const entries = parseChecksumManifest(
      path.join(directory, "album.md5"),
      `${md5}  track.flac\n`,
    );

    const results = await verifyChecksumEntries(
      stagedPath,
      entries,
      {},
      undefined,
      originalPath,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ algorithm: "md5", status: "verified" });

    // Without the identity argument the entry names a file the read path is
    // not, so nothing matches. Asserting the regression directly keeps the two
    // parameters from being collapsed back into one.
    const collapsed = await verifyChecksumEntries(stagedPath, entries);
    expect(collapsed).toEqual([]);
  });
});
