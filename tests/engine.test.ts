// Tests du moteur (Node 24, types effacés à la volée) :
//   node --experimental-strip-types tests/engine.test.ts [dossier-de-sortie]
// Vérifie les surfaces de trame, la compensation d'engraissement, la réaction-diffusion
// et écrit de vrais exports TIFF / PNG / SVG que tests/verify_exports.py relit avec Pillow.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { simulateRD, RD_PRESETS } from "../src/engine/rd.ts";
import { makeScreener, toneLUT, printedTone, defaultScreen } from "../src/engine/screens.ts";
import { defaultDoc } from "../src/engine/doc.ts";
import { makeEnv, computePlates, rdThreshold } from "../src/engine/render.ts";
import { ColorEngine } from "../src/engine/color.ts";
import { exportDoc, type ExportOptions } from "../src/export/exporter.ts";
import { lzw } from "../src/export/tiff.ts";
import type { ScreenSpec } from "../src/engine/types.ts";

const out = process.argv[2] ?? "./test-out";
mkdirSync(out, { recursive: true });
let failures = 0;
const ok = (cond: boolean, msg: string) => {
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) failures++;
};

// ---------------------------------------------------------------- réaction-diffusion
console.log("Réaction-diffusion");
{
  const t0 = performance.now();
  const p = RD_PRESETS.labyrinthe;
  const V = simulateRD(256, p.f, p.k, 3200, 5);
  const ms = performance.now() - t0;
  let runs = 0;
  let crossings = 0;
  for (let y = 0; y < 256; y += 4) {
    let prev = V[y * 256] > 0.5;
    for (let x = 1; x < 256; x++) {
      const cur = V[y * 256 + x] > 0.5;
      if (cur !== prev) crossings++;
      prev = cur;
    }
    runs++;
  }
  const wavelength = (2 * 255 * runs) / Math.max(1, crossings);
  let mean = 0;
  for (const v of V) mean += v;
  mean /= V.length;
  console.log(`  ${ms.toFixed(0)} ms pour 256² × 3200 itérations, longueur d'onde mesurée ≈ ${wavelength.toFixed(1)} cellules`);
  // mesurée le long d'une ligne quelconque : ≈ RD_WAVELENGTH × π/2
  ok(wavelength > 14 && wavelength < 28, "le motif labyrinthe a une période cohérente avec RD_WAVELENGTH (13)");
  ok(mean > 0.05 && mean < 0.95, "le motif n'est ni vide ni plein");
}

// ---------------------------------------------------------------- trames : surface encrée = ton
console.log("Surfaces de trame (ton visé 30 % et 70 %)");
const env = makeEnv(null);
function coverage(spec: ScreenSpec, tone: number, dpi = 1200, size = 600): number {
  const cw = 64;
  const contone = new Float32Array(cw * cw).fill(tone);
  const rd = spec.type === "stochastique" ? rdThreshold(env, spec.rdPreset) : undefined;
  const scr = makeScreener({ spec, outDpi: dpi, fullW: size, fullH: size, contone, cw, ch: cw, contonePpi: (cw / size) * dpi, rdTile: rd });
  const buf = new Uint8Array(size * size);
  scr(0, 0, size, size, buf);
  let ink = 0;
  for (const v of buf) if (v) ink++;
  return ink / buf.length;
}
for (const [label, spec] of [
  ["AM rond 60 lpi", defaultScreen({ type: "am", lpi: 60, shape: "rond" })],
  ["AM euclidien 150 lpi", defaultScreen({ type: "am", lpi: 150, shape: "euclidien" })],
  ["AM ligne 45 lpi", defaultScreen({ type: "am", lpi: 45, shape: "ligne", angle: 30 })],
  ["Stochastique labyrinthe 30 lpi", defaultScreen({ type: "stochastique", lpi: 30 })],
  ["FM 42 µm", defaultScreen({ type: "fm", grainUm: 42 })],
  ["Bayer niveau 3", defaultScreen({ type: "bayer", grainUm: 42, bayerLevel: 3 })],
  ["Diffusion Floyd-Steinberg", defaultScreen({ type: "diffusion", kernel: "floyd", grainUm: 42 })],
  ["Diffusion Atkinson", defaultScreen({ type: "diffusion", kernel: "atkinson", grainUm: 42 })],
] as [string, ScreenSpec][]) {
  const c30 = coverage(spec, 0.3);
  const c70 = coverage(spec, 0.7);
  // Atkinson ne diffuse que 6/8 de l'erreur : il éclaircit/assombrit volontairement les extrêmes
  const tol = spec.kernel === "atkinson" && spec.type === "diffusion" ? 0.08 : 0.03;
  ok(Math.abs(c30 - 0.3) < tol && Math.abs(c70 - 0.7) < tol, `${label} : ${(c30 * 100).toFixed(1)} % et ${(c70 * 100).toFixed(1)} %`);
}

// ---------------------------------------------------------------- engraissement
console.log("Compensation d'engraissement");
{
  const spec = defaultScreen({ dotGain: 15 });
  const lut = toneLUT(spec);
  let mono = true;
  for (let i = 1; i < lut.length; i++) if (lut[i] < lut[i - 1] - 1e-6) mono = false;
  ok(mono, "la courbe compensée est monotone");
  let err = 0;
  for (const v of [0.1, 0.25, 0.5, 0.75, 0.9]) err = Math.max(err, Math.abs(printedTone(lut[Math.round(v * 1023)], 15) - v));
  ok(err < 0.01, `après engraissement simulé de 15 %, le ton imprimé retombe sur le ton voulu (écart max ${(err * 100).toFixed(2)} %)`);
  const s2 = defaultScreen({ minDot: 5, maxDot: 95 });
  const l2 = toneLUT(s2);
  ok(l2[Math.round(0.02 * 1023)] === 0 && Math.abs(l2[Math.round(0.04 * 1023)] - 0.05) < 1e-6, "point minimal 5 % : 2 % → 0, 4 % → 5 %");
}

// ---------------------------------------------------------------- LZW aller-retour
console.log("LZW (TIFF)");
{
  const data = new Uint8Array(70000);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 13 === 0 ? 255 : (i >> 5) & 255;
  const enc = lzw(data);
  // décodeur LZW TIFF de référence (changement de largeur anticipé)
  const dec: number[] = [];
  let bitPos = 0;
  let nbits = 9;
  const read = () => {
    let v = 0;
    for (let i = 0; i < nbits; i++) {
      const byte = enc[(bitPos + i) >> 3];
      v = (v << 1) | ((byte >> (7 - ((bitPos + i) & 7))) & 1);
    }
    bitPos += nbits;
    return v;
  };
  let table: number[][] = [];
  const reset = () => {
    table = [];
    for (let i = 0; i < 256; i++) table.push([i]);
    table.push([], []);
    nbits = 9;
  };
  reset();
  let old: number[] | null = null;
  for (;;) {
    const code = read();
    if (code === 257) break;
    if (code === 256) {
      reset();
      old = null;
      continue;
    }
    let entry: number[];
    if (code < table.length) entry = table[code];
    else entry = [...old!, old![0]];
    dec.push(...entry);
    if (old) table.push([...old, entry[0]]);
    old = entry;
    if (table.length + 1 >= 1 << nbits && nbits < 12) nbits++;
  }
  ok(dec.length === data.length && dec.every((v, i) => v === data[i]), `décompression identique (${data.length} → ${enc.length} octets)`);
}

// ---------------------------------------------------------------- atelier : dessin → matière
console.log("Atelier (dessin → matière)");
{
  const { inkFromRGBA, synthDessinTile, dessinResolution, defaultDessinParams, objectDessinParams } = await import("../src/engine/dessin.ts");
  // un disque de 40 % de la tuile, dessiné à 2048 px
  const S = 2048;
  const rgba = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) if (Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) < S * 0.2) rgba[(y * S + x) * 4 + 3] = 255;
  const cover = (n: number, p: Record<string, number | string>) => {
    const t = synthDessinTile(inkFromRGBA(rgba, S, n), n, p);
    let s = 0;
    for (const v of t) s += v;
    return s / t.length;
  };
  const p = { ...defaultDessinParams(), rugosite: 0, grain: 0 };
  const c256 = cover(256, p);
  const c1024 = cover(1024, p);
  ok(Math.abs(c256 - c1024) < 0.01, `même couverture à 256 et 1024 px (${(c256 * 100).toFixed(1)} % / ${(c1024 * 100).toFixed(1)} % ; attendu ≈ ${(Math.PI * 0.04 * 100).toFixed(1)} %)`);
  const t0 = performance.now();
  const org = cover(1024, { ...p, organique: 60 });
  ok(org > 0.05 && org < 0.95, `croissance organique à 1024 px en ${Math.round(performance.now() - t0)} ms (couverture ${(org * 100).toFixed(1)} %)`);
  ok(dessinResolution(30, 600, 2048) === 1024 && dessinResolution(1000, 600, 2048) === 2048 && dessinResolution(5, 50, 2048) === 64, "résolution adaptée à l'échelle (30 mm à 600 ppi → 1024 px, 1 m → 2048 px, plafond = dessin)");
  const up = inkFromRGBA(rgba.subarray(0, 512 * 512 * 4), 512, 1024);
  ok(up.length === 1024 * 1024, "un dessin de 512 px s'agrandit sans erreur pour un calcul à 1024 px");
  const o = objectDessinParams();
  ok(o.rugosite === 0 && o.grain === 0 && Number(o.nettete) >= 90, "un objet repris à la main garde son allure (rugosité et grain à 0, bords nets)");
}

// ---------------------------------------------------------------- Frost's Special (gravure litho)
console.log("Frost's Special");
{
  const { EFFECT_BY_TYPE, defaultParams } = await import("../src/engine/effects.ts");
  const def = EFFECT_BY_TYPE.frost;
  const base = defaultParams(def);
  const cover = (f: Float32Array) => {
    let s = 0;
    for (const v of f) s += v;
    return s / f.length;
  };
  const flat = (v: number, n: number) => new Float32Array(n * n).fill(v);
  const neutral = { ...base, halo: 0, estompe: 0, gouges: 0, poussiere: 0, dechire: 0 };
  const n = 600;
  const g30 = cover(def.apply(flat(0.3, n), n, n, { ...neutral, lignes: 0 }, { ppi: 300, seed: 5 }));
  const l30 = cover(def.apply(flat(0.3, n), n, n, { ...neutral, lignes: 100, trace: "ondes" }, { ppi: 300, seed: 5 }));
  ok(Math.abs(g30 - 0.3) < 0.03 && Math.abs(l30 - 0.3) < 0.04, `l'encre suit le ton : gris 30 % → ${(g30 * 100).toFixed(1)} % en grain, ${(l30 * 100).toFixed(1)} % en lignes`);
  const paper = cover(def.apply(flat(0, n), n, n, base, { ppi: 300, seed: 5 }));
  ok(paper < 0.003, `le papier reste propre (${(paper * 100).toFixed(2)} % de poussière)`);
  const solid = cover(def.apply(flat(1, n), n, n, { ...base, gouges: 0 }, { ppi: 300, seed: 5 }));
  ok(solid > 0.995, `un aplat reste plein sans gouges (${(solid * 100).toFixed(2)} %)`);
  const gouged = cover(def.apply(flat(1, n), n, n, base, { ppi: 300, seed: 5 }));
  ok(gouged < solid && gouged > 0.8, `les gouges entaillent l'aplat (${(gouged * 100).toFixed(1)} % d'encre)`);
  // un disque de 20 mm sur 60 mm : même dessin à 150 et 300 ppi, halo et échos autour
  const disc = (ppi: number) => {
    const m = Math.round((60 / 25.4) * ppi);
    const f = new Float32Array(m * m);
    for (let y = 0; y < m; y++)
      for (let x = 0; x < m; x++) if (Math.hypot(((x + 0.5) / ppi) * 25.4 - 30, ((y + 0.5) / ppi) * 25.4 - 30) < 10) f[y * m + x] = 1;
    return { f, m };
  };
  const covAt = (ppi: number, p: Record<string, number | string>) => {
    const { f, m } = disc(ppi);
    return cover(def.apply(f, m, m, p, { ppi, seed: 9 }));
  };
  const c150 = covAt(150, base);
  const c300 = covAt(300, base);
  ok(Math.abs(c150 - c300) < 0.015, `même dessin à 150 et 300 ppi (${(c150 * 100).toFixed(1)} % / ${(c300 * 100).toFixed(1)} %)`);
  const plain = Math.PI * 100 / 3600;
  const echo = covAt(150, { ...base, trace: "echos", lignes: 65, halo: 14, forceHalo: 65, gouges: 0 });
  ok(echo > plain + 0.01, `les échos et le halo débordent de la forme (${(echo * 100).toFixed(1)} % contre ${(plain * 100).toFixed(1)} % pour le disque seul)`);
  for (const pr of def.presets ?? []) {
    const v = covAt(100, { ...base, ...pr.params });
    if (!(v > 0.02 && v < 0.6)) ok(false, `recette « ${pr.label} » : couverture anormale ${(v * 100).toFixed(1)} %`);
  }
  ok(true, `${def.presets?.length ?? 0} recettes rendues sans erreur`);
  // A4 à 300 ppi : le temps d'un export
  const W = 2480;
  const H = 3508;
  const a4 = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (Math.hypot(x - W / 2, y - H / 2) < 700 || Math.abs(y - 900 - 200 * Math.sin(x / 300)) < 90) a4[y * W + x] = 1;
  const t0 = performance.now();
  def.apply(a4, W, H, base, { ppi: 300, seed: 3 });
  const ms = performance.now() - t0;
  ok(ms < 20000, `A4 à 300 ppi en ${(ms / 1000).toFixed(1)} s`);
}

// ---------------------------------------------------------------- Médiéval-Pixel
console.log("Médiéval-Pixel");
{
  const { EFFECT_BY_TYPE, defaultParams } = await import("../src/engine/effects.ts");
  const def = EFFECT_BY_TYPE.medievalpixel;
  const base = defaultParams(def);
  const cover = (f: Float32Array) => {
    let s = 0;
    for (const v of f) s += v;
    return s / f.length;
  };
  // un disque de 20 mm sur 60 mm
  const disc = (ppi: number) => {
    const m = Math.round((60 / 25.4) * ppi);
    const f = new Float32Array(m * m);
    for (let y = 0; y < m; y++)
      for (let x = 0; x < m; x++) if (Math.hypot(((x + 0.5) / ppi) * 25.4 - 30, ((y + 0.5) / ppi) * 25.4 - 30) < 10) f[y * m + x] = 1;
    return { f, m };
  };
  const run = (ppi: number, p: Record<string, number | string>) => {
    const { f, m } = disc(ppi);
    return { out: def.apply(f, m, m, p, { ppi, seed: 4 }), m };
  };
  const area = (Math.PI * 100) / 3600;
  const full = cover(run(300, { ...base, rendu: "plein", passes: 1, bavure: 0 }).out);
  ok(Math.abs(full - area) < 0.01, `pixels pleins : la surface du disque est gardée (${(full * 100).toFixed(1)} % pour ${(area * 100).toFixed(1)} %)`);
  const lace = run(300, base);
  const lc = cover(lace.out);
  ok(lc > 0.01 && lc < full, `dentelle : seuls les contours sont tracés (${(lc * 100).toFixed(1)} % d'encre)`);
  // le centre du disque est vide en mode contours : rien n'y est tracé
  const { out, m } = run(300, { ...base, passes: 1, bavure: 0 });
  let inner = 0;
  for (let y = Math.round(m * 0.45); y < Math.round(m * 0.55); y++) for (let x = Math.round(m * 0.45); x < Math.round(m * 0.55); x++) inner += out[y * m + x];
  ok(inner === 0, "contours : l'intérieur d'un aplat reste vide");
  const c150 = cover(run(150, { ...base, rendu: "plein", passes: 1, bavure: 0 }).out);
  ok(Math.abs(c150 - full) < 0.012, `même dessin à 150 et 300 ppi (${(c150 * 100).toFixed(1)} % / ${(full * 100).toFixed(1)} %)`);
  for (const pr of def.presets ?? []) {
    const v = cover(run(100, { ...base, ...pr.params }).out);
    if (!(v > 0.005 && v < 0.5)) ok(false, `recette « ${pr.label} » : couverture anormale ${(v * 100).toFixed(1)} %`);
  }
  ok(true, `${def.presets?.length ?? 0} recettes rendues sans erreur`);
  const W = 2480;
  const H = 3508;
  const a4 = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (Math.hypot(x - W / 2, y - H / 2) < 700 || Math.abs(y - 900 - 200 * Math.sin(x / 300)) < 90) a4[y * W + x] = 1;
  const t0 = performance.now();
  def.apply(a4, W, H, base, { ppi: 300, seed: 3 });
  const ms = performance.now() - t0;
  ok(ms < 20000, `A4 à 300 ppi, 3 passes, en ${(ms / 1000).toFixed(1)} s`);
}

// ---------------------------------------------------------------- Dots
console.log("Dots");
{
  const { EFFECT_BY_TYPE, defaultParams } = await import("../src/engine/effects.ts");
  const def = EFFECT_BY_TYPE.dots;
  const base = defaultParams(def);
  const cover = (f: Float32Array) => {
    let s = 0;
    for (const v of f) s += v;
    return s / f.length;
  };
  const n = 500;
  const flat = (v: number) => new Float32Array(n * n).fill(v);
  const clean = { ...base, noir: 0, blanc: 100, grain: 0, bruit: 0, maxi: 141 };
  const tones = [0.2, 0.4, 0.6, 0.8].map((v) => cover(def.apply(flat(v), n, n, clean, { ppi: 300, seed: 2 })));
  ok(tones.every((v, i) => i === 0 || v > tones[i - 1]), `plus le ton est foncé, plus il y a d'encre (${tones.map((v) => (v * 100).toFixed(0) + " %").join(" → ")})`);
  // points ronds de 113 % du pas (√(4/π)) : l'aire d'un point vaut exactement le ton tant qu'ils ne se touchent pas
  const exact = cover(def.apply(flat(0.4), n, n, { ...clean, maxi: 112.84 }, { ppi: 300, seed: 2 }));
  ok(Math.abs(exact - 0.4) < 0.03, `ton de 40 % rendu à ${(exact * 100).toFixed(1)} % d'encre (points ronds de 113 %, grille régulière)`);
  const paper = cover(def.apply(flat(0), n, n, base, { ppi: 300, seed: 2 }));
  ok(paper === 0, "le papier reste propre");
  const c150 = cover(def.apply(flat(0.5), Math.round(n / 2), Math.round(n / 2), base, { ppi: 150, seed: 2 }));
  const c300 = cover(def.apply(flat(0.5), n, n, base, { ppi: 300, seed: 2 }));
  ok(Math.abs(c150 - c300) < 0.02, `même dessin à 150 et 300 ppi (${(c150 * 100).toFixed(1)} % / ${(c300 * 100).toFixed(1)} %)`);
  for (const pr of def.presets ?? []) {
    const v = cover(def.apply(flat(0.5), 200, 200, { ...base, ...pr.params }, { ppi: 100, seed: 2 }));
    if (!(v > 0.05 && v < 0.98)) ok(false, `recette « ${pr.label} » : couverture anormale ${(v * 100).toFixed(1)} %`);
  }
  ok(true, `${def.presets?.length ?? 0} recettes rendues sans erreur`);
  const W = 2480;
  const H = 3508;
  const a4 = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a4[y * W + x] = Math.max(0, 1 - Math.hypot(x - W / 2, y - H / 2) / 1400);
  const t0 = performance.now();
  def.apply(a4, W, H, base, { ppi: 300, seed: 3 });
  const ms = performance.now() - t0;
  ok(ms < 20000, `A4 à 300 ppi en ${(ms / 1000).toFixed(1)} s`);
}

// ---------------------------------------------------------------- objets à effets : champ découpé
console.log("Objets à effets (champ découpé)");
{
  const { sampleSilhouette, silhouetteBox, uncrop } = await import("../src/engine/compose.ts");
  const { makeScreener, defaultScreen } = await import("../src/engine/screens.ts");
  // une tache sur une page 400 × 300 px, et la même gardée dans une découpe de 120 × 90 px
  const W = 400;
  const H = 300;
  const page = { w: W, h: H, ch: [new Float32Array(W * H), new Float32Array(W * H)] };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = Math.max(0, Math.min(1, 1.5 - Math.hypot(x - 170, y - 120) / 25));
      page.ch[0][y * W + x] = v * 0.6;
      page.ch[1][y * W + x] = v;
    }
  const cx = 110;
  const cy = 75;
  const cw = 120;
  const chh = 90;
  const crop = { w: cw, h: chh, ox: cx, oy: cy, ch: [new Float32Array(cw * chh), new Float32Array(cw * chh)] };
  for (let c = 0; c < 2; c++) for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) crop.ch[c][y * cw + x] = page.ch[c][(cy + y) * W + cx + x];
  let same = true;
  for (const sc of [1, 0.5, 0.25]) {
    const ow = Math.round(W / sc);
    const oh = Math.round(H / sc);
    const A = sampleSilhouette(page, sc, 0, 0, ow, oh);
    const B = sampleSilhouette(crop, sc, 0, 0, ow, oh);
    for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) { same = false; break; }
    const ba = silhouetteBox(page, sc, ow, oh);
    const bb = silhouetteBox(crop, sc, ow, oh);
    if (JSON.stringify(ba) !== JSON.stringify(bb)) same = false;
  }
  ok(same, "silhouette et cadre identiques avec un champ découpé, à 1×, 2× et 4×");
  const u = uncrop(crop, W, H);
  let eq = true;
  for (let i = 0; i < u.ch[1].length; i++) if (Math.abs(u.ch[1][i] - page.ch[1][i]) > 1e-6) { eq = false; break; }
  ok(eq, "un champ découpé se remet à l'échelle de la page sans perte");
  const spec = defaultScreen({ type: "aucune" });
  const sa = makeScreener({ spec, outDpi: 300, fullW: W * 2, fullH: H * 2, contone: page.ch[0], cw: W, ch: H, contonePpi: 150 });
  const sb = makeScreener({ spec, outDpi: 300, fullW: W * 2, fullH: H * 2, contone: crop.ch[0], cw, ch: chh, contonePpi: 150, crop: { x: cx, y: cy } });
  const oa = new Uint8Array(W * 2 * H * 2);
  const ob = new Uint8Array(W * 2 * H * 2);
  sa(0, 0, W * 2, H * 2, oa);
  sb(0, 0, W * 2, H * 2, ob);
  let diff = 0;
  for (let i = 0; i < oa.length; i++) diff = Math.max(diff, Math.abs(oa[i] - ob[i]));
  ok(diff <= 1, `encre de l'objet identique depuis la découpe (écart max ${diff}/255)`);
}

// ---------------------------------------------------------------- texte (contours vectoriels)
console.log("Composition du texte");
{
  const { FontStore, BUILTIN_FONTS } = await import("../src/engine/fonts.ts");
  const { layoutText, PT_TO_MM } = await import("../src/engine/text.ts");
  const fonts = new FontStore(async (def) => {
    const [pkg, name] = def.file!.split("/");
    const b = readFileSync(join("node_modules/@fontsource", pkg, "files", name));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  });
  let loaded = 0;
  for (const f of BUILTIN_FONTS) if (await fonts.get(f.id)) loaded++;
  ok(loaded === BUILTIN_FONTS.length, `${loaded}/${BUILTIN_FONTS.length} polices intégrées chargées`);
  const font = (await fonts.get("inter-700"))!;
  const base = { font: "inter-700", size: 24, leading: 0, tracking: 0, align: "gauche" as const, vAlign: "haut" as const, caps: false, baseline: false };
  const a = layoutText(font, { ...base, content: "Été œ €" }, 100, 30);
  ok(a.d.length > 100 && !a.overflow && a.lines === 1, `« Été œ € » : une ligne, ${a.d.length} caractères de contour`);
  const long = "Le laboratoire de Frost compose ce texte en vrais contours vectoriels, ligne par ligne.";
  const b = layoutText(font, { ...base, content: long }, 60, 15);
  ok(b.overflow && b.lines > 2, `cadre trop petit → texte en excès signalé (${b.lines} lignes pour 1 visible)`);
  const c = layoutText(font, { ...base, content: long }, 60, 200);
  ok(!c.overflow, "cadre assez grand → pas d'excès");
  const j = layoutText(font, { ...base, content: long, align: "justifie" }, 60, 200);
  ok(j.d !== c.d, "la justification change le placement des mots");
  const g = layoutText(font, { ...base, content: "A\nB", baseline: true, leading: 20 }, 60, 200, { firstMm: 3, stepMm: 12 * PT_TO_MM });
  const ys = [...g.d.matchAll(/M[\d.-]+ ([\d.-]+)/g)].map((m) => Number(m[1]));
  ok(ys.length > 0, "grille de ligne de base : contours produits");
}

// ---------------------------------------------------------------- exports réels
console.log("Exports (relus ensuite par Pillow)");
const color = await ColorEngine.create();
const icc = "C:/Program Files (x86)/Common Files/Adobe/Color/Profiles/Recommended/CoatedFOGRA39.icc";
let hasFogra = false;
try {
  hasFogra = !!color.addProfile("sys:CoatedFOGRA39.icc", new Uint8Array(readFileSync(icc)), "système");
} catch {
  hasFogra = false;
}
console.log("  profil FOGRA39 :", hasFogra ? "chargé" : "absent (CMJN générique)");
const env2 = makeEnv(color);
const doc = defaultDoc();
doc.settings.name = "Test Frost";
doc.settings.formatId = "A6";
doc.settings.widthMm = 105;
doc.settings.heightMm = 148;
doc.settings.contonePpi = 150;
if (hasFogra) doc.settings.profileId = "sys:CoatedFOGRA39.icc";
{
  const t0 = performance.now();
  const P = computePlates(doc, 150, env2);
  console.log(`  plaques CMJN à 150 ppi : ${P.w} × ${P.h} px en ${(performance.now() - t0).toFixed(0)} ms, encrage max ${P.tacPeak.toFixed(0)} %`);
  ok(P.data.length === 4, "4 plaques en mode CMJN");
}
const runs: [string, ExportOptions][] = [
  ["tiff-plaques", { format: "tiff", content: "plaques", dpi: 600, bleed: true, marks: true, jpgQuality: 90, tiffCompression: "lzw", embedIcc: true }],
  ["tiff-cmjn", { format: "tiff", content: "cmjn", dpi: 300, bleed: true, marks: false, jpgQuality: 90, tiffCompression: "lzw", embedIcc: true }],
  ["tiff-rvb", { format: "tiff", content: "composite", dpi: 150, bleed: false, marks: false, jpgQuality: 90, tiffCompression: "none", embedIcc: true }],
  ["png-plaques", { format: "png", content: "plaques", dpi: 600, bleed: true, marks: true, jpgQuality: 90, tiffCompression: "lzw", embedIcc: true }],
  ["png-rvb", { format: "png", content: "composite", dpi: 150, bleed: true, marks: false, jpgQuality: 90, tiffCompression: "lzw", embedIcc: true }],
  ["svg-composite", { format: "svg", content: "composite", dpi: 600, bleed: true, marks: true, jpgQuality: 90, tiffCompression: "lzw", embedIcc: true }],
];
for (const [label, opts] of runs) {
  const t0 = performance.now();
  try {
    const res = await exportDoc(doc, opts, env2, () => {});
    const path = join(out, `${label}__${res.file.name}`);
    writeFileSync(path, res.file.data);
    ok(res.file.data.length > 100, `${label} : ${res.file.name} (${(res.file.data.length / 1024).toFixed(0)} Ko, ${(performance.now() - t0).toFixed(0)} ms)`);
    if (res.warnings.length) console.log("    avertissements :", res.warnings.join(" | "));
  } catch (e) {
    ok(false, `${label} : ${e instanceof Error ? e.stack : e}`);
  }
}

console.log(failures ? `\n${failures} échec(s)` : "\nTous les tests passent.");
process.exit(failures ? 1 : 0);
