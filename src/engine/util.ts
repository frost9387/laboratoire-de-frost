// Outils numériques partagés (aléatoire reproductible, interpolation, conversions d'unités).

export const MM_PER_INCH = 25.4;

export function mmToPx(mm: number, ppi: number): number {
  return (mm / MM_PER_INCH) * ppi;
}

export function pxToMm(px: number, ppi: number): number {
  return (px / ppi) * MM_PER_INCH;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-9));
  return t * t * (3 - 2 * t);
}

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hachage entier → flottant [0,1) pour des valeurs aléatoires indexées (x, y, graine). */
export function hash3(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Hache une chaîne (clé de cache). */
export function hashString(s: string): string {
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

export function uid(prefix = "id"): string {
  return prefix + "_" + Math.random().toString(36).slice(2, 9);
}

/** Échantillonnage bilinéaire d'un canal (bords : clamp). */
export function sampleBilinear(ch: Float32Array, w: number, h: number, x: number, y: number): number {
  x -= 0.5;
  y -= 0.5;
  if (x < 0) x = 0;
  else if (x > w - 1) x = w - 1;
  if (y < 0) y = 0;
  else if (y > h - 1) y = h - 1;
  const x0 = x | 0;
  const y0 = y | 0;
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  const a = ch[y0 * w + x0];
  const b = ch[y0 * w + x1];
  const c = ch[y1 * w + x0];
  const d = ch[y1 * w + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Échantillonnage bilinéaire périodique (tuile raccordable). */
export function sampleWrap(ch: Float32Array, n: number, x: number, y: number): number {
  x -= 0.5;
  y -= 0.5;
  const xf = Math.floor(x);
  const yf = Math.floor(y);
  const fx = x - xf;
  const fy = y - yf;
  const x0 = ((xf % n) + n) % n;
  const y0 = ((yf % n) + n) % n;
  const x1 = (x0 + 1) % n;
  const y1 = (y0 + 1) % n;
  const a = ch[y0 * n + x0];
  const b = ch[y0 * n + x1];
  const c = ch[y1 * n + x0];
  const d = ch[y1 * n + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Égalise un champ par rang : le résultat est uniformément réparti dans [0,1). */
export function rankEqualize(src: Float32Array): Float32Array {
  const n = src.length;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => src[a] - src[b]);
  const out = new Float32Array(n);
  for (let r = 0; r < n; r++) out[idx[r]] = (r + 0.5) / n;
  return out;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (x: number) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}

export function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return clamp(Math.round(c * 255), 0, 255);
}
