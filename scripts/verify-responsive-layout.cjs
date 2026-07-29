const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");

app.commandLine.appendSwitch("disable-gpu");
app.setPath(
  "userData",
  path.join(process.cwd(), "tmp", `electron-layout-${process.pid}`),
);

const scenarios = [
  { name: "wide", width: 1800, height: 980, stacked: false },
  { name: "default", width: 1540, height: 980, stacked: true },
  { name: "minimum", width: 1120, height: 720, stacked: true },
  { name: "snapped", width: 900, height: 720, stacked: true },
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
          documentWidth: document.documentElement.scrollWidth,
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
    const noPageOverflow =
      measurement.documentWidth <= measurement.viewport.width;
    const passed =
      singleLine && placementPassed && withinWorkspace && noPageOverflow;
    results.push({
      ...scenario,
      measurement,
      checks: {
        singleLine,
        placementPassed,
        withinWorkspace,
        noPageOverflow,
      },
      passed,
    });
    const screenshot = await window.webContents.capturePage();
    await writeFile(
      path.join(process.cwd(), "build", `layout-${scenario.name}.png`),
      screenshot.toPNG(),
    );
  }

  window.setContentSize(900, 720);
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
            const visible = getComputedStyle(element).display !== "none";
            return {
              left: value.left,
              right: value.right,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
              visible,
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
  const visibleTableHeadCells = warningLayout.tableHeadCells.filter(
    (cell) => cell.visible,
  );
  const tableColumnsSeparated = visibleTableHeadCells.every(
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

  const snappedAuditLayout = await window.webContents.executeJavaScript(`
    (() => {
      const host = document.createElement("div");
      host.className = "qa-snapped-audit";
      host.style.position = "fixed";
      host.style.inset = "18px";
      host.style.zIndex = "10000";
      host.style.display = "grid";
      host.style.gridTemplateRows = "122px 1fr";
      host.style.gap = "12px";
      host.style.background = "var(--background)";
      host.innerHTML = \`
        <section class="overview">
          <div class="verdict-ring"><div><strong>21</strong><span>Files</span></div></div>
          <div class="distribution">
            <span class="eyebrow">Verdict distribution</span>
            <div class="legend">
              <span><i class="clear"></i>Clear <b>15</b></span>
              <span><i class="review"></i>Review <b>6</b></span>
              <span><i class="failed"></i>Failed <b>0</b></span>
              <span><i class="pending"></i>Not analyzed <b>0</b></span>
            </div>
          </div>
          <div class="selected-summary">
            <span class="eyebrow">Selected file</span>
            <h1>01 - Bass Intro_There's Something Goin' On_Love (Live at Blue Note NYC).flac</h1>
            <div class="format-chips"><b>FLAC</b><span>96 kHz</span><span>24-bit</span><span>2 ch</span></div>
            <p>168.8 MB · 7:51</p>
            <small>/Volumes/Network Library/The Roots/A Very Long Album Folder/01 - Bass Intro.flac</small>
          </div>
        </section>
        <section class="analysis-card">
          <div class="analysis-tabs"><button class="active">Loudness</button></div>
          <div class="analysis-content">
            <div class="visualization">
              <div class="loudness-view measured">
                <article><span>Sample peak</span><strong>−0.00 dBFS</strong><p>Maximum decoded PCM sample.</p></article>
                <article><span>Overall RMS</span><strong>−10.81 dBFS</strong><p>Ungated RMS across all channels.</p></article>
                <article><span>Integrated loudness</span><strong>−9.1 LUFS</strong><p>EBU R128 programme loudness.</p></article>
              </div>
            </div>
            <aside class="metrics-panel">
              <span class="eyebrow">Declared profile</span>
              <p>Container and codec claims read from the selected file.</p>
              <div class="inspector-actions"><button>Re-run analysis</button></div>
              <dl>
                <div><dt>Codec</dt><dd>FLAC</dd></div>
                <div><dt>Container</dt><dd>FLAC</dd></div>
                <div><dt>Sample rate</dt><dd>96 kHz</dd></div>
                <div><dt>Bit depth</dt><dd>24-bit</dd></div>
              </dl>
            </aside>
          </div>
        </section>
      \`;
      document.body.append(host);
      const rect = (selector) => {
        const element = host.querySelector(selector);
        const value = element.getBoundingClientRect();
        return {
          left: value.left,
          right: value.right,
          top: value.top,
          bottom: value.bottom,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        };
      };
      return {
        host: {
          left: host.getBoundingClientRect().left,
          right: host.getBoundingClientRect().right,
        },
        overview: rect(".overview"),
        selected: rect(".selected-summary"),
        selectedTitle: rect(".selected-summary h1"),
        selectedPath: rect(".selected-summary > small"),
        analysis: rect(".analysis-card"),
        analysisContent: rect(".analysis-content"),
        visualization: rect(".visualization"),
        metrics: rect(".metrics-panel"),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
      };
    })()
  `);
  const snappedOverviewContained =
    snappedAuditLayout.overview.right <= snappedAuditLayout.host.right + 1 &&
    snappedAuditLayout.selected.right <= snappedAuditLayout.overview.right + 1 &&
    snappedAuditLayout.selectedTitle.right <= snappedAuditLayout.selected.right + 1 &&
    snappedAuditLayout.selectedPath.right <= snappedAuditLayout.selected.right + 1;
  const snappedInspectorContained =
    snappedAuditLayout.analysisContent.right <= snappedAuditLayout.analysis.right + 1 &&
    snappedAuditLayout.visualization.right <= snappedAuditLayout.metrics.left + 1 &&
    snappedAuditLayout.metrics.right <= snappedAuditLayout.analysis.right + 1;
  const snappedNoPageOverflow =
    snappedAuditLayout.documentWidth <= snappedAuditLayout.viewportWidth;
  results.push({
    name: "snapped-audit-content",
    measurement: snappedAuditLayout,
    checks: {
      snappedOverviewContained,
      snappedInspectorContained,
      snappedNoPageOverflow,
    },
    passed:
      snappedOverviewContained &&
      snappedInspectorContained &&
      snappedNoPageOverflow,
  });
  const snappedScreenshot = await window.webContents.capturePage();
  await writeFile(
    path.join(process.cwd(), "build", "layout-snapped-audit.png"),
    snappedScreenshot.toPNG(),
  );
  await window.webContents.executeJavaScript(
    `document.querySelector(".qa-snapped-audit")?.remove()`,
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

  const measureStorageMaintenance = async (width, height) => {
    window.setContentSize(width, height);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return window.webContents.executeJavaScript(`
      (async () => {
        const card = document.querySelector(".storage-maintenance");
        card.scrollIntoView({ block: "center" });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const rect = (element) => {
          const value = element.getBoundingClientRect();
          return {
            left: value.left,
            right: value.right,
            top: value.top,
            bottom: value.bottom,
            width: value.width,
            height: value.height,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
          };
        };
        return {
          viewportWidth: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          card: rect(card),
          copy: rect(card.querySelector(".storage-maintenance-copy")),
          console: rect(card.querySelector(".storage-maintenance-console")),
          button: rect(card.querySelector(".storage-maintenance-action button")),
          metrics: [...card.querySelectorAll(".storage-metrics > div")].map(rect),
        };
      })()
    `);
  };

  const storageWide = await measureStorageMaintenance(1800, 980);
  const storageWidePassed =
    storageWide.copy.right <= storageWide.console.left &&
    storageWide.button.left >= storageWide.console.left &&
    storageWide.button.right <= storageWide.console.right &&
    storageWide.button.width >= 210 &&
    storageWide.metrics.length === 2 &&
    storageWide.metrics.every(
      (metric) =>
        metric.scrollWidth <= metric.clientWidth &&
        metric.scrollHeight <= metric.clientHeight,
    ) &&
    storageWide.card.scrollWidth <= storageWide.card.clientWidth &&
    storageWide.documentWidth <= storageWide.viewportWidth;
  results.push({
    name: "storage-maintenance-wide",
    measurement: storageWide,
    checks: { storageWidePassed },
    passed: storageWidePassed,
  });
  const storageWideScreenshot = await window.webContents.capturePage();
  await writeFile(
    path.join(process.cwd(), "build", "layout-storage-maintenance.png"),
    storageWideScreenshot.toPNG(),
  );

  const storageSnapped = await measureStorageMaintenance(900, 720);
  const storageSnappedPassed =
    storageSnapped.copy.bottom <= storageSnapped.console.top &&
    storageSnapped.button.left >= storageSnapped.console.left &&
    storageSnapped.button.right <= storageSnapped.console.right &&
    storageSnapped.card.scrollWidth <= storageSnapped.card.clientWidth &&
    storageSnapped.documentWidth <= storageSnapped.viewportWidth;
  results.push({
    name: "storage-maintenance-snapped",
    measurement: storageSnapped,
    checks: { storageSnappedPassed },
    passed: storageSnappedPassed,
  });
  const storageSnappedScreenshot = await window.webContents.capturePage();
  await writeFile(
    path.join(process.cwd(), "build", "layout-storage-maintenance-snapped.png"),
    storageSnappedScreenshot.toPNG(),
  );

  window.setContentSize(scenarios[0].width, scenarios[0].height);
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

  window.setContentSize(1600, 900);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const reportPaneLayout = await window.webContents.executeJavaScript(`
    (() => {
      const host = document.createElement("section");
      host.className = "module-page reports-page";
      host.style.position = "fixed";
      host.style.inset = "20px";
      host.style.zIndex = "10000";
      host.style.background = "var(--raised)";
      host.innerHTML = \`
        <header class="module-header"><div><span class="eyebrow">Current audit report</span><h1>Audit evidence and file details</h1></div></header>
        <div class="report-summary">
          <article><span>Total files</span><strong>6000</strong></article>
          <article><span>Clear</span><strong>5200</strong></article>
          <article><span>Review</span><strong>790</strong></article>
          <article><span>Failed</span><strong>10</strong></article>
        </div>
        <div class="reports-workspace">
          <div class="report-table" aria-label="Files in current audit report"></div>
          <article class="report-detail">
            <header><div><span class="eyebrow">Per-file evidence report</span><h2>Selected deep-list file.flac</h2><p>/Volumes/Music/Selected deep-list file.flac</p></div></header>
            <section class="report-interpretation"><strong>Review signal findings</strong><p>Measured evidence remains visible beside the selected list item.</p></section>
            <div class="report-detail-grid"><section></section><section></section></div>
            <section class="report-origin"></section>
            <section class="report-evidence"></section>
          </article>
        </div>
      \`;
      const table = host.querySelector(".report-table");
      for (let index = 0; index < 80; index += 1) {
        const row = document.createElement("button");
        row.innerHTML = \`<strong>Track \${index + 1}.flac</strong><span>FLAC · 44.1 kHz</span><b>Review</b><small>Review signal findings</small>\`;
        table.append(row);
      }
      const detail = host.querySelector(".report-detail");
      detail.querySelector(".report-detail-grid > section").style.height = "500px";
      detail.querySelector(".report-origin").style.height = "400px";
      detail.querySelector(".report-evidence").style.height = "400px";
      document.body.append(host);
      const rectangle = (element) => {
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
      const before = rectangle(detail);
      table.scrollTop = 1800;
      const after = rectangle(detail);
      const result = {
        host: rectangle(host),
        workspace: rectangle(host.querySelector(".reports-workspace")),
        table: rectangle(table),
        detail: after,
        detailHeader: rectangle(detail.querySelector(":scope > header")),
        tableScrollTop: table.scrollTop,
        tableScrollable: table.scrollHeight > table.clientHeight,
        detailScrollable: detail.scrollHeight > detail.clientHeight,
        detailStable:
          Math.abs(before.top - after.top) <= 1 &&
          Math.abs(before.bottom - after.bottom) <= 1,
      };
      return result;
    })()
  `);
  const reportColumnsSeparated =
    reportPaneLayout.table.right < reportPaneLayout.detail.left;
  const reportDetailVisible =
    reportPaneLayout.detail.top >= reportPaneLayout.workspace.top &&
    reportPaneLayout.detail.bottom <= reportPaneLayout.workspace.bottom + tolerance &&
    reportPaneLayout.detailHeader.top >= reportPaneLayout.detail.top &&
    reportPaneLayout.detailHeader.bottom <= reportPaneLayout.detail.bottom;
  const reportPanesIndependent =
    reportPaneLayout.tableScrollable &&
    reportPaneLayout.detailScrollable &&
    reportPaneLayout.tableScrollTop > 0 &&
    reportPaneLayout.detailStable;
  results.push({
    name: "independent-report-evidence-panes",
    measurement: reportPaneLayout,
    checks: {
      reportColumnsSeparated,
      reportDetailVisible,
      reportPanesIndependent,
    },
    passed:
      reportColumnsSeparated && reportDetailVisible && reportPanesIndependent,
  });

  window.setContentSize(1100, 800);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const stackedReportPaneLayout = await window.webContents.executeJavaScript(`
    (() => {
      const host = document.querySelector(".reports-page");
      const table = host.querySelector(".report-table");
      const detail = host.querySelector(".report-detail");
      const rectangle = (element) => {
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
      const result = {
        workspace: rectangle(host.querySelector(".reports-workspace")),
        table: rectangle(table),
        detail: rectangle(detail),
        tableScrollable: table.scrollHeight > table.clientHeight,
        detailScrollable: detail.scrollHeight > detail.clientHeight,
      };
      host.remove();
      return result;
    })()
  `);
  const reportRowsSeparated =
    stackedReportPaneLayout.table.bottom <
    stackedReportPaneLayout.detail.top;
  const stackedReportPanesVisible =
    stackedReportPaneLayout.table.top >=
      stackedReportPaneLayout.workspace.top &&
    stackedReportPaneLayout.detail.bottom <=
      stackedReportPaneLayout.workspace.bottom + tolerance;
  const stackedReportPanesIndependent =
    stackedReportPaneLayout.tableScrollable &&
    stackedReportPaneLayout.detailScrollable;
  results.push({
    name: "stacked-report-evidence-panes",
    measurement: stackedReportPaneLayout,
    checks: {
      reportRowsSeparated,
      stackedReportPanesVisible,
      stackedReportPanesIndependent,
    },
    passed:
      reportRowsSeparated &&
      stackedReportPanesVisible &&
      stackedReportPanesIndependent,
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
      "Responsive layout passed at default and minimum desktop sizes, including storage-maintenance composition, open source warnings, table gutters, active assessment separation, adaptive resource controls, dense inspector text, selected paths, scan progress, independent report evidence panes, and the loudness diagnostics grid.",
    );
  }
  window.destroy();
  app.exit(failed.length ? 1 : 0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
