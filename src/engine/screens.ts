// Tramage à la résolution de sortie. Comme un RIP : le ton continu est calculé à ~300 ppi,
// puis chaque pixel de sortie (jusqu'à 2400 dpi) est tramé à la volée, bande par bande.
import type { ScreenSpec, ScreenType } from "./types.ts";
import { blueNoise, bayer } from "./noise.ts";
import { RD_WAVELENGTH } from "./rd.ts";
import { sampleBilinear } from "./util.ts";

export const SCREEN_TYPES: [ScreenType, string][] = [
  ["aucune", "Aucune (ton continu)"],
  ["am", "AM — points classiques"],
  ["stochastique", "Stochastique — réaction-diffusion"],
  ["fm", "FM — bruit bleu"],
  ["bayer", "Bayer — tramage ordonné"],
  ["diffusion", "Diffusion d'erreur"],
  ["seuil", "Seuil (trait)"],
];

export const AM_SHAPES: [string, string][] = [
  ["rond", "Rond"],
  ["euclidien", "Euclidien (damier à 50 %)"],
  ["ellipse", "Elliptique (chaînette)"],
  ["carre", "Carré"],
  ["losange", "Losange"],
  ["ligne", "Ligne"],
  ["croix", "Croix"],
];

export interface Kernel {
  label: string;
  div: number;
  taps: [number, number, number][];
}

export const KERNELS: Record<string, Kernel> = {
  floyd: { label: "Floyd-Steinberg", div: 16, taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  atkinson: { label: "Atkinson (Mac classique)", div: 8, taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  jarvis: {
    label: "Jarvis-Judice-Ninke", div: 48,
    taps: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]],
  },
  stucki: {
    label: "Stucki", div: 42,
    taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]],
  },
  burkes: { label: "Burkes", div: 32, taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]] },
  sierra: {
    label: "Sierra", div: 32,
    taps: [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]],
  },
  sierra2: { label: "Sierra deux rangées", div: 16, taps: [[1, 0, 4], [2, 0, 3], [-2, 1, 1], [-1, 1, 2], [0, 1, 3], [1, 1, 2], [2, 1, 1]] },
  sierralite: { label: "Sierra Lite", div: 4, taps: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] },
};

export function defaultScreen(over: Partial<ScreenSpec> = {}): ScreenSpec {
  return {
    type: "am",
    lpi: 60,
    angle: 45,
    shape: "rond",
    grainUm: 42,
    kernel: "floyd",
    serpentine: true,
    bayerLevel: 3,
    level: 50,
    rdPreset: "labyrinthe",
    rdScale: 1,
    dotGain: 0,
    minDot: 0,
    maxDot: 100,
    clean: 0,
    ...over,
  };
}

/** Préréglages d'impression courants. */
export const SCREEN_PRESETS: { id: string; label: string; spec: Partial<ScreenSpec> }[] = [
  { id: "offset", label: "Offset couché — AM 150 lpi", spec: { type: "am", lpi: 150, shape: "euclidien", dotGain: 12, minDot: 2, maxDot: 97 } },
  { id: "journal", label: "Journal — AM 85 lpi", spec: { type: "am", lpi: 85, shape: "rond", dotGain: 22, minDot: 4, maxDot: 92 } },
  { id: "serigraphie", label: "Sérigraphie — AM 45 lpi", spec: { type: "am", lpi: 45, shape: "ellipse", dotGain: 15, minDot: 8, maxDot: 90 } },
  { id: "riso", label: "Risographie — FM 60 µm", spec: { type: "fm", grainUm: 60, dotGain: 18, clean: 1 } },
  { id: "stochaster", label: "Organique — stochastique 30 lpi", spec: { type: "stochastique", lpi: 30, rdPreset: "labyrinthe" } },
  { id: "bitmap", label: "Bitmap 1-bit — Atkinson", spec: { type: "diffusion", kernel: "atkinson", grainUm: 85 } },
];

/** Angles anti-moiré standards par plaque CMJN. */
export const CMYK_ANGLES: Record<string, number> = { C: 15, M: 75, Y: 0, K: 45 };

/**
 * Courbe de sortie : compense l'engraissement (modèle parabolique, gain maximal à 50 %),
 * puis applique les limites de point minimal / maximal. Renvoie une table 0..1 → 0..1.
 */
export function toneLUT(spec: ScreenSpec, size = 1024): Float32Array {
  const g = spec.dotGain / 100;
  const mn = spec.minDot / 100;
  const mx = spec.maxDot / 100;
  const lut = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const v = i / (size - 1);
    let u = v;
    if (Math.abs(g) > 1e-4) {
      const a = 1 + 4 * g;
      const disc = a * a - 16 * g * v;
      u = (a - Math.sqrt(Math.max(0, disc))) / (8 * g);
    }
    if (u < 0) u = 0;
    if (u > 1) u = 1;
    if (mn > 0 && u > 0 && u < mn) u = u < mn / 2 ? 0 : mn;
    if (mx < 1 && u > mx && u < 1) u = u > (1 + mx) / 2 ? 1 : mx;
    lut[i] = u;
  }
  return lut;
}

/** Engraissement simulé à l'impression (pour l'épreuvage écran). */
export function printedTone(v: number, gainPct: number): number {
  const g = gainPct / 100;
  return v + 4 * g * v * (1 - v);
}

// --- matrices de seuil mises en cache -------------------------------------------------

const spotCache = new Map<string, Float32Array>();
const SPOT_N = 48;

function spotValue(shape: string, x: number, y: number): number {
  const a = Math.abs(x);
  const b = Math.abs(y);
  switch (shape) {
    case "euclidien":
      return a + b > 1 ? (a - 1) * (a - 1) + (b - 1) * (b - 1) - 1 : 1 - (a * a + b * b);
    case "ellipse":
      return 1 - (a * a * 0.62 + b * b * 1.38);
    case "carre":
      return 1 - Math.max(a, b);
    case "losange":
      return 1 - (a + b);
    case "ligne":
      return 1 - b;
    case "croix":
      return 1 - Math.min(a, b);
    default:
      return 1 - (a * a + b * b);
  }
}

/** Matrice de seuil d'une cellule AM, égalisée par rang : l'aire encrée vaut exactement le ton. */
export function spotTile(shape: string): Float32Array {
  const hit = spotCache.get(shape);
  if (hit) return hit;
  const N = SPOT_N;
  const vals = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N) * 2 - 1;
      const y = ((j + 0.5) / N) * 2 - 1;
      // départage des égalités : le centre de la cellule s'encre en premier
      vals[j * N + i] = -spotValue(shape, x, y) + 1e-5 * (x * x + y * y);
    }
  const idx = Array.from({ length: N * N }, (_, k) => k).sort((p, q) => vals[p] - vals[q]);
  const out = new Float32Array(N * N);
  idx.forEach((k, r) => (out[k] = (r + 0.5) / (N * N)));
  spotCache.set(shape, out);
  return out;
}

let blueTile: Float32Array | null = null;
export function blueNoiseTile(): Float32Array {
  if (!blueTile) blueTile = blueNoise(64, 1337);
  return blueTile;
}

// --- moteur de tramage ----------------------------------------------------------------

export interface ScreenInput {
  spec: ScreenSpec;
  outDpi: number;
  /** Taille totale de la plaque à la résolution de sortie. */
  fullW: number;
  fullH: number;
  /** Ton continu de la plaque et sa résolution. */
  contone: Float32Array;
  cw: number;
  ch: number;
  contonePpi: number;
  /** Matrice stochastique (réaction-diffusion), requise pour le type « stochastique ». */
  rdTile?: { n: number; t: Float32Array };
  /** Multiplicateur du ton (recette d'encre × teinte × couverture d'un objet). */
  gain?: number;
}

/**
 * Renvoie une fonction qui remplit une région [x0,x1)×[y0,y1) de la plaque.
 * Valeurs écrites : 0..255 (quantité d'encre). Les trames donnent 0 ou 255.
 */
export function makeScreener(inp: ScreenInput) {
  const { spec, outDpi, contone, cw, ch, contonePpi } = inp;
  const lut = toneLUT(spec);
  const L = lut.length - 1;
  const scale = contonePpi / outDpi;
  const gain = inp.gain ?? 1;
  const tone = (x: number, y: number) => {
    const v = sampleBilinear(contone, cw, ch, (x + 0.5) * scale, (y + 0.5) * scale) * gain;
    return lut[(v <= 0 ? 0 : v >= 1 ? 1 : v) * L + 0.5 | 0];
  };
  const theta = (spec.angle * Math.PI) / 180;
  const ct = Math.cos(theta);
  const st = Math.sin(theta);

  if (spec.type === "aucune") {
    return (x0: number, y0: number, x1: number, y1: number, out: Uint8Array) => {
      let o = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out[o++] = Math.round(tone(x, y) * 255);
    };
  }

  if (spec.type === "seuil") {
    const lv = spec.level / 100;
    return (x0: number, y0: number, x1: number, y1: number, out: Uint8Array) => {
      let o = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out[o++] = tone(x, y) > lv ? 255 : 0;
    };
  }

  if (spec.type === "am" || spec.type === "stochastique") {
    const cell = outDpi / Math.max(1, spec.lpi);
    let tile: Float32Array;
    let n: number;
    let unit: number; // pixels de sortie par cellule de la matrice
    if (spec.type === "am") {
      tile = spotTile(spec.shape);
      n = SPOT_N;
      unit = cell / n;
    } else {
      if (!inp.rdTile) throw new Error("matrice stochastique manquante");
      tile = inp.rdTile.t;
      n = inp.rdTile.n;
      unit = (cell * Math.max(0.05, spec.rdScale)) / RD_WAVELENGTH;
    }
    const inv = 1 / unit;
    return (x0: number, y0: number, x1: number, y1: number, out: Uint8Array) => {
      let o = 0;
      for (let y = y0; y < y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x < x1; x++) {
          const px = x + 0.5;
          let u = (px * ct + py * st) * inv;
          let v = (-px * st + py * ct) * inv;
          u = Math.floor(u) % n;
          v = Math.floor(v) % n;
          if (u < 0) u += n;
          if (v < 0) v += n;
          out[o++] = tone(x, y) > tile[v * n + u] ? 255 : 0;
        }
      }
    };
  }

  // --- trames sur grille de grains : FM, Bayer, diffusion d'erreur ---
  const g = Math.max(1, (spec.grainUm / 25400) * outDpi);
  const gw = Math.ceil(inp.fullW / g);
  const gh = Math.ceil(inp.fullH / g);
  const cellTone = (gx: number, gy: number) => tone(Math.min(inp.fullW - 1, (gx + 0.5) * g - 0.5), Math.min(inp.fullH - 1, (gy + 0.5) * g - 0.5));

  let gridRow: (gy: number) => Uint8Array;
  if (spec.type === "fm" || spec.type === "bayer") {
    let tile: Float32Array;
    let n: number;
    if (spec.type === "fm") {
      tile = blueNoiseTile();
      n = 64;
    } else {
      const b = bayer(Math.max(1, Math.min(5, spec.bayerLevel)));
      tile = b.m;
      n = b.size;
    }
    gridRow = (gy: number) => {
      const row = new Uint8Array(gw);
      const ty = ((gy % n) + n) % n;
      for (let gx = 0; gx < gw; gx++) row[gx] = cellTone(gx, gy) > tile[ty * n + (gx % n)] ? 1 : 0;
      return row;
    };
  } else {
    const k = KERNELS[spec.kernel] ?? KERNELS.floyd;
    const rows = 3;
    let err = Array.from({ length: rows }, () => new Float32Array(gw + 4));
    let next = 0; // prochaine rangée à calculer
    const done = new Map<number, Uint8Array>();
    gridRow = (gy: number) => {
      const hit = done.get(gy);
      if (hit) return hit;
      if (gy < next) {
        // retour en arrière (loupe) : on repart du haut
        err = Array.from({ length: rows }, () => new Float32Array(gw + 4));
        next = 0;
        done.clear();
      }
      while (next <= gy) {
        const r = next;
        const row = new Uint8Array(gw);
        const rtl = spec.serpentine && r % 2 === 1;
        const e0 = err[0];
        for (let i = 0; i < gw; i++) {
          const gx = rtl ? gw - 1 - i : i;
          const want = cellTone(gx, r) + e0[gx + 2];
          const bit = want > 0.5 ? 1 : 0;
          row[gx] = bit;
          const e = (want - bit) / k.div;
          for (const [dx, dy, wt] of k.taps) {
            const tx = gx + (rtl ? -dx : dx);
            if (tx < 0 || tx >= gw) continue;
            err[dy][tx + 2] += e * wt;
          }
        }
        err.push(err.shift()!.fill(0));
        done.set(r, row);
        if (done.size > 8) done.delete(r - 8);
        next++;
      }
      return done.get(gy)!;
    };
  }

  // nettoyage : retire les grains isolés et bouche les trous isolés
  const cleanN = Math.max(0, Math.min(4, Math.round(spec.clean)));
  const rowCache = new Map<number, Uint8Array>();
  const getRow = (gy: number) => {
    if (gy < 0 || gy >= gh) return null;
    let r = rowCache.get(gy);
    if (!r) {
      r = gridRow(gy);
      rowCache.set(gy, r);
      if (rowCache.size > 6) rowCache.delete(rowCache.keys().next().value!);
    }
    return r;
  };
  const cleanedCache = new Map<number, Uint8Array>();
  const finalRow = (gy: number) => {
    if (cleanN === 0) return getRow(gy)!;
    const hit = cleanedCache.get(gy);
    if (hit) return hit;
    const up = getRow(gy - 1);
    const mid = getRow(gy)!;
    const dn = getRow(gy + 1);
    const out = mid.slice();
    for (let gx = 0; gx < gw; gx++) {
      let inkN = 0;
      let tot = 0;
      for (const r of [up, mid, dn]) {
        if (!r) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (r === mid && dx === 0) continue;
          const x = gx + dx;
          if (x < 0 || x >= gw) continue;
          tot++;
          inkN += r[x];
        }
      }
      if (mid[gx] && inkN < cleanN) out[gx] = 0;
      else if (!mid[gx] && tot - inkN < cleanN) out[gx] = 1;
    }
    cleanedCache.set(gy, out);
    if (cleanedCache.size > 6) cleanedCache.delete(cleanedCache.keys().next().value!);
    return out;
  };

  return (x0: number, y0: number, x1: number, y1: number, out: Uint8Array) => {
    let o = 0;
    for (let y = y0; y < y1; y++) {
      const row = finalRow(Math.floor(y / g));
      for (let x = x0; x < x1; x++) out[o++] = row[Math.floor(x / g)] ? 255 : 0;
    }
  };
}
