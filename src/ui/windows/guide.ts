// Guide pas à pas : chaque étape ouvre et fait clignoter la bonne fenêtre.
import { h } from "../dom.ts";
import { button } from "../widgets.ts";
import { kbd } from "../platform.ts";
import type { Win } from "../wm.ts";

export interface GuideStep {
  title: string;
  text: string;
  show: () => void;
}

export function flash(w: Win) {
  w.open();
  w.el.classList.remove("flash");
  void w.el.offsetWidth;
  w.el.classList.add("flash");
  setTimeout(() => w.el.classList.remove("flash"), 1800);
}

export function mountGuide(win: Win, steps: () => GuideStep[]) {
  let done = new Set<number>();
  function render() {
    const list = steps();
    win.body.replaceChildren(
      h("p", null, "Six étapes pour passer d'une idée à un fichier prêt pour l'imprimeur. Clique « Montre-moi » : la bonne fenêtre clignote."),
      h("ol", { class: "steps" },
        ...list.map((s, i) =>
          h("li", { class: done.has(i) ? "done" : "" },
            h("div", null, h("b", null, s.title), h("br"), h("span", { class: "muted" }, s.text)),
            button("Montre-moi", () => { done.add(i); s.show(); render(); }, { cls: "small" }),
          ),
        ),
      ),
      h("p", { class: "muted" }, `Raccourcis utiles : ${kbd("Ctrl+")}+ / ${kbd("Ctrl+")}− pour zoomer, ${kbd("Ctrl+")}0 pour tout voir, ${kbd("Ctrl+Z")} pour annuler.`),
      h("div", { class: "btns end" }, button("Recommencer", () => { done = new Set(); render(); }, { cls: "small" })),
    );
  }
  win.onShow = render;
  render();
}
