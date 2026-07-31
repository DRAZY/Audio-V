const { app, BrowserWindow } = require("electron");
const { readFile, mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");

const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
]);

function accessibilityTreeSummary(nodes) {
  const exposed = nodes.filter((node) => !node.ignored);
  const roleCounts = {};
  for (const node of exposed) {
    const role = node.role?.value ?? "unknown";
    roleCounts[role] = (roleCounts[role] ?? 0) + 1;
  }
  const unnamedInteractiveNodes = exposed
    .filter((node) => INTERACTIVE_ROLES.has(node.role?.value))
    .filter((node) => !String(node.name?.value ?? "").trim())
    .map((node) => ({
      role: node.role.value,
      backendDOMNodeId: node.backendDOMNodeId ?? null,
    }));
  return {
    exposedNodeCount: exposed.length,
    roleCounts,
    unnamedInteractiveNodes,
    hasApplicationLandmark: exposed.some((node) =>
      ["main", "application"].includes(node.role?.value),
    ),
    hasHeading: exposed.some((node) => node.role?.value === "heading"),
  };
}

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
  window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Accessibility.enable");
  const { nodes } = await window.webContents.debugger.sendCommand(
    "Accessibility.getFullAXTree",
  );
  const accessibilityTree = accessibilityTreeSummary(nodes);
  const semanticFailures = [];
  if (accessibilityTree.unnamedInteractiveNodes.length) {
    semanticFailures.push("Every exposed interactive control must have an accessible name.");
  }
  if (!accessibilityTree.hasApplicationLandmark) {
    semanticFailures.push("The workspace must expose a main or application landmark.");
  }
  if (!accessibilityTree.hasHeading) {
    semanticFailures.push("The workspace must expose at least one heading.");
  }
  const report = {
    schema: "Audio-V accessibility audit v2",
    measuredAt: new Date().toISOString(),
    viewport: { width: 1540, height: 980 },
    blockingViolationCount: blocking.length,
    violationCount: results.violations.length,
    passCount: results.passes.length,
    incompleteCount: results.incomplete.length,
    accessibilityTree,
    semanticFailures,
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
    passed: blocking.length === 0 && semanticFailures.length === 0,
  };
  await mkdir(path.join(process.cwd(), "build"), { recursive: true });
  await writeFile(
    path.join(process.cwd(), "build", "accessibility-latest.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (blocking.length || semanticFailures.length) {
    console.error(
      `${blocking.length} serious/critical DOM violation(s) and ${semanticFailures.length} accessibility-tree failure(s) found.`,
    );
  } else {
    console.log(
      `Accessibility audit passed: ${results.passes.length} DOM rules and ${accessibilityTree.exposedNodeCount} exposed accessibility-tree nodes checked.`,
    );
  }
  window.webContents.debugger.detach();
  window.destroy();
  app.exit(blocking.length || semanticFailures.length ? 1 : 0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
