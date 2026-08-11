const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const { DEFAULTS, reloadEnv, writeEnvFile } = require("../lib/env-file");

let mainWindow;
let serverPort;

function setupEnvironment() {
  const userData = app.getPath("userData");
  const envPath = path.join(userData, ".env");
  const dataDir = path.join(userData, "data");

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  process.env.ENV_FILE = envPath;
  process.env.DATA_DIR = dataDir;
  delete process.env.BASE_PATH;
  delete process.env.HOST;

  if (!fs.existsSync(envPath)) {
    writeEnvFile(DEFAULTS);
  } else {
    reloadEnv();
    writeEnvFile({
      MAX_EMAILS_PER_HOUR: DEFAULTS.MAX_EMAILS_PER_HOUR,
      MAX_RECIPIENTS: DEFAULTS.MAX_RECIPIENTS,
    });
  }
}

function getPublicDir() {
  const unpacked = path.join(process.resourcesPath, "app.asar.unpacked", "public");
  if (fs.existsSync(unpacked)) return unpacked;
  return path.join(__dirname, "..", "public");
}

async function createWindow() {
  setupEnvironment();
  process.env.PUBLIC_DIR = getPublicDir();

  const { startServer } = require("../server");

  try {
    const { port } = await startServer(0, "127.0.0.1");
    serverPort = port;
  } catch (err) {
    const { dialog } = require("electron");
    dialog.showErrorBox(
      "ERA Email Sender",
      "Impossible de démarrer le serveur local.\n\n" + err.message
    );
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "ERA Formation — Envoi d'emails",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
