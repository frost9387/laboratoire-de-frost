// Version portable pour Windows, sans installation ni téléchargement :
// le moteur Electron déjà présent dans node_modules + l'application construite (dist/).
// Résultat : release/Le laboratoire de Frost/ (dossier à zipper et partager tel quel).
import { access, cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const name = "Le laboratoire de Frost";
const out = join(root, "release", name);
const electronDist = join(root, "node_modules", "electron", "dist");

await access(join(root, "dist", "index.html")).catch(() => {
  throw new Error("Lancez d'abord « npm run build ».");
});
await rm(out, { recursive: true, force: true });
await mkdir(join(root, "release"), { recursive: true });
console.log("Copie du moteur Electron…");
await cp(electronDist, out, { recursive: true });
await rm(join(out, "resources", "default_app.asar"), { force: true });
await rename(join(out, "electron.exe"), join(out, name + ".exe"));
// langues de l'interface Chromium : français et anglais suffisent (−40 Mo)
for (const f of await readdir(join(out, "locales")))
  if (!/^(fr|en-US|en-GB)\.pak$/.test(f)) await rm(join(out, "locales", f));

const app = join(out, "resources", "app");
console.log("Copie de l'application…");
await cp(join(root, "dist"), join(app, "dist"), { recursive: true });
await cp(join(root, "electron"), join(app, "electron"), { recursive: true });
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
await writeFile(
  join(app, "package.json"),
  JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, main: pkg.main, type: pkg.type }, null, 2),
);
await writeFile(
  join(out, "LISEZ-MOI.txt"),
  `${name} ${pkg.version} — version portable\r\n\r\nDouble-cliquez sur « ${name}.exe ». Rien à installer.\r\nPour le partager : zippez ce dossier entier.\r\n`,
);
console.log("Prêt : " + out);
