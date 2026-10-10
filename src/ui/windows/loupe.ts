// Fenêtre « Loupe » : la vraie trame à la résolution de sortie (contrôle des points avant export).
import { h } from "../dom.ts";
import { select, note } from "../widgets.ts";
import { store } from "../../app/store.ts";
import { client } from "../../app/client.ts";
import { docBox, plateDescs } from "../../engine/doc.ts";
import type { PlancheApi } from "./planche.ts";
import type { Win } from "../wm.ts";

export function mountLoupe(win: Win, planche: PlancheApi) {
  let sizePx = 320;
  let plate = "composite";
  const canvas = h("canvas", { class: "loupe-canvas", width: sizePx, height: sizePx, "aria-label": "Loupe à la résolution de sortie" });
  const info = h("div", { class: "kv" });
  const controls = h("div");
  const hint = note("Cliquez sur la Planche pour placer la loupe. Chaque pixel affiché = un point de la machine d'impression.");
  win.body.append(controls, canvas, info, hint);

  const center = () => {
    if (!planche.loupeAt) {
      const box = docBox(store.doc);
      planche.loupeAt = { xMm: box.wMm / 2, yMm: box.hMm / 2 };
    }
    return planche.loupeAt;
  };

  function renderControls() {
    const plates = plateDescs(store.doc);
    controls.replaceChildren(
      select("Voir", plate, [["composite", "Composite"], ...plates.map((p) => [p.key, "Plaque " + p.name] as [string, string])], (v) => { plate = v; update(); }),
      select("Zone", String(sizePx), [["160", "160 px de sortie"], ["320", "320 px de sortie"], ["640", "640 px de sortie"]], (v) => { sizePx = Number(v); update(); }),
    );
  }

  let timer = 0;
  const update = () => {
    clearTimeout(timer);
    timer = window.setTimeout(run, 60);
  };

  async function run() {
    if (!win.visible) return;
    const c = center();
    const s = store.doc.settings;
    const mm = (sizePx / s.dpi) * 25.4;
    planche.setLoupeMode(true, mm);
    info.replaceChildren(
      h("dt", null, "Zone"), h("dd", null, `${mm.toFixed(2).replace(".", ",")} × ${mm.toFixed(2).replace(".", ",")} mm`),
      h("dt", null, "Résolution"), h("dd", null, `${s.dpi} dpi (1 pixel = ${(25400 / s.dpi).toFixed(1).replace(".", ",")} µm)`),
      h("dt", null, "État"), h("dd", null, "⌛ calcul…"),
    );
    try {
      const res = await client.loupe(store.doc, { cxMm: c.xMm, cyMm: c.yMm, size: sizePx, plate });
      if (!res) return;
      canvas.width = res.w;
      canvas.height = res.h;
      canvas.getContext("2d")!.putImageData(new ImageData(res.rgba as Uint8ClampedArray<ArrayBuffer>, res.w, res.h), 0, 0);
      (info.lastChild as HTMLElement).textContent = "à jour";
    } catch (e) {
      (info.lastChild as HTMLElement).textContent = "erreur : " + (e instanceof Error ? e.message : String(e));
    }
  }

  planche.onLoupePick = () => update();
  win.onShow = () => { renderControls(); planche.setLoupeMode(true); update(); };
  win.onClose = () => planche.setLoupeMode(false);
  store.on((reason) => {
    if (reason === "doc" || reason === "profiles" || reason === "assets") {
      if (win.visible) { renderControls(); update(); }
    }
  });
  renderControls();
  if (win.visible) win.onShow();
}
