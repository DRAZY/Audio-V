import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  calculateChromaprint,
  inspectContentCredentials,
  lookupAcoustId,
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
});
