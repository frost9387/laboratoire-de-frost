// Bruits procéduraux reproductibles (graine) et optionnellement raccordables (période entière).
import { rng, hash3 } from "./util.ts";

const GRADS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071],
];

export class Perlin {
  private perm = new Uint8Array(512);

  constructor(seed: number) {
    const r = rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Bruit de gradient ~[-1, 1]. `period` > 0 rend le bruit périodique (raccordable). */
  noise(x: number, y: number, period = 0): number {
    let xi = Math.floor(x);
    let yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    let xi1 = xi + 1;
    let yi1 = yi + 1;
    if (period > 0) {
      xi = ((xi % period) + period) % period;
      yi = ((yi % period) + period) % period;
      xi1 = (xi + 1) % period;
      yi1 = (yi + 1) % period;
    }
    const P = this.perm;
    const g = (ix: number, iy: number, dx: number, dy: number) => {
      const gr = GRADS[P[(P[ix & 255] + iy) & 511] & 7];
      return gr[0] * dx + gr[1] * dy;
    };
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const n00 = g(xi, yi, xf, yf);
    const n10 = g(xi1, yi, xf - 1, yf);
    const n01 = g(xi, yi1, xf, yf - 1);
    const n11 = g(xi1, yi1, xf - 1, yf - 1);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.42;
  }

  /** Mouvement brownien fractal ~[-1, 1]. */
  fbm(x: number, y: number, octaves: number, gain = 0.5, period = 0): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * f, y * f, period > 0 ? period * f : 0);
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }
}

/** Bruit cellulaire (Worley) : distance au point caractéristique le plus proche (F1) et suivant (F2). */
export function worley(x: number, y: number, seed: number, period = 0): [number, number] {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      let cx = xi + dx;
      let cy = yi + dy;
      let hx = cx;
      let hy = cy;
      if (period > 0) {
        hx = ((cx % period) + period) % period;
        hy = ((cy % period) + period) % period;
      }
      const px = cx + hash3(hx, hy, seed);
      const py = cy + hash3(hx, hy, seed + 7919);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  }
  return [f1, f2];
}

/** Matrice de seuil « bruit bleu » par la méthode void-and-cluster (Ulichney). Valeurs [0,1). */
export function blueNoise(size: number, seed: number): Float32Array {
  const n = size * size;
  const sigma = 1.5;
  const r = rng(seed);
  // noyau gaussien périodique
  const kr = 6;
  const kern: number[] = [];
  for (let dy = -kr; dy <= kr; dy++)
    for (let dx = -kr; dx <= kr; dx++) kern.push(Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)));
  const energy = new Float64Array(n);
  const bits = new Uint8Array(n);
  const addPoint = (i: number, sign: number) => {
    const x0 = i % size;
    const y0 = (i / size) | 0;
    let k = 0;
    for (let dy = -kr; dy <= kr; dy++) {
      const y = (y0 + dy + size) % size;
      for (let dx = -kr; dx <= kr; dx++) {
        const x = (x0 + dx + size) % size;
        energy[y * size + x] += sign * kern[k++];
      }
    }
  };
  // motif initial : ~10 % de points aléatoires
  const initial = Math.max(1, Math.floor(n * 0.1));
  let placed = 0;
  while (placed < initial) {
    const i = Math.floor(r() * n);
    if (!bits[i]) {
      bits[i] = 1;
      addPoint(i, 1);
      placed++;
    }
  }
  const tightestCluster = () => {
    let best = -1;
    let bv = -Infinity;
    for (let i = 0; i < n; i++) if (bits[i] && energy[i] > bv) { bv = energy[i]; best = i; }
    return best;
  };
  const largestVoid = () => {
    let best = -1;
    let bv = Infinity;
    for (let i = 0; i < n; i++) if (!bits[i] && energy[i] < bv) { bv = energy[i]; best = i; }
    return best;
  };
  // équilibrage du motif initial
  for (let guard = 0; guard < n; guard++) {
    const c = tightestCluster();
    bits[c] = 0;
    addPoint(c, -1);
    const v = largestVoid();
    if (v === c) {
      bits[c] = 1;
      addPoint(c, 1);
      break;
    }
    bits[v] = 1;
    addPoint(v, 1);
  }
  const rank = new Int32Array(n).fill(-1);
  const proto = bits.slice();
  const protoEnergy = energy.slice();
  // phase 1 : retire les points du motif initial
  let ones = initial;
  while (ones > 0) {
    const c = tightestCluster();
    bits[c] = 0;
    addPoint(c, -1);
    ones--;
    rank[c] = ones;
  }
  // phase 2 et 3 : remplit les vides depuis le motif initial
  bits.set(proto);
  energy.set(protoEnergy);
  let count = initial;
  while (count < n) {
    const v = largestVoid();
    bits[v] = 1;
    addPoint(v, 1);
    rank[v] = count++;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (rank[i] + 0.5) / n;
  return out;
}

/** Matrice de Bayer 2^level × 2^level, valeurs [0,1). */
export function bayer(level: number): { size: number; m: Float32Array } {
  let m = [0];
  let size = 1;
  for (let l = 0; l < level; l++) {
    const ns = size * 2;
    const nm = new Array(ns * ns);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const v = m[y * size + x] * 4;
        nm[y * ns + x] = v;
        nm[y * ns + x + size] = v + 2;
        nm[(y + size) * ns + x] = v + 3;
        nm[(y + size) * ns + x + size] = v + 1;
      }
    m = nm;
    size = ns;
  }
  const n = size * size;
  return { size, m: Float32Array.from(m, (v) => (v + 0.5) / n) };
}
