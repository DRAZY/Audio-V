const { app, BrowserWindow } = require("electron");
const { readFile, mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");

app.commandLine.appendSwitch("disable-gpu");
app.setPath(
  "userData",
  path.join(process.cwd(), "tmp", `electron-accessibility-${process.pid}`),
);

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1540,
    height: 980,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadFile(path.join(process.cwd(), "dist", "index.html"));
  const axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
  await window.webContents.executeJavaScript(axeSource);
  const results = await window.webContents.executeJavaScript(`
    axe.run(document, {
      resultTypes: ["violations", "passes", "incomplete"],
      rules: {
        "color-contrast": { enabled: true }
      }
    })
  `);
  const blocking = results.violations.filter((violation) =>
    ["critical", "serious"].includes(violation.impact),
  );
  const report = {
    schema: "Audio-V accessibility audit v1",
    measuredAt: new Date().toISOString(),
    viewport: { width: 1540, height: 980 },
    blockingViolationCount: blocking.length,
    violationCount: results.violations.length,
    passCount: results.passes.length,
    incompleteCount: results.incomplete.length,
    violations: results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
    passed: blocking.length === 0,
  };
  await mkdir(path.join(process.cwd(), "build"), { recursive: true });
  await writeFile(
    path.join(process.cwd(), "build", "accessibility-latest.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (blocking.length) {
    console.error(
      `${blocking.length} serious or critical accessibility violation(s) found.`,
    );
  } else {
    console.log(
      `Accessibility audit passed: ${results.passes.length} rules passed; no serious or critical violations.`,
    );
  }
  window.destroy();
  app.exit(blocking.length ? 1 : 0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
