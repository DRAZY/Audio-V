import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  calculateChromaprint,
  inspectContentCredentials,
  lookupAcoustId,
  metadataProvenanceIndicators,
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
        "test-key",
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
      expect(String(fetchMock.mock.calls[0][0])).toContain(
        "api.acoustid.org/v2/lookup",
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
});
