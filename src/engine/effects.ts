// Pile d'effets IMPRIMABLES. Chaque réglage est en unité physique (mm, °, %),
// donc l'aperçu et l'export à 2400 dpi donnent le même dessin.
import type { ParamValue, Params } from "./types.ts";
import { blur, morph } from "./field.ts";
import { Perlin } from "./noise.ts";
import { clamp01, hash3, mmToPx, sampleBilinear, rng } from "./util.ts";

export interface ParamDef {
  key: string;
  label: string;
  kind: "range" | "select" | "bool";
  def: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: [string, string][];
  /** Plage du tirage « Mosh » : bas = 40 % inférieurs, haut = 25 % supérieurs. */
  rand?: "bas" | "haut" | "tout" | "non";
  hint?: string;
  /** Curseur logarithmique (plages très larges). */
  log?: boolean;
}

export interface EffectCtx {
  ppi: number;
  seed: number;
}

export interface EffectDef {
  type: string;
  label: string;
  group: "Tons" | "Matière" | "Géométrie" | "Déformation" | "Glitch";
  params: ParamDef[];
  apply(ch: Float32Array, w: number, h: number, p: Params, ctx: EffectCtx): Float32Array;
}

const num = (p: Params, k: string) => Number(p[k]);

function remap(ch: Float32Array, w: number, h: number, fn: (x: number, y: number) => [number, number]): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [sx, sy] = fn(x + 0.5, y + 0.5);
      out[y * w + x] = sampleBilinear(ch, w, h, sx, sy);
    }
  return out;
}

const map = (ch: Float32Array, fn: (v: number) => number) => {
  const out = new Float32Array(ch.length);
  for (let i = 0; i < ch.length; i++) out[i] = fn(ch[i]);
  return out;
};

export const EFFECTS: EffectDef[] = [
  {
    type: "niveaux",
    label: "Niveaux",
    group: "Tons",
    params: [
      { key: "noir", label: "Point noir", kind: "range", min: 0, max: 100, step: 1, def: 0, unit: "%", rand: "bas" },
      { key: "blanc", label: "Point blanc", kind: "range", min: 0, max: 100, step: 1, def: 100, unit: "%", rand: "haut" },
      { key: "gamma", label: "Gamma", kind: "range", min: 0.2, max: 5, step: 0.05, def: 1, rand: "tout" },
    ],
    apply(ch, _w, _h, p) {
      const lo = num(p, "noir") / 100;
      const hi = Math.max(lo + 0.001, num(p, "blanc") / 100);
      const g = num(p, "gamma");
      return map(ch, (v) => Math.pow(clamp01((v - lo) / (hi - lo)), g));
    },
  },
  {
    type: "contraste",
    label: "Luminosité / contraste",
    group: "Tons",
    params: [
      { key: "lum", label: "Luminosité", kind: "range", min: -100, max: 100, step: 1, def: 0, unit: "%", rand: "tout" },
      { key: "con", label: "Contraste", kind: "range", min: -100, max: 100, step: 1, def: 20, unit: "%", rand: "haut" },
    ],
    apply(ch, _w, _h, p) {
      const l = num(p, "lum") / 100;
      const c0 = num(p, "con") / 100;
      const c = c0 > 0 ? 1 / (1 - c0 * 0.98) : 1 + c0;
      return map(ch, (v) => clamp01((v - 0.5) * c + 0.5 - l * 0.5));
    },
  },
  {
    type: "inverser",
    label: "Inverser",
    group: "Tons",
    params: [],
    apply: (ch) => map(ch, (v) => 1 - v),
  },
  {
    type: "posteriser",
    label: "Postériser",
    group: "Tons",
    params: [{ key: "niveaux", label: "Niveaux", kind: "range", min: 2, max: 16, step: 1, def: 4, rand: "bas" }],
    apply(ch, _w, _h, p) {
      const n = Math.max(2, Math.round(num(p, "niveaux")));
      return map(ch, (v) => Math.round(v * (n - 1)) / (n - 1));
    },
  },
  {
    type: "solariser",
    label: "Solariser",
    group: "Tons",
    params: [{ key: "seuil", label: "Seuil", kind: "range", min: 10, max: 90, step: 1, def: 50, unit: "%", rand: "tout" }],
    apply(ch, _w, _h, p) {
      const s = num(p, "seuil") / 100;
      return map(ch, (v) => (v < s ? v / s : (1 - v) / (1 - s)));
    },
  },
  {
    type: "flou",
    label: "Flou",
    group: "Matière",
    params: [{ key: "rayon", label: "Rayon", kind: "range", min: 0, max: 10, step: 0.05, def: 0.6, unit: "mm", rand: "bas" }],
    apply: (ch, w, h, p, ctx) => blur(ch, w, h, mmToPx(num(p, "rayon"), ctx.ppi)),
  },
  {
    type: "nettete",
    label: "Netteté",
    group: "Matière",
    params: [
      { key: "rayon", label: "Rayon", kind: "range", min: 0.05, max: 5, step: 0.05, def: 0.4, unit: "mm", rand: "bas" },
      { key: "force", label: "Intensité", kind: "range", min: 0, max: 300, step: 5, def: 120, unit: "%", rand: "tout" },
    ],
    apply(ch, w, h, p, ctx) {
      const b = blur(ch, w, h, mmToPx(num(p, "rayon"), ctx.ppi));
      const a = num(p, "force") / 100;
      const out = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) out[i] = clamp01(ch[i] + a * (ch[i] - b[i]));
      return out;
    },
  },
  {
    type: "grain",
    label: "Grain",
    group: "Matière",
    params: [
      { key: "quantite", label: "Quantité", kind: "range", min: 0, max: 100, step: 1, def: 30, unit: "%", rand: "bas" },
      { key: "taille", label: "Taille du grain", kind: "range", min: 0.03, max: 3, step: 0.01, def: 0.12, unit: "mm", rand: "bas" },
      { key: "doux", label: "Grain doux", kind: "bool", def: false, rand: "tout" },
    ],
    apply(ch, w, h, p, ctx) {
      const q = num(p, "quantite") / 100;
      const size = Math.max(1e-3, num(p, "taille"));
      const soft = Boolean(p.doux);
      const out = new Float32Array(ch.length);
      const s = ctx.seed;
      for (let y = 0; y < h; y++) {
        const ym = ((y + 0.5) / ctx.ppi) * 25.4 / size;
        for (let x = 0; x < w; x++) {
          const xm = ((x + 0.5) / ctx.ppi) * 25.4 / size;
          let n: number;
          if (soft) {
            const xi = Math.floor(xm);
            const yi = Math.floor(ym);
            const fx = xm - xi;
            const fy = ym - yi;
            const a = hash3(xi, yi, s);
            const b = hash3(xi + 1, yi, s);
            const c = hash3(xi, yi + 1, s);
            const d = hash3(xi + 1, yi + 1, s);
            n = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
          } else n = hash3(Math.floor(xm), Math.floor(ym), s);
          const i = y * w + x;
          out[i] = clamp01(ch[i] + (n - 0.5) * q * 1.6);
        }
      }
      return out;
    },
  },
  {
    type: "epaisseur",
    label: "Épaissir / affiner",
    group: "Matière",
    params: [
      { key: "rayon", label: "Rayon", kind: "range", min: -3, max: 3, step: 0.05, def: 0.15, unit: "mm", rand: "tout", hint: "Positif : le trait grossit. Négatif : il s'affine." },
    ],
    apply(ch, w, h, p, ctx) {
      const r = num(p, "rayon");
      return morph(ch, w, h, mmToPx(Math.abs(r), ctx.ppi), r > 0);
    },
  },
  {
    type: "relief",
    label: "Relief",
    group: "Matière",
    params: [
      { key: "angle", label: "Lumière", kind: "range", min: 0, max: 360, step: 1, def: 135, unit: "°", rand: "tout" },
      { key: "profondeur", label: "Profondeur", kind: "range", min: 10, max: 400, step: 5, def: 120, unit: "%", rand: "tout" },
      { key: "rayon", label: "Rayon", kind: "range", min: 0.05, max: 3, step: 0.05, def: 0.25, unit: "mm", rand: "bas" },
    ],
    apply(ch, w, h, p, ctx) {
      const a = (num(p, "angle") * Math.PI) / 180;
      const d = Math.max(0.5, mmToPx(num(p, "rayon"), ctx.ppi));
      const dx = Math.cos(a) * d;
      const dy = Math.sin(a) * d;
      const k = num(p, "profondeur") / 100;
      const out = new Float32Array(ch.length);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const v1 = sampleBilinear(ch, w, h, x + 0.5 + dx, y + 0.5 + dy);
          const v0 = sampleBilinear(ch, w, h, x + 0.5 - dx, y + 0.5 - dy);
          out[y * w + x] = clamp01(0.5 + (v1 - v0) * k * 2);
        }
      return out;
    },
  },
  {
    type: "contours",
    label: "Contours",
    group: "Matière",
    params: [
      { key: "epaisseur", label: "Épaisseur", kind: "range", min: 0.05, max: 3, step: 0.05, def: 0.3, unit: "mm", rand: "bas" },
      { key: "melange", label: "Garder l'original", kind: "range", min: 0, max: 100, step: 1, def: 0, unit: "%", rand: "bas" },
    ],
    apply(ch, w, h, p, ctx) {
      const r = Math.max(1, mmToPx(num(p, "epaisseur"), ctx.ppi) / 2);
      const b = blur(ch, w, h, r);
      const out = new Float32Array(ch.length);
      const m = num(p, "melange") / 100;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const gx = sampleBilinear(b, w, h, x + 0.5 + r, y + 0.5) - sampleBilinear(b, w, h, x + 0.5 - r, y + 0.5);
          const gy = sampleBilinear(b, w, h, x + 0.5, y + 0.5 + r) - sampleBilinear(b, w, h, x + 0.5, y + 0.5 - r);
          const e = clamp01(Math.hypot(gx, gy) * 3);
          const i = y * w + x;
          out[i] = clamp01(e + ch[i] * m);
        }
      return out;
    },
  },
  {
    type: "pixelliser",
    label: "Pixelliser",
    group: "Géométrie",
    params: [{ key: "taille", label: "Taille des blocs", kind: "range", min: 0.2, max: 25, step: 0.1, def: 2, unit: "mm", rand: "bas" }],
    apply(ch, w, h, p, ctx) {
      const s = Math.max(1, mmToPx(num(p, "taille"), ctx.ppi));
      const out = new Float32Array(ch.length);
      const bw = Math.ceil(w / s);
      const bh = Math.ceil(h / s);
      for (let by = 0; by < bh; by++)
        for (let bx = 0; bx < bw; bx++) {
          const x0 = Math.floor(bx * s);
          const y0 = Math.floor(by * s);
          const x1 = Math.min(w, Math.floor((bx + 1) * s));
          const y1 = Math.min(h, Math.floor((by + 1) * s));
          let acc = 0;
          let n = 0;
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { acc += ch[y * w + x]; n++; }
          const v = n ? acc / n : 0;
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out[y * w + x] = v;
        }
      return out;
    },
  },
  {
    type: "miroir",
    label: "Miroir",
    group: "Géométrie",
    params: [
      {
        key: "axe", label: "Axe", kind: "select", def: "gd", rand: "tout",
        options: [["gd", "Gauche → droite"], ["dg", "Droite → gauche"], ["hb", "Haut → bas"], ["bh", "Bas → haut"], ["quad", "Quatre quarts"]],
      },
    ],
    apply(ch, w, h, p) {
      const a = String(p.axe);
      return remap(ch, w, h, (x, y) => {
        if ((a === "gd" || a === "quad") && x > w / 2) x = w - x;
        if (a === "dg" && x < w / 2) x = w - x;
        if ((a === "hb" || a === "quad") && y > h / 2) y = h - y;
        if (a === "bh" && y < h / 2) y = h - y;
        return [x, y];
      });
    },
  },
  {
    type: "kaleido",
    label: "Kaléidoscope",
    group: "Géométrie",
    params: [
      { key: "secteurs", label: "Secteurs", kind: "range", min: 2, max: 24, step: 1, def: 6, rand: "bas" },
      { key: "angle", label: "Rotation", kind: "range", min: 0, max: 360, step: 1, def: 0, unit: "°", rand: "tout" },
      { key: "cx", label: "Centre X", kind: "range", min: 0, max: 100, step: 1, def: 50, unit: "%", rand: "non" },
      { key: "cy", label: "Centre Y", kind: "range", min: 0, max: 100, step: 1, def: 50, unit: "%", rand: "non" },
    ],
    apply(ch, w, h, p) {
      const n = Math.max(2, Math.round(num(p, "secteurs")));
      const seg = (Math.PI * 2) / n;
      const rot = (num(p, "angle") * Math.PI) / 180;
      const cx = (num(p, "cx") / 100) * w;
      const cy = (num(p, "cy") / 100) * h;
      return remap(ch, w, h, (x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy);
        let a = Math.atan2(dy, dx) - rot;
        a = ((a % seg) + seg) % seg;
        if (a > seg / 2) a = seg - a;
        a += rot;
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      });
    },
  },
  {
    type: "repetition",
    label: "Répétition",
    group: "Géométrie",
    params: [
      { key: "nx", label: "Colonnes", kind: "range", min: 1, max: 16, step: 1, def: 3, rand: "bas" },
      { key: "ny", label: "Rangées", kind: "range", min: 1, max: 16, step: 1, def: 3, rand: "bas" },
      { key: "decalage", label: "Décalage des rangées", kind: "range", min: 0, max: 100, step: 1, def: 0, unit: "%", rand: "tout" },
      { key: "alterne", label: "Miroir alterné", kind: "bool", def: false, rand: "tout" },
    ],
    apply(ch, w, h, p) {
      const nx = Math.max(1, Math.round(num(p, "nx")));
      const ny = Math.max(1, Math.round(num(p, "ny")));
      const off = num(p, "decalage") / 100;
      const alt = Boolean(p.alterne);
      const tw = w / nx;
      const th = h / ny;
      return remap(ch, w, h, (x, y) => {
        const row = Math.floor(y / th);
        let xx = x + (row % 2 ? off * tw : 0);
        const col = Math.floor(xx / tw);
        let u = ((xx % tw) + tw) % tw;
        let v = y - row * th;
        if (alt && col % 2) u = tw - u;
        if (alt && row % 2) v = th - v;
        return [u * nx, v * ny];
      });
    },
  },
  {
    type: "onde",
    label: "Onde",
    group: "Déformation",
    params: [
      { key: "amplitude", label: "Amplitude", kind: "range", min: 0, max: 25, step: 0.1, def: 2, unit: "mm", rand: "bas" },
      { key: "longueur", label: "Longueur d'onde", kind: "range", min: 1, max: 150, step: 0.5, def: 18, unit: "mm", rand: "tout" },
      { key: "angle", label: "Direction", kind: "range", min: 0, max: 360, step: 1, def: 0, unit: "°", rand: "tout" },
    ],
    apply(ch, w, h, p, ctx) {
      const amp = mmToPx(num(p, "amplitude"), ctx.ppi);
      const lam = Math.max(1, mmToPx(num(p, "longueur"), ctx.ppi));
      const a = (num(p, "angle") * Math.PI) / 180;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      return remap(ch, w, h, (x, y) => {
        const t = (x * ca + y * sa) / lam;
        const d = Math.sin(t * Math.PI * 2) * amp;
        return [x - sa * d, y + ca * d];
      });
    },
  },
  {
    type: "fonte",
    label: "Fonte",
    group: "Déformation",
    params: [
      { key: "amplitude", label: "Coulure", kind: "range", min: 0, max: 40, step: 0.5, def: 6, unit: "mm", rand: "bas" },
      { key: "echelle", label: "Largeur des coulures", kind: "range", min: 1, max: 200, step: 1, def: 25, unit: "mm", rand: "tout" },
    ],
    apply(ch, w, h, p, ctx) {
      const amp = mmToPx(num(p, "amplitude"), ctx.ppi);
      const sc = Math.max(1, mmToPx(num(p, "echelle"), ctx.ppi));
      const noise = new Perlin(ctx.seed);
      return remap(ch, w, h, (x, y) => {
        const n = (noise.fbm(x / sc, 0.37, 4) + 1) / 2;
        const n2 = noise.fbm(x / sc + 11.3, y / sc, 2);
        return [x + n2 * amp * 0.15, y - n * amp];
      });
    },
  },
  {
    type: "tourbillon",
    label: "Tourbillon",
    group: "Déformation",
    params: [
      { key: "angle", label: "Torsion", kind: "range", min: -720, max: 720, step: 5, def: 180, unit: "°", rand: "tout" },
      { key: "rayon", label: "Rayon", kind: "range", min: 5, max: 150, step: 1, def: 50, unit: "%", rand: "tout" },
    ],
    apply(ch, w, h, p) {
      const tw = (num(p, "angle") * Math.PI) / 180;
      const R = (num(p, "rayon") / 100) * Math.min(w, h) * 0.5;
      const cx = w / 2;
      const cy = h / 2;
      return remap(ch, w, h, (x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy);
        if (r >= R) return [x, y];
        const t = 1 - r / R;
        const a = Math.atan2(dy, dx) + tw * t * t;
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      });
    },
  },
  {
    type: "tranches",
    label: "Tranches glitch",
    group: "Glitch",
    params: [
      { key: "nombre", label: "Nombre de tranches", kind: "range", min: 1, max: 80, step: 1, def: 14, rand: "tout" },
      { key: "decalage", label: "Décalage max", kind: "range", min: 0, max: 60, step: 0.5, def: 8, unit: "mm", rand: "bas" },
      { key: "vertical", label: "Tranches verticales", kind: "bool", def: false, rand: "tout" },
    ],
    apply(ch, w, h, p, ctx) {
      const n = Math.max(1, Math.round(num(p, "nombre")));
      const maxOff = mmToPx(num(p, "decalage"), ctx.ppi);
      const vert = Boolean(p.vertical);
      const r = rng(ctx.seed);
      const cuts: number[] = [];
      for (let i = 0; i < n; i++) cuts.push(r());
      cuts.sort((a, b) => a - b);
      const offs = cuts.map(() => (r() * 2 - 1) * maxOff);
      const len = vert ? w : h;
      return remap(ch, w, h, (x, y) => {
        const t = (vert ? x : y) / len;
        let k = 0;
        while (k < cuts.length && cuts[k] < t) k++;
        const o = k % 2 ? offs[k - 1] : 0;
        return vert ? [x, y + o] : [x + o, y];
      });
    },
  },
  {
    type: "tripixels",
    label: "Tri de pixels",
    group: "Glitch",
    params: [
      { key: "bas", label: "Seuil bas", kind: "range", min: 0, max: 100, step: 1, def: 25, unit: "%", rand: "bas" },
      { key: "haut", label: "Seuil haut", kind: "range", min: 0, max: 100, step: 1, def: 80, unit: "%", rand: "haut" },
      { key: "vertical", label: "Tri vertical", kind: "bool", def: true, rand: "tout" },
      { key: "inverse", label: "Ordre inversé", kind: "bool", def: false, rand: "tout" },
    ],
    apply(ch, w, h, p) {
      const lo = num(p, "bas") / 100;
      const hi = num(p, "haut") / 100;
      const vert = Boolean(p.vertical);
      const inv = Boolean(p.inverse);
      const out = ch.slice();
      const lines = vert ? w : h;
      const len = vert ? h : w;
      const idx = (l: number, i: number) => (vert ? i * w + l : l * w + i);
      const buf: number[] = [];
      for (let l = 0; l < lines; l++) {
        let i = 0;
        while (i < len) {
          if (out[idx(l, i)] < lo || out[idx(l, i)] > hi) { i++; continue; }
          let j = i;
          buf.length = 0;
          while (j < len && out[idx(l, j)] >= lo && out[idx(l, j)] <= hi) buf.push(out[idx(l, j++)]);
          buf.sort((a, b) => (inv ? b - a : a - b));
          for (let k = 0; k < buf.length; k++) out[idx(l, i + k)] = buf[k];
          i = j;
        }
      }
      return out;
    },
  },
  {
    type: "vignette",
    label: "Vignette",
    group: "Tons",
    params: [
      { key: "quantite", label: "Quantité", kind: "range", min: 0, max: 100, step: 1, def: 40, unit: "%", rand: "bas" },
      { key: "douceur", label: "Douceur", kind: "range", min: 5, max: 100, step: 1, def: 60, unit: "%", rand: "tout" },
    ],
    apply(ch, w, h, p) {
      const q = num(p, "quantite") / 100;
      const soft = num(p, "douceur") / 100;
      const out = new Float32Array(ch.length);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const dx = (x / w - 0.5) * 2;
          const dy = (y / h - 0.5) * 2;
          const d = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2;
          const v = clamp01((d - (1 - soft)) / soft);
          const i = y * w + x;
          out[i] = clamp01(ch[i] + v * v * q);
        }
      return out;
    },
  },
];

export const EFFECT_BY_TYPE: Record<string, EffectDef> = Object.fromEntries(EFFECTS.map((e) => [e.type, e]));

export function defaultParams(def: { params: ParamDef[] }): Params {
  const p: Params = {};
  for (const d of def.params) p[d.key] = d.def;
  return p;
}

/** Tire une valeur dans la plage « intéressante » du paramètre (logique du bouton Mosh). */
export function randomParam(d: ParamDef, r: () => number): ParamValue {
  if (d.rand === "non") return d.def;
  if (d.kind === "bool") return r() < 0.5;
  if (d.kind === "select") return d.options![Math.floor(r() * d.options!.length)][0];
  const min = d.min ?? 0;
  const max = d.max ?? 1;
  const span = max - min;
  let lo = min;
  let hi = max;
  if (d.rand === "bas") hi = min + span * 0.4;
  else if (d.rand === "haut") lo = min + span * 0.75;
  const v = lo + r() * (hi - lo);
  const step = d.step ?? 0.01;
  return Math.round(v / step) * step;
}
