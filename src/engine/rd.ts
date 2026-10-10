// Réaction-diffusion de Gray-Scott sur une grille torique (le motif est donc raccordable).
// Coefficients de diffusion et valeurs feed/kill : démo WebGL de pmneila (Du 0.2097, Dv 0.105)
// et Karl Sims pour le corail. Les régimes F/k ne dépendent que du rapport Du/Dv.
import { rng } from "./util.ts";

export interface RDPreset {
  label: string;
  f: number;
  k: number;
}

export const RD_PRESETS: Record<string, RDPreset> = {
  labyrinthe: { label: "Labyrinthe", f: 0.029, k: 0.057 },
  empreintes: { label: "Empreintes", f: 0.037, k: 0.06 },
  vers: { label: "Vers", f: 0.078, k: 0.061 },
  corail: { label: "Corail", f: 0.0545, k: 0.062 },
  taches: { label: "Taches", f: 0.03, k: 0.062 },
  mitose: { label: "Mitose", f: 0.0367, k: 0.0649 },
  bulles: { label: "Bulles", f: 0.039, k: 0.058 },
  chaos: { label: "Chaos", f: 0.026, k: 0.051 },
  boucles: { label: "Boucles", f: 0.018, k: 0.051 },
  ondes: { label: "Ondes", f: 0.014, k: 0.045 },
  uskate: { label: "U-Skate", f: 0.062, k: 0.06093 },
};

/**
 * Longueur d'onde typique du motif, en cellules de simulation. tests/engine.test.ts mesure ~20,6
 * le long d'une ligne quelconque ; perpendiculairement aux bandes, cela fait ≈ 20,6 × 2/π ≈ 13.
 */
export const RD_WAVELENGTH = 13;

const DU = 0.2097;
const DV = 0.105;

/**
 * Simule le motif et renvoie la concentration V normalisée [0,1] (n×n).
 * `init` (optionnel, n×n, 0..1) sert de germe : un dessin peut « faire pousser » le motif.
 */
export function simulateRD(
  n: number,
  f: number,
  k: number,
  iterations: number,
  seed: number,
  init?: Float32Array,
): Float32Array {
  const N = n * n;
  let U = new Float32Array(N).fill(1);
  let V = new Float32Array(N);
  const r = rng(seed);
  if (init) {
    for (let i = 0; i < N; i++) {
      const g = init[i];
      if (g > 0.05) {
        V[i] = 0.5 * Math.min(1, g * 1.5) + 0.02 * r();
        U[i] = 1 - V[i];
      }
    }
  }
  // germes aléatoires (carrés de 3×3), plus clairsemés si un dessin sert déjà de germe
  const spots = Math.max(4, Math.round(N / (init ? 2400 : 300)));
  for (let s = 0; s < spots; s++) {
    const cx = Math.floor(r() * n);
    const cy = Math.floor(r() * n);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const i = ((cy + dy + n) % n) * n + ((cx + dx + n) % n);
        U[i] = 0.5;
        V[i] = 0.25 + 0.05 * r();
      }
  }
  let U2 = new Float32Array(N);
  let V2 = new Float32Array(N);
  const fk = f + k;
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < n; y++) {
      const row = y * n;
      const up = ((y + n - 1) % n) * n;
      const dn = ((y + 1) % n) * n;
      for (let x = 0; x < n; x++) {
        const xl = x === 0 ? n - 1 : x - 1;
        const xr = x === n - 1 ? 0 : x + 1;
        const i = row + x;
        const u = U[i];
        const v = V[i];
        const lu = U[row + xl] + U[row + xr] + U[up + x] + U[dn + x] - 4 * u;
        const lv = V[row + xl] + V[row + xr] + V[up + x] + V[dn + x] - 4 * v;
        const uvv = u * v * v;
        U2[i] = u + DU * lu - uvv + f * (1 - u);
        V2[i] = v + DV * lv + uvv - fk * v;
      }
    }
    let t = U;
    U = U2;
    U2 = t;
    t = V;
    V = V2;
    V2 = t;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < N; i++) {
    if (V[i] < lo) lo = V[i];
    if (V[i] > hi) hi = V[i];
  }
  const span = hi - lo || 1;
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = (V[i] - lo) / span;
  return out;
}
