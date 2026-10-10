// Outils binaires : CRC32, assemblage de morceaux, compression deflate (zlib) en flux.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, crc = 0xffffffff): number {
  let c = crc;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return c;
}

export function crcFinal(c: number): number {
  return (c ^ 0xffffffff) >>> 0;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** Compresse au format zlib (RFC 1950) via CompressionStream, en acceptant des morceaux successifs. */
export class ZlibStream {
  private writer: WritableStreamDefaultWriter<BufferSource>;
  private chunks: Uint8Array[] = [];
  private done: Promise<void>;

  constructor() {
    const cs = new CompressionStream("deflate");
    this.writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();
    this.done = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        this.chunks.push(value);
      }
    })();
  }

  async write(data: Uint8Array) {
    await this.writer.write(data as BufferSource);
  }

  async finish(): Promise<Uint8Array> {
    await this.writer.close();
    await this.done;
    return concat(this.chunks);
  }
}

export async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const z = new ZlibStream();
  await z.write(data);
  return z.finish();
}

/** Archive ZIP sans compression (les fichiers image sont déjà compressés). */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crcFinal(crc32(f.data));
    const local = new Uint8Array(30 + name.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x0800, true); // noms en UTF-8
    dv.setUint16(8, 0, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, f.data.length, true);
    dv.setUint32(22, f.data.length, true);
    dv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const dc = new DataView(cen.buffer);
    dc.setUint32(0, 0x02014b50, true);
    dc.setUint16(4, 20, true);
    dc.setUint16(6, 20, true);
    dc.setUint16(8, 0x0800, true);
    dc.setUint32(16, crc, true);
    dc.setUint32(20, f.data.length, true);
    dc.setUint32(24, f.data.length, true);
    dc.setUint16(28, name.length, true);
    dc.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(local, f.data);
    central.push(cen);
    offset += local.length + f.data.length;
  }
  const cenSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const de = new DataView(end.buffer);
  de.setUint32(0, 0x06054b50, true);
  de.setUint16(8, files.length, true);
  de.setUint16(10, files.length, true);
  de.setUint32(12, cenSize, true);
  de.setUint32(16, offset, true);
  return concat([...parts, ...central, end]);
}
