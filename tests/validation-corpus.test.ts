import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverDatasetCandidates,
  selectBalancedCandidates,
} from "../scripts/lib/external-dataset-adapters.mjs";
import {
  acceptanceEligibilityForCase,
  binomialCdf,
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

  it("requires hashed terms evidence for research-only dataset references", () => {
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
          id: "AVC-M-MAESTRO-TWO",
          groupId: "maestro:composition:two",
          split: "challenge",
          title: "Two",
          artist: "Composer",
          file: ".audio/masters/two.wav",
          sha256: "b".repeat(64),
          dataset: {
            id: "maestro-v3",
            version: "3.0.0",
            sourceId: "2018/two.wav",
            category: "piano-test",
            stratum: "recorded-piano",
            role: "real-recording-challenge",
            officialUrl: "https://magenta.tensorflow.org/datasets/maestro",
          },
          rights: {
            license: "CC-BY-NC-SA-4.0",
            agreementId: "DATASET-1",
            acceptedAt: "2026-07-30",
            redistributable: false,
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
      "AVC-M-MAESTRO-TWO: research-only dataset terms evidence is required",
    );
  });

  it("reports exact binomial uncertainty instead of manufactured certainty", () => {
    expect(clopperPearson(0, 300)).toEqual({ lower: 0, upper: 1.22 });
    expect(clopperPearson(300, 300)).toEqual({ lower: 98.78, upper: 100 });
    expect(clopperPearson(723, 810)).toEqual({ lower: 86.92, upper: 91.31 });
    expect(binomialCdf(9, 20, 0.5)).toBeCloseTo(0.411901, 5);
    expect(clopperPearson(0, 0)).toEqual({ lower: null, upper: null });
  });

  it("keeps unsupported challenge positives observational", () => {
    expect(
      acceptanceEligibilityForCase("negative-only", "lossy-to-lossless"),
    ).toBe("observational-only");
    expect(acceptanceEligibilityForCase("negative-only", "upsample")).toBe(
      "observational-only",
    );
    expect(
      acceptanceEligibilityForCase("negative-only", "deterministic-defect"),
    ).toBe("scored");
    expect(
      acceptanceEligibilityForCase("positive-and-negative", "upsample"),
    ).toBe("scored");
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

  it("selectively extracts Slakh mixtures without stems or omitted duplicates", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "audio-v-slakh-archive-"));
    const source = path.join(root, "source");
    const destination = path.join(root, "selected");
    const archive = path.join(root, "slakh.tar.gz");
    try {
      await fs.mkdir(path.join(source, "train", "Track00001", "stems"), {
        recursive: true,
      });
      await fs.mkdir(path.join(source, "test", "Track00002"), {
        recursive: true,
      });
      await fs.mkdir(path.join(source, "omitted", "Track00003"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(source, "train", "Track00001", "mix.flac"),
        "mix-one",
      );
      await fs.writeFile(
        path.join(source, "train", "Track00001", "stems", "S01.flac"),
        "stem",
      );
      await fs.writeFile(
        path.join(source, "test", "Track00002", "mix.flac"),
        "mix-two",
      );
      await fs.writeFile(
        path.join(source, "omitted", "Track00003", "mix.flac"),
        "duplicate",
      );
      execFileSync("tar", ["-czf", archive, "-C", source, "."]);
      execFileSync(
        process.execPath,
        [
          "scripts/extract-external-dataset.mjs",
          "--dataset",
          "slakh2100",
          "--file",
          archive,
          "--root",
          destination,
          "--candidate-limit",
          "1",
        ],
        { cwd: process.cwd() },
      );
      const receipt = JSON.parse(
        await fs.readFile(
          path.join(destination, ".audio-v-extraction.json"),
          "utf8",
        ),
      );
      expect(receipt.discoveredEligibleEntries).toBe(2);
      expect(receipt.selectedEntries).toHaveLength(1);
      await expect(
        fs.stat(path.join(destination, "train", "Track00001", "stems", "S01.flac")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        fs.stat(path.join(destination, "omitted", "Track00003", "mix.flac")),
      ).rejects.toMatchObject({ code: "ENOENT" });
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

  it("accepts MAESTRO's official column-oriented metadata JSON", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "audio-v-maestro-columns-"));
    try {
      await fs.mkdir(path.join(root, "2018"), { recursive: true });
      await fs.writeFile(path.join(root, "2018", "one.wav"), "");
      await fs.writeFile(
        path.join(root, "maestro-v3.0.0.json"),
        JSON.stringify({
          canonical_composer: { 0: "Composer" },
          canonical_title: { 0: "Work" },
          split: { 0: "train" },
          year: { 0: 2018 },
          midi_filename: { 0: "2018/one.midi" },
          audio_filename: { 0: "2018/one.wav" },
          duration: { 0: 60 },
        }),
      );
      const candidates = await discoverDatasetCandidates(
        {
          id: "maestro-v3",
          displayName: "MAESTRO",
          import: { adapter: "maestro" },
        },
        root,
      );
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        sourceId: "2018/one.wav",
        title: "Work",
        artist: "Composer",
        category: "piano-train",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("selectively extracts unique MAESTRO compositions and official metadata", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "audio-v-maestro-archive-"));
    const source = path.join(root, "source", "maestro-v3.0.0");
    const destination = path.join(root, "selected");
    const archive = path.join(root, "maestro.zip");
    try {
      await fs.mkdir(path.join(source, "2018"), { recursive: true });
      await fs.writeFile(path.join(source, "2018", "one.wav"), "one");
      await fs.writeFile(path.join(source, "2018", "repeat.wav"), "repeat");
      await fs.writeFile(path.join(source, "2018", "two.wav"), "two");
      await fs.writeFile(
        path.join(source, "maestro-v3.0.0.json"),
        JSON.stringify({
          canonical_composer: {
            0: "Composer One",
            1: "Composer One",
            2: "Composer Two",
          },
          canonical_title: { 0: "Work", 1: "Work", 2: "Other Work" },
          split: { 0: "train", 1: "test", 2: "validation" },
          audio_filename: {
            0: "2018/one.wav",
            1: "2018/repeat.wav",
            2: "2018/two.wav",
          },
        }),
      );
      execFileSync("zip", ["-qr", archive, "maestro-v3.0.0"], {
        cwd: path.join(root, "source"),
      });
      execFileSync(
        process.execPath,
        [
          "scripts/extract-external-dataset.mjs",
          "--dataset",
          "maestro-v3",
          "--file",
          archive,
          "--root",
          destination,
          "--candidate-limit",
          "1",
        ],
        { cwd: process.cwd() },
      );
      const receipt = JSON.parse(
        await fs.readFile(
          path.join(destination, ".audio-v-extraction.json"),
          "utf8",
        ),
      );
      expect(receipt.discoveredEligibleEntries).toBe(2);
      expect(receipt.selectedEntries).toHaveLength(2);
      await expect(
        fs.stat(
          path.join(
            destination,
            "maestro-v3.0.0",
            "maestro-v3.0.0.json",
          ),
        ),
      ).resolves.toBeDefined();
      const candidates = await discoverDatasetCandidates(
        {
          id: "maestro-v3",
          displayName: "MAESTRO",
          import: { adapter: "maestro" },
        },
        destination,
      );
      expect(candidates).toHaveLength(1);
      expect(candidates[0].filePath).toContain(
        path.join("maestro-v3.0.0", "2018"),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("selectively extracts balanced MUSDB mixtures without stems", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "audio-v-musdb-archive-"));
    const source = path.join(root, "source", "musdb18hq");
    const destination = path.join(root, "selected");
    const archive = path.join(root, "musdb.zip");
    try {
      for (const [partition, track] of [
        ["train", "Train One"],
        ["train", "Train Two"],
        ["test", "Test One"],
        ["test", "Test Two"],
      ]) {
        const trackRoot = path.join(source, partition, track);
        await fs.mkdir(trackRoot, { recursive: true });
        await fs.writeFile(path.join(trackRoot, "mixture.wav"), "mixture");
        await fs.writeFile(path.join(trackRoot, "vocals.wav"), "stem");
      }
      await fs.writeFile(path.join(source, "README.md"), "Academic terms");
      execFileSync("zip", ["-qr", archive, "musdb18hq"], {
        cwd: path.join(root, "source"),
      });
      execFileSync(
        process.execPath,
        [
          "scripts/extract-external-dataset.mjs",
          "--dataset",
          "musdb18-hq",
          "--file",
          archive,
          "--root",
          destination,
          "--candidate-limit",
          "2",
        ],
        { cwd: process.cwd() },
      );
      const receipt = JSON.parse(
        await fs.readFile(
          path.join(destination, ".audio-v-extraction.json"),
          "utf8",
        ),
      );
      expect(receipt.discoveredEligibleEntries).toBe(4);
      expect(
        receipt.selectedEntries.filter((entry: string) =>
          entry.endsWith("/mixture.wav"),
        ),
      ).toHaveLength(2);
      expect(
        receipt.selectedEntries.some((entry: string) =>
          /\/train\/.*\/mixture\.wav$/u.test(entry),
        ),
      ).toBe(true);
      expect(
        receipt.selectedEntries.some((entry: string) =>
          /\/test\/.*\/mixture\.wav$/u.test(entry),
        ),
      ).toBe(true);
      expect(
        receipt.selectedEntries.some((entry: string) =>
          entry.endsWith("/vocals.wav"),
        ),
      ).toBe(false);
      const candidates = await discoverDatasetCandidates(
        {
          id: "musdb18-hq",
          displayName: "MUSDB18-HQ",
          import: { adapter: "musdb18-hq" },
        },
        destination,
      );
      expect(candidates).toHaveLength(2);
      expect(new Set(candidates.map((candidate) => candidate.category))).toEqual(
        new Set(["mixture-train", "mixture-test"]),
      );
      expect(candidates.every((candidate) => candidate.licenseEvidence)).toBe(
        true,
      );
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

  it("maps EBU SQAM track ranges to handbook evidence strata", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "audio-v-ebu-"));
    try {
      for (const track of ["01", "27", "49", "61", "69"]) {
        await fs.writeFile(path.join(root, `${track}.flac`), "");
      }
      const candidates = await discoverDatasetCandidates(
        {
          id: "ebu-sqam",
          displayName: "EBU SQAM",
          import: { adapter: "ebu-sqam" },
        },
        root,
      );
      expect(
        Object.fromEntries(
          candidates.map((candidate) => [
            candidate.sourceId,
            candidate.category,
          ]),
        ),
      ).toEqual({
        "01.flac": "alignment-signal",
        "27.flac": "single-instrument",
        "49.flac": "speech",
        "61.flac": "vocal-orchestra",
        "69.flac": "pop-music",
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

  it("balances challenge references by category instead of taking filename order", () => {
    const candidates = [
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `train-${index}`,
        groupId: `train-source-${index}`,
        category: "piano-train",
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `test-${index}`,
        groupId: `test-source-${index}`,
        category: "piano-test",
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `validation-${index}`,
        groupId: `validation-source-${index}`,
        category: "piano-validation",
      })),
    ];
    const selected = selectBalancedCandidates(
      candidates,
      9,
      {
        developmentPercent: 60,
        calibrationPercent: 20,
        testPercent: 20,
      },
      false,
    );
    const categories = selected.reduce<Record<string, number>>(
      (output, item) => {
        output[item.category] = (output[item.category] ?? 0) + 1;
        return output;
      },
      {},
    );
    expect(categories).toEqual({
      "piano-test": 3,
      "piano-train": 3,
      "piano-validation": 3,
    });
  });
});
