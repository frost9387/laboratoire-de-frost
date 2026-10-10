// Document par défaut, formats papier, calques (textures + objets de mise en page),
// dérivation des plaques d'impression et migration des anciens projets.
import type { Doc, Ink, Layer, LayerKind, LayoutSettings, PlateDesc, PlateKey, ScreenSpec, SourceType } from "./types.ts";
import { defaultScreen, CMYK_ANGLES } from "./screens.ts";
import { defaultSource } from "./sources.ts";
import { GENERIC_CMYK_ID, SRGB_ID } from "./color.ts";
import { uid } from "./util.ts";

export const FORMATS: { id: string; label: string; w: number; h: number }[] = [
  { id: "A6", label: "A6 — 105 × 148 mm", w: 105, h: 148 },
  { id: "A5", label: "A5 — 148 × 210 mm", w: 148, h: 210 },
  { id: "A4", label: "A4 — 210 × 297 mm", w: 210, h: 297 },
  { id: "A3", label: "A3 — 297 × 420 mm", w: 297, h: 420 },
  { id: "A2", label: "A2 — 420 × 594 mm", w: 420, h: 594 },
  { id: "C20", label: "Carré — 200 × 200 mm", w: 200, h: 200 },
  { id: "C30", label: "Pochette — 315 × 315 mm", w: 315, h: 315 },
  { id: "AF", label: "Affiche — 400 × 600 mm", w: 400, h: 600 },
  { id: "LET", label: "US Letter — 216 × 279 mm", w: 215.9, h: 279.4 },
  { id: "TUILE", label: "Tuile texture — 100 × 100 mm", w: 100, h: 100 },
  { id: "PERSO", label: "Personnalisé", w: 210, h: 297 },
];

export const PROCESS_INKS: Record<PlateKey, { name: string; hex: string }> = {
  C: { name: "Cyan", hex: "#00a0e4" },
  M: { name: "Magenta", hex: "#e6007e" },
  Y: { name: "Jaune", hex: "#ffed00" },
  K: { name: "Noir", hex: "#1d1d1b" },
};

/** Quelques encres de risographie (couleurs d'affichage approximatives). */
export const SPOT_INKS: { name: string; hex: string }[] = [
  { name: "Noir", hex: "#1d1d1b" },
  { name: "Bleu fédéral", hex: "#3d5588" },
  { name: "Bleu moyen", hex: "#3255a4" },
  { name: "Rose fluo", hex: "#ff48b0" },
  { name: "Rouge brillant", hex: "#f15060" },
  { name: "Orange fluo", hex: "#ff7477" },
  { name: "Jaune", hex: "#ffe800" },
  { name: "Vert", hex: "#00a95c" },
  { name: "Turquoise", hex: "#00838a" },
  { name: "Violet", hex: "#765ba7" },
  { name: "Or métallique", hex: "#bb8b41" },
  { name: "Brun", hex: "#925f52" },
];

export const KIND_LABEL: Record<LayerKind, string> = { texture: "Texture", texte: "Texte", forme: "Forme", image: "Logo / image" };
export const KIND_ICON: Record<LayerKind, string> = { texture: "▦", texte: "T", forme: "▭", image: "◈" };

export const kindOf = (l: Layer): LayerKind => l.kind ?? "texture";
export const isElement = (l: Layer) => kindOf(l) !== "texture";

/** Clé de plaque d'une encre en tons directs : même nom + même couleur = même plaque. */
export function inkKey(ink: Ink): string {
  return (ink.name.trim() + "|" + ink.hex).toLowerCase();
}

export function defaultLayout(): LayoutSettings {
  return {
    margins: { top: 12, bottom: 15, inside: 12, outside: 12 },
    columns: 1,
    gutter: 5,
    rows: 1,
    rowGutter: 5,
    baselineStart: 12,
    baselineStep: 12,
    guides: [],
    snap: true,
    show: { margins: true, columns: true, baseline: false, guides: true, frames: true },
  };
}

export function newLayer(type: SourceType, name: string, index: number): Layer {
  const spot = SPOT_INKS[(index + 1) % SPOT_INKS.length];
  return {
    id: uid("couche"),
    name,
    visible: true,
    kind: "texture",
    ink: { name: spot.name, hex: spot.hex, cmyk: index % 2 ? [0, 85, 30, 0] : [100, 55, 0, 15] },
    opacity: 100,
    source: defaultSource(type),
    effects: [],
  };
}

/** Objet de mise en page (texte, forme, logo) avec un cadre par défaut. */
export function newElement(kind: Exclude<LayerKind, "texture">, box: { x: number; y: number; w: number; h: number }, ink?: Ink): Layer {
  const base: Layer = {
    id: uid(kind),
    name: KIND_LABEL[kind],
    visible: true,
    kind,
    ink: ink ? { ...ink, cmyk: [...ink.cmyk] as Ink["cmyk"] } : { name: "Noir", hex: "#1d1d1b", cmyk: [0, 0, 0, 100] },
    opacity: 100,
    source: defaultSource("bruit"),
    effects: [],
    box: { ...box, rot: 0 },
    fill: { mode: "aplat", tint: 100 },
    overprint: false,
    fxOnShape: false,
  };
  if (kind === "texte") {
    base.name = "Texte";
    base.text = { content: "Votre texte", font: "inter-700", size: 36, leading: 0, tracking: 0, align: "gauche", vAlign: "haut", caps: false, baseline: false };
  }
  if (kind === "forme") base.shape = { type: "rect", radius: 0, sides: 6, inner: 50, fill: true, stroke: false, strokePt: 2 };
  if (kind === "image") base.image = { fit: "contenir" };
  return base;
}

export function defaultDoc(): Doc {
  const l1 = newLayer("rd", "Labyrinthe", 0);
  const l2 = newLayer("bruit", "Nuages", 1);
  l2.opacity = 70;
  l2.effects.push({ id: uid("fx"), type: "grain", on: true, locked: false, params: { quantite: 35, taille: 0.12, doux: false } });
  return {
    version: 2,
    settings: {
      name: "Sans titre",
      formatId: "A4",
      widthMm: 210,
      heightMm: 297,
      bleedMm: 3,
      dpi: 1200,
      contonePpi: 300,
      mode: "cmjn",
      profileId: GENERIC_CMYK_ID,
      rgbProfileId: SRGB_ID,
      intent: "relatif",
      bpc: true,
      paperHex: "#ffffff",
      tacMax: 300,
      seed: 1,
    },
    layers: [l1, l2],
    cmykScreens: {
      C: defaultScreen({ angle: CMYK_ANGLES.C, shape: "euclidien" }),
      M: defaultScreen({ angle: CMYK_ANGLES.M, shape: "euclidien" }),
      Y: defaultScreen({ angle: CMYK_ANGLES.Y, shape: "euclidien" }),
      K: defaultScreen({ angle: CMYK_ANGLES.K, shape: "euclidien" }),
    },
    spotScreens: {},
    layout: defaultLayout(),
    activeLayerId: l1.id,
  };
}

/** Trame par défaut d'une nouvelle encre de ton direct (alternance d'angles). */
export function defaultSpotScreen(index: number): ScreenSpec {
  return defaultScreen({ type: index % 2 ? "fm" : "stochastique", lpi: 30, angle: [45, 15, 75, 0][index % 4], grainUm: 60 });
}

/** Plaques réellement imprimées selon le mode couleur. */
export function plateDescs(doc: Doc): PlateDesc[] {
  const m = doc.settings.mode;
  if (m === "cmjn")
    return (["C", "M", "Y", "K"] as PlateKey[]).map((k) => ({ key: k, name: PROCESS_INKS[k].name, hex: PROCESS_INKS[k].hex, screen: doc.cmykScreens[k] }));
  if (m === "gris" || m === "bitmap") {
    const s = doc.cmykScreens.K;
    const screen = m === "bitmap" && s.type === "aucune" ? { ...s, type: "diffusion" as const } : s;
    return [{ key: "K", name: "Noir", hex: "#1d1d1b", screen }];
  }
  const out: PlateDesc[] = [];
  for (const l of doc.layers) {
    if (!l.visible) continue;
    const key = inkKey(l.ink);
    if (out.some((p) => p.key === key)) continue;
    out.push({ key, name: l.ink.name, hex: l.ink.hex, screen: doc.spotScreens[key] ?? defaultSpotScreen(out.length) });
  }
  return out;
}

/** Index de la plaque alimentée par un calque (tons directs / gris), -1 si aucune. */
export function plateIndexOf(doc: Doc, descs: PlateDesc[], l: Layer): number {
  const m = doc.settings.mode;
  if (m === "gris" || m === "bitmap") return 0;
  if (m === "directs") return descs.findIndex((p) => p.key === inkKey(l.ink));
  return -1;
}

/** Boîte de rendu : format fini + fond perdu (+ marge technique pour les traits de coupe). */
export function docBox(doc: Doc, marks = false) {
  const b = doc.settings.bleedMm;
  const slug = marks ? 10 : 0;
  return {
    wMm: doc.settings.widthMm + 2 * (b + slug),
    hMm: doc.settings.heightMm + 2 * (b + slug),
    bleed: b,
    slug,
  };
}

export function pxSize(mm: number, ppi: number): number {
  return Math.max(1, Math.round((mm / 25.4) * ppi));
}

/** Met à niveau un projet d'une version précédente (v0.1 : trames par calque, pas de mise en page). */
export function migrateDoc(raw: unknown): Doc {
  const d = raw as Doc & { version: number };
  if (!d.layout) d.layout = defaultLayout();
  if (!d.spotScreens) {
    d.spotScreens = {};
    for (const l of d.layers) {
      const key = inkKey(l.ink);
      if (l.screen && !d.spotScreens[key]) d.spotScreens[key] = l.screen;
    }
  }
  for (const l of d.layers) {
    if (!l.kind) l.kind = "texture";
    delete l.screen;
  }
  d.version = 2;
  return d as Doc;
}
