// Pont minimal et sûr entre l'interface et le système (profils ICC, enregistrement de fichiers).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("frostDesktop", {
  isDesktop: true,
  listProfiles: () => ipcRenderer.invoke("profiles:list"),
  readProfile: (p) => ipcRenderer.invoke("profiles:read", p),
  saveFile: (name, data) => ipcRenderer.invoke("file:save", name, data),
});
