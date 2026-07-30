import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  calculateChromaprint,
  inspectContentCredentials,
  lookupAcoustId,
  lookupMusicBrainzRecording,
  metadataProvenanceIndicators,
  normalizeAcoustIdApiKey,
  validateAcoustIdApiKey,
} from "../electron/oracle/analysis-tools";

const fixture = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "fidelity-engine",
  "native-wideband-96.flac",
);

describe("provenance and fingerprint tools", () => {
  it("reports absent Content Credentials neutrally and offline", async () => {
    const result = await inspectContentCredentials(fixture);
    expect(result).toMatchObject({
      status: "not-present",
      manifestCount: 0,
      networkAccess: "disabled",
    });
  });

  it("calculates a reproducible local Chromaprint", async () => {
    const left = await calculateChromaprint(fixture);
    const right = await calculateChromaprint(fixture);
    expect(left.status).toBe("measured");
    expect(left.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(right.fingerprintSha256).toBe(left.fingerprintSha256);
    expect(left.rawFingerprint.length).toBeGreaterThan(0);
  });

  it("labels generator metadata as an editable indicator, not an AI verdict", () => {
    const indicators = metadataProvenanceIndicators(
      [{ key: "ENCODER", value: "Suno export" }],
      [],
      {
        status: "not-present",
        manifestCount: 0,
        activeManifest: null,
        claimGenerator: null,
        signer: null,
        signedAt: null,
        digitalSourceTypes: [],
        validationErrors: [],
        networkAccess: "disabled",
        limitation: "Absence is neutral.",
      },
    );
    expect(indicators[0]).toMatchObject({
      identifier: "Suno",
      type: "generator-metadata",
    });
    expect(indicators[0].interpretation).toContain("not proof");
  });

  it("labels MQA text only as an unauthenticated format declaration", () => {
    const indicators = metadataProvenanceIndicators(
      [{ key: "MQAORIGINALSAMPLERATE", value: "96000" }],
      [],
      {
        status: "not-present",
        manifestCount: 0,
        activeManifest: null,
        claimGenerator: null,
        signer: null,
        signedAt: null,
        digitalSourceTypes: [],
        validationErrors: [],
        networkAccess: "disabled",
        limitation: "Absence is neutral.",
      },
    );
    expect(indicators).toContainEqual(
      expect.objectContaining({
        type: "format-marker",
        identifier: "MQA declaration",
        source: "metadata:MQAORIGINALSAMPLERATE",
      }),
    );
    expect(indicators.at(-1)?.interpretation).toContain(
      "has not authenticated",
    );
  });

  it("keeps opt-in AcoustID results bounded and aligned to recording IDs", async () => {
    const fingerprint = await calculateChromaprint(fixture);
    const responseBody = JSON.stringify({
      status: "ok",
      results: [{
        id: "acoustid-result",
        score: 0.97,
        recordings: [
          { id: "musicbrainz-a", title: "Known title" },
          { id: "musicbrainz-b" },
        ],
      }],
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(responseBody, {
        status: 200,
        headers: { "content-length": String(Buffer.byteLength(responseBody)) },
      }),
    );
    try {
      const result = await lookupAcoustId(
        fingerprint,
        " Abcdef1234 ",
        undefined,
        fixture,
      );
      expect(result).toMatchObject({
        status: "matched",
        acoustId: "acoustid-result",
        score: 0.97,
        recordingIds: ["musicbrainz-a", "musicbrainz-b"],
        recordingTitles: ["Known title", ""],
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.acoustid.org/v2/lookup",
        expect.objectContaining({ method: "POST" }),
      );
      const request = fetchMock.mock.calls[0][1] as RequestInit;
      expect(String(request.body)).toContain("client=Abcdef1234");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("serializes transient AcoustID failures through a bounded retry", async () => {
    const fingerprint = {
      ...(await calculateChromaprint(fixture)),
      fingerprint: "synthetic-encoded-fingerprint",
      fingerprintSha256: "b".repeat(64),
    };
    const successBody = JSON.stringify({
      status: "ok",
      results: [{
        id: "retry-result",
        score: 0.91,
        recordings: [{ id: "musicbrainz-retry", title: "Retry title" }],
      }],
    });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          status: "error",
          error: { code: 14, message: "temporarily unavailable" },
        }), {
          status: 503,
        }),
      )
      .mockResolvedValueOnce(
        new Response(successBody, {
          status: 200,
          headers: {
            "content-length": String(Buffer.byteLength(successBody)),
          },
        }),
      );
    try {
      await expect(
        lookupAcoustId(fingerprint, "Abcdef1234"),
      ).resolves.toMatchObject({
        status: "matched",
        acoustId: "retry-result",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("trims and locally validates AcoustID application keys", () => {
    expect(normalizeAcoustIdApiKey(" Abcdef1234\n")).toBe("Abcdef1234");
    expect(() => normalizeAcoustIdApiKey("user-key-with-symbols")).toThrow(
      "10-character application API key",
    );
  });

  it("preflights an accepted AcoustID application key before scanning", async () => {
    const responseBody = JSON.stringify({
      status: "error",
      error: { code: 2, message: 'missing required parameter "fingerprint"' },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(responseBody, {
        status: 400,
        headers: { "content-length": String(Buffer.byteLength(responseBody)) },
      }),
    );
    try {
      await expect(validateAcoustIdApiKey(" Abcdef1234 ")).resolves.toBe(
        "Abcdef1234",
      );
      const request = fetchMock.mock.calls[0][1] as RequestInit;
      expect(String(request.body)).toBe("client=Abcdef1234&format=json");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("surfaces AcoustID's invalid-application-key explanation", async () => {
    const responseBody = JSON.stringify({
      status: "error",
      error: { code: 4, message: "invalid API key" },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(responseBody, {
        status: 400,
        headers: { "content-length": String(Buffer.byteLength(responseBody)) },
      }),
    );
    try {
      await expect(validateAcoustIdApiKey("Abcdef1234")).rejects.toThrow(
        "registered application",
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("directly enriches one MusicBrainz recording and caches repeated IDs", async () => {
    const recordingId = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d";
    const responseBody = JSON.stringify({
      id: recordingId,
      title: "Love Me Do",
      "first-release-date": "1962-10-05",
      isrcs: ["GBAYE0601408"],
      "artist-credit": [{
        artist: {
          id: "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600a",
          name: "The Beatles",
        },
      }],
      releases: [{
        "release-group": {
          id: "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600b",
          title: "Love Me Do",
          "primary-type": "Single",
          "first-release-date": "1962-10-05",
        },
      }],
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(responseBody, {
        status: 200,
        headers: { "content-length": String(Buffer.byteLength(responseBody)) },
      }),
    );
    try {
      const first = await lookupMusicBrainzRecording(
        [recordingId],
        {
          status: "not-requested",
          acoustId: null,
          score: null,
          recordingIds: [],
          recordingTitles: [],
          error: null,
        },
      );
      const second = await lookupMusicBrainzRecording(
        [],
        {
          status: "matched",
          acoustId: "acoustid-result",
          score: 0.99,
          recordingIds: [recordingId],
          recordingTitles: ["Love Me Do"],
          error: null,
        },
      );
      expect(first).toMatchObject({
        status: "matched",
        source: "embedded-mbid",
        recordingId,
        title: "Love Me Do",
        artists: [{ name: "The Beatles" }],
        isrcs: ["GBAYE0601408"],
        firstReleaseDate: "1962-10-05",
      });
      expect(second).toEqual({
        ...first,
        source: "acoustid-match",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const requestedUrl = fetchMock.mock.calls[0][0] as URL;
      expect(requestedUrl.pathname).toBe(`/ws/2/recording/${recordingId}`);
      expect(requestedUrl.searchParams.get("inc")).toBe(
        "artist-credits+isrcs+releases+release-groups",
      );
      expect(fetchMock.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "User-Agent": expect.stringContaining("github.com/DRAZY/Audio-V"),
          }),
        }),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("retries transient MusicBrainz throttling before recording a service error", async () => {
    const recordingId = "00000000-0000-4000-8000-000000000002";
    const successBody = JSON.stringify({
      id: recordingId,
      title: "Recovered MusicBrainz lookup",
      "artist-credit": [],
      isrcs: [],
      releases: [],
    });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "Your requests are exceeding the allowable rate limit.",
          }),
          {
            status: 503,
            headers: { "retry-after": "0" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(successBody, {
          status: 200,
          headers: {
            "content-length": String(Buffer.byteLength(successBody)),
          },
        }),
      );
    try {
      await expect(
        lookupMusicBrainzRecording(
          [recordingId],
          {
            status: "not-requested",
            acoustId: null,
            score: null,
            recordingIds: [],
            recordingTitles: [],
            error: null,
          },
        ),
      ).resolves.toMatchObject({
        status: "matched",
        recordingId,
        title: "Recovered MusicBrainz lookup",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("keeps MusicBrainz enrichment neutral without a valid recording ID", async () => {
    await expect(
      lookupMusicBrainzRecording(
        ["not-an-mbid"],
        {
          status: "matched",
          acoustId: "candidate",
          score: 0.5,
          recordingIds: ["also-not-an-mbid"],
          recordingTitles: ["Ambiguous"],
          error: null,
        },
      ),
    ).resolves.toMatchObject({
      status: "no-identifier",
      source: null,
      recordingId: null,
    });
  });
});
