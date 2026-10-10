// Projet .frost (document + images + dessins + logos + polices + profils importés), imports.
import type { Asset, Doc } from "../engine/types.ts";
import { uid } from "../engine/util.ts";
import { migrateDoc } from "../engine/doc.ts";
import { BUILTIN_FONTS, fontFamilyName, type FontDef } from "../engine/fonts.ts";
import { store } from "./store.ts";
import { client } from "./client.ts";
import { saveBytes } from "./desktop.ts";
import { importedBytes, importProfile } from "./profiles.ts";
import { parseSvgLogo } from "./svgImport.ts";
import { armAutosave } from "./autosave.ts";

const MAX_IMAGE_SIDE = 6000;

export async function decodeImage(file: Blob, maxSide = MAX_IMAGE_SIDE): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const width = Math.max(1, Math.round(bmp.width * k));
  const height = Math.max(1, Math.round(bmp.height * k));
  const c = new OffscreenCanvas(width, height);
  const g = c.getContext("2d")!;
  g.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  return { rgba: g.getImageData(0, 0, width, height).data, width, height };
}

export function registerAsset(a: Asset) {
  store.addAsset(a);
  client.addAsset(a);
}

export async function importImageFile(file: File): Promise<Asset> {
  const { rgba, width, height } = await decodeImage(file);
  const a: Asset = { id: uid("img"), kind: "image", name: file.name, width, height, rgba };
  registerAsset(a);
  return a;
}

/** Logo : SVG (vectoriel, net à toute taille) ou image bitmap (PNG, JPG…). */
export async function importLogoFile(file: File): Promise<{ asset: Asset; warnings: string[] }> {
  const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  if (!isSvg) return { asset: await importImageFile(file), warnings: [] };
  const { vector, warnings } = parseSvgLogo(await file.text());
  const a: Asset = { id: uid("logo"), kind: "vecteur", name: file.name, width: vector.vbW, height: vector.vbH, vector };
  registerAsset(a);
  return { asset: a, warnings };
}

// ---- polices ---------------------------------------------------------------------------

/** Polices importées ou de l'ordinateur, en plus des polices intégrées. */
export function fontList(): FontDef[] {
  const extra: FontDef[] = [...store.assets.values()]
    .filter((a) => a.kind === "police")
    .map((a) => ({ id: a.id, family: a.family ?? a.name, style: a.name, source: "importé" as const }));
  return [...BUILTIN_FONTS, ...extra];
}

export async function importFontBytes(bytes: Uint8Array, fallbackName: string): Promise<Asset> {
  const info = fontFamilyName(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  if (!info) throw new Error("Police illisible (formats acceptés : TTF, OTF, WOFF).");
  const a: Asset = { id: uid("police"), kind: "police", name: info.style, family: info.family || fallbackName, width: 0, height: 0, bytes };
  registerAsset(a);
  return a;
}

export async function importFontFile(file: File): Promise<Asset> {
  return importFontBytes(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.[^.]+$/, ""));
}

interface LocalFont {
  family: string;
  style: string;
  fullName: string;
  blob(): Promise<Blob>;
}

/** Polices installées sur l'ordinateur (API « Local Font Access », Chrome / Edge / version bureau). */
export async function listLocalFonts(): Promise<LocalFont[] | null> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts;
  if (!q) return null;
  return q();
}

export async function importLocalFont(f: LocalFont): Promise<Asset> {
  const bytes = new Uint8Array(await (await f.blob()).arrayBuffer());
  return importFontBytes(bytes, f.family);
}

// ---- projet ----------------------------------------------------------------------------

function rgbaToDataUrl(a: Asset): string {
  const c = document.createElement("canvas");
  c.width = a.width;
  c.height = a.height;
  c.getContext("2d")!.putImageData(new ImageData(a.rgba as Uint8ClampedArray<ArrayBuffer>, a.width, a.height), 0, 0);
  return c.toDataURL("image/png");
}

const b64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Sérialise le projet (document + données utilisées). */
export function projectJson(): string {
  const doc = store.doc;
  const used = new Set<string>();
  doc.layers.forEach((l) => {
    if (l.source.assetId) used.add(l.source.assetId);
    if (l.assetId) used.add(l.assetId);
    if (l.text?.font) used.add(l.text.font);
  });
  const assets = [...store.assets.values()].filter((a) => used.has(a.id)).map((a) => ({
    id: a.id, kind: a.kind, name: a.name, width: a.width, height: a.height, family: a.family,
    png: a.rgba ? rgbaToDataUrl(a) : undefined,
    vector: a.vector,
    bytes: a.bytes ? b64(a.bytes) : undefined,
  }));
  const profiles = [...importedBytes.entries()]
    .filter(([id]) => id === doc.settings.profileId || id === doc.settings.rgbProfileId)
    .map(([id, bytes]) => ({ id, name: id.slice(4), data: b64(bytes) }));
  return JSON.stringify({ app: "laboratoire-de-frost", version: 2, doc, assets, profiles });
}

export async function saveProject() {
  store.commit();
  const name = (store.doc.settings.name || "texture").replace(/[\\/:*?"<>|]/g, "-") + ".frost";
  return saveBytes(name, new TextEncoder().encode(projectJson()), "application/json");
}

/** Recharge un projet sérialisé (fichier .frost ou sauvegarde automatique). */
export async function loadProjectJson(text: string) {
  const data = JSON.parse(text);
  if (data.app !== "laboratoire-de-frost" || !data.doc) throw new Error("Ce fichier n'est pas un projet du Laboratoire de Frost.");
  for (const a of data.assets ?? []) {
    if (a.png) {
      const blob = await (await fetch(a.png)).blob();
      const img = await decodeImage(blob, 100000);
      registerAsset({ id: a.id, kind: a.kind, name: a.name, width: img.width, height: img.height, rgba: img.rgba });
    } else if (a.vector) registerAsset({ id: a.id, kind: "vecteur", name: a.name, width: a.width, height: a.height, vector: a.vector });
    else if (a.bytes) registerAsset({ id: a.id, kind: "police", name: a.name, family: a.family, width: 0, height: 0, bytes: unb64(a.bytes) });
  }
  for (const p of data.profiles ?? []) await importProfile(new File([unb64(p.data)], p.name));
  store.replace(migrateDoc(data.doc) as Doc);
  armAutosave();
}

export async function openProject(file: File) {
  await loadProjectJson(await file.text());
}
