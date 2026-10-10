// Encodeur PNG en flux : gris 1 bit, gris 8 bits ou RVB 8 bits, avec résolution (pHYs) et profil ICC (iCCP).
import { ascii, concat, crc32, crcFinal, zlib, ZlibStream } from "./bytes.ts";

export interface PngOptions {
  width: number;
  height: number;
  kind: "gray1" | "gray8" | "rgb8";
  dpi: number;
  icc?: { name: string; bytes: Uint8Array };
  /** Déclare l'espace sRGB (chunk sRGB) quand aucun profil n'est intégré. */
  srgb?: boolean;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(ascii(type), 4);
  out.set(data, 8);
  const c = crcFinal(crc32(out.subarray(4, 8 + data.length)));
  dv.setUint32(8 + data.length, c);
  return out;
}

/** Octets par rangée (hors octet de filtre). */
export function pngRowBytes(o: PngOptions): number {
  return o.kind === "gray1" ? Math.ceil(o.width / 8) : o.kind === "gray8" ? o.width : o.width * 3;
}

export class PngWriter {
  private z = new ZlibStream();
  private o: PngOptions;

  constructor(o: PngOptions) {
    this.o = o;
  }

  /** Ajoute des rangées déjà empaquetées (rowBytes chacune, sans octet de filtre). */
  async addRows(packed: Uint8Array, rows: number) {
    const rb = pngRowBytes(this.o);
    const buf = new Uint8Array(rows * (rb + 1));
    for (let r = 0; r < rows; r++) {
      buf[r * (rb + 1)] = 0; // filtre « None »
      buf.set(packed.subarray(r * rb, (r + 1) * rb), r * (rb + 1) + 1);
    }
    await this.z.write(buf);
  }

  async finish(): Promise<Uint8Array> {
    const o = this.o;
    const idat = await this.z.finish();
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, o.width);
    dv.setUint32(4, o.height);
    ihdr[8] = o.kind === "gray1" ? 1 : 8;
    ihdr[9] = o.kind === "rgb8" ? 2 : 0;
    const phys = new Uint8Array(9);
    const ppm = Math.round(o.dpi / 0.0254);
    new DataView(phys.buffer).setUint32(0, ppm);
    new DataView(phys.buffer).setUint32(4, ppm);
    phys[8] = 1; // unité : mètre
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr)];
    if (o.icc && o.kind === "rgb8") {
      const name = ascii(o.icc.name.replace(/[^\x20-\x7e]/g, "").slice(0, 79) || "ICC");
      const comp = await zlib(o.icc.bytes);
      parts.push(chunk("iCCP", concat([name, new Uint8Array([0, 0]), comp])));
    } else if (o.srgb) parts.push(chunk("sRGB", new Uint8Array([0])));
    parts.push(chunk("pHYs", phys));
    const MAX = 1 << 20;
    for (let i = 0; i < idat.length; i += MAX) parts.push(chunk("IDAT", idat.subarray(i, i + MAX)));
    parts.push(chunk("IEND", new Uint8Array(0)));
    return concat(parts);
  }
}
