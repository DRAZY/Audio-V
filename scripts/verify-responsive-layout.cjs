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
      "Responsive layout passed at default and minimum supported desktop sizes.",
    );
  }
  window.destroy();
  app.exit(failed.length ? 1 : 0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
