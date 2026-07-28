const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");

app.commandLine.appendSwitch("disable-gpu");
app.setPath(
  "userData",
  path.join(process.cwd(), "tmp", `electron-layout-${process.pid}`),
);

const scenarios = [
  { name: "default", width: 1540, height: 980, stacked: false },
  { name: "minimum", width: 1120, height: 720, stacked: true },
];

function overlaps(first, second) {
  return !(
    first.right <= second.left ||
    second.right <= first.left ||
    first.bottom <= second.top ||
    second.bottom <= first.top
  );
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: scenarios[0].width,
    height: scenarios[0].height,
    useContentSize: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadFile(path.join(process.cwd(), "dist", "index.html"));
  const results = [];
  await mkdir(path.join(process.cwd(), "build"), { recursive: true });

  for (const scenario of scenarios) {
    window.setContentSize(scenario.width, scenario.height);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const measurement = await window.webContents.executeJavaScript(`
      (() => {
        const rectangle = (selector) => {
          const element = document.querySelector(selector);
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            lineHeight: Number.parseFloat(style.lineHeight),
            whiteSpace: style.whiteSpace,
            clientWidth: element.clientWidth,
            clientHeight: element.clientHeight,
            scrollWidth: element.scrollWidth,
            scrollHeight: element.scrollHeight,
          };
        };
        return {
          viewport: { width: innerWidth, height: innerHeight },
          workspace: rectangle(".workspace"),
          lockup: rectangle(".product-lockup"),
          product: rectangle(".product-lockup strong"),
          badge: rectangle(".product-lockup span"),
          tagline: rectangle(".product-lockup > small"),
          commands: rectangle(".source-command"),
        };
      })()
    `);
    const singleLine = ["product", "badge", "tagline"].every((key) => {
      const element = measurement[key];
      return (
        element.whiteSpace === "nowrap" &&
        element.scrollWidth <= element.clientWidth &&
        element.scrollHeight <= element.clientHeight
      );
    });
    const placementPassed = scenario.stacked
      ? measurement.commands.top >= measurement.lockup.bottom
      : !overlaps(measurement.lockup, measurement.commands);
    const withinWorkspace =
      measurement.lockup.left >= measurement.workspace.left &&
      measurement.commands.right <= measurement.workspace.right + 1;
    const passed = singleLine && placementPassed && withinWorkspace;
    results.push({
      ...scenario,
      measurement,
      checks: { singleLine, placementPassed, withinWorkspace },
      passed,
    });
    const screenshot = await window.webContents.capturePage();
    await writeFile(
      path.join(process.cwd(), "build", `layout-${scenario.name}.png`),
      screenshot.toPNG(),
    );
  }

  window.setContentSize(1120, 720);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const warningLayout = await window.webContents.executeJavaScript(`
    (() => {
      const host = document.createElement("div");
      host.className = "qa-active-warning";
      host.style.position = "fixed";
      host.style.inset = "18px";
      host.style.zIndex = "10000";
      host.style.padding = "18px";
      host.style.display = "grid";
      host.style.gridTemplateRows = "330px 260px";
      host.style.gap = "12px";
      host.style.background = "var(--background)";

      const results = document.createElement("section");
      results.className = "results-card";
      results.innerHTML = \`
        <div class="filters">
          <span class="eyebrow">Audit results</span>
          <button class="active">All 32</button>
          <button>Review 4</button>
          <span class="scan-state">18 of 32 fully analyzed · long network-track-name.flac</span>
        </div>
        <details class="source-warnings" open>
          <summary>2 source access warnings</summary>
          <ul>
            <li>\\\\\\\\studio-nas\\\\music\\\\archive: one folder could not be read because access was denied.</li>
            <li>USB-C Library: one disconnected album was skipped while the remaining source continued.</li>
          </ul>
          <p>Confirm the volume is connected, then re-select the folder so the operating system can grant access.</p>
        </details>
        <div class="table-grid table-head">
          <span>File name</span><span>Format</span><span>Sample rate</span>
          <span>Bit depth</span><span>Duration</span><span>Bitrate</span>
          <span>Channels</span><span>Verdict</span>
        </div>
        <div class="table-body">
          <button class="file-row table-grid selected">
            <span>long network-track-name.flac</span><span>FLAC</span><span>96 kHz</span>
            <span>24-bit</span><span>5:18</span><span>2.8 Mbps</span><span>2 ch</span>
            <span class="row-verdict review"><i></i>Review</span>
          </button>
        </div>
      \`;
      const assessment = document.createElement("section");
      assessment.className = "analysis-card";
      assessment.innerHTML = \`
        <div class="analysis-tabs"><button>Oracle evidence</button></div>
        <div class="evidence-view"><article><span>Assessment</span><strong>Review signal findings</strong><p>The active track assessment remains entirely below the warning and results table.</p></article></div>
      \`;
      host.append(results, assessment);
      document.body.append(host);
      const rect = (selector) => {
        const value = host.querySelector(selector).getBoundingClientRect();
        return {
          left: value.left, right: value.right, top: value.top,
          bottom: value.bottom, width: value.width, height: value.height,
        };
      };
      return {
        results: rect(".results-card"),
        filters: rect(".filters"),
        warnings: rect(".source-warnings"),
        tableHead: rect(".table-head"),
        tableHeadCells: [...host.querySelectorAll(".table-head > span")].map(
          (element) => {
            const value = element.getBoundingClientRect();
            return {
              left: value.left,
              right: value.right,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
            };
          },
        ),
        tableBody: rect(".table-body"),
        assessment: rect(".analysis-card"),
      };
    })()
  `);
  const warningRowsSeparated =
    warningLayout.filters.bottom <= warningLayout.warnings.top + 1 &&
    warningLayout.warnings.bottom <= warningLayout.tableHead.top + 1 &&
    warningLayout.tableHead.bottom <= warningLayout.tableBody.top + 1;
  const warningCardContained =
    warningLayout.tableBody.bottom <= warningLayout.results.bottom + 1;
  const assessmentSeparated =
    warningLayout.results.bottom <= warningLayout.assessment.top + 1;
  const tableColumnsSeparated = warningLayout.tableHeadCells.every(
    (cell, index, cells) =>
      cell.scrollWidth <= cell.clientWidth &&
      (index === 0 || cell.left - cells[index - 1].right >= 8),
  );
  results.push({
    name: "active-audit-source-warning",
    measurement: warningLayout,
    checks: {
      warningRowsSeparated,
      warningCardContained,
      assessmentSeparated,
      tableColumnsSeparated,
    },
    passed:
      warningRowsSeparated &&
      warningCardContained &&
      assessmentSeparated &&
      tableColumnsSeparated,
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const warningScreenshot = await window.webContents.capturePage();
  await writeFile(
    path.join(process.cwd(), "build", "layout-active-warning.png"),
    warningScreenshot.toPNG(),
  );
  await window.webContents.executeJavaScript(
    `document.querySelector(".qa-active-warning")?.remove()`,
  );

  window.setContentSize(scenarios[0].width, scenarios[0].height);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const resourceControlsLayout = await window.webContents.executeJavaScript(`
    (async () => {
      [...document.querySelectorAll(".rail-item")].find(
        (button) => button.textContent.toLowerCase().includes("settings")
      )?.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const card = document.querySelector(".capability-grid .resource-controls");
      const rect = card.getBoundingClientRect();
      const presets = [...card.querySelectorAll(".resource-presets button")].map(
        (button) => ({
          clientWidth: button.clientWidth,
          scrollWidth: button.scrollWidth,
          height: button.getBoundingClientRect().height,
        }),
      );
      const notes = [...card.querySelectorAll(".resource-budget-note")].map(
        (note) => ({
          clientWidth: note.clientWidth,
          scrollWidth: note.scrollWidth,
          clientHeight: note.clientHeight,
          scrollHeight: note.scrollHeight,
        }),
      );
      return {
        card: {
          width: rect.width,
          height: rect.height,
          clientHeight: card.clientHeight,
          scrollHeight: card.scrollHeight,
        },
        presets,
        notes,
      };
    })()
  `);
  const resourceControlsPassed =
    resourceControlsLayout.card.scrollHeight <=
      resourceControlsLayout.card.clientHeight &&
    resourceControlsLayout.presets.length === 3 &&
    resourceControlsLayout.presets.every(
      (button) =>
        button.scrollWidth <= button.clientWidth && button.height >= 34,
    ) &&
    resourceControlsLayout.notes.every(
      (note) =>
        note.scrollWidth <= note.clientWidth &&
        note.scrollHeight <= note.clientHeight,
    );
  results.push({
    name: "adaptive-resource-controls",
    measurement: resourceControlsLayout,
    checks: { resourceControlsPassed },
    passed: resourceControlsPassed,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const settingsScreenshot = await window.webContents.capturePage();
  await writeFile(
    path.join(process.cwd(), "build", "layout-settings.png"),
    settingsScreenshot.toPNG(),
  );
  await window.webContents.executeJavaScript(`
    [...document.querySelectorAll(".rail-item")].find(
      (button) => button.textContent.toLowerCase().includes("audit")
    )?.click()
  `);
  await new Promise((resolve) => setTimeout(resolve, 80));

  const loudnessGrid = await window.webContents.executeJavaScript(`
    (() => {
      const grid = document.createElement("div");
      grid.className = "loudness-view measured";
      grid.style.width = "900px";
      grid.style.position = "fixed";
      grid.style.inset = "0 auto auto -2000px";
      for (let index = 0; index < 9; index += 1) {
        grid.append(document.createElement("article"));
      }
      for (let index = 0; index < 2; index += 1) {
        const diagnostic = document.createElement("article");
        diagnostic.className = "clipping-diagnostics";
        grid.append(diagnostic);
      }
      for (let index = 0; index < 2; index += 1) {
        const stereo = document.createElement("article");
        stereo.className = "stereo-diagnostic";
        grid.append(stereo);
      }
      document.body.append(grid);
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return {
          left: value.left,
          right: value.right,
          top: value.top,
          width: value.width,
        };
      };
      const articles = [...grid.querySelectorAll("article")].map(rect);
      const result = {
        grid: rect(grid),
        standard: articles.slice(0, 9),
        diagnostics: articles.slice(9, 11),
        stereo: articles.slice(11, 13),
      };
      grid.remove();
      return result;
    })()
  `);
  const tolerance = 1;
  const threeEqualColumns =
    Math.abs(loudnessGrid.standard[0].width - loudnessGrid.standard[1].width) <= tolerance &&
    Math.abs(loudnessGrid.standard[1].width - loudnessGrid.standard[2].width) <= tolerance &&
    Math.abs(loudnessGrid.standard[0].top - loudnessGrid.standard[2].top) <= tolerance;
  const diagnosticsFillRows = loudnessGrid.diagnostics.every(
    (card) =>
      Math.abs(card.left - loudnessGrid.grid.left) <= tolerance &&
      Math.abs(card.right - loudnessGrid.grid.right) <= tolerance,
  );
  const stereoFillsBalancedRow =
    Math.abs(loudnessGrid.stereo[0].width - loudnessGrid.stereo[1].width) <= tolerance &&
    Math.abs(loudnessGrid.stereo[0].top - loudnessGrid.stereo[1].top) <= tolerance &&
    Math.abs(loudnessGrid.stereo[0].left - loudnessGrid.grid.left) <= tolerance &&
    Math.abs(loudnessGrid.stereo[1].right - loudnessGrid.grid.right) <= tolerance;
  const loudnessPassed =
    threeEqualColumns && diagnosticsFillRows && stereoFillsBalancedRow;
  results.push({
    name: "loudness-grid",
    measurement: loudnessGrid,
    checks: {
      threeEqualColumns,
      diagnosticsFillRows,
      stereoFillsBalancedRow,
    },
    passed: loudnessPassed,
  });

  const denseTextLayout = await window.webContents.executeJavaScript(`
    (() => {
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return {
          left: value.left,
          right: value.right,
          top: value.top,
          bottom: value.bottom,
          width: value.width,
          height: value.height,
        };
      };
      const host = document.createElement("div");
      host.style.position = "fixed";
      host.style.inset = "0 auto auto -3000px";

      const summary = document.createElement("section");
      summary.className = "selected-summary";
      summary.style.width = "720px";
      summary.style.height = "132px";
      summary.innerHTML = \`
        <span class="eyebrow">Selected file</span>
        <h1>001 - The Notorious B.I.G. - Hypnotize (2014 Remaster).flac</h1>
        <div class="format-chips"><b>FLAC</b><span>44.1 kHz</span><span>16-bit</span><span>2 ch</span></div>
        <p>36.6 MB · 3:59</p>
        <small>E:\\\\deemix Music\\\\The Notorious B.I.G\\\\001 - Hypnotize.flac</small>
      \`;

      const metrics = document.createElement("aside");
      metrics.className = "metrics-panel";
      metrics.style.width = "280px";
      metrics.style.height = "560px";
      metrics.innerHTML = \`
        <dl>
          <div><dt>Codec</dt><dd>FLAC (Free Lossless Audio Codec)</dd></div>
          <div><dt>Packet bitrate p05 / p95</dt><dd>790 kbps / 1140 kbps</dd></div>
          <div><dt>Origin assessment</dt><dd>No strong spectral anomaly</dd></div>
        </dl>
        <section class="origin-assessment-card">
          <dl>
            <div><dt>ReplayGain</dt><dd>Not declared</dd></div>
            <div><dt>Cue awareness</dt><dd>No cue sheet found</dd></div>
          </dl>
        </section>
      \`;

      const distribution = document.createElement("section");
      distribution.className = "distribution";
      distribution.style.width = "440px";
      distribution.style.height = "132px";
      distribution.innerHTML = \`
        <span class="eyebrow">Verdict distribution</span>
        <div class="legend">
          <span><i class="clear"></i>Clear <b>2</b></span>
          <span><i class="review"></i>Review <b>1</b></span>
          <span><i class="failed"></i>Failed <b>0</b></span>
          <span><i class="pending"></i>Not analyzed <b>0</b></span>
          <span><i class="error"></i>Analysis error <b>0</b></span>
        </div>
        <div class="scan-progress">
          <div><strong>Analyzing · 2 of 12 complete</strong><b>17%</b></div>
          <span><i style="width:17%"></i></span>
          <small>001 - The Notorious B.I.G. - Hypnotize (2014 Remaster).flac</small>
        </div>
      \`;

      host.append(summary, metrics, distribution);
      document.body.append(host);
      const summaryPath = summary.querySelector("small");
      const metricRows = [...metrics.querySelectorAll("dl > div")].map((row) => ({
        row: rect(row),
        term: rect(row.querySelector("dt")),
        value: rect(row.querySelector("dd")),
        valueFits: row.querySelector("dd").scrollWidth <= row.querySelector("dd").clientWidth,
      }));
      const result = {
        summary: rect(summary),
        summaryPath: rect(summaryPath),
        summaryFits: summary.scrollHeight <= summary.clientHeight,
        metricRows,
        distribution: rect(distribution),
        distributionFits: distribution.scrollHeight <= distribution.clientHeight,
        progress: rect(distribution.querySelector(".scan-progress")),
      };
      host.remove();
      return result;
    })()
  `);
  const summaryPathVisible =
    denseTextLayout.summaryFits &&
    denseTextLayout.summaryPath.height > 0 &&
    denseTextLayout.summaryPath.bottom <= denseTextLayout.summary.bottom + tolerance;
  const inspectorRowsSeparated = denseTextLayout.metricRows.every(
    ({ term, value, valueFits }) =>
      term.right + tolerance < value.left && valueFits,
  );
  const scanProgressContained =
    denseTextLayout.distributionFits &&
    denseTextLayout.progress.bottom <= denseTextLayout.distribution.bottom + tolerance;
  results.push({
    name: "dense-text-and-progress",
    measurement: denseTextLayout,
    checks: {
      summaryPathVisible,
      inspectorRowsSeparated,
      scanProgressContained,
    },
    passed:
      summaryPathVisible && inspectorRowsSeparated && scanProgressContained,
  });

  const failed = results.filter((result) => !result.passed);
  await writeFile(
    path.join(process.cwd(), "build", "responsive-layout-latest.json"),
    `${JSON.stringify(
      {
        schema: "Audio-V responsive layout audit v1",
        measuredAt: new Date().toISOString(),
        scenarios: results,
        passed: failed.length === 0,
      },
      null,
      2,
    )}\n`,
  );
  if (failed.length) {
    console.error(
      `Responsive layout failed: ${failed.map((result) => result.name).join(", ")}.`,
    );
  } else {
    console.log(
      "Responsive layout passed at default and minimum desktop sizes, including open source warnings, table gutters, active assessment separation, adaptive resource controls, dense inspector text, selected paths, scan progress, and the loudness diagnostics grid.",
    );
  }
  window.destroy();
  app.exit(failed.length ? 1 : 0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
