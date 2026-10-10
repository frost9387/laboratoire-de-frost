// Composition du texte en contours vectoriels (mm). Même résultat à l'écran, en TIFF et en SVG.
import type { TextSpec } from "./types.ts";
import type { OTFont } from "./fonts.ts";

export const PT_TO_MM = 25.4 / 72;

export interface TextLayout {
  /** Contours de tous les glyphes, en mm, repère du cadre (0,0 = coin haut-gauche). */
  d: string;
  lines: number;
  /** Du texte ne tient pas dans le cadre (comme le « + » rouge d'InDesign). */
  overflow: boolean;
}

interface Glyphed {
  g: ReturnType<OTFont["charToGlyph"]>;
  ch: string;
  /** échelle (mm par unité) de la police qui fournit ce glyphe (police de secours possible) */
  k: number;
  font: OTFont;
}

/** Première ligne de base alignée sur la grille (mm depuis le haut du cadre). */
export interface BaselineGrid {
  firstMm: number; // position de la grille, relative au haut du cadre (peut être négative)
  stepMm: number;
}

export function layoutText(font: OTFont, t: TextSpec, boxW: number, boxH: number, grid?: BaselineGrid, fallbacks: OTFont[] = []): TextLayout {
  const size = Math.max(0.5, t.size) * PT_TO_MM;
  const k = size / font.unitsPerEm;
  let leading = (t.leading > 0 ? t.leading : t.size * 1.2) * PT_TO_MM;
  if (t.baseline && grid && grid.stepMm > 0.1) leading = Math.max(1, Math.ceil(leading / grid.stepMm - 1e-6)) * grid.stepMm;
  const track = (t.tracking / 1000) * size;
  const ascent = font.ascender * k;
  const descent = -font.descender * k;
  const text = t.caps ? t.content.toLocaleUpperCase("fr") : t.content;

  // glyphe absent de la police (index 0) → on le prend dans une police de secours
  const glyphOf = (ch: string): Glyphed => {
    const g = font.charToGlyph(ch);
    if (g && g.index !== 0) return { g, ch, k, font };
    for (const f of fallbacks) {
      const fg = f.charToGlyph(ch);
      if (fg && fg.index !== 0) return { g: fg, ch, k: size / f.unitsPerEm, font: f };
    }
    return { g, ch, k, font };
  };
  const glyphsOf = (s: string): Glyphed[] => [...s].map(glyphOf);
  const kern = (a: Glyphed, b: Glyphed) => {
    if (a.font !== b.font) return 0;
    try {
      return a.font.getKerningValue(a.g, b.g) * a.k;
    } catch {
      return 0;
    }
  };
  const width = (gs: Glyphed[]) => {
    let w = 0;
    for (let i = 0; i < gs.length; i++) {
      w += (gs[i].g.advanceWidth ?? 0) * gs[i].k + track;
      if (i) w += kern(gs[i - 1], gs[i]);
    }
    return w;
  };
  const space = glyphsOf(" ")[0];
  const spaceW = (space.g.advanceWidth ?? font.unitsPerEm * 0.25) * space.k + track;

  // --- découpe en lignes (glouton, mot par mot ; un mot trop long est coupé)
  type Line = { words: Glyphed[][]; w: number; last: boolean };
  const lines: Line[] = [];
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/ +/).filter((w, i, a) => w.length || a.length === 1).map(glyphsOf);
    let cur: Glyphed[][] = [];
    let curW = 0;
    const push = (last: boolean) => {
      lines.push({ words: cur, w: curW, last });
      cur = [];
      curW = 0;
    };
    for (let word of words) {
      let ww = width(word);
      while (ww > boxW && word.length > 1) {
        // mot plus large que le cadre : coupe au caractère
        if (cur.length) push(false);
        let n = word.length;
        while (n > 1 && width(word.slice(0, n)) > boxW) n--;
        cur = [word.slice(0, n)];
        curW = width(cur[0]);
        push(false);
        word = word.slice(n);
        ww = width(word);
      }
      const add = cur.length ? spaceW + ww : ww;
      if (cur.length && curW + add > boxW + 1e-6) push(false);
      curW += cur.length ? spaceW + ww : ww;
      cur.push(word);
    }
    push(true);
  }

  // --- placement vertical
  let first = ascent;
  if (t.baseline && grid && grid.stepMm > 0.1) {
    const n = Math.ceil((ascent - grid.firstMm) / grid.stepMm - 1e-6);
    first = grid.firstMm + n * grid.stepMm;
  }
  let fit = 0;
  for (let i = 0; i < lines.length; i++) {
    if (first + i * leading + descent <= boxH + 1e-6) fit = i + 1;
    else break;
  }
  const overflow = fit < lines.length;
  const blockH = fit ? first + (fit - 1) * leading + descent : 0;
  let dy = 0;
  if (t.vAlign === "milieu") dy = Math.max(0, (boxH - blockH) / 2);
  if (t.vAlign === "bas") dy = Math.max(0, boxH - blockH);

  // --- tracés
  const parts: string[] = [];
  for (let i = 0; i < fit; i++) {
    const ln = lines[i];
    const y = first + i * leading + dy;
    const justify = t.align === "justifie" && !ln.last && ln.words.length > 1;
    const extra = justify ? (boxW - ln.w) / (ln.words.length - 1) : 0;
    let x = t.align === "centre" ? (boxW - ln.w) / 2 : t.align === "droite" ? boxW - ln.w : 0;
    ln.words.forEach((word, wi) => {
      if (wi) x += spaceW + extra;
      for (let j = 0; j < word.length; j++) {
        if (j) x += kern(word[j - 1], word[j]);
        const p = word[j].g.getPath(x, y, size).toPathData(3);
        if (p) parts.push(p);
        x += (word[j].g.advanceWidth ?? 0) * word[j].k + track;
      }
    });
  }
  return { d: parts.join(""), lines: lines.length, overflow };
}
