import { defineConfig, type Plugin } from "vite";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, extname, basename } from "node:path";
import { homedir, platform } from "node:os";

/** Dossiers où les systèmes et Adobe installent leurs profils ICC. */
export function systemProfileDirs(): string[] {
  if (platform() === "win32") {
    return [
      "C:\\Windows\\System32\\spool\\drivers\\color",
      "C:\\Program Files (x86)\\Common Files\\Adobe\\Color\\Profiles",
      "C:\\Program Files\\Common Files\\Adobe\\Color\\Profiles",
    ];
  }
  if (platform() === "darwin") {
    return [
      "/Library/ColorSync/Profiles",
      join(homedir(), "Library/ColorSync/Profiles"),
      "/System/Library/ColorSync/Profiles",
      "/Library/Application Support/Adobe/Color/Profiles",
    ];
  }
  return ["/usr/share/color/icc", join(homedir(), ".local/share/icc")];
}

async function walk(dir: string, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    const full = join(dir, name);
    try {
      const s = await stat(full);
      if (s.isDirectory()) out.push(...(await walk(full, depth + 1)));
      else if ([".icc", ".icm"].includes(extname(name).toLowerCase())) out.push(full);
    } catch {
      /* fichier illisible : ignoré */
    }
  }
  return out;
}

/**
 * En développement (navigateur), expose les profils ICC installés sur la machine,
 * comme le fait la version bureau (Electron) via son preload.
 */
function frostSystemProfiles(): Plugin {
  return {
    name: "frost-system-profiles",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/__frost/profiles")) return next();
        const dirs = systemProfileDirs();
        const files = (await Promise.all(dirs.map((d) => walk(d)))).flat();
        const url = new URL(req.url, "http://x");
        const wanted = url.searchParams.get("path");
        if (wanted) {
          const full = resolve(wanted);
          if (!files.map((f) => resolve(f)).includes(full)) {
            res.statusCode = 403;
            return res.end("profil non autorisé");
          }
          const bytes = await readFile(full);
          res.setHeader("Content-Type", "application/vnd.iccprofile");
          return res.end(bytes);
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(files.map((f) => ({ path: f, file: basename(f) }))));
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [frostSystemProfiles()],
  worker: { format: "es" },
  build: { target: "es2022", outDir: "dist" },
  server: { port: 5178, strictPort: true },
});
