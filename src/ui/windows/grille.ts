// Fenêtre « Grille & marges » : comme « Marges et colonnes » + grilles d'InDesign.
import { h } from "../dom.ts";
import { slider, checkbox, group, button, note, numField } from "../widgets.ts";
import { store } from "../../app/store.ts";
import type { LayoutSettings } from "../../engine/types.ts";
import type { Win } from "../wm.ts";

const PRESETS: { label: string; apply: (L: LayoutSettings) => void }[] = [
  { label: "1 colonne", apply: (L) => { L.columns = 1; L.rows = 1; } },
  { label: "2 colonnes", apply: (L) => { L.columns = 2; L.rows = 1; L.gutter = 6; } },
  { label: "3 colonnes", apply: (L) => { L.columns = 3; L.rows = 1; L.gutter = 5; } },
  { label: "Grille 6 × 6", apply: (L) => { L.columns = 6; L.rows = 6; L.gutter = 4; L.rowGutter = 4; } },
  { label: "12 colonnes", apply: (L) => { L.columns = 12; L.rows = 1; L.gutter = 4; } },
];

export function mountGrille(win: Win) {
  const ORIGIN = "grille";
  const set = (fn: (L: LayoutSettings) => void, live = false) => store.update((d) => fn(d.layout), { live, origin: live ? ORIGIN : undefined });

  function render() {
    const L = store.doc.layout;
    const s = store.doc.settings;
    const linked = L.margins.top === L.margins.bottom && L.margins.top === L.margins.inside && L.margins.top === L.margins.outside;
    win.body.replaceChildren(
      group(
        "Marges",
        h("div", { class: "nfgrid" },
          numField("Haut", L.margins.top, "mm", (v) => set((x) => (x.margins.top = Math.max(0, v)))),
          numField("Bas", L.margins.bottom, "mm", (v) => set((x) => (x.margins.bottom = Math.max(0, v)))),
          numField("Gauche", L.margins.inside, "mm", (v) => set((x) => (x.margins.inside = Math.max(0, v)))),
          numField("Droite", L.margins.outside, "mm", (v) => set((x) => (x.margins.outside = Math.max(0, v)))),
        ),
        slider({
          label: "Toutes les marges", value: linked ? L.margins.top : L.margins.top, min: 0, max: 60, step: 0.5, unit: "mm",
          hint: "Règle les quatre marges d'un coup.",
          onInput: (v) => set((x) => (x.margins = { top: v, bottom: v, inside: v, outside: v }), true),
          onCommit: () => store.commit(),
        }),
      ),
      group(
        "Colonnes & rangées",
        slider({ label: "Colonnes", value: L.columns, min: 1, max: 24, step: 1, unit: "", def: 1, onInput: (v) => set((x) => (x.columns = v), true), onCommit: () => store.commit() }),
        slider({ label: "Gouttière", value: L.gutter, min: 0, max: 30, step: 0.5, unit: "mm", def: 5, hint: "Espace entre deux colonnes.", onInput: (v) => set((x) => (x.gutter = v), true), onCommit: () => store.commit() }),
        slider({ label: "Rangées", value: L.rows, min: 1, max: 24, step: 1, unit: "", def: 1, onInput: (v) => set((x) => (x.rows = v), true), onCommit: () => store.commit() }),
        slider({ label: "Gouttière rangées", value: L.rowGutter, min: 0, max: 30, step: 0.5, unit: "mm", def: 5, onInput: (v) => set((x) => (x.rowGutter = v), true), onCommit: () => store.commit() }),
        h("div", { class: "btns" }, ...PRESETS.map((p) => button(p.label, () => set(p.apply), { cls: "small" }))),
      ),
      group(
        "Grille de ligne de base",
        slider({ label: "Début", value: L.baselineStart, min: 0, max: Math.round(s.heightMm / 2), step: 0.5, unit: "mm", def: 12, onInput: (v) => set((x) => (x.baselineStart = v), true), onCommit: () => store.commit() }),
        slider({ label: "Pas", value: L.baselineStep, min: 4, max: 72, step: 0.5, unit: "pt", def: 12, hint: "Les textes « alignés sur la grille » ont un interligne multiple de ce pas.", onInput: (v) => set((x) => (x.baselineStep = v), true), onCommit: () => store.commit() }),
        checkbox("Afficher la ligne de base", L.show.baseline, (v) => set((x) => (x.show.baseline = v))),
      ),
      group(
        "Repères",
        L.guides.length
          ? h("div", { class: "list" }, ...L.guides.map((g, i) =>
              h("div", { class: "li" },
                h("span", { class: "kind" }, g.axis === "v" ? "│" : "─"),
                h("span", { class: "name" }, `${g.axis === "v" ? "Vertical" : "Horizontal"} à ${String(g.pos).replace(".", ",")} mm`),
                button("✕", () => set((x) => x.guides.splice(i, 1)), { cls: "small icon", title: "Supprimer ce repère" }),
              ),
            ))
          : note("Astuce : tirez un repère depuis une règle de la Planche (en haut ou à gauche). Pour le supprimer, ramenez-le sur la règle."),
        h("div", { class: "btns" },
          button("+ Vertical au centre", () => set((x) => x.guides.push({ axis: "v", pos: s.widthMm / 2 })), { cls: "small" }),
          button("+ Horizontal au centre", () => set((x) => x.guides.push({ axis: "h", pos: s.heightMm / 2 })), { cls: "small" }),
          L.guides.length ? button("Tout effacer", () => set((x) => (x.guides = [])), { cls: "small" }) : null,
        ),
      ),
      group(
        "Affichage",
        checkbox("Marges", L.show.margins, (v) => set((x) => (x.show.margins = v))),
        checkbox("Colonnes et rangées", L.show.columns, (v) => set((x) => (x.show.columns = v))),
        checkbox("Repères", L.show.guides, (v) => set((x) => (x.show.guides = v))),
        checkbox("Cadres des objets", L.show.frames, (v) => set((x) => (x.show.frames = v))),
        checkbox("Magnétisme (aimanter les objets)", L.snap, (v) => set((x) => (x.snap = v))),
        h("p", { class: "muted" }, "Ces repères ne sont jamais imprimés."),
      ),
    );
  }

  render();
  store.on((reason, origin) => {
    if (reason === "doc" && origin !== ORIGIN) render();
  });
}
