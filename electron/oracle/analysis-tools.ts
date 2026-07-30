import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import type {
  AcoustIdLookup,
  ChromaprintAssessment,
  ContentCredentialsAssessment,
  MusicBrainzEnrichment,
  ProvenanceIndicator,
} from "../../shared/contracts";

const maxOutputBytes = 16 * 1024 * 1024;
const maxAcoustIdResponseBytes = 1024 * 1024;
const maxMusicBrainzResponseBytes = 1024 * 1024;
const acoustIdApplicationKeyPattern = /^[A-Za-z0-9]{10}$/u;
const acoustIdRequestIntervalMilliseconds = 375;
const acoustIdMaximumAttempts = 3;
const acoustIdLookupCache = new Map<string, Promise<AcoustIdLookup>>();
let acoustIdRequestQueue: Promise<void> = Promise.resolve();
let lastAcoustIdRequestAt = 0;
const musicBrainzRecordingIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const musicBrainzRequestIntervalMilliseconds = 1_100;
const musicBrainzRecordingCache = new Map<
  string,
  Promise<MusicBrainzEnrichment>
>();
let musicBrainzRequestQueue: Promise<void> = Promise.resolve();
let lastMusicBrainzRequestAt = 0;

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

interface MusicBrainzRecordingBody {
  id?: string;
  title?: string;
  disambiguation?: string;
  isrcs?: string[];
  "first-release-date"?: string;
  "artist-credit"?: Array<{
    artist?: { id?: string; name?: string };
  }>;
  releases?: Array<{
    "release-group"?: {
      id?: string;
      title?: string;
      "primary-type"?: string;
      "first-release-date"?: string;
    };
  }>;
  error?: string;
}

const musicBrainzLimitation =
  "MusicBrainz supplies community-maintained identity metadata. A match does not prove ownership, mastering provenance, file integrity, or audio quality and never changes the Oracle verdict.";

function emptyMusicBrainzEnrichment(
  status: MusicBrainzEnrichment["status"],
  error: string | null = null,
): MusicBrainzEnrichment {
  return {
    status,
    source: null,
    recordingId: null,
    title: null,
    disambiguation: null,
    artists: [],
    isrcs: [],
    firstReleaseDate: null,
    releaseGroups: [],
    error,
    limitation: musicBrainzLimitation,
  };
}

async function waitForMusicBrainzTurn(signal?: AbortSignal): Promise<void> {
  const previous = musicBrainzRequestQueue;
  let release!: () => void;
  musicBrainzRequestQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    if (signal?.aborted) throw new Error("MusicBrainz lookup canceled.");
    const waitMilliseconds = Math.max(
      0,
      musicBrainzRequestIntervalMilliseconds -
        (Date.now() - lastMusicBrainzRequestAt),
    );
    if (waitMilliseconds > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, waitMilliseconds);
        const cancel = () => {
          clearTimeout(timer);
          reject(new Error("MusicBrainz lookup canceled."));
        };
        signal?.addEventListener("abort", cancel, { once: true });
      });
    }
    lastMusicBrainzRequestAt = Date.now();
  } finally {
    release();
  }
}

async function requestMusicBrainzRecording(
  recordingId: string,
  source: NonNullable<MusicBrainzEnrichment["source"]>,
  signal?: AbortSignal,
): Promise<MusicBrainzEnrichment> {
  await waitForMusicBrainzTurn(signal);
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
    : AbortSignal.timeout(15_000);
  const url = new URL(
    `https://musicbrainz.org/ws/2/recording/${recordingId}`,
  );
  url.searchParams.set(
    "inc",
    "artist-credits+isrcs+releases+release-groups",
  );
  url.searchParams.set("fmt", "json");
  const response = await fetch(url, {
    method: "GET",
    signal: requestSignal,
    headers: {
      Accept: "application/json",
      "User-Agent": "Audio-V/0.4 (https://github.com/DRAZY/Audio-V)",
    },
  });
  const declaredBytes = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredBytes) &&
    declaredBytes > maxMusicBrainzResponseBytes
  ) {
    throw new Error("MusicBrainz response exceeded the 1 MB safety limit.");
  }
  const responseText = await response.text();
  if (Buffer.byteLength(responseText) > maxMusicBrainzResponseBytes) {
    throw new Error("MusicBrainz response exceeded the 1 MB safety limit.");
  }
  let body: MusicBrainzRecordingBody;
  try {
    body = JSON.parse(responseText) as MusicBrainzRecordingBody;
  } catch {
    throw new Error(
      `MusicBrainz returned an unreadable response (HTTP ${response.status}).`,
    );
  }
  if (response.status === 404) {
    return {
      ...emptyMusicBrainzEnrichment("not-found"),
      source,
      recordingId,
    };
  }
  if (!response.ok || !body.id) {
    throw new Error(
      body.error ??
        (response.status === 503
          ? "MusicBrainz is rate limiting or temporarily unavailable. Try again later."
          : `MusicBrainz rejected the lookup (HTTP ${response.status}).`),
    );
  }
  const releaseGroups = new Map<
    string,
    MusicBrainzEnrichment["releaseGroups"][number]
  >();
  for (const release of body.releases ?? []) {
    const group = release["release-group"];
    if (!group?.id || !group.title || releaseGroups.has(group.id)) continue;
    releaseGroups.set(group.id, {
      id: group.id,
      title: group.title,
      primaryType: group["primary-type"] ?? null,
      firstReleaseDate: group["first-release-date"] ?? null,
    });
    if (releaseGroups.size >= 8) break;
  }
  return {
    status: "matched",
    source,
    recordingId: body.id,
    title: body.title ?? null,
    disambiguation: body.disambiguation || null,
    artists: (body["artist-credit"] ?? [])
      .map((credit) => credit.artist)
      .filter(
        (artist): artist is { id: string; name: string } =>
          Boolean(artist?.id && artist.name),
      )
      .slice(0, 12),
    isrcs: [...new Set(body.isrcs ?? [])].slice(0, 20),
    firstReleaseDate:
      body["first-release-date"] ??
      [...releaseGroups.values()]
        .map((group) => group.firstReleaseDate)
        .filter((date): date is string => Boolean(date))
        .sort()[0] ??
      null,
    releaseGroups: [...releaseGroups.values()],
    error: null,
    limitation: musicBrainzLimitation,
  };
}

export async function lookupMusicBrainzRecording(
  embeddedRecordingIds: string[],
  acoustIdLookup: AcoustIdLookup,
  signal?: AbortSignal,
): Promise<MusicBrainzEnrichment> {
  const embeddedId = embeddedRecordingIds.find((id) =>
    musicBrainzRecordingIdPattern.test(id.trim()),
  )?.trim();
  const acoustIdRecordingId = acoustIdLookup.recordingIds.find((id) =>
    musicBrainzRecordingIdPattern.test(id.trim()),
  )?.trim();
  const recordingId = embeddedId ?? acoustIdRecordingId;
  const source: NonNullable<MusicBrainzEnrichment["source"]> | null = embeddedId
    ? "embedded-mbid"
    : acoustIdRecordingId
      ? "acoustid-match"
      : null;
  if (!recordingId || !source) {
    return emptyMusicBrainzEnrichment("no-identifier");
  }
  const cacheKey = recordingId.toLowerCase();
  const cached = musicBrainzRecordingCache.get(cacheKey);
  if (cached) {
    return {
      ...(await cached),
      source,
    };
  }
  const lookup = requestMusicBrainzRecording(recordingId, source, signal)
    .catch(
      (error): MusicBrainzEnrichment => ({
        ...emptyMusicBrainzEnrichment(
          "service-error",
          error instanceof Error ? error.message : "MusicBrainz lookup failed.",
        ),
        source,
        recordingId,
      }),
    )
    .then((result) => {
      if (result.status === "service-error") {
        musicBrainzRecordingCache.delete(cacheKey);
      }
      return result;
    });
  musicBrainzRecordingCache.set(cacheKey, lookup);
  return lookup;
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
  const previous = acoustIdRequestQueue;
  let releaseQueue!: () => void;
  acoustIdRequestQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await previous;
  let response!: Response;
  try {
    const intervalDelay = Math.max(
      0,
      acoustIdRequestIntervalMilliseconds -
        (Date.now() - lastAcoustIdRequestAt),
    );
    if (intervalDelay > 0) {
      await waitForAcoustIdRetry(intervalDelay, signal);
    }
    for (let attempt = 1; attempt <= acoustIdMaximumAttempts; attempt += 1) {
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000);
      response = await fetch("https://api.acoustid.org/v2/lookup", {
        method: "POST",
        signal: requestSignal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Audio-V (https://github.com/DRAZY/Audio-V)",
        },
        body: parameters.toString(),
      });
      lastAcoustIdRequestAt = Date.now();
      if (
        ![429, 502, 503, 504].includes(response.status) ||
        attempt === acoustIdMaximumAttempts
      ) {
        break;
      }
      await response.body?.cancel();
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const retryDelay = Number.isFinite(retryAfterSeconds)
        ? Math.min(10_000, Math.max(375, retryAfterSeconds * 1_000))
        : 375 * 2 ** (attempt - 1);
      await waitForAcoustIdRetry(retryDelay, signal);
    }
  } finally {
    releaseQueue();
  }
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

async function waitForAcoustIdRetry(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new Error("AcoustID lookup canceled.");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new Error("AcoustID lookup canceled."));
    };
    function done(): void {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
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
  const durationSeconds = fingerprint.durationSeconds;
  const cacheKey =
    fingerprint.fingerprintSha256 ??
    `${durationSeconds}:${fingerprint.fingerprint ?? fingerprint.rawFingerprint.join(",")}`;
  const cached = acoustIdLookupCache.get(cacheKey);
  if (cached) return cached;
  const lookup = (async (): Promise<AcoustIdLookup> => {
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
      duration: String(Math.round(durationSeconds)),
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
  })().then((result) => {
    if (result.status === "service-error") {
      acoustIdLookupCache.delete(cacheKey);
    }
    return result;
  });
  acoustIdLookupCache.set(cacheKey, lookup);
  return lookup;
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
    if (
      /\bmqa/iu.test(
        normalized,
      )
    ) {
      indicators.push({
        type: "format-marker",
        identifier: "MQA declaration",
        source: `metadata:${tag.key}`,
        value: tag.value,
        interpretation:
          "An editable metadata field declares MQA-related information. Audio-V has not authenticated an MQA payload, unfolded audio, or certified provenance.",
      });
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
