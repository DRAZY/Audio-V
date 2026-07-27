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
    version: "0.7.0-oracle-v9",
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
      bitrateMode:
        "implemented-streaming-packet-distribution-for-all-demuxers-reporting-packet-sizes-and-durations",
      loudnessBs1770: "implemented-ebur128",
      truePeak: "implemented-bs1770-oversampled",
      spectrogram: "implemented-multicodec-stft-512-2048-4096-16384-hann",
      spectrogramControls:
        "implemented-zoom-pan-region-channel-colormap-and-batch-png-export",
      clippingDiagnostics:
        "implemented-per-channel-percent-events-timeline-and-scaled-plateau-review",
      waveformDefects:
        "implemented-click-pop-stuck-sample-and-steep-transition-candidate-review",
      contentCredentials:
        "implemented-offline-c2pa-validation-with-network-fetch-disabled",
      metadataProvenance:
        "implemented-generator-tag-and-raw-identifier-inventory-not-ai-verdict",
      acousticFingerprint:
        "implemented-chromaprint-1.6.0-current-and-persistent-library-duplicates-with-opt-in-acoustid",
      metadataDepth:
        "implemented-declared-tags-calculated-rg2-track-album-cue-segments-bpm-isrc-musicbrainz",
      bitUtilization:
        "implemented-integer-lossless-effective-depth-and-padding-review",
      headlessCli:
        "implemented-source-and-desktop-package-launchers-json-folder-automation-and-policy-exit-codes",
      resourceControls:
        "implemented-worker-concurrency-js-heap-ffmpeg-thread-and-native-rss-enforcement",
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
      scopedVerdictRules: "implemented-for-oracle-integrity-forensics-v9",
      compareWorkflow:
        "implemented-independent-files-preview-alignment-and-full-track-multichannel-null",
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
