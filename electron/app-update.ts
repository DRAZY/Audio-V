import { app, autoUpdater as nativeUpdater, BrowserWindow, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { installMode, isDeveloperIdSigned, type InstallMode } from "./update-plan";
import { isNewerVersion } from "./version-compare";

/**
 * App updates from GitHub Releases (DRAZY/Audio-V).
 *
 * A check runs 10 s after launch and then on the chosen schedule. A newer
 * release shows the in-window notice (Update now / Skip this version / later).
 * "Update now" downloads the update and then restarts into the new version by
 * itself, unless an audit is running, in which case it waits and offers
 * "Restart and install".
 * - Windows installer build: electron-updater fetches the NSIS installer and
 *   runs it silently, then relaunches.
 * - macOS Developer ID build: electron-updater fetches the zip named in
 *   latest-mac.yml; Squirrel.Mac verifies it against this app's code signature,
 *   swaps the bundle and relaunches.
 * - Otherwise (Windows portable, ad-hoc Mac builds, development runs, or an
 *   in-place install that failed) the button opens the release page.
 */

export type UpdateSchedule = "launch" | "day" | "week" | "never";
export interface UpdateStatus {
  state: "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "error";
  current: string;
  latest?: string;
  progress?: number;
  error?: string;
  manual?: boolean;
  /** The version the user chose to skip; the update notice stays hidden for it. */
  skippedVersion?: string;
}

export interface UpdateHooks {
  /** True while work is running that a restart would interrupt (an audit). */
  isBusy?: () => boolean;
  log?: (level: "info" | "warn" | "error", event: string, data?: Record<string, unknown>) => void;
}

const REPOSITORY = "DRAZY/Audio-V";
const RELEASE_URL = `https://github.com/${REPOSITORY}/releases/latest`;
const SCHEDULE_MS: Record<UpdateSchedule, number> = {
  launch: 0,
  day: 24 * 60 * 60_000,
  week: 7 * 24 * 60 * 60_000,
  never: 0,
};
let status: UpdateStatus = { state: "idle", current: app.getVersion() };
let schedule: UpdateSchedule = "launch";
let skippedVersion: string | undefined;
let timer: NodeJS.Timeout | undefined;
let wired = false;
let lastCheckAt = 0;
let mode: InstallMode | undefined;
/** An in-place install failed this session: use the release page until the next launch. */
let inPlaceFailed = false;
/** Set by Update now: restart on our own once the update is ready, unless busy. */
let restartWhenReady = false;
let hooks: UpdateHooks = {};

/**
 * Maintainer end-to-end test only: with AUDIO_V_ENABLE_QA=1, read the latest
 * version and the update feed from a local server instead of GitHub. Squirrel.Mac
 * still requires the downloaded app to carry this app's Developer ID signature.
 */
const qaFeedUrl =
  process.env.AUDIO_V_ENABLE_QA === "1" && process.env.AUDIO_V_QA_UPDATE_FEED
    ? process.env.AUDIO_V_QA_UPDATE_FEED.replace(/\/+$/u, "")
    : undefined;

function log(level: "info" | "warn" | "error", event: string, data?: Record<string, unknown>): void {
  hooks.log?.(level, event, data);
}
function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("update:status", status);
  }
}
function set(next: Partial<UpdateStatus>): void {
  status = { ...status, ...next, current: app.getVersion(), skippedVersion };
  broadcast();
}

function macDeveloperIdSigned(): boolean {
  // process.execPath = <bundle>.app/Contents/MacOS/Audio-V
  const bundle = path.resolve(process.execPath, "..", "..", "..");
  // codesign prints the signature details on stderr, so read both streams.
  const result = spawnSync("codesign", ["-dv", "--verbose=2", bundle], { encoding: "utf8", timeout: 15_000 });
  if (result.error) log("warn", "update.codesign-failed", { message: result.error.message });
  return isDeveloperIdSigned(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
}

/** How this build installs updates; computed once per launch. */
function updateInstallMode(): InstallMode {
  if (!mode) {
    mode = installMode({
      platform: process.platform,
      packaged: app.isPackaged,
      portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
      developerIdSigned: process.platform === "darwin" && app.isPackaged ? macDeveloperIdSigned() : undefined,
    });
    log("info", "update.install-mode", { mode: mode.kind, reason: mode.kind === "manual" ? mode.reason : undefined });
  }
  return mode;
}
function canInstallInPlace(): boolean {
  return !inPlaceFailed && updateInstallMode().kind === "inPlace";
}

function restartNow(): void {
  if (status.state !== "ready") return;
  log("info", "update.restart", { version: status.latest });
  // Windows: silent install, then start the new version. macOS: Squirrel.Mac swaps and relaunches.
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
}

/** The update is downloaded and (on macOS) accepted by Squirrel.Mac. */
function downloaded(version: string): void {
  set({ state: "ready", latest: version || status.latest, progress: 100, error: undefined });
  log("info", "update.ready", { version: status.latest });
  if (restartWhenReady && !hooks.isBusy?.()) setTimeout(restartNow, 1_500);
}

/** An in-place install went wrong: keep running and offer the release page instead. */
function failInPlace(error: Error): void {
  inPlaceFailed = true;
  restartWhenReady = false;
  log("error", "update.in-place-failed", { message: error.message });
  set({ state: "available", progress: undefined, error: error.message, manual: true });
}

function wireUpdater(): void {
  if (wired) return;
  wired = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  if (qaFeedUrl) autoUpdater.setFeedURL({ provider: "generic", url: qaFeedUrl });
  autoUpdater.on("download-progress", (progress) => set({ state: "downloading", progress: Math.min(99, Math.round(progress.percent)) }));
  if (process.platform === "darwin") {
    // electron-updater reports the zip as downloaded before Squirrel.Mac has
    // checked its signature against this app; ready means Squirrel accepted it.
    let version = "";
    autoUpdater.on("update-downloaded", (info) => {
      version = info.version;
      log("info", "update.zip-downloaded", { version });
    });
    nativeUpdater.on("update-downloaded", () => downloaded(version));
  } else {
    autoUpdater.on("update-downloaded", (info) => downloaded(info.version));
  }
  autoUpdater.on("error", (error) => {
    if (status.state === "downloading" || status.state === "ready") failInPlace(error);
    else log("warn", "update.updater-error", { message: error.message });
  });
}

async function savePreferences(): Promise<void> {
  const file = path.join(app.getPath("userData"), "update-preferences-v1.json");
  await fs.writeFile(file, `${JSON.stringify({ schedule, skippedVersion }, null, 2)}\n`, { mode: 0o600 });
}
export async function initializeUpdates(options: UpdateHooks = {}): Promise<void> {
  hooks = options;
  try {
    const data = JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "update-preferences-v1.json"), "utf8")) as { schedule?: UpdateSchedule; skippedVersion?: unknown };
    if (data.schedule && data.schedule in SCHEDULE_MS) schedule = data.schedule;
    if (typeof data.skippedVersion === "string" && data.skippedVersion) skippedVersion = data.skippedVersion;
  } catch { /* first launch uses launch checks */ }
  scheduleChecks();
}
export function getUpdateStatus(): UpdateStatus { return status; }
export function getUpdateSchedule(): UpdateSchedule { return schedule; }
export async function setUpdateSchedule(value: unknown): Promise<UpdateSchedule> {
  schedule = typeof value === "string" && value in SCHEDULE_MS ? value as UpdateSchedule : "launch";
  await savePreferences();
  scheduleChecks(false);
  return schedule;
}
/**
 * Hide the update notice for one version. A newer release shows the notice
 * again, and Settings still offers the skipped version.
 */
export async function skipUpdate(version: unknown): Promise<UpdateStatus> {
  if (typeof version !== "string" || !version) return status;
  const normalized = version.replace(/^v/u, "");
  if (!isNewerVersion(normalized, app.getVersion())) return status;
  skippedVersion = normalized;
  await savePreferences();
  set({});
  return status;
}
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (status.state === "checking" || status.state === "downloading" || status.state === "ready") return status;
  lastCheckAt = Date.now();
  set({ state: "checking", error: undefined });
  try {
    const response = await fetch(qaFeedUrl ? `${qaFeedUrl}/release.json` : `https://api.github.com/repos/${REPOSITORY}/releases/latest`, { headers: { Accept: "application/vnd.github+json", "User-Agent": `Audio-V/${app.getVersion()}` }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`GitHub ${response.status}`);
    const release = await response.json() as { tag_name: string };
    const latest = release.tag_name.replace(/^v/u, "");
    const available = isNewerVersion(latest, app.getVersion());
    set(available ? { state: "available", latest, manual: !canInstallInPlace() } : { state: "none", latest, manual: false });
    log("info", "update.check", { latest, available, inPlace: available ? canInstallInPlace() : undefined });
  } catch (error) {
    set({ state: "error", error: error instanceof Error ? error.message : "Update check failed." });
    log("warn", "update.check-failed", { message: status.error });
  }
  return status;
}
/** Update now: download and restart into the new version, or open the release page. */
export async function installUpdate(): Promise<void> {
  if (status.state === "ready") return restartNow();
  if (status.state !== "available") return;
  if (!canInstallInPlace()) return void shell.openExternal(RELEASE_URL);
  wireUpdater();
  restartWhenReady = true;
  set({ state: "downloading", progress: 0, error: undefined });
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.updateInfo || !isNewerVersion(result.updateInfo.version, app.getVersion())) throw new Error("The release does not contain an update feed for this platform.");
    await autoUpdater.downloadUpdate();
    // 'update-downloaded' follows; on macOS, Squirrel.Mac has verified the signature by then.
  } catch (error) {
    failInPlace(error instanceof Error ? error : new Error("Update download failed."));
  }
}
function scheduleChecks(checkOnLaunch = true): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  if (checkOnLaunch && schedule !== "never") setTimeout(() => void checkForUpdates(), 10_000);
  const interval = SCHEDULE_MS[schedule];
  if (interval) timer = setInterval(() => void checkForUpdates(), interval);
  if (interval && lastCheckAt && Date.now() - lastCheckAt > interval) void checkForUpdates();
}
