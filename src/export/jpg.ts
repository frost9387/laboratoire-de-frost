// JPG : encodage par le navigateur (OffscreenCanvas), puis on inscrit la résolution (JFIF)
// et le profil ICC (segments APP2) dans le fichier.
import { ascii, concat } from "./bytes.ts";

/** Écrit la densité en dpi dans l'en-tête JFIF (l'ajoute s'il manque). */
export function setJpegDpi(jpg: Uint8Array, dpi: number): Uint8Array {
  const d = Math.min(65535, Math.round(dpi));
  if (jpg[2] === 0xff && jpg[3] === 0xe0 && ascii("JFIF").every((c, i) => jpg[6 + i] === c)) {
    const out = jpg.slice();
    out[13] = 1; // unité : pouces
    out[14] = d >> 8;
    out[15] = d & 255;
    out[16] = d >> 8;
    out[17] = d & 255;
    return out;
  }
  const app0 = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, d >> 8, d & 255, d >> 8, d & 255, 0, 0]);
  return concat([jpg.subarray(0, 2), app0, jpg.subarray(2)]);
}

/** Insère un profil ICC (APP2 « ICC_PROFILE ») juste après le segment JFIF. */
export function embedJpegIcc(jpg: Uint8Array, icc: Uint8Array): Uint8Array {
  const MAX = 65519;
  const count = Math.ceil(icc.length / MAX);
  const segs: Uint8Array[] = [];
  for (let k = 0; k < count; k++) {
    const part = icc.subarray(k * MAX, (k + 1) * MAX);
    const len = 2 + 12 + 2 + part.length;
    const seg = new Uint8Array(2 + len);
    seg[0] = 0xff;
    seg[1] = 0xe2;
    seg[2] = len >> 8;
    seg[3] = len & 255;
    seg.set(ascii("ICC_PROFILE\0"), 4);
    seg[16] = k + 1;
    seg[17] = count;
    seg.set(part, 18);
    segs.push(seg);
  }
  let at = 2;
  if (jpg[2] === 0xff && jpg[3] === 0xe0) at = 4 + ((jpg[4] << 8) | jpg[5]);
  return concat([jpg.subarray(0, at), ...segs, jpg.subarray(at)]);
}
