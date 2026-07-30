const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");

app.commandLine.appendSwitch("disable-gpu");
app.setPath(
  "userData",
  path.join(process.cwd(), "tmp", `electron-acceptance-${process.pid}`),
);
app.on("window-all-closed", () => undefined);

app.whenReady().then(async () => {
  process.env.AUDIO_V_QA_PAYLOAD = JSON.stringify({
    source: { kind: "files", paths: [], label: "Acceptance evidence QA" },
    result: { files: [] },
    comparison: null,
    acceptanceRun: {
      schema: "Audio-V acceptance run evidence v1",
      sessionId: "qa-session",
      status: "completed",
      startedAt: "2026-07-29T10:00:00.000Z",
      finishedAt: "2026-07-29T12:00:00.000Z",
      application: {
        version: "0.4.34",
        packaged: true,
        platform: "win32",
        architecture: "x64",
      },
      system: {
        operatingSystemRelease: "QA",
        logicalCpuCount: 16,
        totalMemoryBytes: 34359738368,
      },
      source: {
        kind: "folder",
        mode: "full-audit",
        storageKind: "network",
        pathCount: 1,
        externalIdentityEnabled: true,
        musicBrainzEnabled: true,
      },
      workload: {
        discoveredCount: 10000,
        completedCount: 10000,
        completedBytes: 1099511627776,
        cacheHitCount: 250,
        analysisErrorCount: 0,
        verdicts: { verified: 9000, review: 1000 },
        failureStages: {},
      },
      timing: {
        elapsedMilliseconds: 7200000,
        filesPerMinute: 83.3,
        cancellationRequestedAt: null,
        cancellationLatencyMilliseconds: null,
      },
      resources: {
        requestedAndEffectiveLimits: {
          concurrency: 4,
          workerMemoryMb: 384,
          ffmpegThreads: 2,
          nativeProcessMemoryMb: 1024,
        },
        sampleIntervalMilliseconds: 500,
        sampleCount: 14400,
        peakTotalWorkingSetBytes: 2147483648,
        peakMainRssBytes: 268435456,
        peakWorkingSetByProcessType: { Browser: 268435456 },
      },
      storage: {
        before: null,
        after: null,
        databaseGrowthBytes: 524288000,
      },
      recovery: {
        strategy: "adaptive-safe",
        attempt: 1,
        safeCandidateCount: 2,
        quarantinedCandidateCount: 1,
      },
      privacy:
        "No filenames, source paths, hashes, tags, audio evidence, or external-service credentials are included.",
      limitations: [],
    },
  });
  const window = new BrowserWindow({
    width: 1120,
    height: 720,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "qa-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  try {
    await window.loadFile(path.join(process.cwd(), "dist", "index.html"));
    await window.webContents.executeJavaScript(`
      [...document.querySelectorAll(".side-rail button")]
        .find((button) => button.textContent.toLowerCase().includes("settings"))
        ?.click()
    `);
    const evidence = await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const check = () => {
          const card = document.querySelector(".acceptance-evidence-card");
          if (card?.textContent.includes("10,000 / 10,000 files")) {
            card.scrollIntoView({ block: "start" });
            const rect = card.getBoundingClientRect();
            resolve({
              text: card.textContent,
              contained:
                rect.left >= 0 &&
                rect.right <= document.documentElement.clientWidth &&
                card.scrollWidth <= card.clientWidth,
            });
          } else if (Date.now() > deadline) {
            reject(new Error("Acceptance evidence did not render in Settings."));
          } else setTimeout(check, 25);
        };
        check();
      })
    `);
    for (const expected of [
      "completed · Audio-V 0.4.34",
      "10,000 / 10,000 files",
      "83.3 files/min",
      "2.15 GB across 14,400 samples",
      "524.3 MB",
      "network · full-audit",
      "adaptive-safe · 1 quarantined",
    ]) {
      if (!evidence.text.includes(expected)) {
        throw new Error(`Acceptance Settings card omitted: ${expected}`);
      }
    }
    if (!evidence.contained) {
      throw new Error("Acceptance evidence overflowed its Settings card.");
    }
    const delivery = await window.webContents.executeJavaScript(`
      (() => {
        const card = document.querySelector(".delivery-profile-card");
        const select = card?.querySelector("select");
        if (!card || !select) throw new Error("Delivery profile controls are missing.");
        select.value = "ebu-r128-programme";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return new Promise((resolve) => setTimeout(() => {
          const rect = card.getBoundingClientRect();
          resolve({
            text: card.textContent,
            contained:
              rect.left >= 0 &&
              rect.right <= document.documentElement.clientWidth &&
              card.scrollWidth <= card.clientWidth,
            stored: localStorage.getItem("audio-v.delivery-profile-v1"),
          });
        }, 50));
      })()
    `);
    for (const expected of [
      "-23.0 LUFS",
      "-23.2 to -22.8 LUFS",
      "-1.0 dBTP",
      "EBU R 128 v5.0 (2023)",
    ]) {
      if (!delivery.text.includes(expected)) {
        throw new Error(`Delivery profile Settings omitted: ${expected}`);
      }
    }
    if (!delivery.contained || delivery.stored !== "ebu-r128-programme") {
      throw new Error(
        "Delivery profile selection did not persist or fit its Settings card.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
    await mkdir(path.join(process.cwd(), "build"), { recursive: true });
    const screenshot = await window.webContents.capturePage();
    await writeFile(
      path.join(process.cwd(), "build", "acceptance-evidence-latest.png"),
      screenshot.toPNG(),
    );
    console.log(
      "Acceptance evidence rendered complete workload, throughput, memory, storage, source, and recovery readings without overflow.",
    );
    window.destroy();
    app.exit(0);
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    console.error(error);
    app.exit(1);
  }
});
