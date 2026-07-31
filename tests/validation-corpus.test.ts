import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverDatasetCandidates,
  selectBalancedCandidates,
} from "../scripts/lib/external-dataset-adapters.mjs";
import {
  clopperPearson,
  splitForGroup,
  validateCorpus,
  validateExternalDatasets,
  validateRecipes,
} from "../scripts/lib/validation-corpus.mjs";

describe("validation corpus grouping", () => {
  it("assigns a source group deterministically", () => {
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

  it("rejects source leakage across partitions", () => {
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
          provenance: {
            kind: "licensed-research-dataset",
            chainOfCustody: "Imported external dataset recording.",
          },
          technical: { sampleRate: 44100, bitDepth: 16, channels: 2 },
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
          provenance: {
            kind: "licensed-research-dataset",
            chainOfCustody: "Imported external dataset recording.",
          },
          technical: { sampleRate: 44100, bitDepth: 16, channels: 2 },
        },
      ],
    });
    expect(result.errors).toContain(
      "AVC-M-TWO: source group same-artist leaks across development and test",
    );
  });

  it("rejects research-only references marked as redistributable", () => {
    const result = validateCorpus({
      schemaVersion: 1,
      corpusId: "audio-v-real-world",
      corpusVersion: "0.2.0",
      policy: {
        pilotIndependentMasters: 1,
        targetIndependentMasters: 1,
        minimumCasesPerMaster: 1,
        publicLicenses: ["CC-BY-4.0"],
        researchLicenses: ["CC-BY-NC-SA-4.0"],
      },
      masters: [
        {
          id: "AVC-M-MAESTRO-ONE",
          groupId: "maestro:composition:one",
          split: splitForGroup("maestro:composition:one"),
          title: "One",
          artist: "Composer",
          file: ".audio/masters/one.wav",
          sha256: "a".repeat(64),
          rights: {
            license: "CC-BY-NC-SA-4.0",
            agreementId: "DATASET-1",
            acceptedAt: "2026-07-30",
            redistributable: true,
            attribution: "MAESTRO",
          },
          provenance: {
            kind: "licensed-research-dataset",
            chainOfCustody: "Imported from the MAESTRO dataset.",
          },
          technical: { sampleRate: 44100, bitDepth: 16, channels: 2 },
        },
      ],
    });
    expect(result.errors).toContain(
      "AVC-M-MAESTRO-ONE: research-only license cannot be marked redistributable",
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

describe("external dataset registry and adapters", () => {
  it("requires split percentages to total 100", () => {
    expect(
      validateExternalDatasets({
        schemaVersion: 1,
        registryVersion: "1.0.0",
        selectionPolicy: {
          developmentPercent: 60,
          calibrationPercent: 20,
          testPercent: 19,
          neverBundleAudioWithApplication: true,
        },
        datasets: [],
      }).errors,
    ).toContain("external dataset registry must contain at least one dataset");
  });

  it("discovers only Slakh mixture references with stable source groups", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "audio-v-slakh-"));
    try {
      await fs.mkdir(path.join(root, "train", "Track00001", "stems"), {
        recursive: true,
      });
      await fs.writeFile(path.join(root, "train", "Track00001", "mix.flac"), "");
      await fs.writeFile(
        path.join(root, "train", "Track00001", "stems", "S01.flac"),
        "",
      );
      const candidates = await discoverDatasetCandidates(
        {
          id: "slakh2100",
          displayName: "Slakh2100",
          import: { adapter: "slakh2100" },
        },
        root,
      );
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        sourceId: "Track00001/mix.flac",
        groupId: "slakh2100:Track00001",
        category: "synthesized-mixture",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("groups repeat MAESTRO performances by composition", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "audio-v-maestro-"));
    try {
      await fs.mkdir(path.join(root, "2018"), { recursive: true });
      await fs.writeFile(path.join(root, "2018", "one.wav"), "");
      await fs.writeFile(path.join(root, "2018", "two.wav"), "");
      await fs.writeFile(
        path.join(root, "maestro-v3.0.0.json"),
        JSON.stringify([
          {
            canonical_composer: "Composer",
            canonical_title: "Work",
            split: "train",
            audio_filename: "2018/one.wav",
          },
          {
            canonical_composer: "Composer",
            canonical_title: "Work",
            split: "test",
            audio_filename: "2018/two.wav",
          },
        ]),
      );
      const candidates = await discoverDatasetCandidates(
        {
          id: "maestro-v3",
          displayName: "MAESTRO",
          import: { adapter: "maestro" },
        },
        root,
      );
      expect(candidates).toHaveLength(2);
      expect(candidates[0].groupId).toBe(candidates[1].groupId);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("attaches the nearest MUSAN component license evidence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "audio-v-musan-"));
    try {
      await fs.mkdir(path.join(root, "music", "fma"), { recursive: true });
      await fs.writeFile(path.join(root, "music", "LICENSE"), "CC BY 4.0");
      await fs.writeFile(path.join(root, "music", "fma", "track.wav"), "");
      const candidates = await discoverDatasetCandidates(
        {
          id: "musan",
          displayName: "MUSAN",
          import: { adapter: "musan" },
        },
        root,
      );
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        category: "music",
        stratum: "music:fma",
        licenseEvidence: "music/LICENSE",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("selects public references with exact 60/20/20 source-level quotas", () => {
    const candidates = Array.from({ length: 500 }, (_, index) => ({
      id: `candidate-${index}`,
      groupId: `source-${index}`,
      category: ["music", "noise", "speech"][index % 3],
      stratum: ["music:fma", "noise:free-sound", "speech:librivox"][
        index % 3
      ],
    }));
    const selected = selectBalancedCandidates(
      candidates,
      50,
      {
        developmentPercent: 60,
        calibrationPercent: 20,
        testPercent: 20,
      },
      true,
    );
    const counts = selected.reduce<Record<string, number>>((output, item) => {
      const split = splitForGroup(item.groupId);
      output[split] = (output[split] ?? 0) + 1;
      return output;
    }, {});
    expect(counts).toEqual({
      development: 30,
      calibration: 10,
      test: 10,
    });
    expect(new Set(selected.map((item) => item.category))).toEqual(
      new Set(["music", "noise", "speech"]),
    );
  });
});
