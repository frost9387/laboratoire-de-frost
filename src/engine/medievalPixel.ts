// « Médiéval-Pixel » : la recette Photoshop « mode Bitmap en diffusion à basse résolution,
// agrandissement au plus proche, fond à 0 % + contour » en un seul effet, réglé en mm.
//  1. le ton est moyenné sur une grille de gros pixels (taille en mm, rotation possible) ;
//  2. chaque gros pixel devient encre ou papier : seuil net, ou diffusion d'erreur
//     (Floyd-Steinberg, Atkinson) qui trame les bords et les gris ;
//  3. rendu : pixels pleins, contour des amas (le style dentelle), ou contour de chaque pixel ;
//  4. plusieurs passes de tailles et de décalages différents se superposent.
import type { Params } from "./types.ts";
import { rng, sampleBilinear } from "./util.ts";
import { blur } from "./field.ts";

const num = (p: Params, k: string, def = 0) => {
  const v = Number(p[k]);
  return Number.isFinite(v) ? v : def;
};

/** Diffusion d'erreur en serpentin sur la grille de gros pixels (0 = papier, 1 = encre). */
function dither(v: Float32Array, gw: number, gh: number, mode: string, level: number, row0 = 0): Uint8Array {
  const out = new Uint8Array(gw * gh);
  if (mode === "seuil") {
    for (let i = 0; i < v.length; i++) out[i] = v[i] > level ? 1 : 0;
    return out;
  }
  const e = Float32Array.from(v);
  const atk = mode === "atkinson";
  for (let y = 0; y < gh; y++) {
    const ltr = (((y + row0) % 2) + 2) % 2 === 0;
    for (let k = 0; k < gw; k++) {
      const x = ltr ? k : gw - 1 - k;
      const s = ltr ? 1 : -1;
      const i = y * gw + x;
      const q = e[i] > level ? 1 : 0;
      out[i] = q;
      const err = e[i] - q;
      const add = (dx: number, dy: number, f: number) => {
        const xx = x + dx * s;
        const yy = y + dy;
        if (xx >= 0 && xx < gw && yy < gh) e[yy * gw + xx] += err * f;
      };
      if (atk) {
        add(1, 0, 1 / 8); add(2, 0, 1 / 8); add(-1, 1, 1 / 8); add(0, 1, 1 / 8); add(1, 1, 1 / 8); add(0, 2, 1 / 8);
      } else {
        add(1, 0, 7 / 16); add(-1, 1, 3 / 16); add(0, 1, 5 / 16); add(1, 1, 1 / 16);
      }
    }
  }
  return out;
}

/** Applique Médiéval-Pixel à un canal (0 = papier, 1 = encre). */
export function medievalPixel(ch: Float32Array, w: number, h: number, p: Params, ppi: number, seed: number, origin = { x: 0, y: 0 }): Float32Array {
  const pxMm = 25.4 / ppi;
  const mode = String(p.rendu ?? "contours");
  const size = Math.max(0.1, num(p, "taille", 1.2));
  const tram = String(p.tramage ?? "diffusion");
  const level = num(p, "seuil", 50) / 100;
  const thick = Math.max(0.02, num(p, "epaisseur", 0.25));
  const pos = String(p.position ?? "centre");
  const passes = Math.max(1, Math.min(4, Math.round(num(p, "passes", 2))));
  const shift = Math.max(0, num(p, "decalage", 0.6));
  const sizeVar = num(p, "variation", 30) / 100;
  const rot = (num(p, "rotation", 0) * Math.PI) / 180;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const Wmm = w * pxMm;
  const Hmm = h * pxMm;
  const r = rng(seed + 61);
  // bavure : on adoucit le dessin avant de le réduire, la diffusion émiette alors ses bords en escaliers irréguliers
  const bav = Math.max(0, num(p, "bavure", 0.4)) / pxMm;
  if (bav >= 0.6) ch = blur(ch, w, h, bav);
  const out = new Float32Array(w * h);
  const SIZE_STEPS = [0, -0.35, 0.45, -0.6];

  for (let k = 0; k < passes; k++) {
    const c = size * Math.max(0.2, 1 + sizeVar * SIZE_STEPS[k]);
    const a = r() * Math.PI * 2;
    const ox = k ? shift * Math.cos(a) + r() * c : 0;
    const oy = k ? shift * Math.sin(a) + r() * c : 0;
    // champ (mm) → grille (unités de gros pixel) ; la grille est ancrée sur la page, pas sur le champ
    const gx0 = origin.x - ox;
    const gy0 = origin.y - oy;
    const toU = (x: number, y: number) => ((x + gx0) * cr + (y + gy0) * sr) / c;
    const toV = (x: number, y: number) => (-(x + gx0) * sr + (y + gy0) * cr) / c;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of [[0, 0], [Wmm, 0], [0, Hmm], [Wmm, Hmm]]) {
      const u = toU(x, y);
      const v = toV(x, y);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u);
      v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const i0 = Math.floor(u0) - 1;
    const j0 = Math.floor(v0) - 1;
    const gw = Math.floor(u1) - i0 + 2;
    const gh = Math.floor(v1) - j0 + 2;

    // 1. ton moyen de chaque gros pixel
    const n = Math.max(1, Math.min(4, Math.ceil(c / pxMm / 2)));
    const tone = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++)
      for (let i = 0; i < gw; i++) {
        let s = 0;
        for (let b = 0; b < n; b++)
          for (let q = 0; q < n; q++) {
            const u = i0 + i + (q + 0.5) / n;
            const v = j0 + j + (b + 0.5) / n;
            const x = c * (u * cr - v * sr) - gx0;
            const y = c * (u * sr + v * cr) - gy0;
            if (x < 0 || y < 0 || x >= Wmm || y >= Hmm) continue;
            s += sampleBilinear(ch, w, h, x / pxMm, y / pxMm);
          }
        tone[j * gw + i] = s / (n * n);
      }

    // 2. encre ou papier
    const S = dither(tone, gw, gh, tram, level, j0);
    const at = (i: number, j: number) => (i < 0 || j < 0 || i >= gw || j >= gh ? 0 : S[j * gw + i]);
    // une arête est tracée entre deux gros pixels différents (amas) ou dès qu'un des deux est encré (chaque pixel)
    const each = mode === "mosaique";
    const edge = (a: number, b: number) => (each ? (a | b) === 1 : a !== b);

    // 3. rendu (les traits gardent au moins 1 px pour rester visibles à l'aperçu)
    const half = Math.max(thick / 2, pxMm * 0.5) / c;
    const full = Math.max(thick, pxMm) / c;
    for (let y = 0; y < h; y++) {
      const ym = (y + 0.5) * pxMm;
      for (let x = 0; x < w; x++) {
        const o = y * w + x;
        if (out[o] === 1) continue;
        const xm = (x + 0.5) * pxMm;
        const u = toU(xm, ym);
        const v = toV(xm, ym);
        const fi = Math.floor(u);
        const fj = Math.floor(v);
        const i = fi - i0;
        const j = fj - j0;
        const fu = u - fi;
        const fv = v - fj;
        const own = at(i, j);
        let ink = 0;
        if (mode === "plein") ink = own;
        else if (pos === "centre") {
          // ligne verticale et horizontale les plus proches, et la rangée / colonne voisine (coins)
          const X = fu < 0.5 ? i : i + 1;
          const dx = fu < 0.5 ? fu : 1 - fu;
          const Y = fv < 0.5 ? j : j + 1;
          const dy = fv < 0.5 ? fv : 1 - fv;
          const jn = fv < 0.5 ? j - 1 : j + 1;
          const iN = fu < 0.5 ? i - 1 : i + 1;
          if (dx < half && (edge(at(X - 1, j), at(X, j)) || (dy < half && edge(at(X - 1, jn), at(X, jn))))) ink = 1;
          else if (dy < half && (edge(at(i, Y - 1), at(i, Y)) || (dx < half && edge(at(iN, Y - 1), at(iN, Y))))) ink = 1;
        } else {
          // intérieur : le trait reste dans les gros pixels encrés ; extérieur : dans le papier
          const want = pos === "interieur" ? 1 : 0;
          if (own === want || (each && pos === "exterieur")) {
            const L = fu < full, R = 1 - fu < full, T = fv < full, B = 1 - fv < full;
            if (each) {
              // chaque gros pixel encré reçoit son propre cadre
              if (pos === "interieur") ink = own && (L || R || T || B) ? 1 : 0;
              else ink = !own && ((L && at(i - 1, j)) || (R && at(i + 1, j)) || (T && at(i, j - 1)) || (B && at(i, j + 1)) || (L && T && at(i - 1, j - 1)) || (R && T && at(i + 1, j - 1)) || (L && B && at(i - 1, j + 1)) || (R && B && at(i + 1, j + 1))) ? 1 : 0;
            } else {
              const d = (ii: number, jj: number) => at(ii, jj) !== own;
              if ((L && d(i - 1, j)) || (R && d(i + 1, j)) || (T && d(i, j - 1)) || (B && d(i, j + 1))) ink = 1;
              else if ((L && T && d(i - 1, j - 1)) || (R && T && d(i + 1, j - 1)) || (L && B && d(i - 1, j + 1)) || (R && B && d(i + 1, j + 1))) ink = 1;
            }
          }
        }
        if (ink) out[o] = 1;
      }
    }
  }
  return out;
}
