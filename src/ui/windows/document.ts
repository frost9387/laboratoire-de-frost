// Fenêtre « Document » : format physique, résolutions, mode couleur et profils ICC.
import { h } from "../dom.ts";
import { slider, select, checkbox, group, note, button, colorInput, expert } from "../widgets.ts";
import { DESTINATIONS, DESTINATION_BY_ID, applyDestination } from "../../app/destinations.ts";
import { store } from "../../app/store.ts";
import { FORMATS, docBox, pxSize } from "../../engine/doc.ts";
import { GENERIC_CMYK_ID } from "../../engine/color.ts";
import { importProfile } from "../../app/profiles.ts";
import { pickFile } from "../../app/desktop.ts";
import { toast } from "../toast.ts";
import type { ColorMode, Intent } from "../../engine/types.ts";
import type { Win } from "../wm.ts";

const PAPERS: [string, string][] = [
  ["#ffffff", "Blanc"],
  ["#fbf6e9", "Ivoire"],
  ["#f2efe6", "Recyclé"],
  ["#d9bf94", "Kraft"],
  ["#e9e4d6", "Journal"],
];

export function mountDocument(win: Win) {
  const ORIGIN = "document";
  const set = (fn: (s: typeof store.doc.settings) => void, live = false) =>
    store.update((d) => fn(d.settings), { live, origin: live ? ORIGIN : undefined });

  function render() {
    const s = store.doc.settings;
    const box = docBox(store.doc);
    const cmyk = store.profiles.filter((p) => p.space === "CMYK");
    const rgb = store.profiles.filter((p) => p.space === "RGB");
    const nameIn = h("input", { type: "text", class: "field", value: s.name, "aria-label": "Nom du document" });
    nameIn.addEventListener("change", () => set((x) => (x.name = nameIn.value.trim() || "Sans titre")));

    const isPerso = s.formatId === "PERSO";
    const orient = s.widthMm > s.heightMm ? "paysage" : "portrait";
    const W = pxSize(box.wMm, s.dpi);
    const H = pxSize(box.hMm, s.dpi);
    const levels = (() => {
      const k = store.doc.cmykScreens.K;
      return k.type === "am" ? Math.round((s.dpi / k.lpi) ** 2 + 1) : null;
    })();

    const dest = store.doc.destination ? DESTINATION_BY_ID[store.doc.destination] : undefined;
    win.body.replaceChildren(
      group(
        "Où vas-tu imprimer ?",
        select("Destination", store.doc.destination ?? "", [["", "— choisir —"], ...DESTINATIONS.map((d) => [d.id, d.icon + " " + d.label] as [string, string])], (v) => {
          if (!v) return;
          store.update((d) => applyDestination(d, v, store.profiles));
          toast("Réglé pour : " + DESTINATION_BY_ID[v].label, DESTINATION_BY_ID[v].delivers, "ok", 8000);
        }, "Règle d'un coup le mode couleur, le profil, l'encrage, la résolution, la trame et l'export."),
        dest ? h("p", { class: "muted" }, dest.hint + " → " + dest.delivers) : note("Choisis une destination : le logiciel règle toute la technique pour toi."),
      ),
      group(
        "Document",
        h("div", { class: "row" }, h("label", null, "Nom"), nameIn),
        select("Format", s.formatId, FORMATS.map((f) => [f.id, f.label]), (v) =>
          set((x) => {
            const f = FORMATS.find((q) => q.id === v)!;
            x.formatId = v;
            if (v !== "PERSO") {
              const land = x.widthMm > x.heightMm;
              x.widthMm = land ? f.h : f.w;
              x.heightMm = land ? f.w : f.h;
              if (f.w === f.h) { x.widthMm = f.w; x.heightMm = f.h; }
            }
          }),
        ),
        select("Orientation", orient, [["portrait", "Portrait"], ["paysage", "Paysage"]], (v) =>
          set((x) => {
            const a = Math.min(x.widthMm, x.heightMm);
            const b = Math.max(x.widthMm, x.heightMm);
            x.widthMm = v === "paysage" ? b : a;
            x.heightMm = v === "paysage" ? a : b;
          }),
        ),
        isPerso && slider({ label: "Largeur", value: s.widthMm, min: 10, max: 1500, step: 0.5, unit: "mm", onInput: (v) => set((x) => (x.widthMm = v), true) }),
        isPerso && slider({ label: "Hauteur", value: s.heightMm, min: 10, max: 1500, step: 0.5, unit: "mm", onInput: (v) => set((x) => (x.heightMm = v), true) }),
        slider({ label: "Fond perdu", value: s.bleedMm, min: 0, max: 15, step: 0.5, def: 3, unit: "mm", hint: "3 mm pour l'offset et le numérique. 5 mm et plus pour certains supports.", onInput: (v) => set((x) => (x.bleedMm = v), true) }),
      ),
      expert(group(
        "Résolution",
        select("Sortie (trame)", String(s.dpi), [["150", "150 dpi (écran)"], ["300", "300 dpi"], ["600", "600 dpi"], ["1200", "1200 dpi (conseillé)"], ["2400", "2400 dpi (flashage)"], ["2540", "2540 dpi"]], (v) => set((x) => (x.dpi = Number(v))), "Résolution des fichiers tramés (1 bit). Une trame AM a besoin de beaucoup de dpi."),
        select("Ton continu", String(s.contonePpi), [["150", "150 ppi (rapide)"], ["200", "200 ppi"], ["300", "300 ppi (standard)"], ["400", "400 ppi (fin)"], ["600", "600 ppi (texte très fin)"]], (v) => set((x) => (x.contonePpi = Number(v))), "Résolution de calcul des textures et effets avant tramage, comme un RIP. Le texte et les formes restent nets à la résolution de sortie."),
        h("div", { class: "readout" }, `${W.toLocaleString("fr-FR")} × ${H.toLocaleString("fr-FR")} px à la sortie`),
        levels !== null && levels < 33 ? note(`Trame noire : seulement ${levels} niveaux de gris à ${s.dpi} dpi. Montez la résolution ou baissez la linéature.`, "warn") : null,
      )),
      group(
        "Couleur",
        select("Mode", s.mode, [["cmjn", "CMJN (quadrichromie)"], ["directs", "Tons directs (riso, sérigraphie)"], ["gris", "Niveaux de gris"], ["bitmap", "Bitmap 1 bit"]], (v) => set((x) => (x.mode = v as ColorMode))),
        select(
          "Profil CMJN",
          s.profileId,
          cmyk.map((p) => [p.id, (p.id === GENERIC_CMYK_ID ? "⚠ " : "") + p.name + (p.origin === "importé" ? " (importé)" : "")]),
          (v) => set((x) => (x.profileId = v)),
          "Profil de sortie : sert à séparer les images, à l'épreuve écran et est intégré aux TIFF/JPG CMJN.",
        ),
        expert(select("Profil RVB", s.rgbProfileId, rgb.map((p) => [p.id, p.name]), (v) => set((x) => (x.rgbProfileId = v)), "Espace des exports RVB (épreuves PNG, JPG, TIFF RVB).")),
        expert(select("Intention", s.intent, [["relatif", "Colorimétrie relative"], ["perceptuel", "Perceptive"], ["saturation", "Saturation"], ["absolu", "Colorimétrie absolue"]], (v) => set((x) => (x.intent = v as Intent)))),
        expert(checkbox("Compensation du point noir", s.bpc, (v) => set((x) => (x.bpc = v)))),
        expert(slider({ label: "Encrage max", value: s.tacMax, min: 160, max: 400, step: 5, def: 300, unit: "%", hint: "Couché : 300–330 %. Non couché : 260–280 %. Journal : 220–240 %.", onInput: (v) => set((x) => (x.tacMax = v), true) })),
        h("div", { class: "btns" },
          button("Importer un profil ICC…", async () => {
            const f = await pickFile(".icc,.icm");
            if (!f) return;
            const info = await importProfile(f);
            if (!info) return toast("Profil refusé", "Ce fichier n'est pas un profil ICC lisible (CMJN, RVB ou gris).", "err");
            if (info.space === "CMYK") set((x) => (x.profileId = info.id));
            if (info.space === "RGB") set((x) => (x.rgbProfileId = info.id));
            toast("Profil importé", info.name, "ok");
          }, { cls: "small" }),
        ),
        store.profilesLoading ? note("Recherche des profils ICC installés sur cet ordinateur…") : null,
        s.profileId === GENERIC_CMYK_ID
          ? note("Profil CMJN générique : approximation sans ICC. Choisissez un vrai profil (FOGRA, GRACoL…) ou importez celui de votre imprimeur.", "warn")
          : null,
      ),
      group(
        "Papier (épreuve écran)",
        colorInput("Teinte", s.paperHex, (hex) => set((x) => (x.paperHex = hex), true)),
        h("div", { class: "btns" }, ...PAPERS.map(([hex, label]) => button(label, () => set((x) => (x.paperHex = hex)), { cls: "small" + (s.paperHex === hex ? " on" : "") }))),
      ),
    );
  }

  render();
  store.on((reason, origin) => {
    if ((reason === "doc" && origin !== ORIGIN) || reason === "profiles") render();
  });
}
