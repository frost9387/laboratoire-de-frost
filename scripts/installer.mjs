// Installateur Windows (NSIS) : construit hors du dossier du projet, puis copie le .exe dans release/.
// (Le Bureau est souvent protégé par Windows : electron-builder n'y peut pas renommer ses dossiers.)
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const out = join(tmpdir(), "laboratoire-de-frost-build");
await rm(out, { recursive: true, force: true });

const r = spawnSync(`npx electron-builder --win nsis "-c.directories.output=${out}"`, { cwd: root, stdio: "inherit", shell: true });
if (r.status !== 0) process.exit(r.status ?? 1);

await mkdir(join(root, "release"), { recursive: true });
for (const f of await readdir(out)) {
  if (!/Setup.*\.exe$/.test(f)) continue;
  await copyFile(join(out, f), join(root, "release", f));
  console.log("Prêt : " + join(root, "release", f));
}
await rm(out, { recursive: true, force: true });
