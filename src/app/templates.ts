// Modèles de départ : un document déjà composé, prêt à personnaliser.
import type { Doc, Layer } from "../engine/types.ts";
import { defaultDoc, newElement, newLayer, FORMATS, SPOT_INKS } from "../engine/doc.ts";
import { uid } from "../engine/util.ts";
import { EFFECT_BY_TYPE, defaultParams } from "../engine/effects.ts";
import { defaultScreen } from "../engine/screens.ts";

export interface Template {
  id: string;
  icon: string;
  label: string;
  hint: string;
  destination: string;
  make(): Doc;
  /** Retouche appliquée APRÈS la destination (qui règle les trames). */
  finish?(doc: Doc): void;
}

/** Effet « signature » prêt à poser : réglages par défaut + une recette éventuelle. */
function signatureFx(type: string, recipe = "", over: Record<string, number | string> = {}) {
  const def = EFFECT_BY_TYPE[type];
  const pr = def.presets?.find((x) => x.label.startsWith(recipe));
  return { id: uid("fx"), type, on: true, locked: false, params: { ...defaultParams(def), ...(recipe ? pr?.params : {}), ...over } };
}
const frostFx = (recipe = "", over: Record<string, number | string> = {}) => signatureFx("frost", recipe, over);
const pixelFx = (recipe = "", over: Record<string, number | string> = {}) => signatureFx("medievalpixel", recipe, over);
const dotsFx = (recipe = "", over: Record<string, number | string> = {}) => signatureFx("dots", recipe, over);

/** Noir et blanc francs : un seuil à 50 %, pas de trame par-dessus le dessin. */
function thresholdScreens(d: Doc) {
  for (const k of Object.keys(d.spotScreens)) d.spotScreens[k] = defaultScreen({ type: "seuil", level: 50 });
  for (const k of Object.keys(d.cmykScreens) as (keyof Doc["cmykScreens"])[]) d.cmykScreens[k] = defaultScreen({ type: "seuil", level: 50 });
}

/** Objet « en réserve » : il n'imprime rien, il efface l'encre du dessous (blanc du papier). */
function knockout(l: Layer, fx: Layer["effects"][number]): Layer {
  l.fill = { mode: "aplat", tint: 0 };
  l.overprint = false;
  l.fxOnShape = true;
  l.effects = [fx];
  return l;
}

const spot = (name: string) => {
  const s = SPOT_INKS.find((i) => i.name === name)!;
  return { name: s.name, hex: s.hex, cmyk: [0, 0, 0, 100] as [number, number, number, number] };
};

function sized(doc: Doc, formatId: string, landscape = false) {
  const f = FORMATS.find((x) => x.id === formatId)!;
  doc.settings.formatId = formatId;
  doc.settings.widthMm = landscape ? f.h : f.w;
  doc.settings.heightMm = landscape ? f.w : f.h;
}

function text(content: string, font: string, size: number, box: { x: number; y: number; w: number; h: number }, ink: Layer["ink"], align: "gauche" | "centre" | "droite" = "gauche"): Layer {
  const l = newElement("texte", box, ink);
  l.text = { ...l.text!, content, font, size, align };
  l.name = content.split("\n")[0].slice(0, 24) || "Texte";
  return l;
}

export const TEMPLATES: Template[] = [
  {
    id: "frost-special", icon: "❄", label: "Frost's Special", hint: "A3 noir et blanc : ondes peignées et titre en linogravure.", destination: "riso",
    make() {
      const d = defaultDoc();
      sized(d, "A3");
      d.settings.name = "Frost's Special";
      d.settings.mode = "directs";
      const fond = newLayer("bruit", "Ondes peignées", 0);
      fond.ink = spot("Noir");
      fond.source.params = { ...fond.source.params, type: "nuages", echelle: 70, octaves: 4, contraste: 280, densite: 20 };
      fond.effects = [frostFx("Ondes", { angle: -14 })];
      const titre = text("FROST", "inter-900", 170, { x: 15, y: 160, w: 267, h: 80 }, spot("Noir"), "centre");
      titre.fxOnShape = true;
      titre.overprint = false;
      titre.effects = [frostFx("", { halo: 12, forceHalo: 60 })];
      d.layers = [fond, titre];
      d.layout.margins = { top: 15, bottom: 15, inside: 15, outside: 15 };
      d.activeLayerId = titre.id;
      return d;
    },
    finish: thresholdScreens,
  },
  {
    id: "medieval-pixel", icon: "⚜", label: "Médiéval-Pixel", hint: "A3 blanc sur bleu : cadre en dentelle de pixels, titre et étoiles pixelisés.", destination: "riso",
    make() {
      const d = defaultDoc();
      sized(d, "A3");
      d.settings.name = "Médiéval-Pixel";
      d.settings.mode = "directs";
      const bleu = spot("Bleu moyen");
      const fond = newLayer("aplat", "Fond bleu", 0);
      fond.ink = bleu;
      fond.source.params = { densite: 100 };
      const cadre = knockout(newElement("forme", { x: 10, y: 10, w: 277, h: 400 }, bleu), pixelFx("Dentelle", { taille: 1 }));
      cadre.name = "Cadre en dentelle";
      cadre.shape = { ...cadre.shape!, type: "rect", radius: 18, fill: false, stroke: true, strokePt: 9 };
      const cadre2 = knockout(newElement("forme", { x: 20, y: 20, w: 257, h: 380 }, bleu), pixelFx("Double contour", { taille: 0.7 }));
      cadre2.name = "Filet intérieur";
      cadre2.shape = { ...cadre2.shape!, type: "rect", radius: 10, fill: false, stroke: true, strokePt: 3 };
      const ville = knockout(text("Dinan", "garamond-400", 64, { x: 30, y: 38, w: 237, h: 30 }, bleu, "centre"), pixelFx("Double contour", { taille: 0.55, epaisseur: 0.2 }));
      const titre = knockout(text("FÊTE DES\nREMPARTS", "garamond-400", 96, { x: 22, y: 78, w: 253, h: 105 }, bleu, "centre"), pixelFx("Dentelle", { taille: 0.75 }));
      const date = knockout(text("19 – 20 juillet", "garamond-400i", 44, { x: 30, y: 350, w: 237, h: 24 }, bleu, "centre"), pixelFx("Double contour", { taille: 0.45, epaisseur: 0.18 }));
      const etoiles = [[40, 205], [245, 220], [70, 300], [215, 310], [150, 255]].map(([x, y], i) => {
        const e = knockout(newElement("forme", { x, y, w: 16 + (i % 2) * 6, h: 16 + (i % 2) * 6 }, bleu), pixelFx("Bitmap", { taille: 0.7 }));
        e.name = "Étoile " + (i + 1);
        e.shape = { ...e.shape!, type: "etoile", sides: 8, inner: 45, fill: true, stroke: false };
        return e;
      });
      d.layers = [fond, cadre, cadre2, ville, titre, date, ...etoiles];
      d.layout.margins = { top: 20, bottom: 20, inside: 20, outside: 20 };
      d.activeLayerId = titre.id;
      return d;
    },
    finish: thresholdScreens,
  },
  {
    id: "dots", icon: "⁙", label: "Dots", hint: "A3 riso trois encres : nuages en grappes de points, soleil tramé, titre.", destination: "riso",
    make() {
      const d = defaultDoc();
      sized(d, "A3");
      d.settings.name = "Dots";
      d.settings.mode = "directs";
      const nuages = newLayer("bruit", "Nuages en points", 0);
      nuages.ink = spot("Rose fluo");
      nuages.source.params = { ...nuages.source.params, type: "nuages", echelle: 60, octaves: 4, contraste: 220, densite: 45 };
      nuages.effects = [dotsFx("Grappes", { pas: 0.6 })];
      const soleil = newElement("forme", { x: 150, y: 150, w: 110, h: 110 }, spot("Jaune"));
      soleil.name = "Soleil tramé";
      soleil.shape = { ...soleil.shape!, type: "ellipse", fill: true, stroke: false };
      soleil.overprint = true;
      soleil.fxOnShape = true;
      soleil.effects = [{ id: uid("fx"), type: "flou", on: true, locked: false, params: { rayon: 8 } }, dotsFx("Trame classique", { pas: 1.6 })];
      const titre = text("LUMIÈRES", "garamond-400", 96, { x: 15, y: 25, w: 267, h: 45 }, spot("Noir"), "centre");
      titre.overprint = true;
      d.layers = [nuages, soleil, titre];
      d.layout.margins = { top: 15, bottom: 15, inside: 15, outside: 15 };
      d.activeLayerId = nuages.id;
      return d;
    },
    finish: thresholdScreens,
  },
  {
    id: "affiche-riso", icon: "◍", label: "Affiche risographie", hint: "A3, deux encres, titre géant sur texture organique.", destination: "riso",
    make() {
      const d = defaultDoc();
      sized(d, "A3");
      d.settings.name = "Affiche riso";
      d.settings.mode = "directs";
      const bg = newLayer("rd", "Corail", 0);
      bg.ink = spot("Bleu moyen");
      bg.source.params = { ...bg.source.params, motif: "corail", tuile: 45, croissance: 7000 };
      const grain = newLayer("bruit", "Nuages", 1);
      grain.ink = spot("Rose fluo");
      grain.opacity = 60;
      const title = text("FROST", "inter-900", 150, { x: 15, y: 210, w: 267, h: 70 }, spot("Rose fluo"), "gauche");
      title.overprint = true;
      title.fill = { mode: "aplat", tint: 100 };
      const sub = text("Laboratoire de textures\n12 – 26 octobre", "garamond-400i", 26, { x: 15, y: 290, w: 200, h: 40 }, spot("Bleu moyen"));
      sub.overprint = true;
      d.layers = [bg, grain, title, sub];
      d.layout.columns = 6;
      d.layout.margins = { top: 15, bottom: 15, inside: 15, outside: 15 };
      d.activeLayerId = title.id;
      return d;
    },
  },
  {
    id: "carte-postale", icon: "✉", label: "Carte postale", hint: "A6 paysage, quadrichromie, texte sur texture.", destination: "offset-nc",
    make() {
      const d = defaultDoc();
      sized(d, "A6", true);
      d.settings.name = "Carte postale";
      const bg = d.layers[0];
      bg.source.params = { ...bg.source.params, motif: "empreintes", tuile: 18 };
      const t = text("Bons baisers\ndu laboratoire", "garamond-700", 28, { x: 10, y: 10, w: 110, h: 30 }, { name: "Noir riche", hex: "#111111", cmyk: [60, 40, 40, 100] });
      const panel = newElement("forme", { x: 8, y: 8, w: 90, h: 34 }, { name: "Blanc", hex: "#ffffff", cmyk: [0, 0, 0, 0] });
      panel.name = "Cartouche";
      panel.fill = { mode: "aplat", tint: 0 };
      d.layers = [bg, d.layers[1], panel, t];
      d.layout.margins = { top: 8, bottom: 8, inside: 8, outside: 8 };
      d.activeLayerId = t.id;
      return d;
    },
  },
  {
    id: "pochette", icon: "◉", label: "Pochette de disque", hint: "Carré 315 mm, texture labyrinthe et titre en Orbitron.", destination: "offset",
    make() {
      const d = defaultDoc();
      sized(d, "C30");
      d.settings.name = "Pochette";
      d.layers[0].source.params = { ...d.layers[0].source.params, motif: "labyrinthe", tuile: 60 };
      const t = text("FROST\nLAB", "orbitron-900", 96, { x: 20, y: 20, w: 275, h: 120 }, { name: "Noir", hex: "#1d1d1b", cmyk: [0, 0, 0, 100] });
      t.fill = { mode: "texture", tint: 100 };
      t.source = { type: "bruit", params: { type: "fibres", echelle: 3, octaves: 5, contraste: 160, densite: 62, etirement: 4, angle: 90, graine: 5 } };
      d.layers.push(t);
      d.layout.columns = 3;
      d.layout.margins = { top: 20, bottom: 20, inside: 20, outside: 20 };
      d.activeLayerId = t.id;
      return d;
    },
  },
  {
    id: "serigraphie", icon: "◫", label: "Affiche sérigraphie", hint: "A3, une encre noire, trame à gros points.", destination: "serigraphie",
    make() {
      const d = defaultDoc();
      sized(d, "A3");
      d.settings.name = "Sérigraphie";
      d.settings.mode = "directs";
      const bg = newLayer("rd", "Empreintes", 0);
      bg.ink = spot("Noir");
      bg.source.params = { ...bg.source.params, motif: "empreintes", tuile: 70 };
      const t = text("ÉCRAN\nDE SOIE", "silkscreen-700", 90, { x: 20, y: 30, w: 257, h: 160 }, spot("Noir"));
      t.overprint = false;
      d.layers = [bg, t];
      d.activeLayerId = t.id;
      return d;
    },
  },
  {
    id: "tuile", icon: "▦", label: "Texture à motif", hint: "Tuile 100 × 100 mm raccordable, pour Illustrator ou InDesign.", destination: "offset",
    make() {
      const d = defaultDoc();
      sized(d, "TUILE");
      d.settings.name = "Tuile";
      d.settings.bleedMm = 0;
      d.layers = [d.layers[0]];
      d.layers[0].source.params = { ...d.layers[0].source.params, tuile: 25 };
      d.activeLayerId = d.layers[0].id;
      return d;
    },
  },
  {
    id: "vide", icon: "□", label: "Document vide", hint: "A4 blanc : tu pars de zéro.", destination: "offset",
    make() {
      const d = defaultDoc();
      d.settings.name = "Sans titre";
      const fond = newLayer("aplat", "Fond", 0);
      fond.source.params = { densite: 0 };
      fond.id = uid("couche");
      d.layers = [fond];
      d.activeLayerId = fond.id;
      return d;
    },
  },
];
