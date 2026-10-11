// Fenêtres d'information : À propos, installation de l'IA locale, raccourcis.
import { h } from "../dom.ts";
import { group, note } from "../widgets.ts";
import { kbd } from "../platform.ts";
import type { Win } from "../wm.ts";

const FLAKE = `      .   *   .
   *  \\  |  /  *
  ---- ❄ FROST ----
   *  /  |  \\  *
      '   *   '`;

export function mountAbout(win: Win) {
  win.body.append(
    h("div", { class: "about" },
      h("div", { class: "ascii", "aria-hidden": "true" }, FLAKE),
      h("div", { class: "big" }, "Le laboratoire de Frost"),
      h("div", { class: "ver" }, "Version 0.4 — Frost's Special"),
      h("p", null, "Textures et mises en page imprimables pour graphistes : texte, logos, formes, grilles, trames AM, stochastiques et FM, profils ICC, séparations et exports print."),
      h("p", { class: "muted" }, "Couleurs : LittleCMS (MIT). Contours de texte : opentype.js (MIT). Polices : Inter, EB Garamond, Space Mono, Orbitron, Silkscreen, VT323 (OFL)."),
    ),
  );
}

export function mountAiHelp(win: Win) {
  const cmd = (t: string) => h("pre", { class: "note", style: "font:16px var(--f-num);white-space:pre-wrap;user-select:all" }, t);
  win.body.append(
    note("L'IA tourne sur ta carte graphique : rien n'est envoyé sur internet. Sans elle, l'Atelier marche quand même (mode règles par mots-clés)."),
    group("1. Installer Ollama", h("p", null, "Télécharger et installer Ollama pour Windows depuis ollama.com, puis le laisser tourner (icône près de l'horloge).")),
    group(
      "2. Télécharger un modèle qui voit les images",
      h("p", null, "Dans PowerShell (ou le Terminal sur Mac). Pour une carte de 8 Go comme la RTX 5050 :"),
      cmd("ollama pull gemma4:e2b-it-qat"),
      h("p", { class: "muted" }, "4,3 Go, rapide. Plus précis mais plus lourd (6,1 Go) :"),
      cmd("ollama pull gemma4:e4b-it-qat"),
      note("N'utilise pas les modèles « cloud » (ex. gemma4:31b-cloud) : ils envoient tes croquis sur internet et sont facturés. Le laboratoire les ignore.", "warn"),
    ),
    group("3. Revenir dans l'Atelier", h("p", null, "Cliquer sur « Reconnecter ». Le point passe au vert et le modèle apparaît dans la liste. L'icône 👁 signale un modèle qui lit le croquis.")),
    group("Dépannage", h("p", null, "Ollama répond sur http://127.0.0.1:11434. Si la version web du laboratoire est servie depuis une autre adresse que localhost, autoriser cette adresse avec la variable d'environnement OLLAMA_ORIGINS.")),
  );
}

export function mountShortcuts(win: Win) {
  const rows: [string, string][] = [
    [kbd("Ctrl+") + "+ / " + kbd("Ctrl+") + "−", "Zoom avant / arrière"],
    [kbd("Ctrl+") + "0 / " + kbd("Ctrl+") + "1", "Toute la page / taille réelle (100 %)"],
    [kbd("Ctrl+") + "molette", "Zoomer sous le curseur"],
    ["Espace + glisser", "Déplacer la vue (outil Main)"],
    [kbd("Ctrl+Z") + " / " + kbd("Ctrl+Maj+Z"), "Annuler / rétablir"],
    ["V T M L \\ Y G K H", "Outils : sélection, texte, rectangle, ellipse, ligne, polygone, étoile, logo, main"],
    ["Flèches (+ Maj)", "Déplacer l'objet de 0,5 mm (5 mm)"],
    ["Alt + glisser", "Dupliquer l'objet"],
    ["Suppr", "Supprimer l'objet sélectionné"],
    [kbd("Ctrl+Maj+D"), "Dupliquer le calque"],
    [kbd("Ctrl+M"), "MOSH ! (effets au hasard)"],
    [kbd("Ctrl+E"), "Exporter"],
    [kbd("Ctrl+S") + " / " + kbd("Ctrl+O"), "Enregistrer / ouvrir un projet .frost"],
    [kbd("Ctrl+I"), "Importer une image"],
    [kbd("Ctrl+D"), "Ouvrir l'Atelier de dessin"],
    ["Atelier : C B N F K D A P S H", "Crayon, pinceau, plume, feutre, fusain, brosse sèche, aéro, points, taches, hachures"],
    ["Atelier : M T L R O G U E", "Tampon, texte, ligne, rectangle, ellipse, remplir, flou, gomme"],
    ["Atelier : [ et ]", "Réduire / agrandir l'outil"],
    ["Clic droit sur un curseur", "Valeur par défaut"],
    ["Double-clic sur un titre", "Replier la fenêtre"],
  ];
  win.body.append(h("dl", { class: "kv" }, ...rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])));
}
