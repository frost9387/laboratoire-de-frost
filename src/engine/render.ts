// Briques du rendu : champs de texture, plaques (ton continu), matrices de trame, épreuve écran.
// L'assemblage calque par calque (textures + objets) est dans compose.ts.
import type { Asset, Doc, Layer, PlateDesc, ScreenSpec } from "./types.ts";
import type { ColorEngine } from "./color.ts";
import type { Field } from "./field.ts";
import type { FontStore } from "./fonts.ts";
import { EFFECT_BY_TYPE } from "./effects.ts";
import { generateSource, rdTile } from "./sources.ts";
import { docBox, isElement, plateDescs, plateIndexOf, pxSize } from "./doc.ts";
import { blueNoiseTile } from "./screens.ts";
import { RD_WAVELENGTH } from "./rd.ts";
import { hashString, hexToRgb, linearToSrgb, rankEqualize, srgbToLinear } from "./util.ts";

export interface Env {
  color: ColorEngine | null;
  fonts: FontStore | null;
  assets: Map<string, Asset>;
  cache: Map<string, unknown>;
  fields: Map<string, Field>;
}

export function makeEnv(color: ColorEngine | null, fonts: FontStore | null = null): Env {
  return { color, fonts, assets: new Map(), cache: new Map(), fields: new Map() };
}

export function fxSeed(doc: Doc, id: string): number {
  let h = doc.settings.seed * 2654435761;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Applique la pile d'effets actifs d'un calque à un champ. */
export function applyEffects(doc: Doc, layer: Layer, field: Field, ppi: number): Field {
  const { w, h } = field;
  for (const fx of layer.effects) {
    if (!fx.on) continue;
    const def = EFFECT_BY_TYPE[fx.type];
    if (!def) continue;
    const ctx = { ppi, seed: fxSeed(doc, fx.id) };
    field = { w, h, ch: field.ch.map((c) => def.apply(c, w, h, fx.params, ctx)) };
  }
  return field;
}

export function cacheField(env: Env, key: string, make: () => Field): Field {
  const hit = env.fields.get(key);
  if (hit) return hit;
  const f = make();
  env.fields.set(key, f);
  if (env.fields.size > 32) env.fields.delete(env.fields.keys().next().value!);
  return f;
}

/** Champ d'une texture (source + effets actifs) à une résolution donnée, mis en cache. */
export function layerField(doc: Doc, layer: Layer, ppi: number, env: Env): Field {
  const box = docBox(doc);
  const w = pxSize(box.wMm, ppi);
  const h = pxSize(box.hMm, ppi);
  const s = doc.settings;
  const usesColor = layer.source.type === "image" && s.mode === "cmjn" && !isElement(layer);
  const key = hashString(
    JSON.stringify({
      src: layer.source,
      fx: layer.effects.filter((e) => e.on),
      w, h, ppi,
      seed: s.seed,
      mode: isElement(layer) ? "objet" : s.mode,
      col: usesColor ? [s.profileId, s.intent, s.bpc] : 0,
    }),
  );
  return cacheField(env, key, () => {
    const f = generateSource(layer.source, {
      w, h, ppi, mode: isElement(layer) ? "objet" : s.mode, assets: env.assets, color: env.color,
      profileId: s.profileId, intent: s.intent, bpc: s.bpc, cache: env.cache,
    });
    return applyEffects(doc, layer, f, ppi);
  });
}

export interface Plates {
  descs: PlateDesc[];
  /** Ton continu par plaque (null = la plaque n'est pas touchée par ces calques). */
  data: (Float32Array | null)[];
  w: number;
  h: number;
  ppi: number;
  tacPeak: number;
  tacLimited: boolean;
}

const over = (dst: Float32Array, i: number, v: number) => {
  dst[i] = 1 - (1 - dst[i]) * (1 - v); // surimpression d'encres transparentes
};

/** Combine un groupe de textures en plaques (ton continu), avec la limite d'encrage total. */
export function runPlates(doc: Doc, layers: Layer[], ppi: number, env: Env, descs = plateDescs(doc)): Plates {
  const box = docBox(doc);
  const w = pxSize(box.wMm, ppi);
  const h = pxSize(box.hMm, ppi);
  const N = w * h;
  const s = doc.settings;
  const data: (Float32Array | null)[] = descs.map(() => null);
  const plate = (k: number) => (data[k] ??= new Float32Array(N));
  let tacPeak = 0;
  let tacLimited = false;

  for (const l of layers) {
    const f = layerField(doc, l, ppi, env);
    const op = l.opacity / 100;
    if (s.mode === "cmjn") {
      for (let k = 0; k < 4; k++) {
        if (f.ch.length === 4) {
          const src = f.ch[k];
          const dst = plate(k);
          for (let i = 0; i < N; i++) over(dst, i, src[i] * op);
        } else if (l.ink.cmyk[k] > 0) {
          const src = f.ch[0];
          const r = (l.ink.cmyk[k] / 100) * op;
          const dst = plate(k);
          for (let i = 0; i < N; i++) over(dst, i, src[i] * r);
        }
      }
    } else {
      const k = plateIndexOf(doc, descs, l);
      if (k < 0) continue;
      const src = f.ch[0];
      const dst = plate(k);
      for (let i = 0; i < N; i++) over(dst, i, src[i] * op);
    }
  }

  if (s.mode === "cmjn") {
    const T = s.tacMax / 100;
    const [C, M, Y, K] = data;
    for (let i = 0; i < N; i++) {
      const c = C?.[i] ?? 0, m = M?.[i] ?? 0, y = Y?.[i] ?? 0, kk = K?.[i] ?? 0;
      const cmy = c + m + y;
      const tot = cmy + kk;
      if (tot * 100 > tacPeak) tacPeak = tot * 100;
      if (tot > T && cmy > 0) {
        const sc = Math.max(0, (T - kk) / cmy);
        if (C) C[i] *= sc;
        if (M) M[i] *= sc;
        if (Y) Y[i] *= sc;
        tacLimited = true;
      }
    }
  } else {
    for (let i = 0; i < N; i++) {
      let t = 0;
      for (const d of data) if (d) t += d[i];
      if (t * 100 > tacPeak) tacPeak = t * 100;
    }
  }
  return { descs, data, w, h, ppi, tacPeak, tacLimited };
}

/** Toutes les textures visibles (sans les objets de mise en page). */
export function computePlates(doc: Doc, ppi: number, env: Env): Plates {
  return runPlates(doc, doc.layers.filter((l) => l.visible && !isElement(l)), ppi, env);
}

/** Matrice de seuil de la trame stochastique : motif RD égalisé + une pointe de bruit bleu. */
export function rdThreshold(env: Env, preset: string): { n: number; t: Float32Array } {
  const key = `rdthr|${preset}`;
  const hit = env.cache.get(key) as { n: number; t: Float32Array } | undefined;
  if (hit) return hit;
  const n = 256;
  const V = rdTile(env.cache, preset, 3400, 5, n);
  const blue = blueNoiseTile();
  const mix = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) mix[y * n + x] = 1 - V[y * n + x] + 0.06 * blue[(y % 64) * 64 + (x % 64)];
  const res = { n, t: rankEqualize(mix) };
  env.cache.set(key, res);
  return res;
}

/** La trame est-elle lisible à cette résolution ? (sinon on affiche le ton continu) */
export function screenVisibleAt(spec: ScreenSpec, ppi: number): boolean {
  switch (spec.type) {
    case "aucune":
      return false;
    case "am":
      return ppi / spec.lpi >= 3;
    case "stochastique":
      return ((ppi / spec.lpi) * spec.rdScale) / RD_WAVELENGTH >= 0.35;
    case "seuil":
      return true;
    default:
      return (spec.grainUm / 25400) * ppi >= 1;
  }
}

/**
 * Épreuve écran : combine les plaques (0..255) en sRGB.
 * CMJN : vraie conversion ICC (LittleCMS) ; tons directs : surimpression multiplicative.
 */
export function proof(doc: Doc, descs: PlateDesc[], planes: Uint8Array[], n: number, env: Env): Uint8ClampedArray {
  const s = doc.settings;
  const out = new Uint8ClampedArray(n * 4);
  const paper = hexToRgb(s.paperHex).map(srgbToLinear);
  const hasCmyk = !!env.color?.info(s.profileId) && env.color.info(s.profileId)!.space === "CMYK";

  if (s.mode === "cmjn" || ((s.mode === "gris" || s.mode === "bitmap") && hasCmyk)) {
    const cmyk = new Uint8Array(n * 4);
    if (s.mode === "cmjn") {
      for (let i = 0; i < n; i++) {
        cmyk[i * 4] = planes[0][i];
        cmyk[i * 4 + 1] = planes[1][i];
        cmyk[i * 4 + 2] = planes[2][i];
        cmyk[i * 4 + 3] = planes[3][i];
      }
    } else for (let i = 0; i < n; i++) cmyk[i * 4 + 3] = planes[0][i];
    const rgb = env.color ? env.color.cmykToSrgb(s.profileId, cmyk, n, s.intent) : new Uint8Array(n * 3).fill(255);
    const lut = new Uint8Array(256 * 3);
    for (let v = 0; v < 256; v++) for (let c = 0; c < 3; c++) lut[v * 3 + c] = linearToSrgb(srgbToLinear(v) * paper[c]);
    for (let i = 0; i < n; i++) {
      out[i * 4] = lut[rgb[i * 3] * 3];
      out[i * 4 + 1] = lut[rgb[i * 3 + 1] * 3 + 1];
      out[i * 4 + 2] = lut[rgb[i * 3 + 2] * 3 + 2];
      out[i * 4 + 3] = 255;
    }
    return out;
  }

  // modèle multiplicatif (encres transparentes) en lumière linéaire
  const luts = descs.map((d) => {
    const ink = hexToRgb(d.hex).map(srgbToLinear);
    const t = new Float32Array(256 * 3);
    for (let v = 0; v < 256; v++) for (let c = 0; c < 3; c++) t[v * 3 + c] = 1 - (v / 255) * (1 - ink[c]);
    return t;
  });
  for (let i = 0; i < n; i++) {
    let r = paper[0];
    let g = paper[1];
    let b = paper[2];
    for (let p = 0; p < planes.length; p++) {
      const v = planes[p][i];
      if (!v) continue;
      const t = luts[p];
      r *= t[v * 3];
      g *= t[v * 3 + 1];
      b *= t[v * 3 + 2];
    }
    out[i * 4] = linearToSrgb(r);
    out[i * 4 + 1] = linearToSrgb(g);
    out[i * 4 + 2] = linearToSrgb(b);
    out[i * 4 + 3] = 255;
  }
  return out;
}
