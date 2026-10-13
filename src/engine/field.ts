// Champ de densité d'encre : 1 canal (texture) ou 4 canaux (image séparée en CMJN).
// Valeur 0 = papier, 1 = encre pleine.

export interface Field {
  w: number;
  h: number;
  ch: Float32Array[];
  /**
   * Découpe : le champ ne couvre que [ox, ox+w) × [oy, oy+h) de la page (px à sa résolution).
   * Hors de la découpe, la valeur est 0 (papier). Absent = le champ couvre toute la page.
   */
  ox?: number;
  oy?: number;
}

export function makeField(w: number, h: number, channels = 1, fill = 0): Field {
  const ch: Float32Array[] = [];
  for (let c = 0; c < channels; c++) ch.push(new Float32Array(w * h).fill(fill));
  return { w, h, ch };
}

/** Flou de boîte séparable (une passe), bords en clamp ou périodiques. */
function boxPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean, wrap: boolean) {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 1 : w;
  const inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w : l;
    const at = (i: number) => {
      if (wrap) i = ((i % len) + len) % len;
      else i = i < 0 ? 0 : i >= len ? len - 1 : i;
      return src[base + i * step];
    };
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += at(i);
    for (let i = 0; i < len; i++) {
      dst[base + i * step] = acc * inv;
      acc += at(i + r + 1) - at(i - r);
    }
  }
}

/** Flou quasi-gaussien (3 boîtes), rayon en pixels. */
export function blur(ch: Float32Array, w: number, h: number, radiusPx: number, wrap = false): Float32Array {
  const r = Math.round(radiusPx / 1.7);
  if (r < 1) return ch.slice();
  const a = ch.slice();
  const b = new Float32Array(a.length);
  for (let k = 0; k < 3; k++) {
    boxPass(a, b, w, h, r, true, wrap);
    boxPass(b, a, w, h, r, false, wrap);
  }
  return a;
}

/** Dilatation (max) ou érosion (min) carrée séparable, rayon en pixels. */
export function morph(ch: Float32Array, w: number, h: number, radiusPx: number, dilate: boolean): Float32Array {
  const r = Math.round(radiusPx);
  if (r < 1) return ch.slice();
  const tmp = new Float32Array(ch.length);
  const out = new Float32Array(ch.length);
  const pick = dilate ? Math.max : Math.min;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = ch[y * w + x];
      for (let d = 1; d <= r; d++) {
        v = pick(v, ch[y * w + Math.max(0, x - d)], ch[y * w + Math.min(w - 1, x + d)]);
      }
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      for (let d = 1; d <= r; d++) {
        v = pick(v, tmp[Math.max(0, y - d) * w + x], tmp[Math.min(h - 1, y + d) * w + x]);
      }
      out[y * w + x] = v;
    }
  return out;
}
