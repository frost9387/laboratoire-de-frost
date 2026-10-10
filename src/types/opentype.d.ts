declare module "opentype.js" {
  export interface PathCommand {
    type: "M" | "L" | "C" | "Q" | "Z";
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }
  export class Path {
    commands: PathCommand[];
    toPathData(decimals?: number): string;
  }
  export class Glyph {
    index: number;
    unicode?: number;
    advanceWidth?: number;
    getPath(x: number, y: number, fontSize: number): Path;
  }
  export class Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    names: unknown;
    charToGlyph(c: string): Glyph;
    getKerningValue(left: Glyph, right: Glyph): number;
  }
  export function parse(buffer: ArrayBuffer): Font;
}
