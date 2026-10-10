// « Où vas-tu imprimer ? » : une seule question règle toute la technique (mode, profil, encrage,
// résolution, trame, format d'export). Pensé pour que n'importe qui obtienne un fichier correct.
import type { Doc, PlateKey, ProfileInfo, ScreenSpec } from "../engine/types.ts";
import type { ExportOptions } from "../export/exporter.ts";
import { defaultScreen, CMYK_ANGLES } from "../engine/screens.ts";
import { GENERIC_CMYK_ID } from "../engine/color.ts";
import { inkKey } from "../engine/doc.ts";

export interface Destination {
  id: string;
  icon: string;
  label: string;
  /** Explication en une phrase, sans jargon. */
  hint: string;
  mode: Doc["settings"]["mode"];
  dpi: number;
  contonePpi: number;
  tacMax: number;
  /** Profils CMJN préférés, par ordre (expressions sur le nom du profil). */
  profiles: RegExp[];
  screen: Partial<ScreenSpec>;
  exportOpts: Partial<ExportOptions>;
  /** Ce que le logiciel livre, dit simplement. */
  delivers: string;
}

export const DESTINATIONS: Destination[] = [
  {
    id: "offset", icon: "▤", label: "Imprimeur — papier couché",
    hint: "Flyers, affiches, magazines sur papier brillant ou satiné.",
    mode: "cmjn", dpi: 300, contonePpi: 300, tacMax: 300,
    profiles: [/pso coated v3|fogra51/i, /fogra39|iso coated v2/i, /coated fogra/i, /gracol/i, /coated/i],
    screen: { type: "aucune" },
    exportOpts: { format: "tiff", content: "cmjn", dpi: 300, bleed: true, marks: true, embedIcc: true, tiffCompression: "lzw" },
    delivers: "Un TIFF CMJN 300 dpi avec profil, fond perdu et traits de coupe. L'imprimeur trame lui-même.",
  },
  {
    id: "offset-nc", icon: "▥", label: "Imprimeur — papier non couché",
    hint: "Papier mat, recyclé, à grain : cartes, éditions, papeterie.",
    mode: "cmjn", dpi: 300, contonePpi: 300, tacMax: 280,
    profiles: [/pso uncoated|fogra52/i, /uncoated fogra29/i, /uncoated/i],
    screen: { type: "aucune" },
    exportOpts: { format: "tiff", content: "cmjn", dpi: 300, bleed: true, marks: true, embedIcc: true, tiffCompression: "lzw" },
    delivers: "Un TIFF CMJN 300 dpi avec profil non couché, fond perdu et traits de coupe.",
  },
  {
    id: "journal", icon: "▦", label: "Journal / fanzine offset",
    hint: "Papier journal fin et absorbant : l'encre s'étale beaucoup.",
    mode: "cmjn", dpi: 300, contonePpi: 300, tacMax: 240,
    profiles: [/newspaper|isonews|snap|ifra/i, /uncoated/i],
    screen: { type: "aucune" },
    exportOpts: { format: "tiff", content: "cmjn", dpi: 300, bleed: true, marks: true, embedIcc: true, tiffCompression: "lzw" },
    delivers: "Un TIFF CMJN 300 dpi, encrage limité à 240 % pour le papier journal.",
  },
  {
    id: "riso", icon: "◍", label: "Risographie",
    hint: "Impression par encres de couleur (rose fluo, bleu…), une plaque par couleur.",
    mode: "directs", dpi: 600, contonePpi: 300, tacMax: 300,
    profiles: [],
    screen: { type: "fm", grainUm: 60, dotGain: 18, clean: 1, minDot: 0, maxDot: 100 },
    exportOpts: { format: "tiff", content: "plaques", dpi: 600, bleed: true, marks: false, tiffCompression: "packbits" },
    delivers: "Une image noir et blanc 600 dpi par couleur d'encre, déjà tramée, dans un ZIP.",
  },
  {
    id: "serigraphie", icon: "◫", label: "Sérigraphie",
    hint: "Écrans de soie, encres épaisses : textiles, affiches d'artiste.",
    mode: "directs", dpi: 1200, contonePpi: 300, tacMax: 300,
    profiles: [],
    screen: { type: "am", lpi: 45, shape: "ellipse", dotGain: 15, minDot: 8, maxDot: 90 },
    exportOpts: { format: "tiff", content: "plaques", dpi: 1200, bleed: true, marks: true, tiffCompression: "packbits" },
    delivers: "Un film noir et blanc 1200 dpi par couleur, trame 45 lpi, avec traits de coupe.",
  },
  {
    id: "laser", icon: "▣", label: "Photocopieuse / laser noir & blanc",
    hint: "Fanzines photocopiés, impression laser au bureau.",
    mode: "bitmap", dpi: 600, contonePpi: 300, tacMax: 100,
    profiles: [],
    screen: { type: "diffusion", kernel: "atkinson", grainUm: 85, dotGain: 10 },
    exportOpts: { format: "png", content: "plaques", dpi: 600, bleed: false, marks: false },
    delivers: "Une image 1 bit 600 dpi, tramée façon Mac classique : nette à la photocopie.",
  },
  {
    id: "bureau", icon: "▢", label: "Imprimante de bureau (couleur)",
    hint: "Jet d'encre ou laser couleur, à la maison ou au bureau.",
    mode: "cmjn", dpi: 300, contonePpi: 300, tacMax: 300,
    profiles: [/fogra39|coated/i],
    screen: { type: "aucune" },
    exportOpts: { format: "png", content: "composite", dpi: 300, bleed: false, marks: false },
    delivers: "Un PNG couleur 300 dpi à imprimer « taille réelle » depuis n'importe quel logiciel.",
  },
  {
    id: "ecran", icon: "▭", label: "Écran / réseaux sociaux",
    hint: "Pour montrer ton travail en ligne (pas pour imprimer).",
    mode: "cmjn", dpi: 150, contonePpi: 150, tacMax: 300,
    profiles: [/fogra39|coated/i],
    screen: { type: "aucune" },
    exportOpts: { format: "jpg", content: "composite", dpi: 150, bleed: false, marks: false, jpgQuality: 90 },
    delivers: "Un JPG léger, couleurs vérifiées, prêt à publier.",
  },
];

export const DESTINATION_BY_ID: Record<string, Destination> = Object.fromEntries(DESTINATIONS.map((d) => [d.id, d]));

function pickProfile(d: Destination, list: ProfileInfo[], current: string): string {
  const cmyk = list.filter((p) => p.space === "CMYK" && p.id !== GENERIC_CMYK_ID);
  for (const re of d.profiles) {
    const hit = cmyk.find((p) => re.test(p.name));
    if (hit) return hit.id;
  }
  return current !== GENERIC_CMYK_ID ? current : cmyk[0]?.id ?? GENERIC_CMYK_ID;
}

const EXPORT_KEY = "frost.export.v1";

/** Applique une destination au document (et prépare les réglages d'export). */
export function applyDestination(doc: Doc, id: string, profiles: ProfileInfo[]) {
  const d = DESTINATION_BY_ID[id];
  if (!d) return;
  const s = doc.settings;
  doc.destination = id;
  s.mode = d.mode;
  s.dpi = d.dpi;
  s.contonePpi = d.contonePpi;
  s.tacMax = d.tacMax;
  if (d.mode === "cmjn") s.profileId = pickProfile(d, profiles, s.profileId);
  const screenFor = (angle: number): ScreenSpec => defaultScreen({ ...d.screen, angle });
  (["C", "M", "Y", "K"] as PlateKey[]).forEach((k) => (doc.cmykScreens[k] = screenFor(CMYK_ANGLES[k])));
  if (d.mode === "directs") {
    const keys = [...new Set(doc.layers.map((l) => inkKey(l.ink)))];
    keys.forEach((k, i) => (doc.spotScreens[k] = screenFor([45, 15, 75, 0][i % 4])));
  }
  try {
    const prev = JSON.parse(localStorage.getItem(EXPORT_KEY) ?? "{}");
    localStorage.setItem(EXPORT_KEY, JSON.stringify({ ...prev, ...d.exportOpts }));
  } catch {
    /* stockage indisponible */
  }
}
