// Découverte des profils ICC : ceux du système et d'Adobe (bureau ou serveur de dev), et les profils importés.
import type { ProfileInfo } from "../engine/types.ts";
import { GENERIC_CMYK_ID, SRGB_ID } from "../engine/color.ts";
import { client } from "./client.ts";
import { desktop } from "./desktop.ts";
import { store } from "./store.ts";

export const BUILTIN_PROFILES: ProfileInfo[] = [
  { id: SRGB_ID, name: "sRGB IEC61966-2.1", space: "RGB", origin: "intégré" },
  { id: GENERIC_CMYK_ID, name: "CMJN générique (approximation, sans ICC)", space: "CMYK", origin: "intégré" },
];

/** Profils vidéo, HDR, cinéma : inutiles pour l'impression. */
const SKIP = /video|hdr|pal|ntsc|smpte|dcdm|dci|film|uhd|hd_display|sd_|cie ?rgb|xyz|st2084|g24/i;

/** Octets des profils importés par l'utilisateur (enregistrés dans le projet). */
export const importedBytes = new Map<string, Uint8Array>();

let found: ProfileInfo[] = [];

function publish(loading: boolean) {
  const all = [...BUILTIN_PROFILES, ...found];
  all.sort((a, b) => (a.space === b.space ? a.name.localeCompare(b.name, "fr") : a.space === "CMYK" ? -1 : 1));
  store.setProfiles(all, loading);
}

export async function discoverProfiles(): Promise<void> {
  publish(true);
  let list: { path: string; file: string }[] = [];
  try {
    if (desktop) list = await desktop.listProfiles();
    else {
      const r = await fetch("./__frost/profiles");
      if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) list = await r.json();
    }
  } catch {
    list = [];
  }
  const seen = new Set<string>();
  for (const item of list) {
    if (SKIP.test(item.file) || seen.has(item.file.toLowerCase())) continue;
    seen.add(item.file.toLowerCase());
    try {
      const buf = desktop
        ? await desktop.readProfile(item.path)
        : await (await fetch("./__frost/profiles?path=" + encodeURIComponent(item.path))).arrayBuffer();
      const info = await client.addProfile("sys:" + item.file, new Uint8Array(buf), "système", item.path);
      if (info && !found.some((f) => f.name === info.name)) {
        found.push(info);
        publish(true);
      }
    } catch {
      /* profil illisible : ignoré */
    }
  }
  publish(false);
}

export async function importProfile(file: File): Promise<ProfileInfo | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = "imp:" + file.name;
  const info = await client.addProfile(id, bytes, "importé");
  if (!info) return null;
  importedBytes.set(id, bytes);
  found = found.filter((f) => f.id !== id);
  found.push(info);
  publish(store.profilesLoading);
  return info;
}

/** Choisit un bon profil CMJN par défaut (Europe d'abord). */
export function preferredCmyk(list: ProfileInfo[]): string | null {
  const cmyk = list.filter((p) => p.space === "CMYK" && p.id !== GENERIC_CMYK_ID);
  const order = [/pso coated v3|fogra51/i, /fogra39|iso coated v2/i, /coated fogra/i, /gracol/i, /swop/i];
  for (const re of order) {
    const hit = cmyk.find((p) => re.test(p.name));
    if (hit) return hit.id;
  }
  return cmyk[0]?.id ?? null;
}
