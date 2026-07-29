const { app, BrowserWindow } = require("electron");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");

app.commandLine.appendSwitch("disable-gpu");
app.setPath(
  "userData",
  path.join(process.cwd(), "tmp", `electron-comparison-${process.pid}`),
);
app.on("window-all-closed", () => {
  // The verifier owns shutdown after its report has been written.
});

function canvasEvidenceScript() {
  return `
    (() => {
      const inspectCanvas = (selector) => {
        const canvas = document.querySelector(selector);
        if (!canvas?.width || !canvas?.height) return null;
        const pixels = canvas
          .getContext("2d")
          ?.getImageData(0, 0, canvas.width, canvas.height).data;
        if (!pixels) return null;
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
        return {
          width: canvas.width,
          height: canvas.height,
          paintedPixels,
          maximumChannel,
        };
      };
      const waveformPaths = [
        ...document.querySelectorAll(".waveform-stack article svg path"),
      ].map((candidate) => candidate.getAttribute("d") ?? "");
      return {
        placeholders: [
          ...document.querySelectorAll(".comparison-visual-placeholder"),
        ].map((candidate) => candidate.textContent.trim()),
        waveformPaths,
        fileA: inspectCanvas(".spectrum-compare-grid article:nth-child(1) canvas"),
        fileB: inspectCanvas(".spectrum-compare-grid article:nth-child(2) canvas"),
        difference: inspectCanvas(".difference-spectrum canvas"),
        residual: inspectCanvas(".residual-spectrum canvas"),
      };
    })()
  `;
}

app.whenReady().then(async () => {
  const keepAlive = setInterval(() => undefined, 1_000);
  const temporaryDirectory = await mkdtemp(
    path.join(process.cwd(), "tests", ".tmp-comparison-visuals-"),
  );
  let window;
  try {
    const leftPath = path.join(temporaryDirectory, "comparison-a.flac");
    const rightPath = path.join(temporaryDirectory, "comparison-b.flac");
    const { runEngine } = require(
      "../dist-electron/electron/oracle/ffmpeg-runtime.js",
    );
    await runEngine("ffmpeg", [
      "-nostdin", "-hide_banner", "-v", "error",
      "-f", "lavfi", "-i",
      "sine=frequency=440:sample_rate=48000:duration=2",
      "-ac", "2", "-c:a", "flac", "-y", leftPath,
    ]);
    await runEngine("ffmpeg", [
      "-nostdin", "-hide_banner", "-v", "error",
      "-f", "lavfi", "-i",
      "sine=frequency=880:sample_rate=48000:duration=2",
      "-ac", "2", "-c:a", "flac", "-y", rightPath,
    ]);
    const { scanSources } = require("../dist-electron/electron/scanner.js");
    const { compareAudioFiles } = require(
      "../dist-electron/electron/oracle/signal-comparison.js",
    );
    const { compactAudioFileRecord } = require(
      "../dist-electron/shared/compact-audio-record.js",
    );
    const source = {
      kind: "files",
      paths: [leftPath, rightPath],
      label: "Compacted comparison visual verification",
      mode: "full-audit",
    };
    const fullResult = await scanSources(source);
    const comparison = await compareAudioFiles(leftPath, rightPath);
    const compactResult = {
      ...fullResult,
      files: fullResult.files.map(compactAudioFileRecord),
      sessionId: "00000000-0000-4000-8000-000000000001",
    };
    const payloadPath = path.join(temporaryDirectory, "qa-payload.json");
    await writeFile(
      payloadPath,
      JSON.stringify({
        source,
        result: compactResult,
        comparison,
        comparisonFiles: fullResult.files,
      }),
    );
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
    window.webContents.on("render-process-gone", (_event, details) => {
      console.error(`Comparison verifier renderer exited: ${details.reason}.`);
    });
    window.webContents.on("did-fail-load", (_event, code, description) => {
      console.error(
        `Comparison verifier page failed to load (${code}): ${description}.`,
      );
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
            reject(
              new Error(
                "Timed out waiting for compact comparison audit. Scan state: " +
                  text +
                  "; status: " +
                  (document.querySelector(".statusbar")?.textContent ?? ""),
              ),
            );
          } else setTimeout(check, 25);
        };
        check();
      })
    `);
    await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const openCompare = () => {
          const button = [...document.querySelectorAll(".side-rail button")]
            .find((candidate) =>
              candidate.textContent.toLowerCase().includes("compare")
            );
          if (!button) {
            reject(new Error("Compare navigation button was not found."));
            return;
          }
          button.click();
          setTimeout(() => {
            const heading = document.querySelector(".module-page .module-header h1")
              ?.textContent?.trim() ?? "";
            if (heading === "Signal and format comparison") resolve(heading);
            else if (Date.now() > deadline) {
              reject(new Error(
                "Compare workspace did not remain active. Current heading: " +
                  heading
              ));
            } else setTimeout(openCompare, 40);
          }, 40);
        };
        openCompare();
      })
    `);
    const evidence = await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const check = () => {
          const evidence = ${canvasEvidenceScript()};
          evidence.heading =
            document.querySelector(".module-page .module-header h1")
              ?.textContent?.trim() ?? "";
          const canvases = [
            evidence.fileA,
            evidence.fileB,
            evidence.difference,
            evidence.residual,
          ];
          const painted = canvases.every(
            (canvas) =>
              canvas &&
              canvas.width > 1 &&
              canvas.height > 1 &&
              canvas.paintedPixels === canvas.width * canvas.height &&
              canvas.maximumChannel > 20,
          );
          const waveforms =
            evidence.waveformPaths.length === 2 &&
            evidence.waveformPaths.every((path) => path.length > 20);
          if (
            evidence.heading === "Signal and format comparison" &&
            evidence.placeholders.length === 0 &&
            painted &&
            waveforms
          ) {
            resolve(evidence);
          } else if (Date.now() > deadline) {
            reject(
              new Error(
                "Compacted comparison records did not hydrate and paint every visual panel: " +
                  JSON.stringify(evidence),
              ),
            );
          } else setTimeout(check, 40);
        };
        check();
      })
    `);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const finalHeading = await window.webContents.executeJavaScript(
      `document.querySelector(".module-page .module-header h1")?.textContent?.trim() ?? ""`,
    );
    if (finalHeading !== "Signal and format comparison") {
      throw new Error(
        `Compare workspace changed before capture. Current heading: ${finalHeading}`,
      );
    }
    await window.webContents.executeJavaScript(
      `document.querySelector(".comparison-visuals")?.scrollIntoView({ block: "start" })`,
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    const screenshot = await window.webContents.capturePage();
    await writeFile(
      path.join(process.cwd(), "build", "comparison-visuals-latest.png"),
      screenshot.toPNG(),
    );
    await writeFile(
      path.join(process.cwd(), "build", "comparison-visuals-latest.json"),
      `${JSON.stringify(
        {
          schema: "Audio-V compact comparison visual verification v1",
          measuredAt: new Date().toISOString(),
          sourceRecordsWereCompacted: true,
          evidence,
          passed: true,
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      "Comparison visual hydration passed for two compacted audit records.",
    );
    window.destroy();
    await rm(temporaryDirectory, { recursive: true, force: true });
    clearInterval(keepAlive);
    app.exit(0);
  } catch (error) {
    if (window && !window.isDestroyed()) window.destroy();
    await rm(temporaryDirectory, { recursive: true, force: true });
    clearInterval(keepAlive);
    console.error(error);
    app.exit(1);
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
