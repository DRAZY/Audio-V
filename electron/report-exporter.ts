import { createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import { finished } from "node:stream/promises";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import JSZip from "jszip";
import PDFDocument from "pdfkit";
import type {
  AudioFileRecord,
  ReportExportFormat,
} from "../shared/contracts";
import { audioFormatLabel } from "../shared/audio-format";

interface AuditReport {
  schema?: string;
  exportedAt?: string;
  source?: string;
  summary?: Record<string, unknown>;
  files?: AudioFileRecord[];
  file?: AudioFileRecord;
}

export interface ReportRow {
  [column: string]: string | number;
}

export function compactReportFile(file: AudioFileRecord): AudioFileRecord {
  const measurements = file.oracle.measurements;
  if (!measurements) return file;
  return {
    ...file,
    oracle: {
      ...file.oracle,
      measurements: {
        ...measurements,
        spectrogram: { ...measurements.spectrogram, slices: [] },
        spectrogramPyramid: (
          measurements.spectrogramPyramid ?? [measurements.spectrogram]
        ).map((spectrum) => ({ ...spectrum, slices: [] })),
      },
    },
  };
}

function asAuditReport(value: unknown): AuditReport {
  if (!value || typeof value !== "object") {
    throw new TypeError("A structured Audio-V report is required.");
  }
  return value as AuditReport;
}

function display(value: string | number | null | undefined): string | number {
  return value ?? "";
}

function reportFiles(report: AuditReport): AudioFileRecord[] {
  if (Array.isArray(report.files)) return report.files;
  return report.file ? [report.file] : [];
}

export function audioFileReportRow(file: AudioFileRecord): ReportRow {
    const signal = file.oracle.measurements;
    const technical = file.oracle.technical;
    const spectrum =
      signal?.originSpectrumSummary ?? signal?.spectrogram;
    const checksumStatus =
      technical?.externalChecksums
        ?.map(
          (item) =>
            `${item.algorithm.toUpperCase()}:${item.status}:${item.expected}`,
        )
        .join(" | ") ?? "";
    const analysisState =
      file.oracle.analysisState ??
      (file.oracle.verdict === "damaged"
        ? "failed"
        : file.oracle.measurements
          ? "completed"
          : file.oracle.scope === "metadata-only"
            ? "not-analyzed"
            : "error");
    return {
      File: file.name,
      Path: file.path,
      Verdict: file.oracle.verdict,
      "Oracle headline": file.oracle.headline,
      "Oracle confidence": display(file.oracle.confidence),
      "Integrity lane": display(file.oracle.assessments?.integrity.status),
      "Signal lane": display(file.oracle.assessments?.signal.status),
      "Spectral-origin lane": display(file.oracle.assessments?.origin.status),
      "Provenance lane": display(file.oracle.assessments?.provenance.status),
      "Delivery lane": display(file.oracle.assessments?.delivery.status),
      "Assessment findings":
        file.oracle.assessments?.findings
          .map(
            (finding) =>
              `${finding.severity}:${finding.lane}:${finding.id}:${finding.summary}`,
          )
          .join(" | ") ?? "",
      "Analysis state": analysisState,
      "User review status": file.userReview ? "reviewed" : "not reviewed",
      "User reviewed at": display(file.userReview?.reviewedAt),
      "Failure category": display(file.oracle.failure?.category),
      "Failure stage": display(file.oracle.failure?.stage),
      "Failure code": display(file.oracle.failure?.code),
      "Failure evidence": display(file.oracle.failure?.evidence),
      Format: audioFormatLabel(file),
      Codec: file.codec,
      Container: file.container,
      "Codec profile": display(file.codecProfile),
      "Sample rate Hz": display(file.sampleRate),
      "Bit depth": display(file.bitDepth),
      "Bitrate bps": display(file.bitrate),
      Channels: display(file.channels),
      "Channel layout": display(file.channelMode),
      "Bitrate mode": display(file.bitrateMode),
      "Packet bitrate p05 bps": display(technical?.packetBitrateP05),
      "Packet bitrate p95 bps": display(technical?.packetBitrateP95),
      "Packet bitrate standard deviation bps": display(
        technical?.packetBitrateStdDev,
      ),
      "Packet duration coverage percent": display(
        technical?.packetDurationCoverage,
      ),
      Title: display(file.metadata?.title),
      Artists: file.metadata?.artists.join(" | ") ?? "",
      Album: display(file.metadata?.album),
      "Album artists": file.metadata?.albumArtists.join(" | ") ?? "",
      Composers: file.metadata?.composers.join(" | ") ?? "",
      Genres: file.metadata?.genres.join(" | ") ?? "",
      Date: display(file.metadata?.date),
      BPM: display(file.metadata?.bpm),
      ISRC: file.metadata?.isrcs.join(" | ") ?? "",
      "MusicBrainz recording IDs":
        file.metadata?.musicBrainzRecordingIds.join(" | ") ?? "",
      "ReplayGain track dB": display(
        file.metadata?.replayGain.trackGainDb,
      ),
      "ReplayGain track peak": display(
        file.metadata?.replayGain.trackPeak,
      ),
      "ReplayGain album dB": display(
        file.metadata?.replayGain.albumGainDb,
      ),
      "Calculated ReplayGain track dB": display(
        signal?.replayGain?.trackGainDb,
      ),
      "Calculated ReplayGain track peak": display(
        signal?.replayGain?.trackPeak,
      ),
      "Calculated ReplayGain album dB": display(
        signal?.replayGain?.albumGainDb,
      ),
      "Calculated ReplayGain album peak": display(
        signal?.replayGain?.albumPeak,
      ),
      "Calculated ReplayGain album status": display(
        signal?.replayGain?.albumStatus,
      ),
      "Calculated ReplayGain album explanation": display(
        signal?.replayGain?.albumReason,
      ),
      "Cue sheet": file.metadata
        ? `${file.metadata.cueSheet.embedded ? "embedded" : ""}${file.metadata.cueSheet.sidecarPaths.length ? ` sidecar:${file.metadata.cueSheet.sidecarPaths.join("|")}` : ""}`.trim()
        : "",
      "Cue tracks": display(file.metadata?.cueSheet.trackCount),
      "Analyzed cue tracks": file.oracle.cueTracks
        ?.map(
          (track) =>
            `${track.trackNumber}:${track.verdict}:${track.integratedLufs ?? ""}LUFS${
              track.pregap
                ? `:INDEX00-${track.pregap.verdict}-${track.pregap.durationSeconds}s`
                : ""
            }`,
        )
        .join(" | ") ?? "",
      "Duration seconds": display(signal?.durationSeconds ?? file.durationSeconds),
      "Complete decode":
        signal
          ? "yes"
          : analysisState === "not-analyzed"
            ? "not run"
            : analysisState === "error"
              ? "analysis error"
              : "failed integrity",
      "File SHA-256": display(technical?.fileSha256),
      "External checksums": checksumStatus,
      "FLAC audio MD5": display(technical?.flacMd5?.status),
      "Sample peak dBFS": display(signal?.samplePeakDbfs),
      "RMS dBFS": display(signal?.rmsDbfs),
      "Integrated LUFS": display(signal?.integratedLufs),
      "Loudness range LU": display(signal?.loudnessRangeLu),
      "True peak dBTP": display(signal?.truePeakDbtp),
      "Peak-to-loudness LU": display(signal?.peakToLoudnessRatioLu),
      "Crest factor dB": display(signal?.crestFactorDb),
      "DR meter": display(signal?.drMeter),
      "DR meter per channel": signal?.drMeterPerChannel
        ?.map((value) => value ?? "")
        .join(" | ") ?? "",
      "Bit utilization": display(signal?.bitUtilization?.classification),
      "Effective bit depth": display(
        signal?.bitUtilization?.effectiveBitDepth,
      ),
      "Unused least-significant bits": display(
        signal?.bitUtilization?.unusedLeastSignificantBits,
      ),
      "Clipped samples": display(signal?.clippedSamples),
      "Clipped sample percent": display(
        signal?.clipping?.clippedSamplePercent,
      ),
      "Clipping events": display(signal?.clipping?.eventCount),
      "Scaled clipping indicator": display(
        signal?.clipping?.scaledClippingIndicator,
      ),
      "Scaled clipping candidate samples": display(
        signal?.clipping?.scaledClippingCandidateSamples,
      ),
      "Per-channel clipping": signal
        ? (signal.perChannel ?? [])
            .map(
              (channel, index) =>
                `CH${index + 1}:${channel.clippedSamples}:${channel.clippedSamplePercent ?? ""}%`,
            )
            .join(" | ")
        : "",
      "Near-clipped samples": display(signal?.nearClippedSamples),
      "Stereo correlation": display(signal?.stereoCorrelation),
      "Stereo assessment": display(signal?.stereoAssessment),
      "Side-to-mid dB": display(signal?.sideToMidRatioDb),
      "Exact silence frames": display(
        signal?.continuity.exactDigitalSilenceFrames,
      ),
      "Longest silence seconds": display(
        signal?.continuity.longestDigitalSilenceSeconds,
      ),
      "Internal dropout candidates": display(
        signal?.continuity.internalDigitalDropoutCount,
      ),
      "Discontinuity candidates": display(
        signal?.continuity.discontinuityCandidateCount,
      ),
      "Click/pop candidates": display(
        signal?.defects?.clickPopCandidateCount,
      ),
      "Stuck-sample candidates": display(
        signal?.defects?.stuckSampleCandidateCount,
      ),
      "Steep-transition candidates": display(
        signal?.defects?.steepTransitionCandidateCount,
      ),
      "Origin assessment": display(file.oracle.fidelity?.classification),
      "Origin confidence": display(file.oracle.fidelity?.confidence),
      "Origin rule strength": display(
        file.oracle.fidelity?.ruleStrength,
      ),
      "Origin regional stability percent": display(
        file.oracle.fidelity?.stabilityPercent,
      ),
      "Origin independent indicators":
        file.oracle.fidelity?.independentIndicators?.join(" | ") ?? "",
      "Origin classifier FFT size": display(
        file.oracle.fidelity?.analysisFftSize,
      ),
      "Content Credentials": display(
        technical?.contentCredentials?.status,
      ),
      "C2PA manifest count": display(
        technical?.contentCredentials?.manifestCount,
      ),
      "C2PA claim generator": display(
        technical?.contentCredentials?.claimGenerator,
      ),
      "C2PA signer": display(technical?.contentCredentials?.signer),
      "C2PA digital source types":
        technical?.contentCredentials?.digitalSourceTypes.join(" | ") ?? "",
      "Provenance indicators":
        technical?.provenanceIndicators
          ?.map((item) => `${item.type}:${item.identifier}:${item.value}`)
          .join(" | ") ?? "",
      "Chromaprint status": display(technical?.fingerprint?.status),
      "Chromaprint SHA-256": display(
        technical?.fingerprint?.fingerprintSha256,
      ),
      "Acoustic matches":
        technical?.fingerprint?.matches
          .map(
            (match) =>
              `${match.source ?? "current-audit"}:${match.relationship}:${match.similarity}:${match.fileName}`,
          )
          .join(" | ") ?? "",
      "AcoustID status": display(
        technical?.fingerprint?.acoustIdLookup.status,
      ),
      AcoustID: display(
        technical?.fingerprint?.acoustIdLookup.acoustId,
      ),
      "AcoustID score": display(
        technical?.fingerprint?.acoustIdLookup.score,
      ),
      "AcoustID-linked MusicBrainz IDs":
        technical?.fingerprint?.acoustIdLookup.recordingIds.join(" | ") ?? "",
      "AcoustID-linked recording titles":
        technical?.fingerprint?.acoustIdLookup.recordingTitles.join(" | ") ?? "",
      "Origin confidence type": display(file.oracle.fidelity?.confidenceType),
      "Origin validation basis": file.oracle.fidelity
        ? "Versioned rule strength; not a probability-calibrated provenance claim"
        : "",
      "Origin evidence coverage": display(
        file.oracle.fidelity?.evidenceCoverage,
      ),
      "Origin reason": display(file.oracle.fidelity?.reasonCode),
      "Origin limitation": display(file.oracle.fidelity?.limitation),
      "Observed bandwidth Hz": display(spectrum?.effectiveBandwidthHz),
      "Strongest cutoff Hz": display(spectrum?.strongestCutoffHz),
      "Cutoff drop dB": display(spectrum?.cutoffDropDb),
      "Upper-band level dBFS": display(spectrum?.upperBandLevelDbfs),
      "Active classifier slices percent": display(
        spectrum?.activeSlicePercent,
      ),
      "Classifier cutoff stability percent": display(
        spectrum?.cutoffStabilityPercent,
      ),
      "Prior Nyquist match distance Hz": display(
        spectrum?.priorNyquistMatchHz,
      ),
      "Secondary band rupture dB": display(
        spectrum?.bandRuptureScoreDb,
      ),
      "Oracle engine": file.oracle.engineVersion,
      "Measured at": display(file.oracle.measuredAt),
    };
}

function reportRows(report: AuditReport): ReportRow[] {
  return reportFiles(report).map(audioFileReportRow);
}

function csvCell(value: string | number): string {
  const serialized = String(value);
  return /[",\r\n]/u.test(serialized)
    ? `"${serialized.replaceAll('"', '""')}"`
    : serialized;
}

function csvReport(rows: ReportRow[]): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\r\n");
}

export function csvReportHeader(): string {
  return Object.keys(audioFileReportRow({
    name: "",
    path: "",
    oracle: {
      verdict: "inconclusive",
      headline: "",
      confidence: null,
      engineVersion: "",
      measuredAt: null,
      measurements: null,
      technical: null,
      fidelity: null,
    },
    extension: "",
    codec: "",
    container: "",
  } as AudioFileRecord))
    .map(csvCell)
    .join(",");
}

export function csvReportLine(file: AudioFileRecord): string {
  const row = audioFileReportRow(file);
  return Object.keys(row).map((column) => csvCell(row[column])).join(",");
}

function xml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function excelColumn(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

async function xlsxReport(rows: ReportRow[]): Promise<Buffer> {
  const columns = rows.length ? Object.keys(rows[0]) : ["No data"];
  const sheetRows = [Object.fromEntries(columns.map((column) => [column, column])), ...rows];
  const sheetXml = sheetRows
    .map((row, rowIndex) => {
      const cells = columns
        .map((column, columnIndex) => {
          const value = row[column] ?? "";
          const reference = `${excelColumn(columnIndex)}${rowIndex + 1}`;
          return typeof value === "number"
            ? `<c r="${reference}"><v>${value}</v></c>`
            : `<c r="${reference}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Audio-V Audit" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Aptos"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${sheetXml}</sheetData><autoFilter ref="A1:${excelColumn(columns.length - 1)}${sheetRows.length}"/></worksheet>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function pdfReport(
  report: AuditReport,
  rows: ReportRow[],
  filePath: string,
): Promise<void> {
  const document = new PDFDocument({ margin: 42, size: "LETTER" });
  const output = createWriteStream(filePath);
  document.pipe(output);
  document.fontSize(20).fillColor("#24154f").text("Audio-V Audit Report");
  document
    .moveDown(0.4)
    .fontSize(9)
    .fillColor("#444444")
    .text(`Schema: ${report.schema ?? "Audio-V audit report"}`)
    .text(`Exported: ${report.exportedAt ?? new Date().toISOString()}`)
    .text(`Source: ${report.source ?? "Current audit"}`);
  for (const row of rows) {
    document.addPage();
    document.fontSize(15).fillColor("#24154f").text(String(row.File));
    document
      .fontSize(10)
      .fillColor("#222222")
      .text(`${row.Verdict} — ${row["Oracle headline"]}`, { continued: false })
      .moveDown(0.5);
    for (const [label, value] of Object.entries(row)) {
      if (label === "File" || value === "") continue;
      document
        .fontSize(8)
        .fillColor("#666666")
        .text(`${label}: `, { continued: true })
        .fillColor("#111111")
        .text(String(value));
    }
  }
  document.end();
  await finished(output);
}

async function docxReport(
  report: AuditReport,
  rows: ReportRow[],
): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      text: "Audio-V Audit Report",
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph(`Schema: ${report.schema ?? "Audio-V audit report"}`),
    new Paragraph(`Exported: ${report.exportedAt ?? new Date().toISOString()}`),
    new Paragraph(`Source: ${report.source ?? "Current audit"}`),
  ];
  for (const row of rows) {
    children.push(
      new Paragraph({
        text: String(row.File),
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
      }),
      new Paragraph({
        children: [
          new TextRun({ text: `${row.Verdict}: `, bold: true }),
          new TextRun(String(row["Oracle headline"])),
        ],
      }),
      new Table({
        rows: Object.entries(row)
          .filter(([label, value]) => label !== "File" && value !== "")
          .map(
            ([label, value]) =>
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [new TextRun({ text: label, bold: true })],
                      }),
                    ],
                  }),
                  new TableCell({
                    children: [new Paragraph(String(value))],
                  }),
                ],
              }),
          ),
      }),
    );
  }
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

export async function writeAuditReport(
  reportValue: unknown,
  format: ReportExportFormat,
  filePath: string,
): Promise<void> {
  const report = asAuditReport(reportValue);
  const rows = reportRows(report);
  if (rows.length === 0) throw new Error("The report contains no audio files.");
  if (format === "json") {
    await fs.writeFile(filePath, JSON.stringify(report, null, 2), "utf8");
  } else if (format === "csv") {
    await fs.writeFile(filePath, csvReport(rows), "utf8");
  } else if (format === "xlsx") {
    await fs.writeFile(filePath, await xlsxReport(rows));
  } else if (format === "docx") {
    await fs.writeFile(filePath, await docxReport(report, rows));
  } else {
    await pdfReport(report, rows, filePath);
  }
}
