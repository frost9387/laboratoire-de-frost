// Encodeur TIFF (baseline + séparations CMJN) : 1 bit, gris 8 bits, RVB 8 bits, CMJN 8 bits.
// Résolution en dpi, profil ICC intégré (tag 34675), compression LZW, PackBits ou aucune.
import { ascii, concat } from "./bytes.ts";

export type TiffKind = "bilevel" | "gray8" | "rgb8" | "cmyk8";
export type TiffCompression = "lzw" | "packbits" | "none";

export interface TiffOptions {
  width: number;
  height: number;
  kind: TiffKind;
  dpi: number;
  compression: TiffCompression;
  icc?: Uint8Array;
  software?: string;
}

export function tiffRowBytes(o: TiffOptions): number {
  switch (o.kind) {
    case "bilevel": return Math.ceil(o.width / 8);
    case "gray8": return o.width;
    case "rgb8": return o.width * 3;
    case "cmyk8": return o.width * 4;
  }
}

// --- compressions ---------------------------------------------------------------------

export function packBits(row: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  const n = row.length;
  while (i < n) {
    let run = 1;
    while (i + run < n && run < 128 && row[i + run] === row[i]) run++;
    if (run >= 2) {
      out.push((257 - run) & 0xff, row[i]);
      i += run;
      continue;
    }
    let lit = 1;
    while (i + lit < n && lit < 128 && !(i + lit + 1 < n && row[i + lit] === row[i + lit + 1])) lit++;
    out.push(lit - 1);
    for (let k = 0; k < lit; k++) out.push(row[i + k]);
    i += lit;
  }
  return Uint8Array.from(out);
}

/** LZW au format TIFF (MSB d'abord, changement de largeur anticipé comme libtiff). */
export function lzw(data: Uint8Array): Uint8Array {
  const CLEAR = 256;
  const EOI = 257;
  const out: number[] = [];
  let acc = 0;
  let accBits = 0;
  let nbits = 9;
  let maxcode = 511;
  let free = 258;
  let dict = new Map<number, number>();
  const put = (code: number) => {
    acc = (acc << nbits) | code;
    accBits += nbits;
    while (accBits >= 8) {
      out.push((acc >>> (accBits - 8)) & 0xff);
      accBits -= 8;
    }
    acc &= (1 << accBits) - 1;
  };
  const reset = () => {
    dict = new Map();
    nbits = 9;
    maxcode = 511;
    free = 258;
  };
  put(CLEAR);
  if (data.length === 0) {
    put(EOI);
    if (accBits > 0) out.push((acc << (8 - accBits)) & 0xff);
    return Uint8Array.from(out);
  }
  let ent = data[0];
  for (let i = 1; i < data.length; i++) {
    const c = data[i];
    const key = ent * 256 + c;
    const hit = dict.get(key);
    if (hit !== undefined) {
      ent = hit;
      continue;
    }
    put(ent);
    ent = c;
    dict.set(key, free++);
    if (free === 4094) {
      put(CLEAR);
      reset();
    } else if (free > maxcode) {
      nbits++;
      maxcode = (1 << nbits) - 1;
    }
  }
  put(ent);
  free++;
  if (free === 4094) {
    put(CLEAR);
    reset();
  } else if (free > maxcode) {
    nbits++;
    maxcode = (1 << nbits) - 1;
  }
  put(EOI);
  if (accBits > 0) out.push((acc << (8 - accBits)) & 0xff);
  return Uint8Array.from(out);
}

// --- écriture -------------------------------------------------------------------------

/** Collecte les bandes (strips) compressées puis assemble le fichier, IFD à la fin. */
export class TiffWriter {
  private o: TiffOptions;
  private strips: Uint8Array[] = [];
  readonly rowsPerStrip: number;

  constructor(o: TiffOptions) {
    this.o = o;
    const rb = tiffRowBytes(o);
    this.rowsPerStrip = Math.max(1, Math.min(o.height, Math.floor((256 * 1024) / Math.max(1, rb))));
  }

  /** Ajoute exactement `rowsPerStrip` rangées empaquetées (ou moins pour la dernière bande). */
  addStrip(packed: Uint8Array, rows: number) {
    const rb = tiffRowBytes(this.o);
    if (this.o.compression === "lzw") this.strips.push(lzw(packed.subarray(0, rows * rb)));
    else if (this.o.compression === "packbits") {
      const parts: Uint8Array[] = [];
      for (let r = 0; r < rows; r++) parts.push(packBits(packed.subarray(r * rb, (r + 1) * rb)));
      this.strips.push(concat(parts));
    } else this.strips.push(packed.slice(0, rows * rb));
  }

  finish(): Uint8Array {
    const o = this.o;
    const spp = o.kind === "rgb8" ? 3 : o.kind === "cmyk8" ? 4 : 1;
    const bps = o.kind === "bilevel" ? 1 : 8;
    const photometric = o.kind === "bilevel" ? 0 : o.kind === "gray8" ? 1 : o.kind === "rgb8" ? 2 : 5;
    const comp = o.compression === "lzw" ? 5 : o.compression === "packbits" ? 32773 : 1;
    const software = ascii((o.software ?? "Le laboratoire de Frost") + "\0");

    // disposition : en-tête (8) | bandes | données annexes | IFD
    let offset = 8;
    const stripOffsets: number[] = [];
    for (const s of this.strips) {
      stripOffsets.push(offset);
      offset += s.length;
      if (offset % 2) offset++; // alignement mot
    }
    const extras: { tag: number; type: number; count: number; data: Uint8Array }[] = [];
    const u16 = (vals: number[]) => {
      const b = new Uint8Array(vals.length * 2);
      const dv = new DataView(b.buffer);
      vals.forEach((v, i) => dv.setUint16(i * 2, v, true));
      return b;
    };
    const u32 = (vals: number[]) => {
      const b = new Uint8Array(vals.length * 4);
      const dv = new DataView(b.buffer);
      vals.forEach((v, i) => dv.setUint32(i * 4, v, true));
      return b;
    };
    const rational = (num: number, den: number) => u32([num, den]);
    const SHORT = 3;
    const LONG = 4;
    const RATIONAL = 5;
    const ASCII = 2;
    const UNDEFINED = 7;
    const entries: { tag: number; type: number; count: number; data: Uint8Array }[] = [
      { tag: 256, type: LONG, count: 1, data: u32([o.width]) },
      { tag: 257, type: LONG, count: 1, data: u32([o.height]) },
      { tag: 258, type: SHORT, count: spp, data: u16(Array(spp).fill(bps)) },
      { tag: 259, type: SHORT, count: 1, data: u16([comp]) },
      { tag: 262, type: SHORT, count: 1, data: u16([photometric]) },
      { tag: 273, type: LONG, count: stripOffsets.length, data: u32(stripOffsets) },
      { tag: 277, type: SHORT, count: 1, data: u16([spp]) },
      { tag: 278, type: LONG, count: 1, data: u32([this.rowsPerStrip]) },
      { tag: 279, type: LONG, count: this.strips.length, data: u32(this.strips.map((s) => s.length)) },
      { tag: 282, type: RATIONAL, count: 1, data: rational(Math.round(o.dpi * 100), 100) },
      { tag: 283, type: RATIONAL, count: 1, data: rational(Math.round(o.dpi * 100), 100) },
      { tag: 284, type: SHORT, count: 1, data: u16([1]) },
      { tag: 296, type: SHORT, count: 1, data: u16([2]) },
      { tag: 305, type: ASCII, count: software.length, data: software },
    ];
    if (o.kind === "cmyk8") entries.push({ tag: 332, type: SHORT, count: 1, data: u16([1]) });
    if (o.icc && o.kind !== "bilevel") entries.push({ tag: 34675, type: UNDEFINED, count: o.icc.length, data: o.icc });
    entries.sort((a, b) => a.tag - b.tag);

    // valeurs > 4 octets : stockées avant l'IFD
    const extraStart = offset;
    let extraPos = extraStart;
    const valueField = new Map<number, number>();
    for (const e of entries) {
      if (e.data.length > 4) {
        valueField.set(e.tag, extraPos);
        extras.push(e);
        extraPos += e.data.length;
        if (extraPos % 2) extraPos++;
      }
    }
    const ifdOffset = extraPos;
    const ifd = new Uint8Array(2 + entries.length * 12 + 4);
    const dv = new DataView(ifd.buffer);
    dv.setUint16(0, entries.length, true);
    entries.forEach((e, i) => {
      const p = 2 + i * 12;
      dv.setUint16(p, e.tag, true);
      dv.setUint16(p + 2, e.type, true);
      dv.setUint32(p + 4, e.count, true);
      if (e.data.length > 4) dv.setUint32(p + 8, valueField.get(e.tag)!, true);
      else ifd.set(e.data, p + 8);
    });
    dv.setUint32(2 + entries.length * 12, 0, true);

    const header = new Uint8Array(8);
    const hv = new DataView(header.buffer);
    header[0] = 0x49;
    header[1] = 0x49;
    hv.setUint16(2, 42, true);
    hv.setUint32(4, ifdOffset, true);

    const parts: Uint8Array[] = [header];
    let pos = 8;
    for (const s of this.strips) {
      parts.push(s);
      pos += s.length;
      if (pos % 2) {
        parts.push(new Uint8Array(1));
        pos++;
      }
    }
    for (const e of extras) {
      parts.push(e.data);
      pos += e.data.length;
      if (pos % 2) {
        parts.push(new Uint8Array(1));
        pos++;
      }
    }
    parts.push(ifd);
    return concat(parts);
  }
}
