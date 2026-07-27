const { app, BrowserWindow } = require("electron");
const { writeFile } = require("node:fs/promises");
const path = require("node:path");

const [
  ,
  ,
  requestedUrl,
  requestedOutput,
  requestedSource,
  requestedPanel,
  requestedAnalysis,
] = process.argv;
if (!requestedUrl || !requestedOutput) {
  throw new Error(
    "Usage: electron scripts/capture-renderer.cjs <url> <output.png> [audio-source]",
  );
}

app.setPath(
  "userData",
  path.join(process.cwd(), "tmp", `electron-qa-${process.pid}`),
);
app.commandLine.appendSwitch("disable-gpu");

app.whenReady().then(async () => {
  if (requestedSource) {
    const { scanSources } = require("../dist-electron/electron/scanner.js");
    const sourcePath = path.resolve(requestedSource);
    const source = {
      kind: "folder",
      paths: [sourcePath],
      label: sourcePath,
    };
    const result = await scanSources(source);
    const { compareAudioFiles } = require(
      "../dist-electron/electron/oracle/signal-comparison.js",
    );
    const comparison = result.files.length
      ? await compareAudioFiles(
          result.files[0].path,
          result.files[1]?.path ?? result.files[0].path,
        )
      : null;
    process.env.AUDIO_V_QA_PAYLOAD = JSON.stringify({
      source,
      result,
      comparison,
    });
  }

  const window = new BrowserWindow({
    width: Number(process.env.AUDIO_V_QA_WIDTH ?? 1540),
    height: Number(process.env.AUDIO_V_QA_HEIGHT ?? 980),
    show: false,
    backgroundColor: "#090a0e",
    webPreferences: requestedSource
      ? {
          preload: path.join(__dirname, "qa-preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        }
      : undefined,
  });

  await window.loadURL(requestedUrl);

  if (requestedSource) {
    await window.webContents.executeJavaScript(
      `document.querySelector(".primary-action").click()`,
    );
    await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const deadline = Date.now() + 20000;
        const check = () => {
          const text = document.querySelector(".scan-state")?.textContent ?? "";
          if (text.includes("files loaded")) resolve(text);
          else if (Date.now() > deadline) reject(new Error("Timed out waiting for scan UI"));
          else setTimeout(check, 50);
        };
        check();
      })
    `);
    if (requestedPanel && requestedPanel !== "audit") {
      const panel = JSON.stringify(requestedPanel.toLowerCase());
      await window.webContents.executeJavaScript(`
        [...document.querySelectorAll(".rail-item")].find(
          (button) => button.textContent.toLowerCase().includes(${panel})
        )?.click()
      `);
    }
    if (requestedAnalysis) {
      const analysis = JSON.stringify(requestedAnalysis.toLowerCase());
      await window.webContents.executeJavaScript(`
        [...document.querySelectorAll(".analysis-tabs button")].find(
          (button) => button.textContent.toLowerCase().includes(${analysis})
        )?.click()
      `);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  await window.webContents.executeJavaScript(`
    window.scrollTo(0, 0);
    document.querySelector(".module-page")?.scrollTo(
      0,
      ${Number(process.env.AUDIO_V_QA_SCROLL ?? 0)}
    );
  `);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const image = await window.webContents.capturePage();
  await writeFile(path.resolve(requestedOutput), image.toPNG());
  window.destroy();
  app.quit();
});
