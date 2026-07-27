import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const packageJson = JSON.parse(
  await fs.readFile(path.join(projectRoot, "package.json"), "utf8"),
);

let sourceRevision = "uncommitted";
try {
  sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  // The first local build intentionally precedes the initial repository commit.
}

const manifest = {
  product: "Audio-V",
  productVersion: packageJson.version,
  projectLicense: packageJson.license,
  sourceRevision,
  oracleEngine: {
    version: "0.4.0-oracle-v6",
    schemaVersion: 1,
    decoderBundled: "FFmpeg-and-ffprobe-8.1.2-LGPL",
    capabilities: {
      metadataProbe: "implemented-with-ffprobe",
      boundedFolderDiscovery: "implemented",
      multiFileIngest: "implemented",
      pcmMeasurementCore: "implemented",
      streamIntegrity: "implemented-by-complete-multicodec-decode",
      flacStreaminfoMd5: "implemented-by-canonical-decoded-pcm-comparison",
      externalChecksumManifests:
        "implemented-md5-sha1-sha256-sha512-gnu-bsd-and-sidecar",
      bitrateMode: "implemented-for-mp3-packet-analysis",
      loudnessBs1770: "implemented-ebur128",
      truePeak: "implemented-bs1770-oversampled",
      spectrogram: "implemented-multicodec-stft-512-hann",
      spectrogramControls: "implemented-linear-log-floor-cursor-png-export",
      signalContinuity: "implemented-exact-zero-dropout-and-transition-candidates",
      stereoAuthenticity:
        "implemented-correlation-side-to-mid-dual-and-near-mono-review",
      waveformEnvelope: "implemented-bounded-full-track-480-points",
      spectralOriginAssessment: "implemented-conservative-control-validated-review",
      originEvidenceCoverage: "implemented-0-to-100-with-reason-codes",
      originRuleStrength: "implemented-versioned-non-probabilistic",
      fidelityGoldenCorpus: "implemented-regression-only-not-probability-calibrated",
      persistentCache: "implemented-versioned-size-mtime-invalidated",
      batchCancellation: "implemented-active-process-termination",
      scopedVerdictRules: "implemented-for-oracle-integrity-fidelity-v6",
      compareWorkflow:
        "implemented-independent-files-waveforms-spectra-and-difference-heatmap",
      repairTriage: "implemented-actions-evidence-reveal-acknowledge",
      truePeakSafeCopy:
        "implemented-source-depth-default-explicit-16-24-dither-artwork-and-reaudit",
      reportExport: "implemented-pdf-xlsx-docx-csv-json",
      transcodeClassification: "implemented-as-possible-review-not-proof",
      upsampleClassification: "implemented-as-possible-review-not-proof",
    },
  },
};

await fs.writeFile(
  path.join(projectRoot, "build", "engine-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log("Wrote build/engine-manifest.json.");
