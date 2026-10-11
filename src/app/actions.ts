// Actions partagées par les menus, les raccourcis et les fenêtres.
import { store } from "./store.ts";
import { EFFECTS, defaultParams, randomParam } from "../engine/effects.ts";
import { defaultDoc, isElement, kindOf, newElement, SPOT_INKS, migrateDoc } from "../engine/doc.ts";
import { objectDessinParams } from "../engine/dessin.ts";
import { client } from "./client.ts";
import { rng, uid } from "../engine/util.ts";
import { preferredCmyk } from "./profiles.ts";
import { importLogoFile, registerAsset } from "./project.ts";
import { applyDestination } from "./destinations.ts";
import { pickFile } from "./desktop.ts";
import { armAutosave } from "./autosave.ts";
import type { Asset, Doc, EffectInst, Ink, Layer, LayerKind } from "../engine/types.ts";

/** Le bouton MOSH : tire 2 à 4 effets imprimables dans leurs plages utiles. Les effets verrouillés restent. */
export function mosh() {
  const r = rng((Date.now() ^ (Math.random() * 1e9)) >>> 0);
  store.update((d) => {
    const l = d.layers.find((x) => x.id === d.activeLayerId);
    if (!l) return;
    const kept = l.effects.filter((e) => e.locked);
    const count = 2 + Math.floor(r() * 3);
    const fresh: EffectInst[] = [];
    for (let i = 0; i < count; i++) {
      const def = EFFECTS[Math.floor(r() * EFFECTS.length)];
      const params = defaultParams(def);
      for (const p of def.params) params[p.key] = randomParam(p, r);
      fresh.push({ id: uid("fx"), type: def.type, on: true, locked: false, params });
    }
    l.effects = [...kept, ...fresh];
  });
}

export function shuffleEffects() {
  const r = rng(Date.now() >>> 0);
  store.update((d) => {
    const l = d.layers.find((x) => x.id === d.activeLayerId);
    if (!l) return;
    for (let i = l.effects.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [l.effects[i], l.effects[j]] = [l.effects[j], l.effects[i]];
    }
  });
}

export function disableAllEffects() {
  store.update((d) => d.layers.forEach((l) => l.effects.forEach((e) => (e.on = false))));
}

export function newSeed() {
  store.update((d) => (d.settings.seed = Math.floor(Math.random() * 99999) + 1));
}

export function newDocument(doc: Doc = defaultDoc(), destination?: string, finish?: (d: Doc) => void) {
  const best = preferredCmyk(store.profiles);
  if (best) doc.settings.profileId = best;
  doc = migrateDoc(doc);
  if (destination) applyDestination(doc, destination, store.profiles);
  finish?.(doc);
  store.replace(doc);
  armAutosave();
}

/** Encre proposée pour un nouvel objet : celle du calque actif (même plaque), sinon noir. */
function defaultInk(): Ink {
  const d = store.doc;
  if (d.settings.mode === "directs") {
    const l = store.layer;
    return l ? { ...l.ink, cmyk: [...l.ink.cmyk] as Ink["cmyk"] } : { ...SPOT_INKS[0], cmyk: [0, 0, 0, 100] };
  }
  return { name: "Noir", hex: "#1d1d1b", cmyk: [0, 0, 0, 100] };
}

/** Ajoute un objet de mise en page. Sans cadre fourni : centré dans les marges. */
export function addElement(kind: Exclude<LayerKind, "texture">, box?: { x: number; y: number; w: number; h: number }, setup?: (l: Layer) => void): Layer {
  const d = store.doc;
  const m = d.layout.margins;
  const W = d.settings.widthMm;
  const H = d.settings.heightMm;
  const def = kind === "texte" ? { w: Math.min(W - m.inside - m.outside, 120), h: 30 } : { w: Math.min(60, W / 3), h: Math.min(60, W / 3) };
  const b = box ?? { x: kind === "texte" ? m.inside : (W - def.w) / 2, y: kind === "texte" ? m.top : (H - def.h) / 2, ...def };
  const l = newElement(kind, b, defaultInk());
  setup?.(l);
  store.update((dd) => {
    dd.layers.push(l);
    dd.activeLayerId = l.id;
  });
  return l;
}

/** Importe un logo (SVG ou image) et le place au centre, proportions respectées. */
export async function addLogo(file?: File | null, at?: { x: number; y: number }): Promise<{ layer: Layer; warnings: string[] } | null> {
  const f = file ?? (await pickFile(".svg,image/svg+xml,image/*"));
  if (!f) return null;
  const { asset, warnings } = await importLogoFile(f);
  const d = store.doc;
  const W = d.settings.widthMm;
  const H = d.settings.heightMm;
  const ratio = asset.height / Math.max(1e-6, asset.width);
  const w = Math.min(W * 0.4, 80);
  const h = w * ratio;
  const x = at ? at.x - w / 2 : (W - w) / 2;
  const y = at ? at.y - h / 2 : (H - h) / 2;
  const layer = addElement("image", { x, y, w, h }, (l) => {
    l.assetId = asset.id;
    l.name = asset.name.replace(/\.[^.]+$/, "").slice(0, 28) || "Logo";
  });
  return { layer, warnings };
}

export function duplicateLayer(id = store.doc.activeLayerId) {
  store.update((d) => {
    const i = d.layers.findIndex((x) => x.id === id);
    if (i < 0) return;
    const copy: Layer = JSON.parse(JSON.stringify(d.layers[i]));
    copy.id = uid(copy.kind ?? "couche");
    copy.name = d.layers[i].name + " copie";
    copy.effects.forEach((e) => (e.id = uid("fx")));
    if (copy.box) {
      copy.box.x += 5;
      copy.box.y += 5;
    }
    d.layers.splice(i + 1, 0, copy);
    d.activeLayerId = copy.id;
  });
}

export function deleteLayer(id = store.doc.activeLayerId) {
  if (store.doc.layers.length <= 1) return;
  store.update((d) => {
    const i = d.layers.findIndex((x) => x.id === id);
    if (i < 0) return;
    d.layers.splice(i, 1);
    d.activeLayerId = d.layers[Math.max(0, i - 1)]?.id ?? d.layers[0].id;
  });
}

/** Déplace l'objet actif (flèches du clavier), en mm. */
export function nudge(dx: number, dy: number) {
  const l = store.layer;
  if (!l || !isElement(l) || !l.box || l.pinned) return;
  store.update((d) => {
    const x = d.layers.find((y) => y.id === l.id);
    if (x?.box) {
      x.box.x += dx;
      x.box.y += dy;
    }
  }, { live: true });
}

export function addEffect(type: string) {
  const def = EFFECTS.find((e) => e.type === type);
  if (!def) return;
  const fx: EffectInst = { id: uid("fx"), type, on: true, locked: false, params: defaultParams(def) };
  store.selectedEffectId = fx.id;
  store.update((d) => d.layers.find((l) => l.id === d.activeLayerId)?.effects.push(fx));
}

/**
 * Reprend un objet (texte, forme, logo) à la main : il devient un dessin de l'Atelier (2048 px),
 * à la même place, avec sa version d'origine gardée pour pouvoir revenir en arrière.
 */
export async function drawOnElement(id: string): Promise<boolean> {
  const d = store.doc;
  const l = d.layers.find((x) => x.id === id);
  if (!l || !isElement(l) || !l.box) return false;
  const N = 2048;
  const r = await client.raster(d, l, (N * 0.8) / Math.max(l.box.w, l.box.h), false);
  const rgba = new Uint8ClampedArray(N * N * 4);
  const ox = Math.round((N - r.w) / 2);
  const oy = Math.round((N - r.h) / 2);
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const a = r.alpha[y * r.w + x];
      if (a) rgba[((oy + y) * N + ox + x) * 4 + 3] = a;
    }
  const asset: Asset = { id: uid("dessin"), kind: "dessin", name: l.name, width: N, height: N, rgba };
  registerAsset(asset);
  const side = N / r.pxPerMm;
  store.update((dd) => {
    const x = dd.layers.find((y) => y.id === id);
    if (!x?.box) return;
    x.avantDessin = { kind: kindOf(x), name: x.name, box: { ...x.box }, text: x.text, shape: x.shape, image: x.image, assetId: x.assetId };
    const cx = x.box.x + x.box.w / 2;
    const cy = x.box.y + x.box.h / 2;
    x.kind = "image";
    x.assetId = asset.id;
    x.image = { fit: "contenir", dessin: { ...objectDessinParams(), rev: 1 } };
    x.box = { x: cx - side / 2, y: cy - side / 2, w: side, h: side, rot: x.box.rot };
    delete x.text;
    delete x.shape;
    dd.activeLayerId = id;
  });
  return true;
}

/** Annule la reprise à la main : l'objet redevient le texte, la forme ou le logo d'origine. */
export function restoreElement(id: string) {
  store.update((d) => {
    const x = d.layers.find((y) => y.id === id);
    const o = x?.avantDessin;
    if (!x || !o) return;
    x.kind = o.kind;
    x.box = { ...o.box };
    x.text = o.text;
    x.shape = o.shape;
    x.image = o.image;
    x.assetId = o.assetId;
    delete x.avantDessin;
  });
}
