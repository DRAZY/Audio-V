import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import type { AudioFileRecord, ReportExportFormat } from "../shared/contracts";
import { writeAuditReport } from "../electron/report-exporter";

const temporaryDirectories: string[] = [];

const file = {
  id: "fixture",
  path: "/music/fixture.flac",
  name: "fixture.flac",
  codec: "FLAC",
  container: "flac",
  codecProfile: null,
  sampleRate: 44_100,
  bitDepth: 16,
  bitrate: 800_000,
  channels: 2,
  channelMode: "stereo",
  bitrateMode: "VBR",
  durationSeconds: 60,
  userReview: {
    status: "reviewed",
    reviewedAt: "2026-07-28T00:00:00.000Z",
    disposition: "accepted-intentional",
    note: "Compared with the trusted release notes.",
  },
  oracle: {
    verdict: "verified",
    headline: "Current checks passed",
    confidence: 100,
    engineVersion: "test",
    measuredAt: "2026-07-26T00:00:00.000Z",
    evidence: [],
    fidelity: {
      classification: "no-strong-spectral-anomaly",
      reasonCode: "no-strong-anomaly",
      confidence: 85,
      confidenceType: "rule-strength-v1",
      evidenceCoverage: 95,
      basis: [],
      limitation: "Test limitation.",
    },
    technical: {
      fileSha256: "a".repeat(64),
      externalChecksums: [],
      flacMd5: { status: "verified" },
    },
    measurements: {
      durationSeconds: 60,
      samplePeakDbfs: -1,
      rmsDbfs: -12,
      integratedLufs: -14,
      loudnessRangeLu: 7,
      truePeakDbtp: -0.8,
      peakToLoudnessRatioLu: 13.2,
      crestFactorDb: 11,
      clippedSamples: 0,
      nearClippedSamples: 2,
      stereoCorrelation: 0.4,
      stereoAssessment: "stereo-content",
      sideToMidRatioDb: -4,
      continuity: {
        exactDigitalSilenceFrames: 0,
        longestDigitalSilenceSeconds: 0,
        internalDigitalDropoutCount: 0,
        discontinuityCandidateCount: 0,
      },
      spectrogram: {
        effectiveBandwidthHz: 21_000,
        strongestCutoffHz: null,
        cutoffDropDb: null,
        upperBandLevelDbfs: -64,
      },
    },
  },
} as unknown as AudioFileRecord;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("report exports", () => {
  it.each(["json", "csv", "pdf", "xlsx", "docx"] as ReportExportFormat[])(
    "writes a readable %s audit artifact",
    async (format) => {
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "audio-v-report-"),
      );
      temporaryDirectories.push(directory);
      const outputPath = path.join(directory, `report.${format}`);
      await writeAuditReport(
        {
          schema: "Audio-V test report",
          exportedAt: "2026-07-26T00:00:00.000Z",
          files: [file],
        },
        format,
        outputPath,
      );

      const bytes = await fs.readFile(outputPath);
      expect(bytes.length).toBeGreaterThan(100);
      if (format === "json") {
        expect(JSON.parse(bytes.toString("utf8")).files[0].name).toBe(
          "fixture.flac",
        );
      } else if (format === "csv") {
        expect(bytes.toString("utf8")).toContain("File SHA-256");
        expect(bytes.toString("utf8")).toContain("stereo-content");
        expect(bytes.toString("utf8")).toContain("Origin evidence coverage");
        expect(bytes.toString("utf8")).toContain("Human disposition");
        expect(bytes.toString("utf8")).toContain("accepted-intentional");
        expect(bytes.toString("utf8")).toContain(
          "Compared with the trusted release notes.",
        );
      } else if (format === "pdf") {
        expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      } else {
        const zip = await JSZip.loadAsync(bytes);
        expect(
          format === "xlsx"
            ? zip.file("xl/worksheets/sheet1.xml")
            : zip.file("word/document.xml"),
        ).not.toBeNull();
      }
    },
  );
});
