// « Frost's Special » : crayon gras sur papier grainé, lignes gravées qui suivent un tracé
// (échos des formes, courbes de niveau, ondes, tourbillon), gouges blanches et stries de pinceau.
//
// Principe : on seuille le ton contre une MATRICE de seuil faite de deux ingrédients mélangés,
//  - le grain du papier (bruit en grumeaux + stries étirées le long du tracé) → rendu crayon / litho ;
//  - un écran de lignes (distance au trait le plus proche du tracé) → rendu gravure / peigne.
// Les deux sont égalisés : la part d'encre suit le ton, quel que soit le mélange.
// Tous les réglages sont en mm : l'aperçu et l'export à 2400 dpi donnent le même dessin.
import type { Params } from "./types.ts";
import { blur } from "./field.ts";
import { Perlin } from "./noise.ts";
import { rng, sampleBilinear } from "./util.ts";

const TEX = 512;
const MASK = TEX - 1;
const lattices = new Map<number, Float32Array>();

/** Réseau de bruit blanc raccordable (512²), mis en cache par graine. */
function lattice(seed: number): Float32Array {
  let t = lattices.get(seed);
  if (!t) {
    const r = rng(seed);
    t = new Float32Array(TEX * TEX);
    for (let i = 0; i < t.length; i++) t[i] = r();
    lattices.set(seed, t);
    if (lattices.size > 16) lattices.delete(lattices.keys().next().value!);
  }
  return t;
}

/** Bruit de valeur (interpolation douce) sur un réseau 512² périodique. */
function vn(t: Float32Array, u: number, v: number): number {
  const xf = Math.floor(u);
  const yf = Math.floor(v);
  let fx = u - xf;
  let fy = v - yf;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const x0 = xf & MASK;
  const y0 = yf & MASK;
  const x1 = (x0 + 1) & MASK;
  const y1 = (y0 + 1) & MASK;
  const a = t[y0 * TEX + x0];
  const b = t[y0 * TEX + x1];
  const c = t[y1 * TEX + x0];
  const d = t[y1 * TEX + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fonction de répartition estimée sur un échantillon : sert à égaliser une matrice de seuil. */
class Cdf {
  private table = new Float32Array(4097);
  private lo: number;
  private span: number;
  constructor(samples: Float32Array) {
    const s = Float32Array.from(samples).sort();
    this.lo = s[0];
    this.span = Math.max(1e-9, s[s.length - 1] - s[0]);
    let k = 0;
    for (let b = 0; b <= 4096; b++) {
      const edge = this.lo + (b / 4096) * this.span;
      while (k < s.length && s[k] <= edge) k++;
      this.table[b] = k / s.length;
    }
  }
  at(v: number): number {
    const x = ((v - this.lo) / this.span) * 4096;
    if (x <= 0) return 0;
    if (x >= 4096) return 1;
    const i = x | 0;
    return this.table[i] + (this.table[i + 1] - this.table[i]) * (x - i);
  }
}

/** Transformée de distance exacte (Felzenszwalb) sur une ligne : `f` = coût, résultat = distance². */
function dt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Distance (en cellules) de chaque cellule à la source la plus proche (`src[i]` vrai). */
function distanceField(src: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20;
  const g = new Float64Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = src[i] ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    dt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    dt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(g[i]);
  return out;
}

const num = (p: Params, k: string, def = 0) => {
  const v = Number(p[k]);
  return Number.isFinite(v) ? v : def;
};

/**
 * Le « tracé » ψ (en mm) sur une grille grossière : les lignes gravées sont ses courbes de niveau,
 * les stries de pinceau courent le long de ces courbes.
 */
function tracePsi(src: Float32Array, w: number, h: number, pxMm: number, p: Params, seed: number) {
  const sp = Math.max(0.2, num(p, "ecart", 1.4));
  const Wmm = w * pxMm;
  const Hmm = h * pxMm;
  const gs = Math.min(Math.max(pxMm, 1), Math.max(pxMm, sp / 6, Math.sqrt((Wmm * Hmm) / 3e6)));
  const gw = Math.ceil(Wmm / gs) + 2;
  const gh = Math.ceil(Hmm / gs) + 2;
  let mode = String(p.trace ?? "echos");
  const a = (num(p, "angle", 15) * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cx = Wmm / 2;
  const cy = Hmm / 2;

  // ton moyen de chaque cellule (2×2 échantillons)
  let base: Float32Array | null = null;
  if (mode === "echos" || mode === "niveaux") {
    const gt = new Float32Array(gw * gh);
    const k = gs / pxMm;
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        const x = gx * k;
        const y = gy * k;
        const q = k * 0.25;
        gt[gy * gw + gx] = (sampleBilinear(src, w, h, x - q, y - q) + sampleBilinear(src, w, h, x + q, y - q) + sampleBilinear(src, w, h, x - q, y + q) + sampleBilinear(src, w, h, x + q, y + q)) / 4;
      }
    if (mode === "echos") {
      const ink = new Uint8Array(gw * gh);
      const paper = new Uint8Array(gw * gh);
      let nInk = 0;
      for (let i = 0; i < gt.length; i++) {
        ink[i] = gt[i] > 0.5 ? 1 : 0;
        paper[i] = 1 - ink[i];
        nInk += ink[i];
      }
      if (nInk > 0 && nInk < gt.length) {
        const dOut = distanceField(ink, gw, gh);
        const dIn = distanceField(paper, gw, gh);
        base = new Float32Array(gw * gh);
        for (let i = 0; i < base.length; i++) base[i] = (ink[i] ? -(dIn[i] - 0.5) : dOut[i] - 0.5) * gs;
      } else mode = "ondes";
    } else {
      const tb = blur(gt, gw, gh, Math.max(sp * 3, 2) / gs);
      let sum = 0;
      let cnt = 0;
      for (let gy = 1; gy < gh - 1; gy++)
        for (let gx = 1; gx < gw - 1; gx++) {
          const i = gy * gw + gx;
          const g = Math.hypot(tb[i + 1] - tb[i - 1], tb[i + gw] - tb[i - gw]) / (2 * gs);
          if (g > 1e-6) {
            sum += g;
            cnt++;
          }
        }
      const G = cnt ? sum / cnt : 0;
      if (G > 1e-5) {
        base = tb;
        for (let i = 0; i < base.length; i++) base[i] /= G;
      } else mode = "ondes";
    }
  }

  const amp = Math.max(0, num(p, "ondulation", 1.5));
  const S = Math.max(8, sp * 10);
  const noise = new Perlin(seed + 404);
  const psi = new Float32Array(gw * gh);
  // gouges « en ondes » : traits parallèles à l'angle donné, avec la même ondulation
  const gougeOndes = String(p.sensGouges ?? "ondes") === "ondes";
  const psiG = gougeOndes ? new Float32Array(gw * gh) : null;
  const alongG = gougeOndes ? new Float32Array(gw * gh) : null;
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      let x = gx * gs;
      let y = gy * gs;
      if (amp > 0) {
        x += amp * noise.fbm(x / S, y / S, 2);
        y += amp * noise.fbm(x / S + 41.3, y / S + 17.9, 2);
      }
      let v: number;
      if (base) v = sampleBilinear(base, gw, gh, x / gs + 0.5, y / gs + 0.5);
      else if (mode === "tourbillon") v = Math.hypot(x - cx, y - cy);
      else v = -x * sa + y * ca;
      psi[gy * gw + gx] = v;
      if (psiG && alongG) {
        psiG[gy * gw + gx] = -x * sa + y * ca;
        alongG[gy * gw + gx] = x * ca + y * sa;
      }
    }
  return { psi, psiG, alongG, gw, gh, gs };
}

/** Applique Frost's Special à un canal (0 = papier, 1 = encre). */
export function frostSpecial(ch: Float32Array, w: number, h: number, p: Params, ppi: number, seed: number): Float32Array {
  const pxMm = 25.4 / ppi;
  const toPx = (mm: number) => mm / pxMm;
  const sp = Math.max(0.2, num(p, "ecart", 1.4));
  const kLines = num(p, "lignes", 45) / 100;
  const gouge = num(p, "gouges", 10) / 100;
  const halo = num(p, "halo", 5);
  const haloK = num(p, "forceHalo", 55) / 100;
  const est = num(p, "estompe", 0.7);
  const grain = Math.max(0.02, num(p, "grain", 0.09));
  const stries = num(p, "stries", 55) / 100;
  const len = Math.max(0.3, num(p, "longueur", 4));
  const gamma = Math.pow(2, -num(p, "encrage", 0) / 70);
  const rag = num(p, "dechire", 35) / 100;
  const dust = num(p, "poussiere", 8) / 100;

  // ---- ton : bords estompés (halo de grain) + halo large où naissent les lignes d'écho
  const src = new Float32Array(ch.length);
  for (let i = 0; i < ch.length; i++) src[i] = ch[i] < 0 ? 0 : ch[i] > 1 ? 1 : ch[i];
  const L1 = lattice(seed * 7 + 1);
  const L2 = lattice(seed * 7 + 2);
  const L3 = lattice(seed * 7 + 3);
  const L4 = lattice(seed * 7 + 4);
  // plaques de pression (~2 cm) : la main appuie plus ici, frotte à peine là
  const patch = (n: number) => {
    const v = (n - 0.5) * 3.2 + 0.5;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  };
  const tone = toPx(est) >= 0.6 ? blur(src, w, h, toPx(est)) : src.slice();
  const hb = halo > 0 && haloK > 0 ? blur(src, w, h, toPx(halo)) : null;
  const kh = haloK * 1.6;
  const ragP = Math.min(1, rag * 1.6);
  for (let y = 0; y < h; y++) {
    const ym = (y + 0.5) * pxMm;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const xm = (x + 0.5) * pxMm;
      let t = tone[i];
      if (rag > 0 && t !== src[i]) t = src[i] + (t - src[i]) * (1 - ragP * (1 - patch(vn(L4, xm / 16 + 800.5, ym / 16 + 41.5))));
      if (hb) {
        const v = hb[i] * kh * (1 - ragP * (1 - patch(vn(L4, xm / 24 + 500.5, ym / 24 + 11.5))));
        if (v > t) t = v > 1 ? 1 : v;
      }
      tone[i] = gamma !== 1 ? Math.pow(t, gamma) : t;
    }
  }

  const { psi, psiG, alongG, gw, gh, gs } = tracePsi(src, w, h, pxMm, p, seed);
  const gsp = Math.max(0.3, num(p, "ecartGouges", 4));
  const c30 = Math.cos(0.52);
  const s30 = Math.sin(0.52);
  const c70 = Math.cos(1.22);
  const s70 = Math.sin(1.22);

  // ---- les ingrédients de la matrice de seuil, en un point (mm)
  const psiAt = (xm: number, ym: number) => sampleBilinear(psi, gw, gh, xm / gs + 0.5, ym / gs + 0.5);
  const grainAt = (xm: number, ym: number) => {
    const u = xm / grain;
    const v = ym / grain;
    return 0.55 * vn(L1, u, v) + 0.3 * vn(L1, (u * c30 - v * s30) / 2.3 + 101.3, (u * s30 + v * c30) / 2.3 + 7.7) + 0.15 * vn(L1, (u * c70 - v * s70) / 6 + 211.7, (u * s70 + v * c70) / 6 + 19.1);
  };
  // largeur d'un poil de pinceau : un peu plus que le grain, jamais sous 0,12 mm
  const bristle = Math.max(0.12, grain * 1.6);
  const streakAt = (ps: number, xm: number, ym: number) => {
    // rapide en travers du tracé, lent le long : le décalage lent casse les stries tous les « len » mm
    const d1 = 3 * vn(L3, xm / len, ym / len);
    const d2 = 5 * vn(L3, xm / len + 77.7, ym / len + 33.3);
    return 0.65 * vn(L2, ps / bristle + d1, 7.5) + 0.35 * vn(L2, ps / (2.6 * bristle) + d2, 91.5);
  };
  const lineAt = (ps: number, xm: number, ym: number) => {
    const lt = ps / sp;
    const idx = Math.round(lt);
    const d = Math.abs(lt - idx) * 2; // 0 sur le trait, 1 entre deux traits
    const vl = 0.5 * vn(L4, idx * 3.7 + 0.5, xm / (sp * 8)) + 0.5 * vn(L4, idx * 5.3 + 50.5, ym / (sp * 8));
    // présence du trait : par endroits il s'amincit jusqu'à disparaître (cassures)
    const vs = vn(L2, idx * 5.71 + xm / (sp * 7) + 0.5, ym / (sp * 7) + idx * 1.3 + 300.5);
    const pres = 1 - ragP * 0.9 * (1 - patch(vs));
    return { d, vl, pres };
  };
  /** Gouge : 0 = pas de coupe ; sinon distance relative au milieu de la coupe (largeur en coin). */
  const gougeAt = (ps: number, xm: number, ym: number) => {
    let g: number;
    let along: number;
    if (psiG && alongG) {
      g = sampleBilinear(psiG, gw, gh, xm / gs + 0.5, ym / gs + 0.5);
      along = sampleBilinear(alongG, gw, gh, xm / gs + 0.5, ym / gs + 0.5);
    } else {
      g = ps;
      along = (xm * 0.8 + ym * 0.6) * 0.7 + (xm * -0.6 + ym * 0.8) * 0.7;
    }
    const lt = g / gsp + 0.5;
    const idx = Math.round(lt);
    const d = Math.abs(lt - idx) * 2; // 0 au milieu de la coupe
    // chaque coupe vit sur un tronçon de ~6 écarts, plus ou moins long, en fuseau
    const v = vn(L3, idx * 7.13 + 0.5, along / (gsp * 5) + idx * 0.37);
    let c = (v - 0.5) / 0.3;
    if (c <= 0) return { d, c: 0 };
    c = c > 1 ? 1 : Math.sqrt(c);
    return { d, c };
  };

  // ---- égalisation : la part d'encre suit le ton (échantillon de 40 000 points)
  const NS = 40000;
  const r = rng(seed + 99);
  const xs = new Float32Array(NS);
  const ys = new Float32Array(NS);
  const gS = new Float32Array(NS);
  const sS = new Float32Array(NS);
  for (let k = 0; k < NS; k++) {
    xs[k] = r() * w * pxMm;
    ys[k] = r() * h * pxMm;
    gS[k] = grainAt(xs[k], ys[k]);
    sS[k] = streakAt(psiAt(xs[k], ys[k]), xs[k], ys[k]);
  }
  const cdfG = new Cdf(gS);
  const cdfS = new Cdf(sS);
  const lineW = (d: number, vl: number, pres: number) => {
    const v = (d * (1 + (vl - 0.5) * rag * 1.4)) / (pres < 0.05 ? 0.05 : pres);
    return v < 0 ? 0 : v > 1 ? 1 : v;
  };
  const tS = new Float32Array(NS);
  for (let k = 0; k < NS; k++) {
    const ps = psiAt(xs[k], ys[k]);
    const gt = cdfG.at(gS[k]) * (1 - stries) + cdfS.at(sS[k]) * stries;
    const { d, vl, pres } = lineAt(ps, xs[k], ys[k]);
    tS[k] = gt * (1 - kLines) + lineW(d, vl, pres) * kLines;
  }
  const cdfT = new Cdf(tS);

  // ---- poussière : quelques éclats d'encre posés au hasard (cellules de 3 mm)
  const cell = Math.max(3, grain * 30);
  const speck = (xm: number, ym: number) => {
    const ci = Math.floor(xm / cell);
    const cj = Math.floor(ym / cell);
    const h1 = vn(L4, ci * 1.913 + 0.5, cj * 2.371 + 0.5);
    if (h1 > dust * 0.35) return false;
    const h2 = L1[((cj * 131 + ci * 17) & MASK) * TEX + ((ci * 31 + cj) & MASK)];
    const h3 = L2[((cj * 59 + ci) & MASK) * TEX + ((ci * 7 + cj * 3) & MASK)];
    const sx = (ci + 0.2 + 0.6 * h2) * cell;
    const sy = (cj + 0.2 + 0.6 * h3) * cell;
    const rr = Math.min(cell * 0.2, grain * (1 + 4 * h2 * h3));
    const dd = Math.hypot(xm - sx, ym - sy);
    return dd < rr * (0.7 + 0.6 * vn(L3, xm / grain, ym / grain));
  };

  // ---- rendu
  const out = new Float32Array(w * h);
  const SOFT = 0.04;
  for (let y = 0; y < h; y++) {
    const ym = (y + 0.5) * pxMm;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const xm = (x + 0.5) * pxMm;
      let t = tone[i];
      if (t < 0.004) {
        // papier : seuls les éclats de poussière s'y posent
        out[i] = dust > 0 && speck(xm, ym) ? 1 : 0;
        continue;
      }
      const ps = psiAt(xm, ym);
      if (t > 0.995) {
        let ink = 1;
        if (gouge > 0) {
          const g = gougeAt(ps, xm, ym);
          if (g.c > 0 && g.d < gouge * 2.4 * g.c * (0.65 + 0.7 * cdfG.at(grainAt(xm, ym)))) ink = 0;
        }
        out[i] = ink;
        continue;
      }
      const gU = cdfG.at(grainAt(xm, ym));
      const sU = stries > 0 ? cdfS.at(streakAt(ps, xm, ym)) : 0;
      const { d, vl, pres } = lineAt(ps, xm, ym);
      if (rag > 0 && t > 0 && t < 1) {
        const rn = vn(L4, xm / 1.4 + 300.5, ym / 1.4) * 0.6 + vn(L4, xm / 0.45 + 70.5, ym / 0.45) * 0.4 - 0.5;
        t += rn * rag * 3.6 * t * (1 - t);
      }
      const T = cdfT.at((gU * (1 - stries) + sU * stries) * (1 - kLines) + lineW(d, vl, pres) * kLines);
      let ink = (t - T) / SOFT + 0.5;
      ink = ink < 0 ? 0 : ink > 1 ? 1 : ink;
      // gouges : traits blancs en fuseau, aux bords grenus
      if (gouge > 0 && ink > 0) {
        const g = gougeAt(ps, xm, ym);
        if (g.c > 0 && g.d < gouge * 2.4 * g.c * (0.65 + 0.7 * gU)) ink = 0;
      }
      if (dust > 0 && ink < 1 && speck(xm, ym)) ink = 1;
      out[i] = ink;
    }
  }
  return out;
}
