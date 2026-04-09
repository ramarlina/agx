const { app, BrowserWindow, dialog, Menu, shell } = require("electron");
const { spawn, execSync } = require("child_process");
const path = require("path");
const net = require("net");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");

const isDev = !app.isPackaged;
const APP_UPDATE_ARG = "--agx-update-now";
const DESKTOP_UPDATE_REPO = { owner: "ramarlina", repo: "agx" };
const REPO_ROOT = path.join(__dirname, "..", "..");
const LOCAL_APP_ROOT = path.join(REPO_ROOT, "apps", "local");
const CLI_ROOT = REPO_ROOT;

const SERVER_PORT = 41741;
const LOG_PATH = path.join(app.getPath("logs"), "agx.log");
const DESKTOP_CHAT_DEBUG_LOG_PATH = path.join(app.getPath("home"), ".agx", "logs", "desktop-chat-debug.log");

let mainWindow = null;
let serverProcess = null;
let appUpdateInFlight = null;

// --- Logging ---

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`;
  process.stdout.write(line);
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line);
  } catch {}
}

log(`agx starting (dev=${isDev}, pid=${process.pid})`);
log(`log file: ${LOG_PATH}`);
log(`desktop chat debug log: ${DESKTOP_CHAT_DEBUG_LOG_PATH}`);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

// --- Path helpers ---

function getResourcePath(...segments) {
  if (isDev) {
    return path.join(LOCAL_APP_ROOT, ...segments);
  }
  return path.join(process.resourcesPath, ...segments);
}

function getCliPath() {
  if (isDev) {
    return path.join(CLI_ROOT, "index.js");
  }
  return path.join(process.resourcesPath, "cli", "index.js");
}

function findNodeBinary() {
  // In dev, Electron is Node.
  if (isDev) return process.execPath;

  // Use the bundled Node.js binary (matches native modules exactly).
  const bundledNode = path.join(process.resourcesPath, "node-runtime", "node");
  if (fs.existsSync(bundledNode)) {
    log(`Using bundled node: ${bundledNode}`);
    return bundledNode;
  }

  log("Bundled node not found, falling back to system node");

  // Fallback: try system node
  try {
    const resolved = execSync("zsh -lc 'which node'", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (resolved && fs.existsSync(resolved)) return resolved;
  } catch {}

  const candidates = [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  return null;
}

function isUpdateLaunch(argv = process.argv) {
  return argv.includes(APP_UPDATE_ARG);
}

function configureAutoUpdater() {
  if (isDev || !app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.setFeedURL({
    provider: "github",
    owner: DESKTOP_UPDATE_REPO.owner,
    repo: DESKTOP_UPDATE_REPO.repo,
  });

  autoUpdater.on("checking-for-update", () => {
    log("[updater] checking for updates");
  });
  autoUpdater.on("update-available", (info) => {
    log(`[updater] update available ${info?.version || "unknown"}`);
  });
  autoUpdater.on("update-not-available", (info) => {
    log(`[updater] no update available (${info?.version || app.getVersion()})`);
  });
  autoUpdater.on("download-progress", (progress) => {
    log(`[updater] download ${Math.round(progress.percent || 0)}%`);
  });
  autoUpdater.on("error", (err) => {
    log(`[updater] error ${err?.message || err}`);
  });
  autoUpdater.on("update-downloaded", (info) => {
    log(`[updater] update downloaded ${info?.version || "unknown"}`);
  });
}

async function runAppUpdate({ source = "manual", quitWhenFinished = false } = {}) {
  if (isDev || !app.isPackaged) {
    log(`[updater] skipped (${source}) because app is not packaged`);
    if (quitWhenFinished) app.quit();
    return { status: "unsupported" };
  }

  if (appUpdateInFlight) return appUpdateInFlight;

  appUpdateInFlight = (async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      const updateInfo = result?.updateInfo;

      if (!updateInfo || updateInfo.version === app.getVersion()) {
        if (quitWhenFinished) app.quit();
        return { status: "up-to-date" };
      }

      log(`[updater] downloading ${updateInfo.version} (${source})`);
      await autoUpdater.downloadUpdate();
      autoUpdater.quitAndInstall();
      return { status: "installing", version: updateInfo.version };
    } catch (err) {
      const message = err?.message || String(err);
      log(`[updater] failed (${source}): ${message}`);
      if (!quitWhenFinished) {
        dialog.showErrorBox("Update Failed", message);
      }
      if (quitWhenFinished) app.quit();
      return { status: "error", error: message };
    } finally {
      appUpdateInFlight = null;
    }
  })();

  return appUpdateInFlight;
}

// --- Port detection ---

function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      server.close(() => resolve(startPort));
    });
    server.on("error", () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

// --- Server lifecycle ---

async function startNextServer() {
  const port = await findAvailablePort(SERVER_PORT);

  if (isDev) {
    // In dev, start the local board workspace from the agx repo.
    const devDir = LOCAL_APP_ROOT;
    serverProcess = spawn("npx", ["next", "dev", "--port", String(port)], {
      cwd: devDir,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    serverProcess.stdout.on("data", (data) => log(`[dev] ${data}`));
    serverProcess.stderr.on("data", (data) => log(`[dev:err] ${data}`));
    serverProcess.on("error", (err) => log("Dev server error:", err));

    await waitForServer(port, 60); // dev server can be slow to start
    return port;
  }

  const nodeBin = findNodeBinary();
  if (!nodeBin) {
    throw new Error(
      "Node.js not found on this system.\n\nagx requires Node.js to run. " +
        "Install it from https://nodejs.org or via homebrew:\n  brew install node"
    );
  }

  const serverDir = getResourcePath("server");
  const serverEntry = path.join(serverDir, "server.js");

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Server entry not found at ${serverEntry}`);
  }

  const cliPath = getCliPath();

  serverProcess = spawn(nodeBin, [serverEntry], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      // Tell the local board where to find the bundled CLI
      AGX_CLI_PATH: cliPath,
      AGX_ELECTRON: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  log(`node: ${nodeBin}`);
  log(`server: ${serverEntry}`);
  log(`cwd: ${serverDir}`);
  log(`port: ${port}`);

  serverProcess.stdout.on("data", (data) => {
    log(`[server] ${data}`);
  });

  serverProcess.stderr.on("data", (data) => {
    log(`[server:err] ${data}`);
  });

  // Track early exit so waitForServer can fail fast
  let serverExited = false;
  let serverError = null;

  serverProcess.on("error", (err) => {
    log("Failed to start server:", err);
    serverExited = true;
    serverError = err.message;
  });

  serverProcess.on("exit", (code) => {
    log(`[server] exited with code ${code}`);
    serverExited = true;
    serverError = `Server exited with code ${code}`;
  });

  await waitForServer(port, 60, () => serverExited ? serverError : null);
  return port;
}

function waitForServer(port, retries = 30, checkDead = null) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      // Fail fast if the server process already died
      if (checkDead) {
        const err = checkDead();
        if (err) {
          reject(new Error(err));
          return;
        }
      }

      if (remaining <= 0) {
        reject(new Error(`Server failed to start within ${retries / 2} seconds`));
        return;
      }

      const socket = new net.Socket();
      socket.setTimeout(500);
      socket.on("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        setTimeout(() => attempt(remaining - 1), 500);
      });
      socket.on("timeout", () => {
        socket.destroy();
        setTimeout(() => attempt(remaining - 1), 500);
      });
      socket.connect(port, "127.0.0.1");
    };
    attempt(retries);
  });
}

// --- Window ---

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  // Inject CSS to align the web app header with the native macOS traffic lights
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.insertCSS(`
      .workspace-sidebar:not(.workspace-sidebar--collapsed) .workspace-sidebar__brand {
        min-height: 3.25rem;
        padding: 0.75rem 0.75rem 0.75rem 4.75rem !important;
        justify-content: flex-end;
      }

      .workspace-sidebar:not(.workspace-sidebar--collapsed) .workspace-sidebar__brand-content {
        display: none !important;
      }

      .workspace-sidebar__brand,
      .desktop-titlebar {
        -webkit-app-region: drag;
      }

      .workspace-sidebar__brand a,
      .workspace-sidebar__brand button,
      .desktop-titlebar a,
      .desktop-titlebar button,
      .desktop-titlebar input,
      .desktop-titlebar textarea,
      .desktop-titlebar select,
      .desktop-titlebar [role="button"] {
        -webkit-app-region: no-drag;
      }
    `);
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// --- Menu ---

function buildMenu() {
  const template = [
    {
      label: "AGX",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Check for App Updates",
          click: () => {
            void runAppUpdate({ source: "menu" }).then((result) => {
              if (result?.status === "up-to-date") {
                dialog.showMessageBox(mainWindow, {
                  type: "info",
                  message: "agx is up to date",
                  detail: `Version ${app.getVersion()} is already installed.`,
                });
              }
            });
          },
        },
        {
          label: "Install CLI",
          click: () => installCli(),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- CLI install helper ---

function installCli() {
  const binDir = "/usr/local/bin";
  const linkPath = path.join(binDir, "agx");
  const cliEntry = getCliPath();
  const nodeBin = findNodeBinary() || "node";

  const wrapper = `#!/bin/bash
# agx CLI — installed by agx.app
exec "${nodeBin}" "${cliEntry}" "$@"
`;

  try {
    // Check if we can write directly
    fs.writeFileSync(linkPath, wrapper, { mode: 0o755 });
    dialog.showMessageBox(mainWindow, {
      type: "info",
      message: "CLI Installed",
      detail: `The agx command is now available at ${linkPath}`,
    });
  } catch {
    // Need sudo — use osascript
    const escaped = wrapper.replace(/'/g, "'\\''");
    try {
      execSync(
        `osascript -e 'do shell script "echo '"'"'${escaped}'"'"' > ${linkPath} && chmod +x ${linkPath}" with administrator privileges'`,
        { timeout: 30000 }
      );
      dialog.showMessageBox(mainWindow, {
        type: "info",
        message: "CLI Installed",
        detail: `The agx command is now available at ${linkPath}`,
      });
    } catch (err) {
      dialog.showErrorBox("Installation Failed", err.message);
    }
  }
}

// --- App lifecycle ---

if (hasSingleInstanceLock) {
  app.on("second-instance", (_event, argv) => {
    if (isUpdateLaunch(argv)) {
      void runAppUpdate({ source: "cli" });
      return;
    }

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  configureAutoUpdater();

  if (isUpdateLaunch()) {
    await runAppUpdate({ source: "cli", quitWhenFinished: true });
    return;
  }

  buildMenu();

  try {
    const port = await startNextServer();
    createWindow(port);
  } catch (err) {
    log("Startup failed:", err.message);
    dialog.showErrorBox("Startup Error", `${err.message}\n\nSee log: ${LOG_PATH}`);
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      startNextServer().then((port) => createWindow(port));
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
