// Polices vectorielles : on lit les vrais contours (opentype.js), donc le texte est identique
// à l'écran, dans les fichiers tramés et en SVG (contours vectorisés, sans dépendre des polices de l'imprimeur).
import * as otNs from "opentype.js";

// Vite charge la version module (fonctions nommées) ; Node charge la version CommonJS (tout dans `default`).
const opentype: typeof otNs = (otNs as unknown as { parse?: unknown }).parse
  ? otNs
  : (otNs as unknown as { default: typeof otNs }).default;

export interface FontDef {
  id: string;
  family: string;
  style: string; // libellé de graisse / style
  source: "intégré" | "importé" | "ordinateur";
  file?: string; // police intégrée : nom du fichier fontsource
}

const F = (pkg: string, w: string, italic = false) => `${pkg}-latin-${w}-${italic ? "italic" : "normal"}.woff`;

/** Polices libres (OFL) livrées avec le logiciel. */
export const BUILTIN_FONTS: FontDef[] = [
  { id: "inter-400", family: "Inter", style: "Regular", source: "intégré", file: "inter/" + F("inter", "400") },
  { id: "inter-400i", family: "Inter", style: "Italic", source: "intégré", file: "inter/" + F("inter", "400", true) },
  { id: "inter-700", family: "Inter", style: "Bold", source: "intégré", file: "inter/" + F("inter", "700") },
  { id: "inter-900", family: "Inter", style: "Black", source: "intégré", file: "inter/" + F("inter", "900") },
  { id: "garamond-400", family: "EB Garamond", style: "Regular", source: "intégré", file: "eb-garamond/" + F("eb-garamond", "400") },
  { id: "garamond-400i", family: "EB Garamond", style: "Italic", source: "intégré", file: "eb-garamond/" + F("eb-garamond", "400", true) },
  { id: "garamond-700", family: "EB Garamond", style: "Bold", source: "intégré", file: "eb-garamond/" + F("eb-garamond", "700") },
  { id: "spacemono-400", family: "Space Mono", style: "Regular", source: "intégré", file: "space-mono/" + F("space-mono", "400") },
  { id: "spacemono-700", family: "Space Mono", style: "Bold", source: "intégré", file: "space-mono/" + F("space-mono", "700") },
  { id: "orbitron-500", family: "Orbitron", style: "Medium", source: "intégré", file: "orbitron/" + F("orbitron", "500") },
  { id: "orbitron-900", family: "Orbitron", style: "Black", source: "intégré", file: "orbitron/" + F("orbitron", "900") },
  { id: "silkscreen-400", family: "Silkscreen", style: "Regular", source: "intégré", file: "silkscreen/" + F("silkscreen", "400") },
  { id: "silkscreen-700", family: "Silkscreen", style: "Bold", source: "intégré", file: "silkscreen/" + F("silkscreen", "700") },
  { id: "vt323-400", family: "VT323", style: "Regular", source: "intégré", file: "vt323/" + F("vt323", "400") },
];

export type OTFont = otNs.Font;

/** Cache des polices analysées. Le chargement des octets est fourni par l'environnement (navigateur ou Node). */
export class FontStore {
  private fonts = new Map<string, OTFont>();
  private pending = new Map<string, Promise<OTFont | null>>();
  private bytes = new Map<string, Uint8Array>();
  private loader: (def: FontDef) => Promise<ArrayBuffer>;

  constructor(loader: (def: FontDef) => Promise<ArrayBuffer>) {
    this.loader = loader;
  }

  /** Police importée ou de l'ordinateur : octets fournis directement. */
  register(id: string, data: Uint8Array) {
    this.bytes.set(id, data);
    this.fonts.delete(id);
    this.pending.delete(id);
  }

  has(id: string) {
    return this.fonts.has(id);
  }

  /** Version synchrone (la police doit déjà être chargée). */
  getLoaded(id: string): OTFont | undefined {
    return this.fonts.get(id) ?? this.fonts.get("inter-400");
  }

  async get(id: string): Promise<OTFont | null> {
    const hit = this.fonts.get(id);
    if (hit) return hit;
    let p = this.pending.get(id);
    if (!p) {
      p = (async () => {
        try {
          let buf: ArrayBuffer;
          const own = this.bytes.get(id);
          if (own) buf = own.buffer.slice(own.byteOffset, own.byteOffset + own.byteLength) as ArrayBuffer;
          else {
            const def = BUILTIN_FONTS.find((f) => f.id === id);
            if (!def) return null;
            buf = await this.loader(def);
          }
          const font = opentype.parse(buf);
          this.fonts.set(id, font);
          return font;
        } catch {
          return null;
        }
      })();
      this.pending.set(id, p);
    }
    return p;
  }

  /** Charge toutes les polices utilisées (repli sur Inter si une police manque). */
  async ensure(ids: string[]): Promise<void> {
    await this.get("inter-400");
    await Promise.all([...new Set(ids)].map((id) => this.get(id)));
  }
}

/** Lit le nom de famille d'un fichier de police (pour les polices importées). */
export function fontFamilyName(buf: ArrayBuffer): { family: string; style: string } | null {
  try {
    const f = opentype.parse(buf);
    const n = f.names as unknown as Record<string, Record<string, string>>;
    const pick = (o?: Record<string, string>) => (o ? o.fr ?? o.en ?? Object.values(o)[0] : undefined);
    return {
      family: pick(n.preferredFamily) ?? pick(n.fontFamily) ?? "Police",
      style: pick(n.preferredSubfamily) ?? pick(n.fontSubfamily) ?? "Regular",
    };
  } catch {
    return null;
  }
}
