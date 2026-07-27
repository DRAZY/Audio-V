import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { IAudioMetadata } from "music-metadata";
import { buildMetadataInventory } from "../electron/metadata-inventory";

let temporaryDirectory = "";

afterEach(async () => {
  if (temporaryDirectory) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = "";
  }
});

describe("metadata inventory", () => {
  it("normalizes identity, ReplayGain, generator tags, and sidecar cue sheets", async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(process.cwd(), "tests", ".tmp-metadata-"),
    );
    const audioPath = path.join(temporaryDirectory, "track.flac");
    await fs.writeFile(audioPath, "");
    await fs.writeFile(
      path.join(temporaryDirectory, "album.cue"),
      'FILE "track.flac" WAVE\n  TRACK 01 AUDIO\n  TRACK 02 AUDIO\n',
    );
    const metadata = {
      format: {},
      common: {
        track: { no: 1, of: 2 },
        disk: { no: 1, of: 1 },
        movementIndex: { no: null, of: null },
        title: "Track",
        artists: ["Artist"],
        album: "Album",
        bpm: 120,
        replaygain_track_gain: { dB: -7.25 },
        replaygain_track_peak: { ratio: 0.98 },
      },
      native: {
        vorbis: [
          { id: "ENCODER", value: "Suno export" },
          { id: "MUSICBRAINZ_TRACKID", value: "recording-id" },
        ],
      },
      quality: { warnings: [] },
    } as unknown as IAudioMetadata;

    const result = await buildMetadataInventory(audioPath, metadata);

    expect(result).toMatchObject({
      title: "Track",
      artists: ["Artist"],
      album: "Album",
      bpm: 120,
      replayGain: { trackGainDb: -7.25, trackPeak: 0.98 },
      cueSheet: { embedded: false, trackCount: 2 },
    });
    expect(result.cueSheet.sidecarPaths).toHaveLength(1);
    expect(result.tags).toContainEqual({
      key: "ENCODER",
      value: "Suno export",
    });
  });
});
