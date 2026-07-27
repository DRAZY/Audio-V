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
});
