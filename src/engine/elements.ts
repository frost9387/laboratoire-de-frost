// Objets de mise en page (texte, formes, logos) : géométrie vectorielle en mm et rendu net
// à N'IMPORTE QUELLE résolution (le texte reste net à 2400 dpi, il n'est pas agrandi depuis 300 ppi).
import type { Asset, Box, Doc, Layer, ShapeSpec, VectorData } from "./types.ts";
import type { FontStore } from "./fonts.ts";
import { layoutText, PT_TO_MM } from "./text.ts";
import { kindOf } from "./doc.ts";
import { hashString } from "./util.ts";
import { inkFromRGBA, synthDessinTile, synthKey } from "./dessin.ts";
import type { Params } from "./types.ts";

const f3 = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** Contour d'une forme, en mm, repère du cadre. */
export function shapePath(s: ShapeSpec, w: number, h: number): string {
  switch (s.type) {
    case "ellipse": {
      const rx = w / 2;
      const ry = h / 2;
      return `M0 ${f3(ry)}A${f3(rx)} ${f3(ry)} 0 1 0 ${f3(w)} ${f3(ry)}A${f3(rx)} ${f3(ry)} 0 1 0 0 ${f3(ry)}Z`;
    }
    case "ligne":
      return `M0 ${f3(h / 2)}L${f3(w)} ${f3(h / 2)}`;
    case "polygone":
    case "etoile": {
      const n = Math.max(3, Math.round(s.sides));
      const star = s.type === "etoile";
      const pts: string[] = [];
      const count = star ? n * 2 : n;
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / count;
        const r = star && i % 2 ? Math.max(0.05, s.inner / 100) : 1;
        pts.push(`${f3(w / 2 + Math.cos(a) * (w / 2) * r)} ${f3(h / 2 + Math.sin(a) * (h / 2) * r)}`);
      }
      return "M" + pts.join("L") + "Z";
    }
    default: {
      const r = Math.max(0, Math.min(s.radius, w / 2, h / 2));
      if (r < 0.01) return `M0 0H${f3(w)}V${f3(h)}H0Z`;
      return `M${f3(r)} 0H${f3(w - r)}A${f3(r)} ${f3(r)} 0 0 1 ${f3(w)} ${f3(r)}V${f3(h - r)}A${f3(r)} ${f3(r)} 0 0 1 ${f3(w - r)} ${f3(h)}H${f3(r)}A${f3(r)} ${f3(r)} 0 0 1 0 ${f3(h - r)}V${f3(r)}A${f3(r)} ${f3(r)} 0 0 1 ${f3(r)} 0Z`;
    }
  }
}

/** Placement d'un logo (viewBox) dans le cadre : [échelle X, échelle Y, décalage X, décalage Y]. */
export function fitVector(v: VectorData, w: number, h: number, fit: string): [number, number, number, number] {
  const sx = w / v.vbW;
  const sy = h / v.vbH;
  if (fit === "etirer") return [sx, sy, -v.vbX * sx, -v.vbY * sy];
  const s = fit === "remplir" ? Math.max(sx, sy) : Math.min(sx, sy);
  return [s, s, (w - v.vbW * s) / 2 - v.vbX * s, (h - v.vbH * s) / 2 - v.vbY * s];
}

export interface ElementGeom {
  box: Box;
  fill?: string; // contour rempli (mm, repère du cadre)
  stroke?: { d: string; widthMm: number };
  vector?: VectorData;
  bitmap?: Asset;
  fit: string;
  overflow: boolean;
  empty: boolean;
}

/** Calcule la géométrie d'un objet (texte composé, forme, logo). Mise en cache. */
/** Rendus des objets dessinés (lourds : 16 Mo en 2048 px) — on n'en garde que quelques-uns. */
const drawnCache = new Map<string, Asset>();

/** Objet repris dans l'Atelier : le dessin passé par les curseurs de matière, en niveaux de gris. */
function drawnBitmap(a: Asset, p: Params): Asset {
  const id = "rendu|" + a.id + "|" + hashString(synthKey(p));
  const hit = drawnCache.get(id);
  if (hit) return hit;
  const n = a.width;
  const tile = synthDessinTile(inkFromRGBA(a.rgba!, a.width, n), n, p);
  const rgba = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const v = 255 - Math.round(tile[i] * 255);
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  const out: Asset = { id, kind: "image", name: a.name, width: n, height: n, rgba };
  drawnCache.set(id, out);
  if (drawnCache.size > 4) drawnCache.delete(drawnCache.keys().next().value!);
  return out;
}

export async function elementGeom(doc: Doc, l: Layer, fonts: FontStore, assets: Map<string, Asset>, cache: Map<string, unknown>): Promise<ElementGeom> {
  const lay = doc.layout;
  const key =
    "geom|" +
    hashString(JSON.stringify([kindOf(l), l.box, l.text, l.shape, l.image, l.assetId, lay.baselineStart, lay.baselineStep]));
  const hit = cache.get(key) as ElementGeom | undefined;
  if (hit) return hit;
  const box = l.box ?? { x: 0, y: 0, w: 50, h: 20, rot: 0 };
  const g: ElementGeom = { box, fit: l.image?.fit ?? "contenir", overflow: false, empty: false };
  const kind = kindOf(l);
  if (kind === "texte" && l.text) {
    const font = (await fonts.get(l.text.font)) ?? (await fonts.get("inter-400"));
    // polices de secours pour les signes absents (flèches, symboles…)
    const fallbacks = (await Promise.all(["inter-400", "spacemono-400", "garamond-400"].map((id) => fonts.get(id)))).filter((f): f is NonNullable<typeof f> => !!f && f !== font);
    if (font) {
      const res = layoutText(font, l.text, box.w, box.h, {
        firstMm: lay.baselineStart - box.y,
        stepMm: lay.baselineStep * PT_TO_MM,
      }, fallbacks);
      g.fill = res.d;
      g.overflow = res.overflow;
      g.empty = !res.d;
    } else g.empty = true;
  } else if (kind === "forme" && l.shape) {
    const d = shapePath(l.shape, box.w, box.h);
    if (l.shape.fill && l.shape.type !== "ligne") g.fill = d;
    if (l.shape.stroke || l.shape.type === "ligne") g.stroke = { d, widthMm: Math.max(0.05, l.shape.strokePt * PT_TO_MM) };
  } else if (kind === "image") {
    const a = l.assetId ? assets.get(l.assetId) : undefined;
    if (a?.kind === "vecteur") g.vector = a.vector;
    else if (a?.kind === "dessin" && a.rgba && l.image?.dessin) {
      // pas dans le cache général : trop lourd ; drawnBitmap garde les derniers rendus
      g.bitmap = drawnBitmap(a, l.image.dessin);
      return g;
    } else if (a?.rgba) g.bitmap = a;
    else g.empty = true;
  }
  cache.set(key, g);
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return g;
}

/**
 * Pinceau commun : place le repère du cadre (mm) dans la région rendue.
 * `originMm` = coin haut-gauche du fond perdu ; `ppi` = résolution ; `x0, y0` = coin de la région (px).
 */
function placeBox(ctx: OffscreenCanvasRenderingContext2D, box: Box, bleed: number, ppi: number, x0: number, y0: number) {
  const s = ppi / 25.4;
  ctx.setTransform(s, 0, 0, s, -x0, -y0);
  ctx.translate(bleed + box.x + box.w / 2, bleed + box.y + box.h / 2);
  ctx.rotate((box.rot * Math.PI) / 180);
  ctx.translate(-box.w / 2, -box.h / 2);
}

const bitmapCache = new Map<string, ImageBitmap>();

async function bitmapOf(a: Asset): Promise<ImageBitmap> {
  let b = bitmapCache.get(a.id);
  if (!b) {
    // densité d'encre = sombre et opaque ; on fabrique une image en niveaux de gris sur blanc
    const n = a.width * a.height;
    const px = new Uint8ClampedArray(n * 4);
    const src = a.rgba!;
    for (let i = 0; i < n; i++) {
      const al = src[i * 4 + 3] / 255;
      const lum = 0.2126 * src[i * 4] + 0.7152 * src[i * 4 + 1] + 0.0722 * src[i * 4 + 2];
      const v = Math.round(255 - (255 - lum) * al);
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
      px[i * 4 + 3] = 255;
    }
    b = await createImageBitmap(new ImageData(px, a.width, a.height));
    bitmapCache.set(a.id, b);
    // les rendus d'objets dessinés changent à chaque réglage : on borne la mémoire
    if (bitmapCache.size > 16) {
      const old = bitmapCache.keys().next().value!;
      bitmapCache.get(old)?.close();
      bitmapCache.delete(old);
    }
  }
  return b;
}

/** Prépare les ressources asynchrones (images bitmap). */
export async function prepareBitmaps(geoms: ElementGeom[]) {
  for (const g of geoms) if (g.bitmap) await bitmapOf(g.bitmap);
}

/**
 * Rend la couverture d'un objet sur une région (px, repère du fond perdu) : 0 = papier, 255 = encre.
 * Les très grandes régions sont découpées pour rester sous les limites des canvas.
 */
export function rasterizeElement(g: ElementGeom, bleed: number, ppi: number, x0: number, y0: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  if (g.empty) return out;
  const CH = 8192;
  for (let cx = 0; cx < w; cx += CH) {
    const cw = Math.min(CH, w - cx);
    for (let cy = 0; cy < h; cy += CH) {
      const chh = Math.min(CH, h - cy);
      const cv = new OffscreenCanvas(cw, chh);
      const ctx = cv.getContext("2d", { willReadFrequently: true })!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cw, chh);
      placeBox(ctx, g.box, bleed, ppi, x0 + cx, y0 + cy);
      if (g.fill) {
        ctx.fillStyle = "#000";
        ctx.fill(new Path2D(g.fill), "nonzero");
      }
      if (g.stroke) {
        ctx.strokeStyle = "#000";
        ctx.lineWidth = g.stroke.widthMm;
        ctx.lineJoin = "miter";
        ctx.lineCap = "butt";
        ctx.stroke(new Path2D(g.stroke.d));
      }
      if (g.vector) {
        const [sx, sy, tx, ty] = fitVector(g.vector, g.box.w, g.box.h, g.fit);
        ctx.save();
        if (g.fit === "remplir") {
          ctx.beginPath();
          ctx.rect(0, 0, g.box.w, g.box.h);
          ctx.clip();
        }
        ctx.transform(sx, 0, 0, sy, tx, ty);
        for (const it of g.vector.items) {
          ctx.save();
          ctx.transform(...it.m);
          const p = new Path2D(it.d);
          if (it.fill !== null) {
            const v = Math.round(255 * (1 - it.fill));
            ctx.fillStyle = `rgb(${v},${v},${v})`;
            ctx.fill(p, it.evenodd ? "evenodd" : "nonzero");
          }
          if (it.stroke !== null && it.sw > 0) {
            const v = Math.round(255 * (1 - it.stroke));
            ctx.strokeStyle = `rgb(${v},${v},${v})`;
            ctx.lineWidth = it.sw;
            ctx.stroke(p);
          }
          ctx.restore();
        }
        ctx.restore();
      }
      if (g.bitmap) {
        const bmp = bitmapCache.get(g.bitmap.id);
        if (bmp) {
          const v: VectorData = { vbX: 0, vbY: 0, vbW: g.bitmap.width, vbH: g.bitmap.height, items: [] };
          const [sx, sy, tx, ty] = fitVector(v, g.box.w, g.box.h, g.fit);
          ctx.save();
          if (g.fit === "remplir") {
            ctx.beginPath();
            ctx.rect(0, 0, g.box.w, g.box.h);
            ctx.clip();
          }
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(bmp, tx, ty, g.bitmap.width * sx, g.bitmap.height * sy);
          ctx.restore();
        }
      }
      const px = ctx.getImageData(0, 0, cw, chh).data;
      for (let y = 0; y < chh; y++) {
        const row = (cy + y) * w + cx;
        for (let x = 0; x < cw; x++) out[row + x] = 255 - px[(y * cw + x) * 4];
      }
    }
  }
  return out;
}

/** Contour de l'objet pour le SVG : chemin dans le repère du fond perdu (mm) + transformation. */
export function svgTransform(box: Box, bleed: number, originMm: number): string {
  const cx = bleed + box.x + box.w / 2 - originMm;
  const cy = bleed + box.y + box.h / 2 - originMm;
  return `translate(${f3(cx)} ${f3(cy)}) rotate(${f3(box.rot)}) translate(${f3(-box.w / 2)} ${f3(-box.h / 2)})`;
}
