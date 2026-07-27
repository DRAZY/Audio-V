import { execFile, spawn } from "node:child_process";
import path from "node:path";

const outputLimit = 32 * 1024 * 1024;
const timeoutMs = 30 * 60 * 1000;
let resourcePolicy = {
  ffmpegThreads: 2,
  nativeProcessMemoryMb: 1024,
};

export function configureEngineResourcePolicy(policy: {
  ffmpegThreads: number;
  nativeProcessMemoryMb: number;
}): void {
  resourcePolicy = {
    ffmpegThreads: Math.max(1, Math.min(4, Math.floor(policy.ffmpegThreads))),
    nativeProcessMemoryMb: Math.max(
      256,
      Math.min(2048, Math.floor(policy.nativeProcessMemoryMb)),
    ),
  };
}

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
  | "memory-limit"
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
    const effectiveArgs =
      tool === "ffmpeg"
        ? ["-threads", String(resourcePolicy.ffmpegThreads), ...args]
        : args;
    const child = spawn(enginePath(tool), effectiveArgs, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let memoryProbeRunning = false;
    const memoryLimitBytes = resourcePolicy.nativeProcessMemoryMb * 1024 * 1024;
    const probeMemory = () => {
      if (settled || memoryProbeRunning || !child.pid) return;
      memoryProbeRunning = true;
      const finishProbe = (residentBytes: number | null) => {
        memoryProbeRunning = false;
        if (
          residentBytes !== null &&
          residentBytes > memoryLimitBytes &&
          !settled
        ) {
          child.kill("SIGKILL");
          settleWithError(
            new EngineProcessError(
              `${tool} exceeded the ${resourcePolicy.nativeProcessMemoryMb} MB native-process memory limit.`,
              tool,
              "memory-limit",
            ),
          );
        }
      };
      if (process.platform === "win32") {
        execFile(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue).WorkingSet64`,
          ],
          { windowsHide: true, timeout: 2_000 },
          (error, stdout) => {
            const value = Number(String(stdout).trim());
            finishProbe(!error && Number.isFinite(value) ? value : null);
          },
        );
      } else {
        execFile(
          "ps",
          ["-o", "rss=", "-p", String(child.pid)],
          { timeout: 2_000 },
          (error, stdout) => {
            const value = Number(String(stdout).trim());
            finishProbe(!error && Number.isFinite(value) ? value * 1024 : null);
          },
        );
      }
    };
    const memoryTimer = setInterval(probeMemory, 500);
    const settleWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(memoryTimer);
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
      clearInterval(memoryTimer);
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
