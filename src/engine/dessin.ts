// Atelier de dessin → texture : le dessin (tuile raccordable) est transformé par les curseurs
// (croissance organique, rugosité, épaisseur…) puis répété sur la page en unités physiques.
import type { Params } from "./types.ts";
import { RD_PRESETS, simulateRD } from "./rd.ts";
import { Perlin } from "./noise.ts";
import { blur } from "./field.ts";
import { clamp01, hash3, sampleWrap, smoothstep } from "./util.ts";

export interface DessinSlider {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  unit?: string;
  hint: string;
}

/** Tous les paramètres de la texture dessinée (curseurs de l'Atelier). */
export const DESSIN_SLIDERS: DessinSlider[] = [
  { key: "echelle", label: "Échelle du motif", min: 2, max: 200, step: 0.5, def: 30, unit: "mm", hint: "Taille réelle d'une tuile imprimée." },
  { key: "densite", label: "Densité", min: 0, max: 100, step: 1, def: 50, unit: "%", hint: "Plus d'encre ou plus de papier." },
  { key: "contraste", label: "Contraste", min: 0, max: 100, step: 1, def: 50, unit: "%", hint: "Écart entre les zones claires et foncées." },
  { key: "organique", label: "Croissance organique", min: 0, max: 100, step: 1, def: 0, unit: "%", hint: "Fait pousser une réaction-diffusion à partir du trait." },
  { key: "chaos", label: "Chaos", min: 0, max: 100, step: 1, def: 10, unit: "%", hint: "Variations aléatoires entre les répétitions." },
  { key: "epaisseur", label: "Épaisseur du trait", min: -100, max: 100, step: 1, def: 0, unit: "", hint: "Négatif : trait affiné. Positif : trait épaissi." },
  { key: "rugosite", label: "Rugosité", min: 0, max: 100, step: 1, def: 15, unit: "%", hint: "Bords irréguliers, comme une encre qui boit le papier." },
  { key: "direction", label: "Direction", min: 0, max: 360, step: 1, def: 0, unit: "°", hint: "Rotation de tout le motif." },
  { key: "nettete", label: "Netteté des bords", min: 0, max: 100, step: 1, def: 85, unit: "%", hint: "0 : bords fondus. 100 : bords nets." },
  { key: "tons", label: "Nombre de tons", min: 0, max: 16, step: 1, def: 0, unit: "", hint: "0 : continu. 2 : pur noir et blanc." },
  { key: "grain", label: "Grain", min: 0, max: 100, step: 1, def: 10, unit: "%", hint: "Moucheture fine dans la matière." },
  { key: "decalage", label: "Décalage des rangées", min: 0, max: 100, step: 1, def: 0, unit: "%", hint: "Pose en quinconce (brique)." },
  { key: "graine", label: "Graine", min: 1, max: 9999, step: 1, def: 7, unit: "", hint: "Change le tirage aléatoire, à réglages égaux." },
];

export const ORGANIC_PRESETS = Object.keys(RD_PRESETS);

export function defaultDessinParams(): Params {
  const p: Params = { motif: "corail" };
  for (const s of DESSIN_SLIDERS) p[s.key] = s.def;
  return p;
}

const SYNTH_KEYS = ["densite", "contraste", "organique", "epaisseur", "rugosite", "nettete", "tons", "grain", "graine", "motif", "rev"];
export function synthKey(p: Params): string {
  return SYNTH_KEYS.map((k) => `${k}=${p[k]}`).join("&");
}

/** Réduit l'encre du dessin (canal alpha, N×N) à une tuile n×n en flottants. */
export function inkFromRGBA(rgba: Uint8ClampedArray, size: number, n: number): Float32Array {
  const out = new Float32Array(n * n);
  const f = size / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let acc = 0;
      let cnt = 0;
      for (let yy = Math.floor(y * f); yy < Math.floor((y + 1) * f); yy++)
        for (let xx = Math.floor(x * f); xx < Math.floor((x + 1) * f); xx++) {
          acc += rgba[(yy * size + xx) * 4 + 3];
          cnt++;
        }
      out[y * n + x] = cnt ? acc / cnt / 255 : 0;
    }
  return out;
}

/** Transforme le dessin en tuile de texture (raccordable). */
export function synthDessinTile(ink: Float32Array, n: number, p: Params): Float32Array {
  const seed = Number(p.graine) || 1;
  const o = Number(p.organique) / 100;
  let t = blur(ink, n, n, 1.2, true);
  if (o > 0.001) {
    const preset = RD_PRESETS[String(p.motif)] ?? RD_PRESETS.corail;
    const rd = simulateRD(n, preset.f, preset.k, Math.round(300 + o * 3200), seed, t);
    for (let i = 0; i < t.length; i++) t[i] = t[i] * (1 - o) + rd[i] * o;
  }
  const rug = Number(p.rugosite) / 100;
  const grain = Number(p.grain) / 100;
  const noise = new Perlin(seed);
  const period = 8;
  const c = 0.5 - (Number(p.epaisseur) / 100) * 0.3 - (Number(p.densite) - 50) / 100 * 0.5;
  const gain = 0.4 + (Number(p.contraste) / 100) * 1.6;
  const width = (1 - Number(p.nettete) / 100) * 0.45 + 0.004;
  const tons = Math.round(Number(p.tons));
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      let v = t[i];
      if (rug > 0) v += noise.fbm((x / n) * period, (y / n) * period, 4, 0.55, period) * rug * 0.35;
      if (grain > 0) v += (hash3(x, y, seed) - 0.5) * grain * 0.5;
      v = (v - c) * gain + c;
      v = smoothstep(c - width, c + width, v);
      if (tons >= 2) v = Math.round(v * (tons - 1)) / (tons - 1);
      out[i] = clamp01(v);
    }
  return out;
}

/** Lit la texture dessinée en un point de la page (mm), avec répétition, chaos, direction et décalage. */
export function makeDessinSampler(tile: Float32Array, n: number, p: Params) {
  const scale = Math.max(0.5, Number(p.echelle));
  const chaos = Number(p.chaos) / 100;
  const dir = (Number(p.direction) * Math.PI) / 180;
  const cd = Math.cos(dir);
  const sd = Math.sin(dir);
  const off = Number(p.decalage) / 100;
  const seed = Number(p.graine) || 1;
  const warp = new Perlin(seed + 101);
  return (xMm: number, yMm: number) => {
    let u = (xMm * cd + yMm * sd) / scale;
    let v = (-xMm * sd + yMm * cd) / scale;
    if (chaos > 0) {
      u += warp.noise(u * 0.9, v * 0.9) * chaos * 0.18;
      v += warp.noise(u * 0.9 + 17.1, v * 0.9) * chaos * 0.18;
    }
    const row = Math.floor(v);
    u += row * off;
    const col = Math.floor(u);
    let fu = u - col;
    let fv = v - row;
    if (chaos > 0) {
      const h1 = hash3(col, row, seed);
      const h2 = hash3(col, row, seed + 31);
      fu += (h1 - 0.5) * chaos;
      fv += (h2 - 0.5) * chaos;
      if (chaos > 0.35 && hash3(col, row, seed + 77) < chaos * 0.6) {
        const q = Math.floor(hash3(col, row, seed + 91) * 4);
        for (let k = 0; k < q; k++) {
          const t = fu;
          fu = fv;
          fv = 1 - t;
        }
      }
    }
    return sampleWrap(tile, n, fu * n, fv * n);
  };
}
