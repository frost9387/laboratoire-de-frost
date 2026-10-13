// « Dots » : une grille de points dont la taille suit le ton, à la manière des générateurs en ligne
// (préparation de l'image → grille régulière ou Benday → points mini/maxi, arrondi, bruit).
// Les points peuvent dépasser le pas de la grille : ils se touchent et forment des grappes.
// Tout est réglé en mm et ancré sur la page : l'aperçu, la Loupe et l'export donnent le même dessin.
import type { Params } from "./types.ts";
import { blur } from "./field.ts";
import { hash3, sampleBilinear } from "./util.ts";

const num = (p: Params, k: string, def = 0) => {
  const v = Number(p[k]);
  return Number.isFinite(v) ? v : def;
};

/** Applique Dots à un canal (0 = papier, 1 = encre). */
export function dots(ch: Float32Array, w: number, h: number, p: Params, ppi: number, seed: number, origin = { x: 0, y: 0 }): Float32Array {
  const pxMm = 25.4 / ppi;
  // ---- 1. préparation de l'image : flou, points noir / blanc, gamma, grain
  const flou = Math.max(0, num(p, "flou", 0)) / pxMm;
  let t = flou >= 0.6 ? blur(ch, w, h, flou) : ch;
  const bp = num(p, "noir", 10) / 100;
  const wp = Math.max(bp + 0.01, num(p, "blanc", 85) / 100);
  const gamma = Math.max(0.1, num(p, "gamma", 1.3));
  const grain = num(p, "grain", 10) / 100;
  const tone = new Float32Array(w * h);
  for (let i = 0; i < tone.length; i++) {
    let v = (t[i] - bp) / (wp - bp);
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    tone[i] = Math.pow(v, 1 / gamma);
  }
  t = tone;

  // ---- 2. la grille
  const step = Math.max(0.1, num(p, "pas", 0.6));
  const benday = String(p.grille ?? "reguliere") === "benday";
  const a = (num(p, "angle", 22) * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const dMin = Math.max(0, num(p, "mini", 0)) / 100;
  const dMax = Math.max(dMin, num(p, "maxi", 160) / 100);
  const round = Math.min(1, Math.max(0, num(p, "arrondi", 100) / 100));
  const noise = num(p, "bruit", 35) / 100;
  const seuil = num(p, "seuil", 0) / 100;
  // portée d'un point (en pas de grille) : demi-taille maxi + décalage du bruit
  const reach = Math.ceil(dMax * (1 + noise * 0.3) * 0.5 + noise * 0.5 + 0.5);
  const aa = pxMm / step; // un pixel, en unités de grille (bord adouci)

  // page (mm) → grille ; la grille ne dépend que de la page, pas du champ
  const toU = (x: number, y: number) => (x * ca + y * sa) / step;
  const toV = (x: number, y: number) => (-x * sa + y * ca) / step;
  const toX = (u: number, v: number) => (u * ca - v * sa) * step;
  const toY = (u: number, v: number) => (u * sa + v * ca) * step;

  // centre, taille de chaque point, calculés une fois par cellule de la grille qui couvre le champ
  const Wm = w * pxMm;
  const Hm = h * pxMm;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, y] of [[0, 0], [Wm, 0], [0, Hm], [Wm, Hm]]) {
    const u = toU(x + origin.x, y + origin.y);
    const v = toV(x + origin.x, y + origin.y);
    u0 = Math.min(u0, u); u1 = Math.max(u1, u);
    v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const i0 = Math.floor(u0) - reach - 1;
  const j0 = Math.floor(v0) - reach - 1;
  const gw = Math.floor(u1) + reach + 2 - i0;
  const gh = Math.floor(v1) + reach + 2 - j0;
  const CU = new Float32Array(gw * gh);
  const CV = new Float32Array(gw * gh);
  const CD = new Float32Array(gw * gh);
  for (let jj = 0; jj < gh; jj++)
    for (let ii = 0; ii < gw; ii++) {
      const i = ii + i0;
      const j = jj + j0;
      const off = benday && j & 1 ? 0.5 : 0;
      const u = i + 0.5 + off + (hash3(i, j, seed) - 0.5) * noise;
      const v = j + 0.5 + (hash3(i, j, seed + 17) - 0.5) * noise;
      const xm = toX(u, v) - origin.x;
      const ym = toY(u, v) - origin.y;
      let tv = 0;
      if (xm >= 0 && ym >= 0 && xm <= Wm && ym <= Hm) tv = sampleBilinear(t, w, h, xm / pxMm, ym / pxMm);
      // grain de la préparation : chaque point reçoit un ton un peu différent
      if (grain > 0 && tv > 0.002) tv = Math.min(1, Math.max(0, tv + (hash3(i, j, seed + 41) - 0.5) * grain * 1.2));
      let d = 0;
      if (tv > 0.002 && tv >= seuil) {
        // diamètre : surface proportionnelle au ton, entre le mini et le maxi
        d = Math.sqrt(dMin * dMin + (dMax * dMax - dMin * dMin) * tv);
        d *= 1 + (hash3(i, j, seed + 29) - 0.5) * noise * 0.6;
      }
      const k = jj * gw + ii;
      CU[k] = u;
      CV[k] = v;
      CD[k] = d;
    }

  // ---- 3. rendu : union des points voisins (carré arrondi aligné sur la grille)
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = (y + 0.5) * pxMm + origin.y;
    for (let x = 0; x < w; x++) {
      const xm = (x + 0.5) * pxMm + origin.x;
      const u = toU(xm, ym);
      const v = toV(xm, ym);
      const fi = Math.floor(u);
      const fj = Math.floor(v);
      let best = 0;
      for (let j = fj - reach; j <= fj + reach && best < 1; j++)
        for (let i = fi - reach; i <= fi + reach && best < 1; i++) {
          const ii = i - i0;
          const jj = j - j0;
          if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue;
          const k = jj * gw + ii;
          const d = CD[k];
          if (d <= 0) continue;
          const half = d / 2;
          const qx = Math.abs(u - CU[k]);
          const qy = Math.abs(v - CV[k]);
          if (qx > half + aa || qy > half + aa) continue;
          // distance signée à un carré arrondi (rayon = arrondi × demi-côté)
          const rr = round * half;
          const ex = qx - (half - rr);
          const ey = qy - (half - rr);
          const dist = Math.hypot(Math.max(ex, 0), Math.max(ey, 0)) + Math.min(Math.max(ex, ey), 0) - rr;
          const cov = 0.5 - dist / aa;
          if (cov > best) best = cov > 1 ? 1 : cov;
        }
      out[y * w + x] = best;
    }
  }
  return out;
}
