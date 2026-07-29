const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");

app.commandLine.appendSwitch("disable-gpu");
app.setPath(
  "userData",
  path.join(process.cwd(), "tmp", `electron-identity-${process.pid}`),
);
app.on("window-all-closed", () => undefined);

app.whenReady().then(async () => {
  process.env.AUDIO_V_QA_PAYLOAD = JSON.stringify({
    source: { kind: "files", paths: [], label: "Identity preferences QA" },
    result: { files: [] },
    comparison: null,
    externalIdentityPreferences: {
      acoustIdEnabled: true,
      musicBrainzEnabled: true,
      acoustIdApiKey: "ABCDEFGHIJ",
      hasStoredAcoustIdApiKey: true,
      protection: "os-encrypted",
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
    const restored = await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const check = () => {
          const cards = [...document.querySelectorAll(".external-service-card")];
          const acoustId = cards[0]?.querySelector('input[type="checkbox"]');
          const key = cards[0]?.querySelector('input[type="password"]');
          const musicBrainz = cards[1]?.querySelector('input[type="checkbox"]');
          if (acoustId?.checked && musicBrainz?.checked && key?.value === "ABCDEFGHIJ") {
            resolve({
              acoustIdEnabled: acoustId.checked,
              musicBrainzEnabled: musicBrainz.checked,
              keyLength: key.value.length,
            });
          } else if (Date.now() > deadline) {
            reject(new Error("Stored external identity settings were not restored into Settings."));
          } else setTimeout(check, 25);
        };
        check();
      })
    `);
    if (
      !restored.acoustIdEnabled ||
      !restored.musicBrainzEnabled ||
      restored.keyLength !== 10
    ) {
      throw new Error("Restored external identity preferences were incomplete.");
    }
    const layout = await window.webContents.executeJavaScript(`
      (() => {
        const card = document.querySelector(".external-service-card");
        const actions = document.querySelector(".external-service-actions");
        card?.scrollIntoView({ block: "start" });
        const cardRect = card.getBoundingClientRect();
        const actionRect = actions.getBoundingClientRect();
        return {
          cardWidth: cardRect.width,
          actionWidth: actionRect.width,
          contained:
            actionRect.left >= cardRect.left &&
            actionRect.right <= cardRect.right &&
            actions.scrollWidth <= actions.clientWidth,
        };
      })()
    `);
    if (!layout.contained) {
      throw new Error("External identity save actions overflowed their Settings card.");
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
    await mkdir(path.join(process.cwd(), "build"), { recursive: true });
    const screenshot = await window.webContents.capturePage();
    await writeFile(
      path.join(process.cwd(), "build", "identity-preferences-latest.png"),
      screenshot.toPNG(),
    );
    console.log(
      "External identity preferences restored: AcoustID enabled, protected key present, MusicBrainz enabled.",
    );
    window.destroy();
    app.exit(0);
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    console.error(error);
    app.exit(1);
  }
});
