import { spawn } from "node:child_process";
import path from "node:path";

const outputLimit = 32 * 1024 * 1024;
const timeoutMs = 30 * 60 * 1000;

function platformDirectory(): string {
  if (process.platform === "darwin") return `mac-${process.arch}`;
  if (process.platform === "win32") return `win-${process.arch}`;
  return `${process.platform}-${process.arch}`;
}

export function enginePath(tool: "ffmpeg" | "ffprobe"): string {
  const override = process.env[`AUDIO_V_${tool.toUpperCase()}_PATH`];
  if (override) return override;
  const executable = `${tool}${process.platform === "win32" ? ".exe" : ""}`;
  const resourcesPath = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath;
  if (resourcesPath && !process.defaultApp) {
    return path.join(resourcesPath, "engine", executable);
  }
  return path.join(
    process.cwd(),
    "vendor",
    "ffmpeg",
    platformDirectory(),
    executable,
  );
}

export interface ProcessResult {
  stdout: Buffer;
  stderr: string;
}

export type EngineFailureReason =
  | "launch"
  | "timeout"
  | "output-limit"
  | "exit";

export class EngineProcessError extends Error {
  constructor(
    message: string,
    readonly tool: "ffmpeg" | "ffprobe",
    readonly reason: EngineFailureReason,
    readonly stderr: string = "",
    readonly exitCode: number | null = null,
  ) {
    super(message);
    this.name = "EngineProcessError";
  }
}

export async function runEngine(
  tool: "ffmpeg" | "ffprobe",
  args: string[],
  onStdout?: (chunk: Buffer) => void,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Audio analysis canceled."));
      return;
    }
    const child = spawn(enginePath(tool), args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const settleWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(error);
    };
    const abort = () => {
      child.kill("SIGKILL");
      settleWithError(new Error("Audio analysis canceled."));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settleWithError(
        new EngineProcessError(
          `${tool} exceeded the 30-minute analysis limit.`,
          tool,
          "timeout",
        ),
      );
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      if (onStdout) {
        onStdout(chunk);
        return;
      }
      stdoutBytes += chunk.length;
      if (stdoutBytes > outputLimit) {
        child.kill("SIGKILL");
        settleWithError(
          new EngineProcessError(
            `${tool} produced more than 32 MB of output.`,
            tool,
            "output-limit",
          ),
        );
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= outputLimit) stderr.push(chunk);
    });
    child.on("error", (error) => {
      settleWithError(
        new EngineProcessError(
          `${tool} could not start: ${error.message}`,
          tool,
          "launch",
        ),
      );
    });
    child.on("close", (code, terminationSignal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      const stderrText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(
          new EngineProcessError(
            `${tool} decode failed${terminationSignal ? ` (${terminationSignal})` : ""}: ${
              stderrText || `exit code ${code}`
            }`,
            tool,
            "exit",
            stderrText,
            code,
          ),
        );
        return;
      }
      resolve({ stdout: Buffer.concat(stdout), stderr: stderrText });
    });
  });
}
