import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import type {
  AcoustIdLookup,
  ChromaprintAssessment,
  ContentCredentialsAssessment,
  ProvenanceIndicator,
} from "../../shared/contracts";

const maxOutputBytes = 16 * 1024 * 1024;
const maxAcoustIdResponseBytes = 1024 * 1024;
const acoustIdApplicationKeyPattern = /^[A-Za-z0-9]{10}$/u;

interface AcoustIdResponseBody {
  status?: string;
  error?: {
    code?: number;
    message?: string;
  };
  results?: Array<{
    id?: string;
    score?: number;
    recordings?: Array<{ id?: string; title?: string }>;
  }>;
}

export function normalizeAcoustIdApiKey(apiKey: string): string {
  const normalized = apiKey.trim();
  if (!acoustIdApplicationKeyPattern.test(normalized)) {
    throw new Error(
      "Enter the 10-character application API key from your registered AcoustID application. User submission keys are not accepted for lookup.",
    );
  }
  return normalized;
}

async function requestAcoustId(
  parameters: URLSearchParams,
  signal?: AbortSignal,
): Promise<{ response: Response; body: AcoustIdResponseBody }> {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
    : AbortSignal.timeout(15_000);
  const response = await fetch("https://api.acoustid.org/v2/lookup", {
    method: "POST",
    signal: requestSignal,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Audio-V (https://github.com/DRAZY/Audio-V)",
    },
    body: parameters.toString(),
  });
  const declaredBytes = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredBytes) &&
    declaredBytes > maxAcoustIdResponseBytes
  ) {
    throw new Error("AcoustID response exceeded the 1 MB safety limit.");
  }
  const responseText = await response.text();
  if (Buffer.byteLength(responseText) > maxAcoustIdResponseBytes) {
    throw new Error("AcoustID response exceeded the 1 MB safety limit.");
  }
  try {
    return {
      response,
      body: JSON.parse(responseText) as AcoustIdResponseBody,
    };
  } catch {
    throw new Error(
      `AcoustID returned an unreadable response (HTTP ${response.status}).`,
    );
  }
}

function acoustIdServiceError(
  response: Response,
  body: AcoustIdResponseBody,
): Error {
  if (body.error?.code === 4) {
    return new Error(
      "AcoustID rejected the application API key. Copy the key from the registered application—not the user submission key—and try again.",
    );
  }
  if (response.status === 429 || body.error?.code === 14) {
    return new Error(
      body.error?.message ??
        "AcoustID rate limiting is active. Wait briefly and try again.",
    );
  }
  return new Error(
    body.error?.message ??
      `AcoustID rejected the lookup (HTTP ${response.status}).`,
  );
}

export async function validateAcoustIdApiKey(
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const normalized = normalizeAcoustIdApiKey(apiKey);
  const { response, body } = await requestAcoustId(
    new URLSearchParams({
      client: normalized,
      format: "json",
    }),
    signal,
  );
  // AcoustID validates `client` before the required fingerprint. Error 2
  // therefore confirms that the application key was accepted.
  if (body.status === "ok" || body.error?.code === 2) return normalized;
  throw acoustIdServiceError(response, body);
}

function platformDirectory(): string {
  if (process.platform === "darwin") return `mac-${process.arch}`;
  if (process.platform === "win32") return `win-${process.arch}`;
  return `${process.platform}-${process.arch}`;
}

export function analysisToolPath(tool: "c2patool" | "fpcalc"): string {
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

function c2paSettingsPath(): string {
  const resourcesPath = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath;
  if (resourcesPath && !process.defaultApp) {
    return path.join(resourcesPath, "engine", "c2pa-offline-settings.json");
  }
  return path.join(
    process.cwd(),
    "vendor",
    "ffmpeg",
    platformDirectory(),
    "c2pa-offline-settings.json",
  );
}

async function runTool(
  tool: "c2patool" | "fpcalc",
  args: string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(analysisToolPath(tool), args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    const abort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => child.kill("SIGKILL"), 5 * 60_000);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= maxOutputBytes) stdout.push(chunk);
      else child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= maxOutputBytes) stderr.push(chunk);
      else child.kill("SIGKILL");
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        reject(new Error("Audio analysis canceled."));
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: code ?? -1,
      });
    });
  });
}

function recursiveDigitalSourceTypes(value: unknown, output = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (
      /digitalsourcetype|algorithmicmedia|digitalcapture|compositewith/iu.test(
        value,
      )
    ) {
      output.add(value);
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) recursiveDigitalSourceTypes(entry, output);
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (/digitalSourceType/iu.test(key) && typeof entry === "string") {
        output.add(entry);
      }
      recursiveDigitalSourceTypes(entry, output);
    }
  }
  return output;
}

export async function inspectContentCredentials(
  filePath: string,
  signal?: AbortSignal,
): Promise<ContentCredentialsAssessment> {
  const limitation =
    "Content Credentials validate cryptographic provenance statements, not whether audio is truthful, human-made, or high quality. Inspection is offline, so remote-only manifests are not fetched; absence is neutral.";
  try {
    const result = await runTool(
      "c2patool",
      [filePath, "--settings", c2paSettingsPath()],
      signal,
    );
    const combined = `${result.stdout}\n${result.stderr}`;
    if (/No claim found|No C2PA Manifests/iu.test(combined)) {
      return {
        status: "not-present",
        manifestCount: 0,
        activeManifest: null,
        claimGenerator: null,
        signer: null,
        signedAt: null,
        digitalSourceTypes: [],
        validationErrors: [],
        networkAccess: "disabled",
        limitation,
      };
    }
    if (result.exitCode !== 0) {
      return {
        status: /unsupported|not supported/iu.test(combined)
          ? "unsupported"
          : "tool-error",
        manifestCount: 0,
        activeManifest: null,
        claimGenerator: null,
        signer: null,
        signedAt: null,
        digitalSourceTypes: [],
        validationErrors: [combined.trim().slice(0, 2_000)],
        networkAccess: "disabled",
        limitation,
      };
    }
    const parsed = JSON.parse(result.stdout) as {
      active_manifest?: string;
      manifests?: Record<string, {
        claim_generator?: string;
        signature_info?: {
          issuer?: string;
          common_name?: string;
          time?: string;
        };
        assertions?: unknown[];
      }>;
      validation_state?: string;
      validation_status?: Array<{ code?: string; explanation?: string }>;
    };
    const activeManifest = parsed.active_manifest ?? null;
    const active = activeManifest ? parsed.manifests?.[activeManifest] : undefined;
    const errors = (parsed.validation_status ?? []).map(
      (entry) =>
        [entry.code, entry.explanation].filter(Boolean).join(": "),
    );
    const untrusted = errors.some((entry) =>
      /signingCredential\.untrusted/iu.test(entry),
    );
    const invalid = /invalid/iu.test(parsed.validation_state ?? "") || errors.some(
      (entry) =>
        !/signingCredential\.untrusted|timeStamp\.untrusted/iu.test(entry),
    );
    return {
      status: invalid
        ? "invalid"
        : untrusted
          ? "valid-untrusted-signer"
          : "valid",
      manifestCount: Object.keys(parsed.manifests ?? {}).length,
      activeManifest,
      claimGenerator: active?.claim_generator ?? null,
      signer:
        active?.signature_info?.common_name ??
        active?.signature_info?.issuer ??
        null,
      signedAt: active?.signature_info?.time ?? null,
      digitalSourceTypes: [...recursiveDigitalSourceTypes(active?.assertions)],
      validationErrors: errors,
      networkAccess: "disabled",
      limitation,
    };
  } catch (error) {
    return {
      status: "tool-error",
      manifestCount: 0,
      activeManifest: null,
      claimGenerator: null,
      signer: null,
      signedAt: null,
      digitalSourceTypes: [],
      validationErrors: [
        error instanceof Error ? error.message : "C2PA inspection failed.",
      ],
      networkAccess: "disabled",
      limitation,
    };
  }
}

export async function calculateChromaprint(
  filePath: string,
  signal?: AbortSignal,
): Promise<ChromaprintAssessment> {
  const notRequested: AcoustIdLookup = {
    status: "not-requested",
    acoustId: null,
    score: null,
    recordingIds: [],
    recordingTitles: [],
    error: null,
  };
  const limitation =
    "Chromaprint identifies acoustically similar recordings; it does not prove ownership, edition, mastering provenance, or byte identity.";
  try {
    const result = await runTool(
      "fpcalc",
      ["-length", "120", "-raw", "-json", filePath],
      signal,
    );
    if (result.exitCode !== 0) {
      return {
        status: "error",
        algorithm: "Chromaprint 1.6.0",
        durationSeconds: null,
        fingerprint: null,
        rawFingerprint: [],
        fingerprintSha256: null,
        matches: [],
        acoustIdLookup: notRequested,
        limitation: `${limitation} ${result.stderr.trim()}`.trim(),
      };
    }
    const raw = JSON.parse(result.stdout) as {
      duration?: number;
      fingerprint?: number[];
    };
    const rawFingerprint = raw.fingerprint ?? [];
    const fingerprintIdentity = rawFingerprint.join(",");
    return {
      status: rawFingerprint.length ? "measured" : "error",
      algorithm: "Chromaprint 1.6.0",
      durationSeconds: raw.duration ?? null,
      fingerprint: null,
      rawFingerprint,
      fingerprintSha256: fingerprintIdentity
        ? createHash("sha256").update(fingerprintIdentity).digest("hex")
        : null,
      matches: [],
      acoustIdLookup: notRequested,
      limitation,
    };
  } catch (error) {
    return {
      status: /ENOENT|could not start/iu.test(
        error instanceof Error ? error.message : "",
      )
        ? "unavailable"
        : "error",
      algorithm: "Chromaprint 1.6.0",
      durationSeconds: null,
      fingerprint: null,
      rawFingerprint: [],
      fingerprintSha256: null,
      matches: [],
      acoustIdLookup: notRequested,
      limitation: `${limitation} ${error instanceof Error ? error.message : "Fingerprinting failed."}`,
    };
  }
}

export async function lookupAcoustId(
  fingerprint: ChromaprintAssessment,
  apiKey: string,
  signal?: AbortSignal,
  filePath?: string,
): Promise<AcoustIdLookup> {
  if (fingerprint.status !== "measured" || fingerprint.durationSeconds === null) {
    return {
      status: "service-error",
      acoustId: null,
      score: null,
      recordingIds: [],
      recordingTitles: [],
      error: "No measured Chromaprint fingerprint is available.",
    };
  }
  try {
    const normalizedApiKey = normalizeAcoustIdApiKey(apiKey);
    let encodedFingerprint = fingerprint.fingerprint;
    if (!encodedFingerprint && filePath) {
      const encodedResult = await runTool(
        "fpcalc",
        ["-length", "120", "-json", filePath],
        signal,
      );
      if (encodedResult.exitCode !== 0) {
        throw new Error(encodedResult.stderr.trim() || "fpcalc encoding failed.");
      }
      encodedFingerprint = (
        JSON.parse(encodedResult.stdout) as { fingerprint?: string }
      ).fingerprint ?? null;
    }
    if (!encodedFingerprint) {
      throw new Error("No encoded Chromaprint value is available.");
    }
    const parameters = new URLSearchParams({
      client: normalizedApiKey,
      meta: "recordings",
      duration: String(Math.round(fingerprint.durationSeconds)),
      fingerprint: encodedFingerprint,
      format: "json",
    });
    const { response, body } = await requestAcoustId(parameters, signal);
    if (!response.ok || body.status !== "ok") {
      throw acoustIdServiceError(response, body);
    }
    const match = body.results?.[0];
    if (!match) {
      return {
        status: "no-match",
        acoustId: null,
        score: null,
        recordingIds: [],
        recordingTitles: [],
        error: null,
      };
    }
    const recordings = (match.recordings ?? []).filter(
      (entry): entry is { id: string; title?: string } => Boolean(entry.id),
    );
    return {
      status: "matched",
      acoustId: match.id ?? null,
      score: match.score ?? null,
      recordingIds: recordings.map((entry) => entry.id),
      recordingTitles: recordings.map((entry) => entry.title ?? ""),
      error: null,
    };
  } catch (error) {
    return {
      status: "service-error",
      acoustId: null,
      score: null,
      recordingIds: [],
      recordingTitles: [],
      error: error instanceof Error ? error.message : "AcoustID lookup failed.",
    };
  }
}

const generatorPatterns = [
  ["openai", "OpenAI"],
  ["suno", "Suno"],
  ["udio", "Udio"],
  ["stable audio", "Stable Audio"],
  ["elevenlabs", "ElevenLabs"],
  ["musicgen", "MusicGen"],
  ["audiocraft", "AudioCraft"],
  ["riffusion", "Riffusion"],
  ["google lyria", "Google Lyria"],
  ["aiva", "AIVA"],
  ["boomy", "Boomy"],
] as const;

export function metadataProvenanceIndicators(
  tags: Array<{ key: string; value: string }>,
  rawIdentifiers: Array<{ identifier: string; value: string }>,
  credentials: ContentCredentialsAssessment,
): ProvenanceIndicator[] {
  const indicators: ProvenanceIndicator[] = [];
  for (const tag of tags) {
    const normalized = `${tag.key} ${tag.value}`.toLowerCase();
    for (const [pattern, name] of generatorPatterns) {
      if (normalized.includes(pattern)) {
        indicators.push({
          type: "generator-metadata",
          identifier: name,
          source: `metadata:${tag.key}`,
          value: tag.value,
          interpretation:
            "A known generator/tool name appears in editable metadata. This is an inventory indicator, not proof of how the audio was created.",
        });
      }
    }
  }
  for (const raw of rawIdentifiers) {
    indicators.push({
      type: "watermark-signature",
      identifier: raw.identifier,
      source: "raw-file-string",
      value: raw.value,
      interpretation:
        "A known identifier string occurs in the file bytes. Audio-V has not decoded or authenticated a proprietary watermark.",
    });
  }
  if (credentials.status !== "not-present") {
    indicators.push({
      type: "content-credential",
      identifier: "C2PA Content Credentials",
      source: "cryptographic-manifest",
      value: credentials.status,
      interpretation: credentials.limitation,
    });
  }
  return indicators;
}
