// Mode « règles » : quand aucune IA locale n'est disponible, on interprète la consigne par mots-clés.
import type { Params } from "../engine/types.ts";
import type { AiSuggestion } from "./schema.ts";

interface Rule {
  words: RegExp;
  label: string;
  apply: (p: Params) => void;
  trame?: AiSuggestion["trame"];
}

const add = (p: Params, k: string, d: number, lo: number, hi: number) => {
  p[k] = Math.min(hi, Math.max(lo, Number(p[k]) + d));
};

const RULES: Rule[] = [
  { words: /organi|naturel|vivant|cellul|biolog|lichen|mousse/, label: "organique", apply: (p) => { p.organique = Math.max(60, Number(p.organique)); p.motif = "corail"; } },
  { words: /corail|coral|branche/, label: "corail", apply: (p) => { p.organique = Math.max(70, Number(p.organique)); p.motif = "corail"; } },
  { words: /labyrinth|maze|meandre|méandre|empreinte|digital/, label: "labyrinthe", apply: (p) => { p.organique = Math.max(65, Number(p.organique)); p.motif = "labyrinthe"; }, trame: "stochastique" },
  { words: /tache|léopard|leopard|pois|point/, label: "taches", apply: (p) => { p.organique = Math.max(50, Number(p.organique)); p.motif = "taches"; } },
  { words: /vers|ver |serpent|spaghetti/, label: "vers", apply: (p) => { p.organique = Math.max(55, Number(p.organique)); p.motif = "vers"; } },
  { words: /bulle|mousse|écume|ecume/, label: "bulles", apply: (p) => { p.organique = Math.max(55, Number(p.organique)); p.motif = "bulles"; } },
  { words: /géométr|geometr|régulier|regulier|grille|propre|net /, label: "géométrique", apply: (p) => { p.organique = 0; p.chaos = Math.min(5, Number(p.chaos)); p.rugosite = Math.min(5, Number(p.rugosite)); } },
  { words: /chaos|aléatoire|aleatoire|sauvage|désordre|desordre|glitch|cassé|casse/, label: "chaos", apply: (p) => add(p, "chaos", 45, 0, 100) },
  { words: /\bfin(e|es|s)?\b|délicat|delicat|petit|subtil|léger trait/, label: "fin", apply: (p) => { add(p, "echelle", -10, 2, 200); add(p, "epaisseur", -30, -100, 100); } },
  { words: /gros|épais|epais|massif|bold|lourd|énorme|enorme/, label: "épais", apply: (p) => { add(p, "echelle", 15, 2, 200); add(p, "epaisseur", 40, -100, 100); } },
  { words: /grain|granul|sable|poussi|papier|riso/, label: "grain", apply: (p) => { add(p, "grain", 40, 0, 100); add(p, "rugosite", 25, 0, 100); }, trame: "fm" },
  { words: /doux|flou|vaporeux|brume|soft/, label: "doux", apply: (p) => { p.nettete = Math.min(30, Number(p.nettete)); } },
  { words: /tranch|graphique|vectoriel|sec|nette|contrast/, label: "net", apply: (p) => { p.nettete = Math.max(95, Number(p.nettete)); add(p, "contraste", 25, 0, 100); } },
  { words: /rétro|retro|vintage|ancien|vieux|90|2000/, label: "rétro", apply: (p) => { add(p, "grain", 20, 0, 100); p.tons = 2; }, trame: "bayer" },
  { words: /bitmap|1.?bit|pixel|hypercard|mac/, label: "bitmap", apply: (p) => { p.tons = 2; }, trame: "diffusion" },
  { words: /trame|halftone|similigravure|journal|offset/, label: "trame", apply: () => {}, trame: "am" },
  { words: /dense|sombre|noir|chargé|charge|foncé|fonce/, label: "dense", apply: (p) => add(p, "densite", 20, 0, 100) },
  { words: /clair|aéré|aere|léger|leger|lumineux|vide/, label: "clair", apply: (p) => add(p, "densite", -20, 0, 100) },
  { words: /vertical/, label: "vertical", apply: (p) => { p.direction = 90; } },
  { words: /diagonal|oblique/, label: "diagonal", apply: (p) => { p.direction = 45; } },
  { words: /brique|quinconce|décal|decal/, label: "quinconce", apply: (p) => { p.decalage = 50; } },
  { words: /rugueux|rugos|brut|encre|bave|craie|fusain/, label: "rugueux", apply: (p) => add(p, "rugosite", 35, 0, 100) },
];

export function interpret(consigne: string, current: Params): AiSuggestion {
  const text = " " + consigne.toLowerCase() + " ";
  const p: Params = { ...current };
  const hits: string[] = [];
  let trame: AiSuggestion["trame"];
  for (const r of RULES) {
    if (r.words.test(text)) {
      r.apply(p);
      hits.push(r.label);
      if (r.trame) trame = r.trame;
    }
  }
  if (!hits.length) {
    // pas de mot-clé : on propose une variation douce autour des réglages actuels
    add(p, "organique", 15, 0, 100);
    add(p, "rugosite", 10, 0, 100);
    p.graine = Math.floor(Math.random() * 9999) + 1;
  }
  return {
    params: p,
    trame,
    explication: hits.length
      ? `Mode règles (IA locale absente) : j'ai repéré « ${hits.join(", ")} » et ajusté les curseurs en conséquence.`
      : "Mode règles (IA locale absente) : aucun mot-clé reconnu, je propose une variation organique.",
    source: "regles",
  };
}
