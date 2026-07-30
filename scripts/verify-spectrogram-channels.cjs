const { app, BrowserWindow } = require("electron");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");

app.commandLine.appendSwitch("disable-gpu");
app.setPath(
  "userData",
  path.join(process.cwd(), "tmp", `electron-spectrogram-${process.pid}`),
);

const channelModes = [
  "left channel",
  "right channel",
  "left-right difference",
];

async function verifyChannelCanvas(window, channelMode) {
  return window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const channelMode = ${JSON.stringify(channelMode)};
      const label = [...document.querySelectorAll(".spectrogram-controls label")]
        .find((candidate) => candidate.textContent.includes("Channels"));
      const select = label?.querySelector("select");
      if (!select) {
        reject(new Error("Spectrogram channel selector was not found."));
        return;
      }
      select.value = channelMode;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const deadline = Date.now() + 5000;
      const inspect = () => {
        const canvas = document.querySelector(".spectrogram-frame canvas");
        if (canvas?.width && canvas?.height) {
          const pixels = canvas
            .getContext("2d")
            ?.getImageData(0, 0, canvas.width, canvas.height).data;
          if (pixels) {
            let paintedPixels = 0;
            let maximumChannel = 0;
            for (let offset = 0; offset < pixels.length; offset += 4) {
              if (pixels[offset + 3] > 0) paintedPixels += 1;
              maximumChannel = Math.max(
                maximumChannel,
                pixels[offset],
                pixels[offset + 1],
                pixels[offset + 2],
              );
            }
            const totalPixels = canvas.width * canvas.height;
            if (paintedPixels === totalPixels && maximumChannel > 30) {
              resolve({
                channelMode,
                width: canvas.width,
                height: canvas.height,
                paintedPixels,
                maximumChannel,
              });
              return;
            }
          }
        }
        if (Date.now() > deadline) {
          reject(
            new Error(
              channelMode +
                " produced an unpainted or visually empty spectrogram canvas.",
            ),
          );
          return;
        }
        setTimeout(inspect, 25);
      };
      inspect();
    })
  `);
}

app.whenReady().then(async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(process.cwd(), "tests", ".tmp-spectrogram-channels-"),
  );
  let window;
  try {
    const audioPath = path.join(temporaryDirectory, "stereo-channels.flac");
    const { runEngine } = require(
      "../dist-electron/electron/oracle/ffmpeg-runtime.js"
    );
    await runEngine("ffmpeg", [
      "-nostdin", "-hide_banner", "-v", "error",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
      "-f", "lavfi", "-i", "sine=frequency=3600:sample_rate=48000:duration=1",
      "-filter_complex", "[0:a][1:a]amerge=inputs=2",
      "-ac", "2", "-c:a", "flac", "-y", audioPath,
    ]);
    const { scanSources } = require("../dist-electron/electron/scanner.js");
    const { inspectSpectrogram } = require(
      "../dist-electron/electron/oracle/spectrogram-inspector.js"
    );
    const source = {
      kind: "files",
      paths: [audioPath],
      label: "Spectrogram channel verification",
    };
    const result = await scanSources(source);
    const spectrograms = {};
    for (const channelMode of channelModes) {
      spectrograms[`512:${channelMode}`] = await inspectSpectrogram(
        audioPath,
        512,
        channelMode,
      );
    }
    const payloadPath = path.join(temporaryDirectory, "qa-payload.json");
    await writeFile(payloadPath, JSON.stringify({
      source,
      result,
      comparison: null,
      spectrograms,
    }));
    process.env.AUDIO_V_QA_PAYLOAD_PATH = payloadPath;
    window = new BrowserWindow({
      width: 1540,
      height: 980,
      show: false,
      backgroundColor: "#090a0e",
      webPreferences: {
        preload: path.join(__dirname, "qa-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    await window.loadFile(path.join(process.cwd(), "dist", "index.html"));
    await window.webContents.executeJavaScript(
      `document.querySelector(".primary-action").click()`,
    );
    await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const check = () => {
          const text = document.querySelector(".scan-state")?.textContent ?? "";
          if (text.includes("files loaded")) resolve(text);
          else if (Date.now() > deadline) {
            reject(new Error("Timed out waiting for the QA audit result."));
          } else setTimeout(check, 25);
        };
        check();
      })
    `);
    const quickInspect = await window.webContents.executeJavaScript(`
      (() => {
        const activeTab = document.querySelector(
          '.analysis-tabs button[aria-selected="true"]',
        );
        const panel = document.querySelector(".quick-inspect");
        const cards = [...document.querySelectorAll(".quick-grid article")];
        if (!activeTab?.textContent.toLowerCase().includes("quick inspect")) {
          throw new Error("Quick Inspect was not the default completed-file view.");
        }
        if (!panel || cards.length !== 4) {
          throw new Error("Quick Inspect did not render all four summary cards.");
        }
        const panelRect = panel.getBoundingClientRect();
        const overflow = cards.some((card) => {
          const rect = card.getBoundingClientRect();
          return (
            rect.left < panelRect.left - 1 ||
            rect.right > panelRect.right + 1 ||
            card.scrollWidth > card.clientWidth
          );
        });
        if (overflow) {
          throw new Error("Quick Inspect summary cards overflow their panel.");
        }
        return {
          activeTab: activeTab.textContent.trim(),
          cardCount: cards.length,
          headings: cards.map((card) =>
            card.querySelector(".eyebrow")?.textContent.trim(),
          ),
          verdict: panel.querySelector(".quick-verdict h2")?.textContent.trim(),
        };
      })()
    `);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const quickScreenshot = await window.webContents.capturePage();
    await writeFile(
      path.join(process.cwd(), "build", "layout-quick-inspect.png"),
      quickScreenshot.toPNG(),
    );
    await window.webContents.executeJavaScript(`
      [...document.querySelectorAll(".analysis-tabs button")]
        .find((button) => button.textContent.toLowerCase().includes("spectrogram"))
        ?.click()
    `);
    const results = [];
    for (const channelMode of channelModes) {
      results.push(await verifyChannelCanvas(window, channelMode));
    }
    const report = {
      schema: "Audio-V spectrogram channel rendering v1",
      measuredAt: new Date().toISOString(),
      quickInspect,
      results,
      passed: true,
    };
    await writeFile(
      path.join(process.cwd(), "build", "spectrogram-channel-validation-latest.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      `Spectrogram channel rendering passed for ${channelModes.join(", ")}.`,
    );
    window.destroy();
    await rm(temporaryDirectory, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    if (window && !window.isDestroyed()) window.destroy();
    await rm(temporaryDirectory, { recursive: true, force: true });
    console.error(error);
    app.exit(1);
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
