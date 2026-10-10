// Fenêtre « Trame » : comment chaque plaque est transformée en points imprimables.
import { h } from "../dom.ts";
import { slider, select, checkbox, group, note, button, expert } from "../widgets.ts";
import { store } from "../../app/store.ts";
import { plateDescs } from "../../engine/doc.ts";
import { AM_SHAPES, KERNELS, SCREEN_PRESETS, SCREEN_TYPES, CMYK_ANGLES } from "../../engine/screens.ts";
import { RD_PRESETS } from "../../engine/rd.ts";
import type { Doc, PlateKey, ScreenSpec, ScreenType } from "../../engine/types.ts";
import type { Win } from "../wm.ts";

/** Trame d'une plaque. En tons directs, elle est rangée par encre (créée à la première modification). */
function screenOf(d: Doc, key: string, create = false): ScreenSpec | undefined {
  if (d.settings.mode === "cmjn" || d.settings.mode === "gris" || d.settings.mode === "bitmap")
    return d.cmykScreens[key as PlateKey];
  const own = d.spotScreens[key];
  if (own) return own;
  const desc = plateDescs(d).find((p) => p.key === key);
  if (!desc) return undefined;
  if (!create) return desc.screen;
  d.spotScreens[key] = JSON.parse(JSON.stringify(desc.screen));
  return d.spotScreens[key];
}

export function mountTrame(win: Win) {
  const ORIGIN = "trame";
  let plate = "";

  const upd = (fn: (s: ScreenSpec) => void, live = false) =>
    store.update((d) => {
      const s = screenOf(d, plate, true);
      if (s) fn(s);
    }, { live, origin: live ? ORIGIN : undefined });

  function render() {
    const d = store.doc;
    const plates = plateDescs(d);
    if (!plates.some((p) => p.key === plate)) plate = plates[0]?.key ?? "";
    const spec = screenOf(d, plate);
    if (!spec) {
      win.body.replaceChildren(note("Aucune plaque visible."));
      return;
    }
    const dpi = d.settings.dpi;
    const tabs = h(
      "div",
      { class: "plates", role: "tablist" },
      ...plates.map((p) => {
        const t = h("button", { class: "plate-tab" + (p.key === plate ? " sel" : ""), type: "button", role: "tab", "aria-selected": String(p.key === plate) }, h("span", { class: "sw", style: `background:${p.hex}` }), p.name);
        t.addEventListener("click", () => { plate = p.key; render(); });
        return t;
      }),
    );
    const live = (fn: (s: ScreenSpec, v: number) => void) => (v: number) => upd((s) => fn(s, v), true);
    const commit = () => store.commit();
    const params: (HTMLElement | null)[] = [];
    const angleSlider = slider({ label: "Angle", value: spec.angle, min: -90, max: 180, step: 0.5, unit: "°", onInput: live((s, v) => (s.angle = v)), onCommit: commit });
    switch (spec.type) {
      case "am":
        params.push(
          slider({ label: "Linéature", value: spec.lpi, min: 5, max: 300, step: 1, unit: "lpi", hint: "Lignes de points par pouce. Journal 85, offset 150, sérigraphie 35–65.", onInput: live((s, v) => (s.lpi = v)), onCommit: commit }),
          angleSlider,
          select("Forme du point", spec.shape, AM_SHAPES, (v) => upd((s) => (s.shape = v))),
        );
        break;
      case "stochastique":
        params.push(
          slider({ label: "Linéature équiv.", value: spec.lpi, min: 4, max: 150, step: 1, unit: "lpi", hint: "Finesse du motif organique, comme une linéature.", onInput: live((s, v) => (s.lpi = v)), onCommit: commit }),
          select("Motif", spec.rdPreset, Object.entries(RD_PRESETS).map(([k, v]) => [k, v.label]), (v) => upd((s) => (s.rdPreset = v))),
          slider({ label: "Échelle du motif", value: spec.rdScale, min: 0.25, max: 4, step: 0.05, unit: "×", def: 1, onInput: live((s, v) => (s.rdScale = v)), onCommit: commit }),
          angleSlider,
        );
        break;
      case "fm":
        params.push(slider({ label: "Grain", value: spec.grainUm, min: 10, max: 500, step: 1, unit: "µm", hint: "Taille d'un point. Riso : 40–85 µm. Offset FM : 20–35 µm.", onInput: live((s, v) => (s.grainUm = v)), onCommit: commit }));
        break;
      case "bayer":
        params.push(
          slider({ label: "Grain", value: spec.grainUm, min: 10, max: 2000, step: 1, unit: "µm", onInput: live((s, v) => (s.grainUm = v)), onCommit: commit }),
          slider({ label: "Matrice", value: spec.bayerLevel, min: 1, max: 5, step: 1, unit: "", hint: "1 = 2×2 … 5 = 32×32", onInput: live((s, v) => (s.bayerLevel = v)), onCommit: commit }),
        );
        break;
      case "diffusion":
        params.push(
          select("Algorithme", spec.kernel, Object.entries(KERNELS).map(([k, v]) => [k, v.label]), (v) => upd((s) => (s.kernel = v))),
          slider({ label: "Grain", value: spec.grainUm, min: 10, max: 2000, step: 1, unit: "µm", onInput: live((s, v) => (s.grainUm = v)), onCommit: commit }),
          checkbox("Balayage serpentin", spec.serpentine, (v) => upd((s) => (s.serpentine = v)), "Alterne le sens des rangées : moins de traînées."),
        );
        break;
      case "seuil":
        params.push(slider({ label: "Seuil", value: spec.level, min: 1, max: 99, step: 1, unit: "%", onInput: live((s, v) => (s.level = v)), onCommit: commit }));
        break;
    }

    // contrôles d'imprimabilité
    const checks: HTMLElement[] = [];
    if (spec.type === "am") {
      const levels = Math.round((dpi / spec.lpi) ** 2 + 1);
      const cellMm = 25.4 / spec.lpi;
      checks.push(h("div", { class: "readout" }, `Cellule ${cellMm.toFixed(2).replace(".", ",")} mm · ${levels} niveaux à ${dpi} dpi`));
      if (levels < 65) checks.push(note(`Peu de niveaux de gris (${levels}) : risque de postérisation. Montez la résolution de sortie ou baissez la linéature.`, "warn"));
    }
    if (spec.type === "fm" || spec.type === "bayer" || spec.type === "diffusion") {
      const px = (spec.grainUm / 25400) * dpi;
      checks.push(h("div", { class: "readout" }, `Grain = ${px.toFixed(1).replace(".", ",")} px à ${dpi} dpi`));
      if (px < 1) checks.push(note("Grain plus petit qu'un pixel de sortie : augmentez le grain ou la résolution.", "warn"));
    }
    if (d.settings.mode === "cmjn") {
      const am = plates.filter((p) => p.screen.type === "am" || p.screen.type === "stochastique");
      for (let i = 0; i < am.length; i++)
        for (let j = i + 1; j < am.length; j++) {
          const da = Math.abs(((am[i].screen.angle - am[j].screen.angle) % 90 + 90) % 90);
          if (am[i].key !== "Y" && am[j].key !== "Y" && (da < 15 || da > 75))
            checks.push(note(`${am[i].name} et ${am[j].name} : angles trop proches (${am[i].screen.angle}° / ${am[j].screen.angle}°) → risque de moiré. Écart conseillé : 30°.`, "warn"));
        }
    }

    const presetSel = h("select", { class: "pop", "aria-label": "Préréglage d'impression" }, h("option", { value: "" }, "Choisir un préréglage…"), ...SCREEN_PRESETS.map((p) => h("option", { value: p.id }, p.label)));
    presetSel.addEventListener("change", () => {
      const p = SCREEN_PRESETS.find((x) => x.id === presetSel.value);
      if (p) upd((s) => Object.assign(s, p.spec));
    });

    win.body.replaceChildren(
      tabs,
      h("div", { class: "btns" }, presetSel),
      h("div", { class: "btns" },
        button("Appliquer à toutes les plaques", () =>
          store.update((dd) => {
            const src = screenOf(dd, plate);
            if (!src) return;
            for (const p of plateDescs(dd)) {
              const s = screenOf(dd, p.key, true);
              if (!s || s === src) continue;
              const angle = s.angle;
              Object.assign(s, JSON.parse(JSON.stringify(src)));
              s.angle = angle;
            }
          }), { cls: "small", title: "Copie ces réglages sur les autres plaques en gardant leurs angles" }),
        d.settings.mode === "cmjn" ? button("Angles standard", () => store.update((dd) => (["C", "M", "Y", "K"] as PlateKey[]).forEach((k) => (dd.cmykScreens[k].angle = CMYK_ANGLES[k]))), { cls: "small", title: "C 15°, M 75°, J 0°, N 45°" }) : null,
      ),
      group("Trame", select("Type", spec.type, SCREEN_TYPES, (v) => upd((s) => (s.type = v as ScreenType))), ...params),
      ...(store.expert ? [] : checks),
      spec.type !== "aucune"
        ? expert(group(
            "Imprimabilité",
            slider({ label: "Engraissement", value: spec.dotGain, min: -10, max: 40, step: 1, def: 0, unit: "%", hint: "Compense l'élargissement des points à 50 %. Couché ~12 %, non couché ~18 %, journal ~22 %.", onInput: live((s, v) => (s.dotGain = v)), onCommit: commit }),
            slider({ label: "Point minimal", value: spec.minDot, min: 0, max: 25, step: 0.5, def: 0, unit: "%", hint: "En dessous, le point ne tient pas sur la plaque ou l'écran : il est supprimé ou arrondi.", onInput: live((s, v) => (s.minDot = v)), onCommit: commit }),
            slider({ label: "Point maximal", value: spec.maxDot, min: 75, max: 100, step: 0.5, def: 100, unit: "%", hint: "Au-dessus, les trous se bouchent : on passe au plein ou on garde le trou.", onInput: live((s, v) => (s.maxDot = v)), onCommit: commit }),
            spec.type === "fm" || spec.type === "bayer" || spec.type === "diffusion"
              ? slider({ label: "Nettoyage", value: spec.clean, min: 0, max: 4, step: 1, def: 0, unit: "", hint: "Supprime les grains isolés et bouche les trous isolés (1 = léger, 4 = fort).", onInput: live((s, v) => (s.clean = v)), onCommit: commit })
              : null,
            ...(store.expert ? checks : []),
          ))
        : group("Ton continu", note("Pas de trame : le fichier garde ses niveaux de gris (le RIP de l'imprimeur tramera). Exports 8 bits.")),
    );
  }

  render();
  store.on((reason, origin) => {
    if ((reason === "doc" && origin !== ORIGIN) || reason === "status") render();
  });
}
