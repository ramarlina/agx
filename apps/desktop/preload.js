const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agxDesktop", {
  platform: process.platform,
  isElectron: true,
  arch: process.arch,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
});
