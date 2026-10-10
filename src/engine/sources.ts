// Sources de texture : ce qui alimente une couche avant la pile d'effets.
import type { Asset, Intent, Params, SourceSpec, SourceType } from "./types.ts";
import type { ParamDef } from "./effects.ts";
import type { ColorEngine } from "./color.ts";
import { makeField, type Field } from "./field.ts";
import { Perlin, worley } from "./noise.ts";
import { RD_PRESETS, simulateRD } from "./rd.ts";
import { defaultDessinParams, inkFromRGBA, makeDessinSampler, synthDessinTile, synthKey } from "./dessin.ts";
import { clamp01, hash3, sampleWrap } from "./util.ts";

export interface SourceDef {
  type: SourceType;
  label: string;
  params: ParamDef[];
}

const rdOptions = Object.entries(RD_PRESETS).map(([k, v]) => [k, v.label] as [string, string]);

export const SOURCE_DEFS: SourceDef[] = [
  {
    type: "rd",
    label: "Réaction-diffusion",
    params: [
      { key: "motif", label: "Motif", kind: "select", def: "labyrinthe", options: rdOptions },
      { key: "tuile", label: "Taille de la tuile", kind: "range", min: 3, max: 200, step: 0.5, def: 24, unit: "mm" },
      { key: "croissance", label: "Croissance", kind: "range", min: 300, max: 9000, step: 100, def: 3200, unit: "it.", hint: "Durée de la réaction : plus long = motif plus régulier." },
      { key: "angle", label: "Rotation", kind: "range", min: 0, max: 360, step: 1, def: 0, unit: "°" },
      { key: "contraste", label: "Contraste", kind: "range", min: 0, max: 300, step: 5, def: 100, unit: "%" },
      { key: "graine", label: "Graine", kind: "range", min: 1, max: 9999, step: 1, def: 3 },
    ],
  },
  {
    type: "bruit",
    label: "Bruit procédural",
    params: [
      {
        key: "type", label: "Type", kind: "select", def: "nuages",
        options: [["nuages", "Nuages (fBm)"], ["turbulence", "Turbulence"], ["cretes", "Crêtes"], ["cellules", "Cellules (Worley)"], ["reseau", "Réseau cellulaire"], ["fibres", "Fibres de papier"], ["blanc", "Bruit blanc"]],
      },
      { key: "echelle", label: "Échelle", kind: "range", min: 0.2, max: 200, step: 0.1, def: 14, unit: "mm" },
      { key: "octaves", label: "Détail (octaves)", kind: "range", min: 1, max: 8, step: 1, def: 5 },
      { key: "contraste", label: "Contraste", kind: "range", min: 0, max: 400, step: 5, def: 140, unit: "%" },
      { key: "densite", label: "Densité", kind: "range", min: 0, max: 100, step: 1, def: 50, unit: "%" },
      { key: "etirement", label: "Étirement", kind: "range", min: 0.1, max: 10, step: 0.1, def: 1 },
      { key: "angle", label: "Direction", kind: "range", min: 0, max: 360, step: 1, def: 0, unit: "°" },
      { key: "graine", label: "Graine", kind: "range", min: 1, max: 9999, step: 1, def: 11 },
    ],
  },
  {
    type: "image",
    label: "Image importée",
    params: [
      { key: "ajustement", label: "Ajustement", kind: "select", def: "couvrir", options: [["couvrir", "Remplir la page"], ["contenir", "Contenir"], ["etirer", "Étirer"]] },
      { key: "echelle", label: "Échelle", kind: "range", min: 10, max: 400, step: 1, def: 100, unit: "%" },
      { key: "decalX", label: "Décalage X", kind: "range", min: -100, max: 100, step: 1, def: 0, unit: "%" },
      { key: "decalY", label: "Décalage Y", kind: "range", min: -100, max: 100, step: 1, def: 0, unit: "%" },
      {
        key: "gris", label: "Conversion en gris", kind: "select", def: "lum709",
        options: [["lum709", "Luminance Rec.709"], ["lum601", "Luminance Rec.601"], ["moyenne", "Moyenne"], ["r", "Canal rouge"], ["g", "Canal vert"], ["b", "Canal bleu"]],
      },
      { key: "separation", label: "En mode CMJN", kind: "select", def: "cmjn", options: [["cmjn", "Séparer via le profil"], ["gris", "Une seule encre"]] },
    ],
  },
  { type: "dessin", label: "Dessin (Atelier)", params: [] },
  {
    type: "aplat",
    label: "Aplat",
    params: [{ key: "densite", label: "Couverture", kind: "range", min: 0, max: 100, step: 1, def: 40, unit: "%" }],
  },
];

export const SOURCE_BY_TYPE: Record<string, SourceDef> = Object.fromEntries(SOURCE_DEFS.map((s) => [s.type, s]));

export function defaultSource(type: SourceType): SourceSpec {
  if (type === "dessin") return { type, params: defaultDessinParams() };
  const p: Params = {};
  for (const d of SOURCE_BY_TYPE[type].params) p[d.key] = d.def;
  return { type, params: p };
}

export interface SourceCtx {
  w: number;
  h: number;
  ppi: number;
  mode: string;
  assets: Map<string, Asset>;
  color: ColorEngine | null;
  profileId: string;
  intent: Intent;
  bpc: boolean;
  cache: Map<string, unknown>;
}

function cached<T>(cache: Map<string, unknown>, key: string, make: () => T): T {
  if (cache.has(key)) return cache.get(key) as T;
  const v = make();
  cache.set(key, v);
  if (cache.size > 40) cache.delete(cache.keys().next().value!);
  return v;
}

export const RD_TILE_N = 256;

/** Tuile réaction-diffusion mise en cache (coûteuse : ~1 s). */
export function rdTile(cache: Map<string, unknown>, preset: string, iterations: number, seed: number, n = RD_TILE_N): Float32Array {
  const pr = RD_PRESETS[preset] ?? RD_PRESETS.labyrinthe;
  return cached(cache, `rd|${preset}|${iterations}|${seed}|${n}`, () => simulateRD(n, pr.f, pr.k, iterations, seed));
}

export function generateSource(src: SourceSpec, ctx: SourceCtx): Field {
  const { w, h, ppi } = ctx;
  const p = src.params;
  const mmAt = (i: number) => ((i + 0.5) / ppi) * 25.4;

  switch (src.type) {
    case "aplat":
      return makeField(w, h, 1, clamp01(Number(p.densite) / 100));

    case "rd": {
      const n = RD_TILE_N;
      const tile = rdTile(ctx.cache, String(p.motif), Number(p.croissance), Number(p.graine));
      const f = makeField(w, h, 1);
      const sz = Math.max(0.5, Number(p.tuile));
      const a = (Number(p.angle) * Math.PI) / 180;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const k = Number(p.contraste) / 100;
      const out = f.ch[0];
      for (let y = 0; y < h; y++) {
        const ym = mmAt(y);
        for (let x = 0; x < w; x++) {
          const xm = mmAt(x);
          const u = ((xm * ca + ym * sa) / sz) * n;
          const v = ((-xm * sa + ym * ca) / sz) * n;
          out[y * w + x] = clamp01((sampleWrap(tile, n, u, v) - 0.5) * k + 0.5);
        }
      }
      return f;
    }

    case "bruit": {
      const f = makeField(w, h, 1);
      const out = f.ch[0];
      const seed = Number(p.graine);
      const noise = new Perlin(seed);
      const sc = Math.max(0.05, Number(p.echelle));
      const oct = Math.round(Number(p.octaves));
      const k = Number(p.contraste) / 100;
      const bias = (Number(p.densite) - 50) / 100;
      const st = Math.max(0.05, Number(p.etirement));
      const a = (Number(p.angle) * Math.PI) / 180;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const type = String(p.type);
      for (let y = 0; y < h; y++) {
        const ym = mmAt(y);
        for (let x = 0; x < w; x++) {
          const xm = mmAt(x);
          const u = ((xm * ca + ym * sa) / sc) / st;
          const v = (-xm * sa + ym * ca) / sc;
          let val: number;
          switch (type) {
            case "turbulence": {
              let s = 0, amp = 1, nrm = 0, fq = 1;
              for (let o = 0; o < oct; o++) { s += amp * Math.abs(noise.noise(u * fq, v * fq)); nrm += amp; amp *= 0.5; fq *= 2; }
              val = (s / nrm) * 1.6;
              break;
            }
            case "cretes": {
              let s = 0, amp = 1, nrm = 0, fq = 1;
              for (let o = 0; o < oct; o++) { const r = 1 - Math.abs(noise.noise(u * fq, v * fq)); s += amp * r * r; nrm += amp; amp *= 0.5; fq *= 2; }
              val = s / nrm;
              break;
            }
            case "cellules":
              val = 1 - Math.min(1, worley(u, v, seed)[0]);
              break;
            case "reseau": {
              const [f1, f2] = worley(u, v, seed);
              val = 1 - Math.min(1, (f2 - f1) * 4);
              break;
            }
            case "fibres": {
              const n1 = noise.fbm(u * 0.25, v * 6, oct, 0.6);
              const n2 = hash3(Math.floor(xm / 0.04), Math.floor(ym / 0.04), seed) - 0.5;
              val = 0.5 + n1 * 0.6 + n2 * 0.15;
              break;
            }
            case "blanc":
              val = hash3(Math.floor(u * 4), Math.floor(v * 4), seed);
              break;
            default:
              val = noise.fbm(u, v, oct) * 0.5 + 0.5;
          }
          out[y * w + x] = clamp01((val - 0.5) * k + 0.5 + bias);
        }
      }
      return f;
    }

    case "image": {
      const asset = src.assetId ? ctx.assets.get(src.assetId) : undefined;
      if (!asset?.rgba) return makeField(w, h, 1, 0);
      const sep = ctx.mode === "cmjn" && p.separation === "cmjn";
      const iw = asset.width;
      const ih = asset.height;
      const fit = String(p.ajustement);
      const sc = Number(p.echelle) / 100;
      let dw: number, dh: number;
      if (fit === "etirer") { dw = w; dh = h; }
      else {
        const r = fit === "contenir" ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
        dw = iw * r;
        dh = ih * r;
      }
      dw *= sc;
      dh *= sc;
      const ox = (w - dw) / 2 + (Number(p.decalX) / 100) * w;
      const oy = (h - dh) / 2 + (Number(p.decalY) / 100) * h;
      const N = w * h;
      const rgb = new Uint8Array(N * 3);
      const inside = new Uint8Array(N);
      const px = asset.rgba;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const sx = ((x + 0.5 - ox) / dw) * iw - 0.5;
          const sy = ((y + 0.5 - oy) / dh) * ih - 0.5;
          const i = y * w + x;
          if (sx < -0.5 || sy < -0.5 || sx > iw - 0.5 || sy > ih - 0.5) {
            rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = 255;
            continue;
          }
          inside[i] = 1;
          const x0 = Math.max(0, Math.min(iw - 1, Math.floor(sx)));
          const y0 = Math.max(0, Math.min(ih - 1, Math.floor(sy)));
          const x1 = Math.min(iw - 1, x0 + 1);
          const y1 = Math.min(ih - 1, y0 + 1);
          const fx = Math.max(0, Math.min(1, sx - x0));
          const fy = Math.max(0, Math.min(1, sy - y0));
          for (let c = 0; c < 3; c++) {
            const a = px[(y0 * iw + x0) * 4 + c];
            const b = px[(y0 * iw + x1) * 4 + c];
            const cc = px[(y1 * iw + x0) * 4 + c];
            const d = px[(y1 * iw + x1) * 4 + c];
            const alpha = px[(y0 * iw + x0) * 4 + 3] / 255;
            const v = a + (b - a) * fx + (cc - a) * fy + (a - b - cc + d) * fx * fy;
            rgb[i * 3 + c] = Math.round(v * alpha + 255 * (1 - alpha));
          }
        }
      }
      if (sep && ctx.color) {
        const cmyk = ctx.color.srgbToCmyk(ctx.profileId, rgb, N, ctx.intent, ctx.bpc);
        const f = makeField(w, h, 4);
        for (let i = 0; i < N; i++) for (let c = 0; c < 4; c++) f.ch[c][i] = cmyk[i * 4 + c] / 255;
        return f;
      }
      const f = makeField(w, h, 1);
      const mode = String(p.gris);
      for (let i = 0; i < N; i++) {
        const r = rgb[i * 3] / 255, g = rgb[i * 3 + 1] / 255, b = rgb[i * 3 + 2] / 255;
        let lum: number;
        switch (mode) {
          case "lum601": lum = 0.299 * r + 0.587 * g + 0.114 * b; break;
          case "moyenne": lum = (r + g + b) / 3; break;
          case "r": lum = r; break;
          case "g": lum = g; break;
          case "b": lum = b; break;
          default: lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
        f.ch[0][i] = 1 - lum;
      }
      return f;
    }

    case "dessin": {
      const asset = src.assetId ? ctx.assets.get(src.assetId) : undefined;
      if (!asset?.rgba) return makeField(w, h, 1, 0);
      const n = 256;
      const tile = dessinTile(ctx.cache, asset, p, n);
      const sample = makeDessinSampler(tile, n, p);
      const f = makeField(w, h, 1);
      const out = f.ch[0];
      for (let y = 0; y < h; y++) {
        const ym = mmAt(y);
        for (let x = 0; x < w; x++) out[y * w + x] = sample(mmAt(x), ym);
      }
      return f;
    }
  }
  return makeField(w, h, 1, 0);
}

export function dessinTile(cache: Map<string, unknown>, asset: Asset, p: Params, n = 256): Float32Array {
  return cached(cache, `dessin|${asset.id}|${synthKey(p)}|${n}`, () =>
    synthDessinTile(inkFromRGBA(asset.rgba ?? new Uint8ClampedArray(asset.width * asset.width * 4), asset.width, n), n, p),
  );
}
