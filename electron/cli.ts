#!/usr/bin/env node
import { createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { finished } from "node:stream/promises";
import type {
  AnalysisMode,
  AnalysisResourceLimits,
  AudioSourceSelection,
} from "../shared/contracts";
import { compactReportFile } from "./report-exporter";
import { scanSources } from "./scanner";
import { OracleWorkerPool } from "./oracle/oracle-worker-pool";
import { configureEngineResourcePolicy } from "./oracle/ffmpeg-runtime";

interface CliOptions {
  inputs: string[];
  output: string | null;
  mode: AnalysisMode;
  concurrency: AnalysisResourceLimits["concurrency"];
  memoryMb: AnalysisResourceLimits["workerMemoryMb"];
  ffmpegThreads: AnalysisResourceLimits["ffmpegThreads"];
  nativeMemoryMb: AnalysisResourceLimits["nativeProcessMemoryMb"];
  failOn: "never" | "review" | "failed" | "error";
  acoustIdApiKey: string | null;
}

function usage(): string {
  return `Audio-V headless Oracle CLI

Usage:
  audio-v-cli <file-or-folder>... [options]

Options:
  --output <path>          Write JSON evidence to a file (default: stdout)
  --metadata-only         Inventory metadata without decoding
  --concurrency <1-8>     Parallel Oracle jobs (default: 2)
  --memory-mb <value>     Per-worker heap cap: 128, 256, 384, or 512
  --ffmpeg-threads <n>    FFmpeg threads per file: 1, 2, or 4
  --native-memory-mb <n>  Native-process cap: 256, 512, 1024, or 2048
  --acoustid-key <key>    Opt in to AcoustID lookup (or set AUDIO_V_ACOUSTID_KEY)
  --fail-on <policy>      never, review, failed, or error (default: failed)
  --help                  Show this help
`;
}

function parseArguments(args: string[]): CliOptions {
  const options: CliOptions = {
    inputs: [],
    output: null,
    mode: "full-audit",
    concurrency: 2,
    memoryMb: 256,
    ffmpegThreads: 2,
    nativeMemoryMb: 1024,
    failOn: "failed",
    acoustIdApiKey: process.env.AUDIO_V_ACOUSTID_KEY ?? null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--help") {
      process.stdout.write(usage());
      process.exit(0);
    } else if (value === "--metadata-only") {
      options.mode = "metadata-inventory";
    } else if (value === "--output") {
      options.output = args[++index] ?? null;
    } else if (value === "--concurrency") {
      const parsed = Number(args[++index]);
      if (![1, 2, 3, 4, 5, 6, 7, 8].includes(parsed)) {
        throw new Error("--concurrency must be an integer from 1 through 8.");
      }
      options.concurrency = parsed as CliOptions["concurrency"];
    } else if (value === "--memory-mb") {
      const parsed = Number(args[++index]);
      if (![128, 256, 384, 512].includes(parsed)) {
        throw new Error("--memory-mb must be 128, 256, 384, or 512.");
      }
      options.memoryMb = parsed as CliOptions["memoryMb"];
    } else if (value === "--fail-on") {
      const parsed = args[++index] as CliOptions["failOn"];
      if (!["never", "review", "failed", "error"].includes(parsed)) {
        throw new Error("--fail-on must be never, review, failed, or error.");
      }
      options.failOn = parsed;
    } else if (value === "--ffmpeg-threads") {
      const parsed = Number(args[++index]);
      if (![1, 2, 4].includes(parsed)) {
        throw new Error("--ffmpeg-threads must be 1, 2, or 4.");
      }
      options.ffmpegThreads = parsed as CliOptions["ffmpegThreads"];
    } else if (value === "--native-memory-mb") {
      const parsed = Number(args[++index]);
      if (![256, 512, 1024, 2048].includes(parsed)) {
        throw new Error("--native-memory-mb must be 256, 512, 1024, or 2048.");
      }
      options.nativeMemoryMb = parsed as CliOptions["nativeMemoryMb"];
    } else if (value === "--acoustid-key") {
      options.acoustIdApiKey = args[++index] ?? null;
    } else if (value.startsWith("-")) {
      throw new Error(`Unknown option: ${value}`);
    } else {
      options.inputs.push(value);
    }
  }
  if (options.inputs.length === 0) {
    throw new Error("Provide at least one file or folder.");
  }
  if (options.acoustIdApiKey && options.acoustIdApiKey.length > 128) {
    throw new Error("The AcoustID API key must be 128 characters or fewer.");
  }
  return options;
}

function shouldFail(
  policy: CliOptions["failOn"],
  files: Awaited<ReturnType<typeof scanSources>>["files"],
): boolean {
  if (policy === "never") return false;
  if (policy === "error") {
    return files.some((file) => file.oracle.analysisState === "error");
  }
  if (policy === "failed") {
    return files.some(
      (file) =>
        file.oracle.analysisState === "failed" ||
        file.oracle.verdict === "damaged",
    );
  }
  return files.some(
    (file) =>
      file.oracle.analysisState === "error" ||
      file.oracle.analysisState === "failed" ||
      ["review", "likely-transcode", "likely-upsample", "damaged"].includes(
        file.oracle.verdict,
      ),
  );
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  configureEngineResourcePolicy({
    ffmpegThreads: options.ffmpegThreads,
    nativeProcessMemoryMb: options.nativeMemoryMb,
  });
  for (const input of options.inputs) await fs.access(path.resolve(input));
  const source: AudioSourceSelection = {
    kind: options.inputs.length === 1 &&
      (await fs.stat(path.resolve(options.inputs[0]))).isDirectory()
      ? "folder"
      : "files",
    paths: options.inputs.map((entry) => path.resolve(entry)),
    label: options.inputs.length === 1
      ? path.basename(options.inputs[0])
      : `${options.inputs.length} CLI sources`,
    mode: options.mode,
    resourceLimits: {
      concurrency: options.concurrency,
      workerMemoryMb: options.memoryMb,
      ffmpegThreads: options.ffmpegThreads,
      nativeProcessMemoryMb: options.nativeMemoryMb,
    },
    externalLookup: options.acoustIdApiKey
      ? {
          acoustIdEnabled: true,
          acoustIdApiKey: options.acoustIdApiKey,
        }
      : { acoustIdEnabled: false },
  };
  const pool = new OracleWorkerPool(
    path.join(__dirname, "oracle", "oracle-worker.js"),
    options.concurrency,
    options.memoryMb,
    {
      ffmpegThreads: options.ffmpegThreads,
      nativeProcessMemoryMb: options.nativeMemoryMb,
    },
  );
  const result = await scanSources(source, undefined, {
    concurrency: options.concurrency,
    analyzeFile: (filePath, signal) => pool.analyze(filePath, signal),
  }).finally(() => pool.close());
  const publicSource: AudioSourceSelection = {
    ...source,
    externalLookup: { acoustIdEnabled: Boolean(options.acoustIdApiKey) },
  };
  const document = {
    schema: "Audio-V Oracle CLI evidence v1",
    exportedAt: new Date().toISOString(),
    source: publicSource,
    summary: {
      discovered: result.files.length,
      clear: result.files.filter((file) =>
        ["verified", "authentic"].includes(file.oracle.verdict),
      ).length,
      review: result.files.filter((file) =>
        ["review", "likely-transcode", "likely-upsample"].includes(
          file.oracle.verdict,
        ),
      ).length,
      failed: result.files.filter(
        (file) =>
          file.oracle.analysisState === "failed" ||
          file.oracle.verdict === "damaged",
      ).length,
      errors: result.files.filter(
        (file) => file.oracle.analysisState === "error",
      ).length,
      warnings: result.warnings,
    },
    files: result.files.map(compactReportFile),
  };
  const output = `${JSON.stringify(document, null, 2)}\n`;
  if (options.output) {
    const stream = createWriteStream(path.resolve(options.output), {
      encoding: "utf8",
    });
    stream.end(output);
    await finished(stream);
  } else {
    process.stdout.write(output);
  }
  process.exitCode = shouldFail(options.failOn, result.files) ? 2 : 0;
}

void main().catch((error) => {
  process.stderr.write(
    `Audio-V CLI error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
