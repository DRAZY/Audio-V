const { app, BrowserWindow } = require("electron");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");

app.commandLine.appendSwitch("disable-gpu");
app.setPath(
  "userData",
  path.join(process.cwd(), "tmp", `electron-update-notice-${process.pid}`),
);
app.on("window-all-closed", () => undefined);

const waitFor = (window, expression, label) =>
  window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => {
        const value = (() => (${expression}))();
        if (value) return resolve(value);
        if (Date.now() > deadline) return reject(new Error(${JSON.stringify(`Timed out waiting for ${label}`)}));
        setTimeout(check, 25);
      };
      check();
    })
  `);

const notice = (window) =>
  window.webContents.executeJavaScript(`
    (() => {
      const element = document.querySelector(".update-notice");
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const statusbar = document.querySelector(".statusbar")?.getBoundingClientRect();
      // Compare with the status bar's visible items: its box stretches when
      // the workspace is empty, but the items stay in the bottom row.
      const statusItems = [...document.querySelectorAll(".statusbar > span")].map((item) => item.getBoundingClientRect());
      const workspaceBottom = document.querySelector(".workspace")?.getBoundingClientRect().bottom ?? innerHeight;
      return {
        title: element.querySelector("strong")?.textContent.trim(),
        text: element.textContent.replace(/\\s+/g, " ").trim(),
        buttons: [...element.querySelectorAll("button")].map((button) => ({
          label: (button.getAttribute("aria-label") ?? button.textContent).trim(),
          disabled: button.disabled,
        })),
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        viewport: { width: innerWidth, height: innerHeight },
        statusbarTop: statusbar?.top ?? null,
        statusbarRect: statusbar ? [statusbar.left, statusbar.top, statusbar.right, statusbar.bottom] : null,
        clearOfStatusbar:
          // Clear of the status bar's own row (the bottom 40px of the workspace)…
          rect.bottom <= workspaceBottom - 40 + 1 &&
          // …and of every visible status item.
          statusItems.every(
            (item) =>
              rect.bottom <= item.top + 1 ||
              rect.top >= item.bottom - 1 ||
              rect.right <= item.left + 1 ||
              rect.left >= item.right - 1,
          ),
      };
    })()
  `);

const click = (window, label) =>
  window.webContents.executeJavaScript(`
    (() => {
      const button = [...document.querySelectorAll(".update-notice button")].find(
        (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent).trim() === ${JSON.stringify(label)},
      );
      if (!button) throw new Error(${JSON.stringify(`No update notice button "${label}"`)});
      button.click();
      return true;
    })()
  `);

const setStatus = (window, status) =>
  window.webContents.executeJavaScript(
    `window.audioV.qaSetUpdateStatus(${JSON.stringify(status)})`,
  );

app.whenReady().then(async () => {
  process.env.AUDIO_V_QA_PAYLOAD = JSON.stringify({
    source: { kind: "files", paths: [], label: "Update notice QA" },
    result: { files: [] },
    comparison: null,
    updateStatus: { state: "idle", current: "0.4.49" },
  });
  const window = new BrowserWindow({
    width: 1540,
    height: 980,
    useContentSize: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "qa-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const checks = {};
  try {
    await window.loadFile(path.join(process.cwd(), "dist", "index.html"));
    await waitFor(window, `document.querySelector(".statusbar")`, "the application shell");
    checks.hiddenWhenIdle = (await notice(window)) === null;

    await setStatus(window, { state: "available", latest: "0.4.50", manual: false });
    await waitFor(window, `document.querySelector(".update-notice")`, "the update notice");
    const available = await notice(window);
    checks.availableTitle = available.title === "Audio-V 0.4.50 is available";
    checks.availableMentionsCurrent = available.text.includes("You have 0.4.49");
    checks.availableActions =
      JSON.stringify(available.buttons.map((button) => button.label)) ===
      JSON.stringify(["Update now", "Skip this version", "Remind me later"]);
    checks.insideViewport =
      available.rect.left >= 0 &&
      available.rect.right <= available.viewport.width &&
      available.rect.top >= 0 &&
      available.rect.bottom <= available.viewport.height;
    checks.clearOfStatusbar = available.clearOfStatusbar;
    if (!available.clearOfStatusbar) {
      console.error(`Notice ${JSON.stringify(available.rect)}, status bar ${JSON.stringify(available.statusbarRect)}, viewport ${available.viewport.height}.`);
    }

    const axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
    await window.webContents.executeJavaScript(axeSource);
    const violations = await window.webContents.executeJavaScript(`
      axe.run(document.querySelector(".update-notice"), { resultTypes: ["violations"] })
        .then((result) => result.violations.map((violation) => violation.id))
    `);
    checks.accessible = violations.length === 0;

    await new Promise((resolve) => setTimeout(resolve, 250));
    await mkdir(path.join(process.cwd(), "build"), { recursive: true });
    await writeFile(
      path.join(process.cwd(), "build", "update-notice-available.png"),
      (await window.webContents.capturePage()).toPNG(),
    );

    await click(window, "Update now");
    await click(window, "Skip this version");
    await waitFor(window, `!document.querySelector(".update-notice")`, "the notice to hide after skipping");
    const calls = await window.webContents.executeJavaScript(`window.audioV.qaUpdateCalls()`);
    checks.updateCallsInstall = calls.includes("install");
    checks.skipPersistsVersion = calls.includes("skip:0.4.50");
    await setStatus(window, { state: "available", latest: "0.4.50" });
    checks.skippedVersionStaysHidden = (await notice(window)) === null;

    await setStatus(window, { state: "available", latest: "0.4.51" });
    await waitFor(window, `document.querySelector(".update-notice")`, "the notice for a newer release");
    checks.newerReleaseShowsAgain = (await notice(window)).title === "Audio-V 0.4.51 is available";
    await click(window, "Remind me later");
    await waitFor(window, `!document.querySelector(".update-notice")`, "the notice to hide after Later");
    await setStatus(window, { state: "downloading", latest: "0.4.51", progress: 40 });
    checks.laterHidesThisVersion = (await notice(window)) === null;

    await setStatus(window, { state: "ready", latest: "0.4.52", progress: 100 });
    await waitFor(window, `document.querySelector(".update-notice")`, "the ready notice");
    const ready = await notice(window);
    checks.readyOffersRestart =
      ready.title === "Audio-V 0.4.52 is ready to install" &&
      ready.buttons[0].label === "Restart and install" &&
      !ready.buttons.some((button) => button.label === "Skip this version");

    await setStatus(window, { state: "downloading", latest: "0.4.53", progress: 37 });
    await waitFor(window, `document.querySelector(".update-notice button")?.textContent.includes("37%")`, "download progress");
    const downloading = await notice(window);
    checks.downloadingShowsProgress =
      downloading.buttons[0].label === "Downloading 37%" && downloading.buttons[0].disabled;

    await setStatus(window, {
      state: "available",
      latest: "0.4.54",
      progress: undefined,
      manual: true,
      error: "The release does not contain an update feed for this platform.",
    });
    await waitFor(window, `document.querySelector(".update-notice")?.textContent.includes("0.4.54")`, "the manual notice");
    const manual = await notice(window);
    checks.manualOpensReleasePage = manual.buttons[0].label === "Open release page";
    checks.errorShown = manual.text.includes("does not contain an update feed");

    window.setContentSize(900, 720);
    await waitFor(window, `innerWidth <= 901`, "the narrow window");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const narrow = await notice(window);
    checks.fitsNarrowWindow =
      narrow.rect.left >= 0 && narrow.rect.right <= narrow.viewport.width;

    const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    await writeFile(
      path.join(process.cwd(), "build", "update-notice-latest.json"),
      `${JSON.stringify({ schema: "Audio-V update notice check v1", measuredAt: new Date().toISOString(), checks, violations, passed: failed.length === 0 }, null, 2)}\n`,
    );
    if (failed.length) {
      console.error(`Update notice failed: ${failed.join(", ")}.`);
      if (violations.length) console.error(`Accessibility violations: ${violations.join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log(`Update notice passed: ${Object.keys(checks).length} checks (show, skip, later, newer release, download, ready, manual, accessibility, layout).`);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    window.destroy();
    app.quit();
  }
});
