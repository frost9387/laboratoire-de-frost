// Fenêtre « Pile d'effets » : effets imprimables de la couche active, appliqués de haut en bas.
import { h } from "../dom.ts";
import { button, note } from "../widgets.ts";
import { store } from "../../app/store.ts";
import { EFFECTS, EFFECT_BY_TYPE } from "../../engine/effects.ts";
import { addEffect, mosh } from "../../app/actions.ts";
import { paramControls } from "./couches.ts";
import { uid } from "../../engine/util.ts";
import type { EffectInst } from "../../engine/types.ts";
import { kbd } from "../platform.ts";
import type { Win } from "../wm.ts";

export function mountPile(win: Win) {
  const ORIGIN = "pile";
  const open = new Set<string>();

  const updFx = (id: string, fn: (fx: EffectInst, list: EffectInst[]) => void, live = false) =>
    store.update((d) => {
      const l = d.layers.find((x) => x.id === d.activeLayerId);
      const fx = l?.effects.find((e) => e.id === id);
      if (l && fx) fn(fx, l.effects);
    }, { live, origin: live ? ORIGIN : undefined });

  function card(fx: EffectInst, i: number, n: number): HTMLElement {
    const def = EFFECT_BY_TYPE[fx.type];
    const isOpen = open.has(fx.id) || store.selectedEffectId === fx.id;
    const on = h("input", { type: "checkbox", checked: fx.on, title: "Activer / désactiver", "aria-label": "Activer " + (def?.label ?? fx.type) });
    on.addEventListener("change", () => updFx(fx.id, (f) => (f.on = on.checked)));
    const tw = h("button", { class: "tw", type: "button", "aria-expanded": String(isOpen), title: "Afficher les réglages" }, isOpen ? "▼" : "▶");
    tw.addEventListener("click", () => {
      if (open.has(fx.id) || store.selectedEffectId === fx.id) {
        open.delete(fx.id);
        if (store.selectedEffectId === fx.id) store.selectedEffectId = null;
      } else open.add(fx.id);
      render();
    });
    const head = h(
      "div",
      { class: "fx-head" },
      tw,
      on,
      h("span", { class: "fx-name", title: def?.group ?? "" }, def?.label ?? fx.type),
      button(fx.locked ? "🔒" : "🔓", () => updFx(fx.id, (f) => (f.locked = !f.locked)), { cls: "small icon lock" + (fx.locked ? " on" : ""), title: "Verrouiller : le bouton MOSH ne touchera pas cet effet" }),
      button("▲", () => updFx(fx.id, (_f, list) => { const k = list.findIndex((e) => e.id === fx.id); if (k > 0) [list[k - 1], list[k]] = [list[k], list[k - 1]]; }), { cls: "small icon", title: "Monter (appliqué plus tôt)", disabled: i === 0 }),
      button("▼", () => updFx(fx.id, (_f, list) => { const k = list.findIndex((e) => e.id === fx.id); if (k < list.length - 1) [list[k + 1], list[k]] = [list[k], list[k + 1]]; }), { cls: "small icon", title: "Descendre (appliqué plus tard)", disabled: i === n - 1 }),
      button("⧉", () => updFx(fx.id, (f, list) => { const k = list.findIndex((e) => e.id === fx.id); list.splice(k + 1, 0, { ...JSON.parse(JSON.stringify(f)), id: uid("fx"), locked: false }); }), { cls: "small icon", title: "Dupliquer" }),
      button("✕", () => updFx(fx.id, (_f, list) => { const k = list.findIndex((e) => e.id === fx.id); list.splice(k, 1); }), { cls: "small icon", title: "Supprimer" }),
    );
    const body = isOpen && def
      ? h("div", { class: "fx-body" }, ...(def.params.length ? paramControls(def.params, fx.params, (k, v, live) => updFx(fx.id, (f) => (f.params[k] = v), live)) : [h("p", { class: "muted" }, "Pas de réglage.")]))
      : null;
    return h("div", { class: "fx" + (fx.on ? "" : " off") + (isOpen ? " open" : "") }, head, body);
  }

  function render() {
    const l = store.layer;
    const addSel = h("select", { class: "pop", "aria-label": "Effet à ajouter" });
    for (const g of ["Tons", "Matière", "Géométrie", "Déformation", "Glitch"] as const) {
      const og = h("optgroup", { label: g });
      for (const e of EFFECTS.filter((x) => x.group === g)) og.append(h("option", { value: e.type }, e.label));
      addSel.append(og);
    }
    const mb = h("button", { class: "mosh", type: "button", title: `Tire 2 à 4 effets au hasard (${kbd("Ctrl+M")}). Les effets verrouillés 🔒 restent.` }, "✦ MOSH ! ✦");
    mb.addEventListener("click", mosh);
    win.setTitle(`Pile d'effets — ${l.name}`);
    undoBtn = button("Annuler", () => store.undo(), { cls: "small", disabled: !store.canUndo, title: kbd("Ctrl+Z") });
    redoBtn = button("Rétablir", () => store.redo(), { cls: "small", disabled: !store.canRedo, title: kbd("Ctrl+Maj+Z") });
    win.body.replaceChildren(
      mb,
      h("div", { class: "btns" },
        undoBtn,
        redoBtn,
        h("span", { class: "muted" }, `${l.effects.filter((e) => e.on).length} actif(s) / ${l.effects.length}`),
      ),
      ...(l.effects.length
        ? l.effects.map((fx, i) => card(fx, i, l.effects.length))
        : [note("Aucun effet sur cette couche. Ajoutez-en un ou appuyez sur MOSH !")]),
      h("div", { class: "btns" }, addSel, button("+ Ajouter l'effet", () => addEffect(addSel.value), { cls: "small default" })),
      h("p", { class: "muted" }, "Seuls des effets imprimables sont proposés. Leurs réglages sont en mm : l'aperçu et l'export donnent le même dessin."),
    );
  }

  let undoBtn: HTMLButtonElement | null = null;
  let redoBtn: HTMLButtonElement | null = null;
  render();
  store.on((reason, origin) => {
    if (reason === "doc" && origin !== ORIGIN) render();
    if (reason === "status" && undoBtn && redoBtn) {
      undoBtn.disabled = !store.canUndo;
      redoBtn.disabled = !store.canRedo;
    }
  });
}
