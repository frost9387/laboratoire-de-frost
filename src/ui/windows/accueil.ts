// Écran d'accueil : deux questions simples pour bien démarrer, sans jargon.
import { h } from "../dom.ts";
import { button, checkbox } from "../widgets.ts";
import { TEMPLATES } from "../../app/templates.ts";
import { DESTINATIONS, DESTINATION_BY_ID } from "../../app/destinations.ts";
import { newDocument } from "../../app/actions.ts";
import { readAutosave, type AutosaveEntry } from "../../app/autosave.ts";
import { loadProjectJson } from "../../app/project.ts";
import { toast } from "../toast.ts";
import type { Win } from "../wm.ts";

const SHOW_KEY = "frost.accueil";

export function accueilAuDemarrage(): boolean {
  try {
    return localStorage.getItem(SHOW_KEY) !== "0";
  } catch {
    return true;
  }
}

export function mountAccueil(win: Win, actions: { openProject: () => void; openGuide: () => void }) {
  let tpl = TEMPLATES[0].id;
  let dest = TEMPLATES[0].destination;
  let auto: AutosaveEntry | null = null;

  function ago(t: number) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "à l'instant";
    if (m < 60) return `il y a ${m} min`;
    const hh = Math.round(m / 60);
    return hh < 48 ? `il y a ${hh} h` : `il y a ${Math.round(hh / 24)} jours`;
  }

  function render() {
    const cards = h("div", { class: "cards", role: "radiogroup", "aria-label": "Modèle" },
      ...TEMPLATES.map((t) => {
        const c = h("button", { class: "card" + (t.id === tpl ? " sel" : ""), type: "button", role: "radio", "aria-checked": String(t.id === tpl) },
          h("span", { class: "card-icon", "aria-hidden": "true" }, t.icon),
          h("span", { class: "card-title" }, t.label),
          h("span", { class: "card-hint" }, t.hint),
        );
        c.addEventListener("click", () => { tpl = t.id; dest = t.destination; render(); });
        c.addEventListener("dblclick", create);
        return c;
      }),
    );
    const dests = h("div", { class: "dests", role: "radiogroup", "aria-label": "Destination d'impression" },
      ...DESTINATIONS.map((d) => {
        const r = h("button", { class: "dest" + (d.id === dest ? " sel" : ""), type: "button", role: "radio", "aria-checked": String(d.id === dest), title: d.delivers },
          h("span", { class: "card-icon small", "aria-hidden": "true" }, d.icon),
          h("span", null, h("b", null, d.label), h("br"), h("span", { class: "card-hint" }, d.hint)),
        );
        r.addEventListener("click", () => { dest = d.id; render(); });
        return r;
      }),
    );
    let show = accueilAuDemarrage();
    win.body.replaceChildren(
      h("div", { class: "welcome" },
        h("div", { class: "welcome-head" },
          h("div", { class: "big" }, "❄ Le laboratoire de Frost"),
          h("p", null, "Des textures et des mises en page prêtes à imprimer. Réponds à deux questions, le logiciel s'occupe de la technique."),
        ),
        h("h3", { class: "pix" }, "1. Que veux-tu créer ?"),
        cards,
        h("h3", { class: "pix" }, "2. Où vas-tu l'imprimer ?"),
        dests,
        h("p", { class: "note ok" }, "Tu obtiendras : " + DESTINATION_BY_ID[dest].delivers),
        h("div", { class: "btns end" },
          auto ? button(`Reprendre « ${auto.name} » (${ago(auto.time)})`, async () => {
            try {
              await loadProjectJson(auto!.json);
              win.close();
            } catch (e) {
              toast("Reprise impossible", e instanceof Error ? e.message : String(e), "err");
            }
          }, { cls: "small" }) : null,
          button("Ouvrir un projet…", () => { win.close(); actions.openProject(); }, { cls: "small" }),
          button("✦ Créer", create, { cls: "default frost" }),
        ),
        h("div", { class: "btns" },
          checkbox("Afficher cet écran au démarrage", show, (v) => {
            show = v;
            try { localStorage.setItem(SHOW_KEY, v ? "1" : "0"); } catch { /* rien */ }
          }),
          button("Guide pas à pas", () => actions.openGuide(), { cls: "small" }),
        ),
      ),
    );
  }

  function create() {
    const t = TEMPLATES.find((x) => x.id === tpl)!;
    newDocument(t.make(), dest, t.finish?.bind(t));
    win.close();
    toast("C'est parti !", `${t.label} — réglé pour : ${DESTINATION_BY_ID[dest].label}. Tout reste modifiable.`, "ok", 7000);
  }

  win.onShow = async () => {
    auto = await readAutosave();
    render();
  };
  render();
}
