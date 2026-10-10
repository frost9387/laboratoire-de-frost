// Version bureau (Windows / macOS) : même interface que la version web, plus l'accès
// direct aux profils ICC installés et une vraie boîte « Enregistrer sous ».
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");

function profileDirs() {
  if (process.platform === "win32") {
    return [
      "C:\\Windows\\System32\\spool\\drivers\\color",
      "C:\\Program Files (x86)\\Common Files\\Adobe\\Color\\Profiles",
      "C:\\Program Files\\Common Files\\Adobe\\Color\\Profiles",
    ];
  }
  if (process.platform === "darwin") {
    return [
      "/Library/ColorSync/Profiles",
      path.join(os.homedir(), "Library/ColorSync/Profiles"),
      "/System/Library/ColorSync/Profiles",
      "/Library/Application Support/Adobe/Color/Profiles",
    ];
  }
  return ["/usr/share/color/icc", path.join(os.homedir(), ".local/share/icc")];
}

async function walk(dir, depth = 0) {
  if (depth > 3) return [];
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    const full = path.join(dir, n);
    try {
      const st = await fs.stat(full);
      if (st.isDirectory()) out.push(...(await walk(full, depth + 1)));
      else if (/\.(icc|icm)$/i.test(n)) out.push(full);
    } catch {
      /* ignoré */
    }
  }
  return out;
}

let known = new Set();

ipcMain.handle("profiles:list", async () => {
  const files = (await Promise.all(profileDirs().map((d) => walk(d)))).flat();
  known = new Set(files.map((f) => path.resolve(f)));
  return files.map((f) => ({ path: f, file: path.basename(f) }));
});

ipcMain.handle("profiles:read", async (_e, p) => {
  const full = path.resolve(String(p));
  if (!known.has(full)) throw new Error("profil non autorisé");
  const buf = await fs.readFile(full);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

ipcMain.handle("file:save", async (e, name, data) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const ext = path.extname(name).slice(1) || "*";
  const res = await dialog.showSaveDialog(win, {
    title: "Enregistrer",
    defaultPath: path.join(app.getPath("documents"), name),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }, { name: "Tous les fichiers", extensions: ["*"] }],
  });
  if (res.canceled || !res.filePath) return null;
  await fs.writeFile(res.filePath, Buffer.from(data));
  return res.filePath;
});

// Polices installées sur l'ordinateur (bouton « Polices de l'ordinateur ») : autorisées pour
// l'application elle-même, refusées pour tout le reste.
function allowLocalFonts(ses) {
  const ok = (permission) => permission === "local-fonts";
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(ok(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ok(permission));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: "Le laboratoire de Frost",
    backgroundColor: "#a2a2ab",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // les liens externes s'ouvrent dans le navigateur, jamais dans l'application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  const dev = process.env.FROST_DEV_URL;
  if (dev) win.loadURL(dev);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

// Windows / Linux : pas de barre de menus native (le logiciel a la sienne).
// macOS : il faut un menu minimal, sinon ⌘C / ⌘V / ⌘A ne marchent pas dans les champs de texte
// et ⌘Q ne quitte pas. ⌘Z est d'abord proposé à la page (annuler du document hors des champs).
function nativeMenu() {
  if (process.platform !== "darwin") return null;
  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: "about", label: "À propos du laboratoire de Frost" },
        { type: "separator" },
        { role: "hide", label: "Masquer le laboratoire de Frost" },
        { role: "hideOthers", label: "Masquer les autres" },
        { role: "unhide", label: "Tout afficher" },
        { type: "separator" },
        { role: "quit", label: "Quitter le laboratoire de Frost" },
      ],
    },
    {
      label: "Édition",
      submenu: [
        { role: "undo", label: "Annuler la saisie" },
        { role: "redo", label: "Rétablir la saisie" },
        { type: "separator" },
        { role: "cut", label: "Couper" },
        { role: "copy", label: "Copier" },
        { role: "paste", label: "Coller" },
        { role: "selectAll", label: "Tout sélectionner" },
      ],
    },
  ]);
}

Menu.setApplicationMenu(nativeMenu());
app.whenReady().then(() => {
  const { session } = require("electron");
  allowLocalFonts(session.defaultSession);
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
