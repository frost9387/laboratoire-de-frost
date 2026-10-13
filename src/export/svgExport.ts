// Export SVG vectoriel de toute la mise en page :
//  - textures : points AM géométriques, ou pixels tramés vectorisés ;
//  - objets : vrais contours (lettres, formes, logos) ; réserve par masque SVG ;
//  - textures dans les objets : tramées puis découpées à la forme exacte.
import type { Doc, Layer, PlateDesc, ScreenSpec } from "../engine/types.ts";
import { docBox, isElement, plateDescs, plateIndexOf, pxSize } from "../engine/doc.ts";
import { layerField, rdThreshold, runPlates, type Env } from "../engine/render.ts";
import { makeScreener } from "../engine/screens.ts";
import { elementGeom, fitVector, prepareBitmaps, rasterizeElement, svgTransform, type ElementGeom } from "../engine/elements.ts";
import { amDots, RunMerger, svgDocument } from "./svg.ts";
import { hasTonalEffects, openSession, sampleSilhouette, silhouetteBox, uncrop } from "../engine/compose.ts";
import type { Field } from "../engine/field.ts";

const f3 = (v: number) => (Math.round(v * 1000) / 1000).toString();

export interface SvgParams {
  originMm: number;
  wMm: number;
  hMm: number;
  dpi: number;
  cppi: number;
  separate: boolean;
  marks: boolean;
  bleedIncluded: boolean;
}

export async function exportSvg(
  doc: Doc,
  p: SvgParams,
  env: Env,
  warnings: string[],
  progress: (f: number, label: string) => void,
): Promise<{ name: string; svg: string }[]> {
  const s = doc.settings;
  const box = docBox(doc);
  const descs = plateDescs(doc);
  const svgDpi = Math.min(p.dpi, 600);
  const so = Math.round((p.originMm / 25.4) * svgDpi);
  const sw = pxSize(p.wMm, svgDpi);
  const sh = pxSize(p.hMm, svgDpi);
  const spw = pxSize(box.wMm, svgDpi);
  const sph = pxSize(box.hMm, svgDpi);
  const k25 = 25.4 / svgDpi;
  const content: string[][] = descs.map(() => []);
  const defs: string[] = [];
  let seq = 0;
  let shapes = 0;
  const color = (k: number) => (p.separate ? "#000000" : descs[k].hex);
  if (env.fonts) await env.fonts.ensure(doc.layers.filter((l) => l.text).map((l) => l.text!.font));

  const specOf = (k: number): ScreenSpec => {
    const sp = descs[k].screen;
    if (sp.type === "aucune") {
      warnings.push(`Plaque ${descs[k].name} en ton continu : convertie en trait (seuil 50 %) pour le SVG.`);
      return { ...sp, type: "seuil", level: 50 };
    }
    return sp;
  };
  const specs = descs.map((_, k) => specOf(k));
  if (svgDpi < p.dpi && specs.some((x) => x.type !== "am")) warnings.push(`SVG : les trames non AM sont vectorisées à ${svgDpi} dpi pour garder un fichier ouvrable.`);

  /** Pixels tramés d'un champ, vectorisés, sur une région (px à svgDpi, repère du fond perdu). */
  const rasterRuns = (spec: ScreenSpec, f: { data: Float32Array; w: number; h: number }, gain: number, bx0: number, by0: number, bx1: number, by1: number, mask?: Uint8Array) => {
    const scr = makeScreener({
      spec, outDpi: svgDpi, fullW: spw, fullH: sph, contone: f.data, cw: f.w, ch: f.h, contonePpi: p.cppi, gain,
      rdTile: spec.type === "stochastique" ? rdThreshold(env, spec.rdPreset) : undefined,
    });
    const w = bx1 - bx0;
    const merger = new RunMerger(bx0 - so, by0 - so);
    const row = new Uint8Array(w);
    for (let y = by0; y < by1; y++) {
      scr(bx0, y, bx1, y + 1, row);
      if (mask) for (let x = 0; x < w; x++) row[x] = row[x] && mask[(y - by0) * w + x] >= 128 ? 1 : 0;
      else for (let x = 0; x < w; x++) row[x] = row[x] ? 1 : 0;
      merger.addRow(row, y - by0);
    }
    const d = merger.finish(by1 - by0);
    shapes += merger.count;
    return d ? `<path transform="scale(${k25})" d="${d}"/>` : "";
  };

  /** Rectangle englobant de l'objet (px à svgDpi, repère du fond perdu), borné à la page. */
  const bboxPx = (g: ElementGeom) => {
    const { x, y, w, h, rot } = g.box;
    const cx = box.bleed + x + w / 2;
    const cy = box.bleed + y + h / 2;
    const a = (rot * Math.PI) / 180;
    const ex = Math.abs((w / 2) * Math.cos(a)) + Math.abs((h / 2) * Math.sin(a)) + 1;
    const ey = Math.abs((w / 2) * Math.sin(a)) + Math.abs((h / 2) * Math.cos(a)) + 1;
    const px = (mm: number) => Math.round((mm / 25.4) * svgDpi);
    return {
      x0: Math.max(0, px(cx - ex)), y0: Math.max(0, px(cy - ey)),
      x1: Math.min(spw, px(cx + ex)), y1: Math.min(sph, px(cy + ey)),
    };
  };

  /** Forme exacte de l'objet dessinée en `ink` (zones encrées) et `paper` (zones blanches d'un logo). */
  const shapeMarkup = (g: ElementGeom, layer: Layer, ink: string, paper: string, rasterMask?: Uint8Array, bb?: ReturnType<typeof bboxPx>) => {
    if (rasterMask && bb) {
      const w = bb.x1 - bb.x0;
      const merger = new RunMerger(bb.x0 - so, bb.y0 - so);
      const row = new Uint8Array(w);
      for (let y = 0; y < bb.y1 - bb.y0; y++) {
        for (let x = 0; x < w; x++) row[x] = rasterMask[y * w + x] >= 128 ? 1 : 0;
        merger.addRow(row, y);
      }
      return `<path transform="scale(${k25})" fill="${ink}" d="${merger.finish(bb.y1 - bb.y0)}"/>`;
    }
    const T = svgTransform(g.box, box.bleed, p.originMm);
    let out = "";
    if (g.fill) out += `<path fill="${ink}" d="${g.fill}"/>`;
    if (g.stroke) out += `<path fill="none" stroke="${ink}" stroke-width="${f3(g.stroke.widthMm)}" d="${g.stroke.d}"/>`;
    if (g.vector) {
      const [sx, sy, tx, ty] = fitVector(g.vector, g.box.w, g.box.h, g.fit);
      out += `<g transform="matrix(${f3(sx)} 0 0 ${f3(sy)} ${f3(tx)} ${f3(ty)})">`;
      for (const it of g.vector.items) {
        const m = it.m.map(f3).join(" ");
        if (it.fill !== null) out += `<path transform="matrix(${m})" fill="${it.fill >= 0.5 ? ink : paper}"${it.evenodd ? ' fill-rule="evenodd"' : ""} d="${it.d}"/>`;
        if (it.stroke !== null && it.sw > 0) out += `<path transform="matrix(${m})" fill="none" stroke="${it.stroke >= 0.5 ? ink : paper}" stroke-width="${f3(it.sw)}" d="${it.d}"/>`;
      }
      out += `</g>`;
    }
    void layer;
    return `<g transform="${T}">${out}</g>`;
  };

  const visible = doc.layers.filter((l) => l.visible);
  let run: Layer[] = [];
  const total = visible.length || 1;
  let done = 0;

  const flush = () => {
    if (!run.length) return;
    const P = runPlates(doc, run, p.cppi, env, descs);
    P.data.forEach((d, k) => {
      if (!d) return;
      const spec = specs[k];
      if (spec.type === "am") {
        const r = amDots({ spec, contone: d, cw: P.w, ch: P.h, cppi: p.cppi, originMm: p.originMm, outWmm: p.wMm, outHmm: p.hMm, plateWmm: box.wMm, plateHmm: box.hMm });
        shapes += r.count;
        if (r.d) content[k].push(`<path d="${r.d}"/>`);
      } else {
        const x0 = Math.max(0, so);
        const y0 = Math.max(0, so);
        const part = rasterRuns(spec, { data: d, w: P.w, h: P.h }, 1, x0, y0, Math.min(spw, sw + so), Math.min(sph, sh + so));
        if (part) content[k].push(part);
      }
    });
    run = [];
  };

  for (const l of visible) {
    progress(0.1 + 0.8 * (done++ / total), `Vectorisation : ${l.name}…`);
    if (!isElement(l)) {
      run.push(l);
      continue;
    }
    flush();
    const g = await elementGeom(doc, l, env.fonts!, env.assets, env.cache);
    if (g.overflow) warnings.push(`Texte en excès dans « ${l.name} » : agrandissez le cadre.`);
    if (g.empty) continue;
    await prepareBitmaps([g]);
    const fxShape = !!l.fxOnShape && l.effects.some((e) => e.on);
    const textured = l.fill?.mode === "texture";
    // effets sur la forme : reprend le champ déformé du rendu (silhouette + ton), qui peut sortir du cadre
    let shapeField: Field | undefined;
    if (fxShape) {
      const sess = await openSession({ ...doc, layers: [l] }, env, { dpi: svgDpi, cppi: p.cppi, screened: false, autoContone: false });
      const seg = sess.segs.find((x) => x.type === "el");
      shapeField = seg && seg.type === "el" ? seg.shapeField ?? undefined : undefined;
      if (shapeField) shapeField = uncrop(shapeField, pxSize(box.wMm, p.cppi), pxSize(box.hMm, p.cppi));
    }
    const sc = p.cppi / svgDpi;
    const bb = shapeField ? silhouetteBox(shapeField, sc, spw, sph) : bboxPx(g);
    if (bb.x1 <= bb.x0 || bb.y1 <= bb.y0) continue;
    // forme rastérisée si elle ne peut pas être décrite en vecteurs (image bitmap, effets sur la forme)
    let rasterMask: Uint8Array | undefined;
    if (shapeField) rasterMask = sampleSilhouette(shapeField, sc, bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
    else if (g.bitmap) rasterMask = rasterizeElement(g, box.bleed, svgDpi, bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
    const id = ++seq;
    // réserve
    if (!l.overprint) {
      defs.push(`<mask id="ko${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${f3(p.wMm)}" height="${f3(p.hMm)}"><rect width="${f3(p.wMm)}" height="${f3(p.hMm)}" fill="#fff"/>${shapeMarkup(g, l, "#000", "#fff", rasterMask, bb)}</mask>`);
      content.forEach((c, k) => {
        if (c.length) content[k] = [`<g mask="url(#ko${id})">${c.join("")}</g>`];
      });
    }
    // masque de forme (pour découper une teinte ou une texture, et pour les logos)
    defs.push(`<mask id="sh${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${f3(p.wMm)}" height="${f3(p.hMm)}">${shapeMarkup(g, l, "#fff", "#000", rasterMask, bb)}</mask>`);
    // encre de l'objet
    const tint = ((l.fill?.tint ?? 100) / 100) * (l.opacity / 100);
    const gainsK = s.mode === "cmjn" ? l.ink.cmyk.map((v) => (v / 100) * tint) : descs.map((_, i) => (i === plateIndexOf(doc, descs, l) ? tint : 0));
    const tone = textured && !fxShape ? layerField(doc, l, p.cppi, env) : null;
    const shapeTone = shapeField && (textured || hasTonalEffects(l)) ? shapeField : null;
    gainsK.forEach((gain, k) => {
      if (gain <= 0) return;
      const solid = gain >= 0.999 && !tone && !shapeTone;
      if (solid) {
        if (g.vector || rasterMask) {
          const ob = { x: (bb.x0 - so) * k25, y: (bb.y0 - so) * k25, w: (bb.x1 - bb.x0) * k25, h: (bb.y1 - bb.y0) * k25 };
          content[k].push(`<rect x="${f3(ob.x)}" y="${f3(ob.y)}" width="${f3(ob.w)}" height="${f3(ob.h)}" fill="${color(k)}" mask="url(#sh${id})"/>`);
        } else content[k].push(shapeMarkup(g, l, color(k), "none"));
        shapes++;
        return;
      }
      const spec = specs[k];
      const field = shapeTone ? { data: shapeTone.ch[0], w: shapeTone.w, h: shapeTone.h } : tone ? { data: tone.ch[0], w: tone.w, h: tone.h } : { data: new Float32Array([1]), w: 1, h: 1 };
      let part: string;
      if (spec.type === "am") {
        const r = amDots({
          spec, contone: field.data, cw: field.w, ch: field.h, cppi: field.w === 1 ? 1 : p.cppi, gain,
          originMm: p.originMm, outWmm: p.wMm, outHmm: p.hMm, plateWmm: box.wMm, plateHmm: box.hMm,
          clip: { x0: (bb.x0 - so) * k25, y0: (bb.y0 - so) * k25, x1: (bb.x1 - so) * k25, y1: (bb.y1 - so) * k25 },
        });
        shapes += r.count;
        part = r.d ? `<path d="${r.d}"/>` : "";
      } else part = rasterRuns(spec, field, gain, bb.x0, bb.y0, bb.x1, bb.y1);
      if (part) content[k].push(`<g mask="url(#sh${id})">${part}</g>`);
    });
  }
  flush();

  // traits de coupe (repérage : sur toutes les plaques)
  let marks = "";
  if (p.marks) {
    const bl = p.bleedIncluded ? s.bleedMm : 0;
    const t0 = 10 + bl;
    const tx1 = t0 + s.widthMm;
    const ty1 = t0 + s.heightMm;
    const gap = Math.max(s.bleedMm, 3) + 0.5;
    const L = 6;
    const lines = [
      [t0, t0 - gap - L, t0, t0 - gap], [tx1, t0 - gap - L, tx1, t0 - gap],
      [t0, ty1 + gap, t0, ty1 + gap + L], [tx1, ty1 + gap, tx1, ty1 + gap + L],
      [t0 - gap - L, t0, t0 - gap, t0], [t0 - gap - L, ty1, t0 - gap, ty1],
      [tx1 + gap, t0, tx1 + gap + L, t0], [tx1 + gap, ty1, tx1 + gap + L, ty1],
    ];
    marks = `<g stroke="#000" stroke-width="0.1" fill="none">${lines.map(([a, b, c, d]) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}"/>`).join("")}</g>`;
  }
  if (shapes > 600000) warnings.push(`SVG très lourd : ${shapes.toLocaleString("fr-FR")} formes. Baissez la linéature ou la résolution.`);

  const layerOf = (k: number, d: PlateDesc) => ({
    id: `plaque-${d.name.replace(/[^a-zA-Z0-9_-]+/g, "-")}`,
    label: d.name,
    fill: color(k),
    content: content[k].join("\n"),
    multiply: !p.separate,
  });
  const allDefs = defs.join("\n");
  if (p.separate) {
    return descs.map((d, k) => ({
      name: d.name,
      svg: svgDocument({
        wMm: p.wMm, hMm: p.hMm, title: `${s.name} — ${d.name}`, defs: allDefs,
        layers: [layerOf(k, d), ...(marks ? [{ id: "traits-de-coupe", label: "Traits de coupe", fill: "none", content: marks, multiply: false }] : [])],
      }),
    }));
  }
  const layers = descs.map((d, k) => layerOf(k, d));
  if (marks) layers.push({ id: "traits-de-coupe", label: "Traits de coupe", fill: "none", content: marks, multiply: false });
  return [{ name: "", svg: svgDocument({ wMm: p.wMm, hMm: p.hMm, title: s.name, defs: allDefs, layers }) }];
}
