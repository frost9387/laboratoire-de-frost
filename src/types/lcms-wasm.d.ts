declare module "lcms-wasm" {
  export interface LcmsModule {
    cmsOpenProfileFromMem(bytes: Uint8Array, size: number): number;
    cmsCloseProfile(handle: number): void;
    cmsCreate_sRGBProfile(): number;
    cmsCreateLab4Profile(whitePoint?: number[]): number;
    cmsGetProfileInfoASCII(handle: number, info: number, lang: string, country: string): string;
    cmsGetColorSpaceASCII(handle: number): string | null;
    cmsFormatterForColorspaceOfProfile(handle: number, nBytes: number, isFloat: boolean): number;
    cmsCreateTransform(input: number, inFmt: number, output: number, outFmt: number, intent: number, flags: number): number;
    cmsDeleteTransform(transform: number): void;
    cmsDoTransform(transform: number, input: Uint8Array | Uint16Array | Float32Array, n: number): Uint8Array | Uint16Array | Float32Array;
  }
  export function instantiate(opts?: { locateFile?: (name: string) => string }): Promise<LcmsModule>;
  export const TYPE_CMYK_8: number;
  export const TYPE_RGB_8: number;
  export const TYPE_GRAY_8: number;
  export const INTENT_PERCEPTUAL: number;
  export const INTENT_RELATIVE_COLORIMETRIC: number;
  export const INTENT_SATURATION: number;
  export const INTENT_ABSOLUTE_COLORIMETRIC: number;
  export const cmsFLAGS_BLACKPOINTCOMPENSATION: number;
  export const cmsFLAGS_NOCACHE: number;
  export const cmsInfoDescription: number;
}
