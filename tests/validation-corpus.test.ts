import { describe, expect, it } from "vitest";
import {
  clopperPearson,
  splitForGroup,
  validateCorpus,
  validateRecipes,
} from "../scripts/lib/validation-corpus.mjs";

describe("validation corpus grouping", () => {
  it("assigns a contributor group deterministically", () => {
    expect(splitForGroup("artist-one")).toBe(splitForGroup("artist-one"));
  });

  it("keeps the assignment within the declared partitions", () => {
    const splits = new Set(
      Array.from({ length: 100 }, (_, index) =>
        splitForGroup(`contributor-${index}`),
      ),
    );
    expect(splits).toEqual(new Set(["development", "calibration", "test"]));
  });

  it("rejects contributor leakage across partitions", () => {
    const result = validateCorpus({
      schemaVersion: 1,
      corpusId: "audio-v-real-world",
      policy: { publicLicenses: ["CC-BY-4.0"] },
      masters: [
        {
          id: "AVC-M-ONE",
          groupId: "same-artist",
          split: "development",
          file: ".audio/masters/one.wav",
          sha256: "a".repeat(64),
          rights: {
            license: "CC-BY-4.0",
            agreementId: "AGR-1",
            acceptedAt: "2026-07-26",
          },
          provenance: { chainOfCustody: "Direct master export." },
        },
        {
          id: "AVC-M-TWO",
          groupId: "same-artist",
          split: "test",
          file: ".audio/masters/two.wav",
          sha256: "b".repeat(64),
          rights: {
            license: "CC-BY-4.0",
            agreementId: "AGR-2",
            acceptedAt: "2026-07-26",
          },
          provenance: { chainOfCustody: "Direct master export." },
        },
      ],
    });
    expect(result.errors).toContain(
      "AVC-M-TWO: contributor group same-artist leaks across development and test",
    );
  });

  it("reports exact binomial uncertainty instead of manufactured certainty", () => {
    expect(clopperPearson(0, 300)).toEqual({ lower: 0, upper: 1.22 });
    expect(clopperPearson(300, 300)).toEqual({ lower: 98.78, upper: 100 });
    expect(clopperPearson(0, 0)).toEqual({ lower: null, upper: null });
  });

  it("enforces the controlled-case floor per master", () => {
    expect(
      validateRecipes(
        {
          schemaVersion: 1,
          recipes: [
            {
              id: "one-case",
              acceptedClassifications: ["inconclusive"],
            },
          ],
        },
        10,
      ).errors,
    ).toContain("Recipe set has 1 cases; policy requires at least 10 per master");
  });

  it("allows a non-spectral fixture with a deterministic expected outcome", () => {
    expect(
      validateRecipes(
        {
          schemaVersion: 1,
          recipes: [
            {
              id: "corruption-case",
              acceptedClassifications: [],
              expected: { analysisStates: ["failed"] },
            },
          ],
        },
        1,
      ).errors,
    ).toEqual([]);
  });
});
