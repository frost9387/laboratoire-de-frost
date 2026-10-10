// Assemblage calque par calque, du bas vers le haut :
//  - les textures consécutives sont combinées en ton continu puis tramées ensemble ;
//  - chaque objet (texte, forme, logo) est rendu NET à la résolution demandée, réserve
//    les encres en dessous (sauf en surimpression) puis ajoute son encre (aplat ou texture).
// Aperçu, Loupe et export utilisent tous cette même « séance ».
import type { Doc, Layer, PlateDesc } from "./types.ts";
import type { Field } from "./field.ts";
import { makeField } from "./field.ts";
import { docBox, isElement, plateDescs, plateIndexOf, pxSize } from "./doc.ts";
import { makeScreener } from "./screens.ts";
import { applyEffects, cacheField, layerField, rdThreshold, runPlates, screenVisibleAt, type Env } from "./render.ts";
import { elementGeom, prepareBitmaps, rasterizeElement, type ElementGeom } from "./elements.ts";
import { hashString } from "./util.ts";

type Screener = (x0: number, y0: number, x1: number, y1: number, out: Uint8Array) => void;

interface RunSeg {
  type: "run";
  screeners: (Screener | null)[];
}

interface ElSeg {
  type: "el";
  layer: Layer;
  geom: ElementGeom;
  /** par plaque : null = l'objet n'y met pas d'encre ; "plein" = aplat 100 % ; sinon un tramage */
  own: (Screener | "plein" | null)[];
  /** Effets sur la forme : le champ contient déjà la forme (pas de rendu net). */
  shapeField: Field | null;
  cppi: number;
}

export interface Session {
  doc: Doc;
  env: Env;
  descs: PlateDesc[];
  dpi: number;
  cppi: number;
  screened: boolean;
  /** Par plaque : tramée en 1 bit (sinon ton continu 0..255). */
  bitsK: boolean[];
  fullW: number;
  fullH: number;
  bleed: number;
  segs: (RunSeg | ElSeg)[];
  tacPeak: number;
  tacLimited: boolean;
  /** Plaques affichées en ton continu car la trame est trop fine à cette résolution. */
  tooFine: string[];
  /** Identifiants des objets dont le texte déborde du cadre. */
  overflow: string[];
}

export interface SessionOpts {
  dpi: number;
  /** Résolution du ton continu (≤ dpi). */
  cppi: number;
  /** Tramer (sinon : ton continu partout). */
  screened: boolean;
  /** Si la trame est illisible à ce dpi, montrer le ton continu (aperçu, épreuve). */
  autoContone: boolean;
}

/** Effets qui déplacent ou redessinent la silhouette (les autres ne changent que le ton). */
const SHAPE_EFFECTS = new Set(["miroir", "kaleido", "repetition", "onde", "fonte", "tourbillon", "tranches", "tripixels", "pixelliser", "epaisseur", "flou", "contours"]);

/**
 * Champs d'un objet dont les effets déforment la forme (2 canaux) :
 *  - canal 0 : le ton (aplat ou texture) après TOUS les effets, découpé par la silhouette ;
 *  - canal 1 : la silhouette seule, déformée par les seuls effets de forme.
 * Le relief ou le contraste ne débordent donc pas, et la réserve suit la silhouette, pas le ton.
 */
function shapeFieldOf(doc: Doc, l: Layer, geom: ElementGeom, cppi: number, env: Env): Field {
  const box = docBox(doc);
  const w = pxSize(box.wMm, cppi);
  const h = pxSize(box.hMm, cppi);
  const key = "forme|" + hashString(JSON.stringify([l.box, l.text, l.shape, l.image, l.assetId, l.fill, l.source, l.effects.filter((e) => e.on), cppi, w, h, doc.settings.seed]));
  return cacheField(env, key, () => {
    const m = rasterizeElement(geom, box.bleed, cppi, 0, 0, w, h);
    const N = w * h;
    const mask = makeField(w, h, 1);
    const f = makeField(w, h, 1);
    const tone = l.fill?.mode === "texture" ? layerField(doc, { ...l, effects: [] }, cppi, env).ch[0] : null;
    for (let i = 0; i < N; i++) {
      mask.ch[0][i] = m[i] / 255;
      f.ch[0][i] = mask.ch[0][i] * (tone ? tone[i] : 1);
    }
    const toned = applyEffects(doc, l, f, cppi).ch[0];
    const shape = applyEffects(doc, { ...l, effects: l.effects.filter((e) => SHAPE_EFFECTS.has(e.type)) }, mask, cppi).ch[0];
    const out = makeField(w, h, 2);
    for (let i = 0; i < N; i++) {
      const s = shape[i] < 0 ? 0 : shape[i] > 1 ? 1 : shape[i];
      out.ch[0][i] = toned[i] * s;
      out.ch[1][i] = s;
    }
    return out;
  });
}

/**
 * Silhouette déformée (canal 1) rééchantillonnée en bilinéaire à la résolution de sortie :
 * bords lisses même quand le ton continu est plus grossier. Masque 0..255.
 */
export function sampleSilhouette(f: Field, sc: number, x0: number, y0: number, w: number, h: number): Uint8Array {
  const sil = f.ch[1];
  const out = new Uint8Array(w * h);
  const xs0 = new Int32Array(w);
  const xs1 = new Int32Array(w);
  const tx = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const fx = Math.min(f.w - 1, Math.max(0, (x0 + x + 0.5) * sc - 0.5));
    xs0[x] = Math.floor(fx);
    xs1[x] = Math.min(f.w - 1, xs0[x] + 1);
    tx[x] = fx - xs0[x];
  }
  for (let y = 0; y < h; y++) {
    const fy = Math.min(f.h - 1, Math.max(0, (y0 + y + 0.5) * sc - 0.5));
    const iy = Math.floor(fy);
    const r0 = iy * f.w;
    const r1 = Math.min(f.h - 1, iy + 1) * f.w;
    const ty = fy - iy;
    for (let x = 0; x < w; x++) {
      const a = sil[r0 + xs0[x]] + (sil[r0 + xs1[x]] - sil[r0 + xs0[x]]) * tx[x];
      const b = sil[r1 + xs0[x]] + (sil[r1 + xs1[x]] - sil[r1 + xs0[x]]) * tx[x];
      const v = a + (b - a) * ty;
      out[y * w + x] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0;
    }
  }
  return out;
}

/** Rectangle (pixels de sortie) qui contient la silhouette déformée : elle peut sortir du cadre d'origine. */
export function silhouetteBox(f: Field, sc: number, maxW: number, maxH: number) {
  const sil = f.ch[1];
  let ax = f.w;
  let ay = f.h;
  let bx = -1;
  let by = -1;
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++)
      if (sil[y * f.w + x] > 0.004) {
        if (x < ax) ax = x;
        if (x > bx) bx = x;
        if (y < ay) ay = y;
        if (y > by) by = y;
      }
  if (bx < 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return {
    x0: Math.max(0, Math.floor(ax / sc) - 2), y0: Math.max(0, Math.floor(ay / sc) - 2),
    x1: Math.min(maxW, Math.ceil((bx + 1) / sc) + 2), y1: Math.min(maxH, Math.ceil((by + 1) / sc) + 2),
  };
}

/** L'objet a-t-il des effets actifs qui changent le ton (pas seulement la forme) ? */
export function hasTonalEffects(l: Layer): boolean {
  return l.effects.some((e) => e.on && !SHAPE_EFFECTS.has(e.type));
}

/** Champ de texture d'un objet (source + effets), indépendant de sa forme. */
function textureFieldOf(doc: Doc, l: Layer, cppi: number, env: Env): Field {
  return layerField(doc, l, cppi, env);
}

/** Recette de l'objet par plaque (0..1) : CMJN = recette ; tons directs / gris = sa plaque. */
function gains(doc: Doc, descs: PlateDesc[], l: Layer): number[] {
  const tint = ((l.fill?.tint ?? 100) / 100) * (l.opacity / 100);
  if (doc.settings.mode === "cmjn") return l.ink.cmyk.map((v) => (v / 100) * tint);
  const k = plateIndexOf(doc, descs, l);
  return descs.map((_, i) => (i === k ? tint : 0));
}

export async function openSession(doc: Doc, env: Env, o: SessionOpts): Promise<Session> {
  const descs = plateDescs(doc);
  const box = docBox(doc);
  const fullW = pxSize(box.wMm, o.dpi);
  const fullH = pxSize(box.hMm, o.dpi);
  const visible = doc.layers.filter((l) => l.visible);
  const tooFine = new Set<string>();
  const overflow: string[] = [];
  const segs: (RunSeg | ElSeg)[] = [];
  let tacPeak = 0;
  let tacLimited = false;

  // polices nécessaires au texte
  if (env.fonts) await env.fonts.ensure(visible.filter((l) => l.text).map((l) => l.text!.font));

  const specFor = (k: number) => {
    const spec = descs[k].screen;
    if (!o.screened) return { ...spec, type: "aucune" as const, dotGain: 0, minDot: 0, maxDot: 100 };
    if (o.autoContone && spec.type !== "aucune" && !screenVisibleAt(spec, o.dpi)) {
      tooFine.add(descs[k].name);
      return { ...spec, type: "aucune" as const, dotGain: 0, minDot: 0, maxDot: 100 };
    }
    return spec;
  };
  const specs = descs.map((_, k) => specFor(k));
  const bitsK = specs.map((sp) => sp.type !== "aucune");
  const screenerFor = (k: number, contone: Float32Array, cw: number, ch: number, cppi: number, gain = 1): Screener => {
    const spec = specs[k];
    return makeScreener({
      spec, outDpi: o.dpi, fullW, fullH, contone, cw, ch, contonePpi: cppi, gain,
      rdTile: spec.type === "stochastique" ? rdThreshold(env, spec.rdPreset) : undefined,
    });
  };

  let run: Layer[] = [];
  const flush = () => {
    if (!run.length) return;
    const P = runPlates(doc, run, o.cppi, env, descs);
    tacPeak = Math.max(tacPeak, P.tacPeak);
    tacLimited ||= P.tacLimited;
    segs.push({ type: "run", screeners: P.data.map((d, k) => (d ? screenerFor(k, d, P.w, P.h, o.cppi) : null)) });
    run = [];
  };

  const constant = new Float32Array([1]);
  for (const l of visible) {
    if (!isElement(l)) {
      run.push(l);
      continue;
    }
    flush();
    const geom = await elementGeom(doc, l, env.fonts!, env.assets, env.cache);
    if (geom.overflow) overflow.push(l.id);
    if (geom.empty) continue;
    await prepareBitmaps([geom]);
    const g = gains(doc, descs, l);
    const fxShape = !!l.fxOnShape && l.effects.some((e) => e.on);
    const textured = l.fill?.mode === "texture";
    let shapeField: Field | null = null;
    let tone: Field | null = null;
    if (fxShape) shapeField = shapeFieldOf(doc, l, geom, o.cppi, env);
    else if (textured) tone = textureFieldOf(doc, l, o.cppi, env);
    // un aplat déformé sans effet de ton reste un aplat net : seule sa silhouette change
    const toneField = textured || (fxShape && hasTonalEffects(l)) ? (shapeField ?? tone) : null;
    const own = g.map((gain, k) => {
      if (gain <= 0) return null;
      if (toneField) return screenerFor(k, toneField.ch[0], toneField.w, toneField.h, o.cppi, gain);
      if (gain >= 0.999) return "plein" as const;
      return screenerFor(k, constant, 1, 1, o.cppi, gain);
    });
    segs.push({ type: "el", layer: l, geom, own, shapeField, cppi: o.cppi });
  }
  flush();
  return {
    doc, env, descs, dpi: o.dpi, cppi: o.cppi, screened: o.screened, bitsK, fullW, fullH, bleed: box.bleed,
    segs, tacPeak, tacLimited, tooFine: [...tooFine], overflow,
  };
}

/** Rend une région [x0,x1)×[y0,y1) (pixels à `dpi`, repère du fond perdu). Une plaque = 0..255. */
export function composeRegion(s: Session, x0: number, y0: number, x1: number, y1: number): Uint8Array[] {
  const w = x1 - x0;
  const h = y1 - y0;
  const n = w * h;
  const acc = s.descs.map(() => new Uint8Array(n));
  const tmp = new Uint8Array(n);
  const over = (a: Uint8Array, b: Uint8Array) => {
    for (let i = 0; i < n; i++) {
      const v = b[i];
      if (!v) continue;
      const u = a[i];
      a[i] = u === 0 ? v : 255 - (((255 - u) * (255 - v) + 127) / 255 | 0);
    }
  };
  for (const seg of s.segs) {
    if (seg.type === "run") {
      seg.screeners.forEach((scr, k) => {
        if (!scr) return;
        scr(x0, y0, x1, y1, tmp);
        over(acc[k], tmp);
      });
      continue;
    }
    // masque de l'objet : net à cette résolution, ou issu du champ déformé par les effets
    const m = seg.shapeField
      ? sampleSilhouette(seg.shapeField, seg.cppi / s.dpi, x0, y0, w, h)
      : rasterizeElement(seg.geom, s.bleed, s.dpi, x0, y0, w, h);

    // réserve : l'objet efface les encres en dessous
    if (!seg.layer.overprint) {
      acc.forEach((a, k) => {
        const bits = s.bitsK[k];
        for (let i = 0; i < n; i++) {
          const mv = m[i];
          if (!mv) continue;
          a[i] = bits ? (mv >= 128 ? 0 : a[i]) : ((a[i] * (255 - mv) + 127) / 255) | 0;
        }
      });
    }
    // encre de l'objet
    seg.own.forEach((own, k) => {
      if (!own) return;
      const bits = s.bitsK[k];
      if (own === "plein") {
        for (let i = 0; i < n; i++) tmp[i] = bits ? (m[i] >= 128 ? 255 : 0) : m[i];
      } else {
        own(x0, y0, x1, y1, tmp);
        for (let i = 0; i < n; i++) tmp[i] = bits ? (m[i] >= 128 && tmp[i] >= 128 ? 255 : 0) : ((tmp[i] * m[i] + 127) / 255) | 0;
      }
      over(acc[k], tmp);
    });
  }
  return acc;
}
