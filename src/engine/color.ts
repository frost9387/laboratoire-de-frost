// Gestion des couleurs : vrais profils ICC via LittleCMS (WASM).
// Sans profil CMJN chargé, un modèle « CMJN générique » approximatif prend le relais (signalé dans l'interface).
import * as LCMS from "lcms-wasm";
import type { Intent, ProfileInfo } from "./types.ts";
import { clamp } from "./util.ts";

export const GENERIC_CMYK_ID = "cmjn-generique";
export const SRGB_ID = "srgb";

const INTENTS: Record<Intent, number> = {
  perceptuel: LCMS.INTENT_PERCEPTUAL,
  relatif: LCMS.INTENT_RELATIVE_COLORIMETRIC,
  saturation: LCMS.INTENT_SATURATION,
  absolu: LCMS.INTENT_ABSOLUTE_COLORIMETRIC,
};

type Lcms = Awaited<ReturnType<typeof LCMS.instantiate>>;

interface Loaded {
  info: ProfileInfo;
  handle: number;
  bytes?: Uint8Array;
}

export class ColorEngine {
  private lcms: Lcms;
  private profiles = new Map<string, Loaded>();
  private transforms = new Map<string, number>();

  private constructor(lcms: Lcms) {
    this.lcms = lcms;
    this.profiles.set(SRGB_ID, {
      info: { id: SRGB_ID, name: "sRGB IEC61966-2.1", space: "RGB", origin: "intégré" },
      handle: lcms.cmsCreate_sRGBProfile(),
    });
  }

  static async create(wasmUrl?: string): Promise<ColorEngine> {
    const lcms = await LCMS.instantiate(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
    return new ColorEngine(lcms);
  }

  /** Lit un profil ICC. Renvoie ses infos ou null s'il est illisible. */
  addProfile(id: string, bytes: Uint8Array, origin: ProfileInfo["origin"], path?: string): ProfileInfo | null {
    if (this.profiles.has(id)) return this.profiles.get(id)!.info;
    const handle = this.lcms.cmsOpenProfileFromMem(bytes, bytes.byteLength);
    if (!handle) return null;
    const space = this.lcms.cmsGetColorSpaceASCII(handle);
    if (space !== "CMYK" && space !== "RGB" && space !== "GRAY") {
      this.lcms.cmsCloseProfile(handle);
      return null;
    }
    const name =
      this.lcms.cmsGetProfileInfoASCII(handle, LCMS.cmsInfoDescription, "en", "US").replace(/\0/g, "").trim() || id;
    const info: ProfileInfo = { id, name, space, origin, path };
    this.profiles.set(id, { info, handle, bytes });
    return info;
  }

  has(id: string): boolean {
    return this.profiles.has(id);
  }

  info(id: string): ProfileInfo | undefined {
    return this.profiles.get(id)?.info;
  }

  bytes(id: string): Uint8Array | undefined {
    return this.profiles.get(id)?.bytes;
  }

  list(): ProfileInfo[] {
    return [...this.profiles.values()].map((p) => p.info);
  }

  private transform(key: string, make: () => number): number {
    let t = this.transforms.get(key);
    if (!t) {
      t = make();
      if (!t) throw new Error("transformation impossible : " + key);
      this.transforms.set(key, t);
    }
    return t;
  }

  /** CMJN 8 bits (0..255 = 0..100 % d'encre) → sRGB 8 bits, pour l'épreuvage écran. */
  cmykToSrgb(profileId: string, cmyk: Uint8Array, n: number, intent: Intent): Uint8Array {
    const p = this.profiles.get(profileId);
    if (!p || p.info.space !== "CMYK") return genericCmykToRgb(cmyk, n);
    const s = this.profiles.get(SRGB_ID)!;
    const t = this.transform(`c2s|${profileId}|${intent}`, () =>
      this.lcms.cmsCreateTransform(p.handle, LCMS.TYPE_CMYK_8, s.handle, LCMS.TYPE_RGB_8, INTENTS[intent], 0),
    );
    return this.lcms.cmsDoTransform(t, cmyk, n) as Uint8Array;
  }

  /** sRGB 8 bits → CMJN 8 bits selon le profil de sortie (séparation d'une image). */
  srgbToCmyk(profileId: string, rgb: Uint8Array, n: number, intent: Intent, bpc: boolean): Uint8Array {
    const p = this.profiles.get(profileId);
    if (!p || p.info.space !== "CMYK") return genericRgbToCmyk(rgb, n);
    const s = this.profiles.get(SRGB_ID)!;
    const flags = bpc ? LCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0;
    const t = this.transform(`s2c|${profileId}|${intent}|${bpc}`, () =>
      this.lcms.cmsCreateTransform(s.handle, LCMS.TYPE_RGB_8, p.handle, LCMS.TYPE_CMYK_8, INTENTS[intent], flags),
    );
    return this.lcms.cmsDoTransform(t, rgb, n) as Uint8Array;
  }

  /** sRGB → autre espace RVB (Adobe RGB, P3…) pour les exports RVB. */
  srgbToRgb(profileId: string, rgb: Uint8Array, n: number, intent: Intent): Uint8Array {
    const p = this.profiles.get(profileId);
    if (!p || p.info.space !== "RGB" || profileId === SRGB_ID) return rgb;
    const s = this.profiles.get(SRGB_ID)!;
    const t = this.transform(`s2r|${profileId}|${intent}`, () =>
      this.lcms.cmsCreateTransform(s.handle, LCMS.TYPE_RGB_8, p.handle, LCMS.TYPE_RGB_8, INTENTS[intent], 0),
    );
    return this.lcms.cmsDoTransform(t, rgb, n) as Uint8Array;
  }
}

/** Modèle CMJN générique (sans profil) : encres approximatives sur papier blanc. */
export function genericCmykToRgb(cmyk: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = cmyk[i * 4] / 255;
    const m = cmyk[i * 4 + 1] / 255;
    const y = cmyk[i * 4 + 2] / 255;
    const k = cmyk[i * 4 + 3] / 255;
    // impuretés typiques des encres process
    const r = (1 - c) * (1 - 0.08 * m) * (1 - 0.02 * y);
    const g = (1 - 0.35 * c) * (1 - m) * (1 - 0.08 * y);
    const b = (1 - 0.1 * c) * (1 - 0.55 * m) * (1 - y);
    const kk = 1 - k * 0.92;
    out[i * 3] = clamp(Math.round(255 * r * kk), 0, 255);
    out[i * 3 + 1] = clamp(Math.round(255 * g * kk), 0, 255);
    out[i * 3 + 2] = clamp(Math.round(255 * b * kk), 0, 255);
  }
  return out;
}

export function genericRgbToCmyk(rgb: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3] / 255;
    const g = rgb[i * 3 + 1] / 255;
    const b = rgb[i * 3 + 2] / 255;
    const k = 1 - Math.max(r, g, b);
    const d = 1 - k || 1;
    const gcr = 0.7;
    const kk = k * gcr;
    const c = ((1 - r - k) / d) * (1 - kk) + (k - kk);
    const m = ((1 - g - k) / d) * (1 - kk) + (k - kk);
    const y = ((1 - b - k) / d) * (1 - kk) + (k - kk);
    out[i * 4] = clamp(Math.round(c * 255), 0, 255);
    out[i * 4 + 1] = clamp(Math.round(m * 255), 0, 255);
    out[i * 4 + 2] = clamp(Math.round(y * 255), 0, 255);
    out[i * 4 + 3] = clamp(Math.round(kk * 255), 0, 255);
  }
  return out;
}
