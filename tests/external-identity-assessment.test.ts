import { describe, expect, it } from "vitest";
import type {
  AcoustIdLookup,
  MetadataInventory,
  MusicBrainzEnrichment,
} from "../shared/contracts";
import { assessExternalIdentity } from "../shared/external-identity-assessment";

const metadata: MetadataInventory = {
  title: "Example Song",
  artists: ["Example Artist feat. Guest"],
  album: "Example Album",
  albumArtists: [],
  composers: [],
  genres: [],
  date: null,
  year: null,
  trackNumber: null,
  trackTotal: null,
  discNumber: null,
  discTotal: null,
  bpm: null,
  isrcs: [],
  musicBrainzRecordingIds: ["b9ad642e-b012-41c7-b72a-42cf4911f9ff"],
  acoustId: null,
  replayGain: {
    trackGainDb: null,
    trackPeak: null,
    albumGainDb: null,
    albumPeak: null,
  },
  cueSheet: {
    embedded: false,
    sidecarPaths: [],
    trackCount: 0,
    tracks: [],
  },
  tags: [],
};

const acoustId: AcoustIdLookup = {
  status: "matched",
  acoustId: "acoustid-result",
  score: 0.98,
  recordingIds: ["b9ad642e-b012-41c7-b72a-42cf4911f9ff"],
  recordingTitles: ["Example Song"],
  error: null,
};

const musicBrainz: MusicBrainzEnrichment = {
  status: "matched",
  source: "acoustid-match",
  recordingId: "b9ad642e-b012-41c7-b72a-42cf4911f9ff",
  title: "Example Song",
  disambiguation: null,
  artists: [
    { id: "artist-a", name: "Example Artist" },
    { id: "artist-b", name: "Guest" },
  ],
  isrcs: [],
  firstReleaseDate: null,
  releaseGroups: [],
  error: null,
  limitation: "Identity only.",
};

describe("parallel external identity assessment", () => {
  it("corroborates equivalent recording, title, and artist declarations", () => {
    expect(assessExternalIdentity(metadata, acoustId, musicBrainz)).toMatchObject({
      status: "metadata-corroborated",
      basis: "acoustic-match",
      providers: ["acoustid", "musicbrainz"],
      comparisons: [
        { field: "recording-id", result: "agrees" },
        { field: "title", result: "agrees" },
        { field: "artist", result: "agrees" },
      ],
    });
  });

  it("exposes metadata conflicts without producing an Oracle verdict", () => {
    const result = assessExternalIdentity(
      { ...metadata, title: "Different Song" },
      acoustId,
      musicBrainz,
    );
    expect(result.status).toBe("metadata-conflict");
    expect(result.comparisons).toContainEqual(
      expect.objectContaining({ field: "title", result: "conflicts" }),
    );
    expect(result).not.toHaveProperty("verdict");
    expect(result.summary).toContain("audio-quality verdict is unchanged");
  });

  it("reports an acoustic match when local metadata cannot corroborate it", () => {
    const result = assessExternalIdentity(
      {
        ...metadata,
        title: null,
        artists: [],
        albumArtists: [],
        musicBrainzRecordingIds: [],
      },
      acoustId,
      undefined,
    );
    expect(result).toMatchObject({
      status: "identity-matched",
      basis: "acoustic-match",
      comparisons: [],
    });
  });

  it("keeps missing or disabled external identity evidence inconclusive", () => {
    const result = assessExternalIdentity(
      metadata,
      {
        status: "not-requested",
        acoustId: null,
        score: null,
        recordingIds: [],
        recordingTitles: [],
        error: null,
      },
      undefined,
    );
    expect(result).toMatchObject({
      status: "inconclusive",
      basis: null,
      providers: [],
    });
  });

  it("labels an embedded MusicBrainz lookup as declared identity evidence", () => {
    const result = assessExternalIdentity(metadata, {
      status: "not-requested",
      acoustId: null,
      score: null,
      recordingIds: [],
      recordingTitles: [],
      error: null,
    }, {
      ...musicBrainz,
      source: "embedded-mbid",
    });
    expect(result).toMatchObject({
      status: "metadata-corroborated",
      basis: "embedded-id-lookup",
      providers: ["musicbrainz"],
    });
  });
});
