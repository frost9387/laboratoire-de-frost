// SVG vectoriel. Trame AM : chaque point est une vraie forme géométrique (résolution infinie).
// Autres trames : vectorisation exacte des pixels tramés (rectangles fusionnés).
import type { ScreenSpec } from "../engine/types.ts";
import { toneLUT } from "../engine/screens.ts";
import { sampleBilinear } from "../engine/util.ts";

const f3 = (v: number) => (Math.round(v * 1000) / 1000).toString();
/** Positions au centième de mm (10 µm) : largement assez pour un point de trame, fichier plus léger. */
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

export interface AmGeom {
  spec: ScreenSpec;
  contone: Float32Array;
  cw: number;
  ch: number;
  cppi: number;
  /** Origine de la sortie dans le repère du fond perdu (mm) et taille de sortie (mm). */
  originMm: number;
  outWmm: number;
  outHmm: number;
  /** Limites de la plaque dans le repère du fond perdu (mm). */
  plateWmm: number;
  plateHmm: number;
  /** Multiplicateur de ton (teinte d'un objet). */
  gain?: number;
  /** Ne garder que les points dans ce rectangle (mm, repère de sortie). */
  clip?: { x0: number; y0: number; x1: number; y1: number };
}

/** Points AM en géométrie exacte. Renvoie un attribut `d` de chemin SVG (unités : mm) et le nombre de points. */
export function amDots(g: AmGeom): { d: string; count: number } {
  const { spec } = g;
  const lut = toneLUT(spec);
  const L = lut.length - 1;
  const cmm = 25.4 / Math.max(1, spec.lpi);
  const th = (spec.angle * Math.PI) / 180;
  const ct = Math.cos(th);
  const st = Math.sin(th);
  const corners = [[0, 0], [g.plateWmm, 0], [0, g.plateHmm], [g.plateWmm, g.plateHmm]];
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const [x, y] of corners) {
    const u = (x * ct + y * st) / cmm;
    const v = (-x * st + y * ct) / cmm;
    umin = Math.min(umin, u); umax = Math.max(umax, u);
    vmin = Math.min(vmin, v); vmax = Math.max(vmax, v);
  }
  const parts: string[] = [];
  let count = 0;
  const shape = spec.shape;
  const toPx = g.cppi / 25.4;
  for (let j = Math.floor(vmin) - 1; j <= Math.ceil(vmax); j++) {
    for (let i = Math.floor(umin) - 1; i <= Math.ceil(umax); i++) {
      const u = i + 0.5;
      const v = j + 0.5;
      const x = (u * ct - v * st) * cmm;
      const y = (u * st + v * ct) * cmm;
      if (x < -cmm || y < -cmm || x > g.plateWmm + cmm || y > g.plateHmm + cmm) continue;
      const tx = x - g.originMm;
      const ty = y - g.originMm;
      if (tx < -cmm || ty < -cmm || tx > g.outWmm + cmm || ty > g.outHmm + cmm) continue;
      if (g.clip && (tx < g.clip.x0 - cmm || ty < g.clip.y0 - cmm || tx > g.clip.x1 + cmm || ty > g.clip.y1 + cmm)) continue;
      const raw = sampleBilinear(g.contone, g.cw, g.ch, Math.max(0, Math.min(g.plateWmm, x)) * toPx, Math.max(0, Math.min(g.plateHmm, y)) * toPx) * (g.gain ?? 1);
      const a = lut[(raw <= 0 ? 0 : raw >= 1 ? 1 : raw) * L + 0.5 | 0];
      if (a < 0.002) continue;
      count++;
      const A = a * cmm * cmm; // aire visée (mm²)
      if (shape === "carre" || shape === "losange" || shape === "ligne") {
        let pts: [number, number][];
        if (shape === "carre") {
          const s = Math.sqrt(A) / 2;
          pts = [[-s, -s], [s, -s], [s, s], [-s, s]];
        } else if (shape === "losange") {
          const d = Math.sqrt(A / 2);
          pts = [[0, -d], [d, 0], [0, d], [-d, 0]];
        } else {
          const t = (a * cmm) / 2;
          const hl = cmm / 2 + 0.001;
          pts = [[-hl, -t], [hl, -t], [hl, t], [-hl, t]];
        }
        const p = pts.map(([px, py]) => [tx + px * ct - py * st, ty + px * st + py * ct]);
        parts.push(`M${f2(p[0][0])} ${f2(p[0][1])}L${f2(p[1][0])} ${f2(p[1][1])}L${f2(p[2][0])} ${f2(p[2][1])}L${f2(p[3][0])} ${f2(p[3][1])}Z`);
      } else if (shape === "ellipse") {
        const rx = Math.sqrt(A / (Math.PI * 0.72));
        const ry = rx * 0.72;
        const deg = f3(spec.angle);
        const sx = tx - rx * ct;
        const sy = ty - rx * st;
        const ex = tx + rx * ct;
        const ey = ty + rx * st;
        parts.push(`M${f2(sx)} ${f2(sy)}A${f3(rx)} ${f3(ry)} ${deg} 1 0 ${f2(ex)} ${f2(ey)}A${f3(rx)} ${f3(ry)} ${deg} 1 0 ${f2(sx)} ${f2(sy)}Z`);
      } else {
        const r = Math.sqrt(A / Math.PI);
        const r3 = f3(r);
        parts.push(`M${f2(tx - r)} ${f2(ty)}a${r3} ${r3} 0 1 0 ${f3(2 * r)} 0a${r3} ${r3} 0 1 0 ${f3(-2 * r)} 0Z`);
      }
    }
  }
  return { d: parts.join(""), count };
}

/** Fusionne les pixels encrés en rectangles (rangées successives identiques). */
export class RunMerger {
  private open = new Map<string, { x0: number; x1: number; y0: number }>();
  private out: string[] = [];
  count = 0;
  private dx: number;
  private dy: number;

  /** `dx, dy` : décalage ajouté aux coordonnées émises (région partielle). */
  constructor(dx = 0, dy = 0) {
    this.dx = dx;
    this.dy = dy;
  }

  addRow(row: Uint8Array, y: number) {
    const seen = new Set<string>();
    let x = 0;
    const n = row.length;
    while (x < n) {
      if (!row[x]) { x++; continue; }
      let e = x;
      while (e < n && row[e]) e++;
      const key = x + ":" + e;
      seen.add(key);
      if (!this.open.has(key)) this.open.set(key, { x0: x, x1: e, y0: y });
      x = e;
    }
    for (const [key, r] of this.open) {
      if (!seen.has(key)) {
        this.emit(r, y);
        this.open.delete(key);
      }
    }
  }

  private emit(r: { x0: number; x1: number; y0: number }, yEnd: number) {
    this.count++;
    this.out.push(`M${r.x0 + this.dx} ${r.y0 + this.dy}h${r.x1 - r.x0}v${yEnd - r.y0}h${r.x0 - r.x1}Z`);
  }

  finish(yEnd: number): string {
    for (const r of this.open.values()) this.emit(r, yEnd);
    this.open.clear();
    return this.out.join("");
  }
}

export function svgDocument(opts: {
  wMm: number;
  hMm: number;
  title: string;
  defs?: string;
  layers: { id: string; label: string; fill: string; content: string; multiply: boolean }[];
}): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const head =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
    `width="${f3(opts.wMm)}mm" height="${f3(opts.hMm)}mm" viewBox="0 0 ${f3(opts.wMm)} ${f3(opts.hMm)}">\n` +
    `<title>${esc(opts.title)}</title>\n` +
    (opts.defs ? `<defs>\n${opts.defs}\n</defs>\n` : "");
  const body = opts.layers
    .map(
      (l) =>
        `<g id="${esc(l.id)}" inkscape:groupmode="layer" inkscape:label="${esc(l.label)}" fill="${l.fill}"` +
        (l.multiply ? ` style="mix-blend-mode:multiply"` : "") +
        `>\n${l.content}\n</g>\n`,
    )
    .join("");
  return head + body + `</svg>\n`;
}
