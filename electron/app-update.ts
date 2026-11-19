import { app, autoUpdater as nativeUpdater, BrowserWindow, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export type UpdateSchedule = "launch" | "day" | "week" | "never";
export interface UpdateStatus {
  state: "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "error";
  current: string;
  latest?: string;
  progress?: number;
  error?: string;
  manual?: boolean;
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
let timer: NodeJS.Timeout | undefined;
let wired = false;
let lastCheckAt = 0;

function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("update:status", status);
  }
}
function set(next: Partial<UpdateStatus>): void {
  status = { ...status, ...next, current: app.getVersion() };
  broadcast();
}
function newer(candidate: string, current: string): boolean {
  const numbers = (version: string) => version.replace(/^v/u, "").split(/[.-]/u).map((part) => Number(part) || 0);
  const left = numbers(candidate);
  const right = numbers(current);
  return left.some((value, index) => value !== (right[index] ?? 0) && value > (right[index] ?? 0));
}
function developerIdSigned(): boolean {
  if (process.platform !== "darwin" || !app.isPackaged) return false;
  try {
    const bundle = path.resolve(process.execPath, "..", "..", "..");
    const details = execFileSync("codesign", ["-dv", "--verbose=2", bundle], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return details.includes("TeamIdentifier=W966GFT83K") && details.includes("Authority=Developer ID Application:");
  } catch (error) {
    const details = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
    return details.includes("TeamIdentifier=W966GFT83K") && details.includes("Authority=Developer ID Application:");
  }
}
function canInstallInPlace(): boolean {
  return app.isPackaged && (process.platform === "win32" || (process.platform === "darwin" && developerIdSigned()));
}
function wireUpdater(): void {
  if (wired) return;
  wired = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("download-progress", (progress) => set({ state: "downloading", progress: Math.min(99, Math.round(progress.percent)) }));
  autoUpdater.on("update-downloaded", (info) => {
    if (process.platform !== "darwin") set({ state: "ready", latest: info.version, progress: 100 });
  });
  nativeUpdater.on("update-downloaded", () => set({ state: "ready", progress: 100 }));
  autoUpdater.on("error", (error) => {
    if (status.state === "downloading") set({ state: "available", error: error.message, manual: true });
  });
}
async function saveSchedule(): Promise<void> {
  const file = path.join(app.getPath("userData"), "update-preferences-v1.json");
  await fs.writeFile(file, `${JSON.stringify({ schedule }, null, 2)}\n`, { mode: 0o600 });
}
export async function initializeUpdates(): Promise<void> {
  try {
    const data = JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "update-preferences-v1.json"), "utf8")) as { schedule?: UpdateSchedule };
    if (data.schedule && data.schedule in SCHEDULE_MS) schedule = data.schedule;
  } catch { /* first launch uses launch checks */ }
  scheduleChecks();
}
export function getUpdateStatus(): UpdateStatus { return status; }
export function getUpdateSchedule(): UpdateSchedule { return schedule; }
export async function setUpdateSchedule(value: unknown): Promise<UpdateSchedule> {
  schedule = typeof value === "string" && value in SCHEDULE_MS ? value as UpdateSchedule : "launch";
  await saveSchedule();
  scheduleChecks(false);
  return schedule;
}
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (status.state === "checking" || status.state === "downloading") return status;
  lastCheckAt = Date.now();
  set({ state: "checking", error: undefined });
  try {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, { headers: { Accept: "application/vnd.github+json", "User-Agent": `Audio-V/${app.getVersion()}` }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`GitHub ${response.status}`);
    const release = await response.json() as { tag_name: string };
    const latest = release.tag_name.replace(/^v/u, "");
    set(newer(latest, app.getVersion()) ? { state: "available", latest, manual: !canInstallInPlace() } : { state: "none", latest, manual: false });
  } catch (error) {
    set({ state: "error", error: error instanceof Error ? error.message : "Update check failed." });
  }
  return status;
}
export async function installUpdate(): Promise<void> {
  if (status.state === "ready") return void setImmediate(() => autoUpdater.quitAndInstall(true, true));
  if (status.state !== "available") return;
  if (!canInstallInPlace()) return void shell.openExternal(RELEASE_URL);
  wireUpdater();
  set({ state: "downloading", progress: 0, error: undefined });
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.updateInfo || !newer(result.updateInfo.version, app.getVersion())) throw new Error("The release does not contain an update feed for this platform.");
    await autoUpdater.downloadUpdate();
  } catch (error) {
    set({ state: "available", error: error instanceof Error ? error.message : "Update download failed.", manual: true });
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
