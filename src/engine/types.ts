// Modèle de document du Laboratoire de Frost.
// Règle d'or : tout réglage visible est exprimé en unité physique (mm, lpi, dpi, °, %),
// jamais en pixels d'aperçu. Le rendu est donc identique quelle que soit la résolution.

export type ColorMode = "bitmap" | "gris" | "cmjn" | "directs";
export type Intent = "perceptuel" | "relatif" | "saturation" | "absolu";
export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

export type SourceType = "rd" | "bruit" | "image" | "dessin" | "aplat";

export type ScreenType = "aucune" | "am" | "stochastique" | "fm" | "bayer" | "diffusion" | "seuil";

export interface ScreenSpec {
  type: ScreenType;
  lpi: number; // linéature (AM, stochastique)
  angle: number; // degrés
  shape: string; // forme de point AM
  grainUm: number; // taille du grain (FM, Bayer, diffusion), en micromètres
  kernel: string; // noyau de diffusion d'erreur
  serpentine: boolean;
  bayerLevel: number; // 1..4 → matrice 2^n
  level: number; // seuil 0..100 (%)
  rdPreset: string; // trame stochastique : motif réaction-diffusion
  rdScale: number; // multiplicateur d'échelle du motif
  dotGain: number; // compensation d'engraissement à 50 % (en points de %)
  minDot: number; // plus petit point imprimable (%)
  maxDot: number; // plus grand point avant bouchage (%)
  clean: number; // nettoyage des amas isolés (cellules), 0 = off
}

export interface Ink {
  name: string;
  cmyk: [number, number, number, number]; // recette en % (mode CMJN)
  hex: string; // couleur d'affichage (tons directs, gris)
}

export interface SourceSpec {
  type: SourceType;
  params: Params;
  assetId?: string;
}

export interface EffectInst {
  id: string;
  type: string;
  on: boolean;
  locked: boolean;
  params: Params;
}

/** Nature d'un calque : texture pleine page, ou objet de mise en page. */
export type LayerKind = "texture" | "texte" | "forme" | "image";

/** Cadre d'un objet, en mm depuis le coin haut-gauche du FORMAT FINI (comme InDesign). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number; // degrés, autour du centre
}

export type TextAlign = "gauche" | "centre" | "droite" | "justifie";

export interface TextSpec {
  content: string;
  font: string; // identifiant de police (voir fonts.ts)
  size: number; // pt
  leading: number; // pt (0 = automatique : 120 %)
  tracking: number; // approche, en millièmes de cadratin
  align: TextAlign;
  vAlign: "haut" | "milieu" | "bas";
  caps: boolean; // tout en capitales
  baseline: boolean; // aligné sur la grille de ligne de base
}

export type ShapeType = "rect" | "ellipse" | "ligne" | "polygone" | "etoile";

export interface ShapeSpec {
  type: ShapeType;
  radius: number; // arrondi des angles (mm)
  sides: number; // polygone / étoile
  inner: number; // creux de l'étoile (%)
  fill: boolean;
  stroke: boolean;
  strokePt: number; // épaisseur du contour (pt)
}

export interface ImageSpec {
  fit: "contenir" | "remplir" | "etirer";
}

/** Comment l'objet est encré : aplat (teinte) ou texture (source + pile d'effets du calque). */
export interface ElementFill {
  mode: "aplat" | "texture";
  tint: number; // %
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  kind?: LayerKind; // absent = texture (projets v0.1)
  ink: Ink;
  opacity: number; // 0..100 (%)
  source: SourceSpec;
  effects: EffectInst[];
  /** Ancien emplacement de la trame (v0.1). Depuis la v0.2 : doc.spotScreens. */
  screen?: ScreenSpec;
  box?: Box;
  text?: TextSpec;
  shape?: ShapeSpec;
  image?: ImageSpec;
  assetId?: string; // logo vectoriel ou image de l'objet
  fill?: ElementFill;
  /** Surimpression : l'objet n'efface pas les encres en dessous (sinon : réserve, comme InDesign). */
  overprint?: boolean;
  /** Les effets déforment aussi la forme de l'objet (texte qui fond, logo en onde…). */
  fxOnShape?: boolean;
  /** Position verrouillée sur la planche. */
  pinned?: boolean;
}

export interface Guide {
  axis: "v" | "h";
  pos: number; // mm depuis le bord haut-gauche du format fini
}

/** Grilles façon InDesign : marges, colonnes, rangées, ligne de base, repères. */
export interface LayoutSettings {
  margins: { top: number; bottom: number; inside: number; outside: number };
  columns: number;
  gutter: number; // mm
  rows: number;
  rowGutter: number; // mm
  baselineStart: number; // mm depuis le haut du format
  baselineStep: number; // pt
  guides: Guide[];
  snap: boolean;
  show: { margins: boolean; columns: boolean; baseline: boolean; guides: boolean; frames: boolean };
}

export interface DocSettings {
  name: string;
  formatId: string;
  widthMm: number;
  heightMm: number;
  bleedMm: number; // fond perdu
  dpi: number; // résolution de sortie (trame)
  contonePpi: number; // résolution du ton continu (calcul des effets)
  mode: ColorMode;
  profileId: string; // profil CMJN (sortie / épreuvage)
  rgbProfileId: string; // profil des exports RVB
  intent: Intent;
  bpc: boolean; // compensation du point noir
  paperHex: string;
  tacMax: number; // taux d'encrage total max (%)
  seed: number;
}

export type PlateKey = "C" | "M" | "Y" | "K";

export interface Doc {
  version: 2;
  settings: DocSettings;
  layers: Layer[];
  cmykScreens: Record<PlateKey, ScreenSpec>;
  /** Tons directs : une plaque par encre (clé = nom|couleur). */
  spotScreens: Record<string, ScreenSpec>;
  layout: LayoutSettings;
  activeLayerId: string;
  /** Destination d'impression choisie (préréglage « pour tout le monde »). */
  destination?: string;
}

/** Tracé vectoriel importé (logo SVG), déjà converti en chemins + gris d'encre. */
export interface VectorItem {
  d: string; // données de chemin SVG, dans le repère du viewBox
  m: [number, number, number, number, number, number]; // matrice de transformation
  fill: number | null; // densité d'encre 0..1 (null = pas de remplissage)
  stroke: number | null;
  sw: number; // épaisseur du contour (unités du viewBox)
  evenodd: boolean;
}

export interface VectorData {
  vbX: number;
  vbY: number;
  vbW: number;
  vbH: number;
  items: VectorItem[];
}

/** Données lourdes (images, dessins, logos, polices) gardées hors de l'historique. */
export interface Asset {
  id: string;
  kind: "image" | "dessin" | "vecteur" | "police";
  name: string;
  width: number;
  height: number;
  rgba?: Uint8ClampedArray; // image : RVBA ; dessin : encre dans le canal alpha
  vector?: VectorData; // logo SVG
  bytes?: Uint8Array; // police importée (TTF / OTF / WOFF)
  family?: string; // police : nom de famille
}

export interface ProfileInfo {
  id: string;
  name: string;
  space: "CMYK" | "RGB" | "GRAY";
  origin: "intégré" | "système" | "importé";
  path?: string; // système : chemin sur disque
}

/** Une plaque = une encre imprimée séparément. */
export interface PlateDesc {
  key: string; // "C" | "M" | "Y" | "K" ou clé d'encre (tons directs)
  name: string;
  hex: string; // couleur d'affichage
  screen: ScreenSpec;
}
