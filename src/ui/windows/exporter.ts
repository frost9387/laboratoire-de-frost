// Dialogue « Exporter » : JPG, PNG, SVG, TIFF — avec ce que chaque format sait vraiment porter.
import { h } from "../dom.ts";
import { select, checkbox, slider, group, note, button, progressBar } from "../widgets.ts";
import { store } from "../../app/store.ts";
import { client } from "../../app/client.ts";
import { saveBytes } from "../../app/desktop.ts";
import { estimate, formatCapabilities, type ExportContent, type ExportFormat, type ExportOptions } from "../../export/exporter.ts";
import { plateDescs } from "../../engine/doc.ts";
import { toast } from "../toast.ts";
import type { Win } from "../wm.ts";

const KEY = "frost.export.v1";

export function mountExport(win: Win) {
  let o: ExportOptions = {
    format: "tiff", content: "plaques", dpi: 1200, bleed: true, marks: false, jpgQuality: 92, tiffCompression: "lzw", embedIcc: true,
  };
  try {
    o = { ...o, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    /* préférences illisibles : défauts */
  }
  let running = false;
  const pb = progressBar();

  function fix() {
    const caps = formatCapabilities(o.format, store.doc.settings.mode);
    if (o.content === "cmjn" && !caps.cmjn) o.content = "plaques";
  }

  function render() {
    fix();
    const s = store.doc.settings;
    const caps = formatCapabilities(o.format, s.mode);
    const est = estimate(store.doc, o);
    const plates = plateDescs(store.doc);
    const fmtBtns = (["jpg", "png", "svg", "tiff"] as ExportFormat[]).map((f) =>
      button(f.toUpperCase(), () => { o.format = f; if (f === "jpg" && o.dpi > 600) o.dpi = 300; render(); }, { cls: o.format === f ? "on" : "" }),
    );
    const contents: [string, string][] = [["composite", "Épreuve composite (RVB)"], ["plaques", `Plaques séparées (${plates.length} fichier${plates.length > 1 ? "s" : ""})`]];
    if (caps.cmjn) contents.push(["cmjn", "Fichier CMJN unique (4 couches)"]);
    const px = est.w * est.h;
    const warns: HTMLElement[] = [];
    if (o.format === "jpg" && o.content === "plaques") warns.push(note("JPG compresse avec perte : les points de trame bavent. Préférez TIFF ou PNG pour des plaques.", "warn"));
    if (o.format === "jpg" && (est.w > 16384 || est.h > 16384)) warns.push(note("Trop grand pour du JPG : baissez la résolution ou choisissez TIFF/PNG.", "err"));
    if (o.content === "composite" && o.dpi > 600 && o.format !== "svg") warns.push(note("Une épreuve RVB n'a pas besoin de plus de 300–600 dpi : fichier inutilement lourd.", "warn"));
    if (s.profileId === "cmjn-generique" && (o.content === "cmjn" || s.mode === "cmjn")) warns.push(note("Profil CMJN générique : choisissez un vrai profil ICC dans la fenêtre Document avant d'envoyer chez l'imprimeur.", "warn"));
    if (px > 400e6) warns.push(note(`Très grand fichier (${Math.round(px / 1e6)} Mpx) : l'export peut prendre plusieurs minutes.`, "warn"));

    const go = button("Exporter", () => run(), { cls: "default", disabled: running });
    const parts: (HTMLElement | null)[] = [
      group("Format", h("div", { class: "btns" }, ...fmtBtns), h("p", { class: "muted" }, caps.note)),
      group(
        "Contenu",
        select("Fichier", o.content, contents, (v) => { o.content = v as ExportContent; render(); }),
        select("Résolution", String(o.dpi), [["150", "150 dpi"], ["300", "300 dpi"], ["600", "600 dpi"], ["1200", "1200 dpi"], ["2400", "2400 dpi"], ["2540", "2540 dpi"]], (v) => { o.dpi = Number(v); render(); }),
        checkbox(`Inclure le fond perdu (${s.bleedMm} mm)`, o.bleed, (v) => { o.bleed = v; render(); }),
        checkbox("Traits de coupe (marge technique 10 mm)", o.marks, (v) => { o.marks = v; render(); }),
        o.format === "jpg" ? slider({ label: "Qualité JPG", value: o.jpgQuality, min: 40, max: 100, step: 1, unit: "%", onInput: (v) => (o.jpgQuality = v) }) : null,
        o.format === "tiff" ? select("Compression", o.tiffCompression, [["lzw", "LZW (sans perte)"], ["packbits", "PackBits (1 bit)"], ["none", "Aucune"]], (v) => { o.tiffCompression = v as ExportOptions["tiffCompression"]; }) : null,
        o.format !== "svg" ? checkbox("Intégrer le profil ICC", o.embedIcc, (v) => (o.embedIcc = v)) : null,
      ),
      h("dl", { class: "kv" },
        h("dt", null, "Taille"), h("dd", null, `${est.wMm.toFixed(1).replace(".", ",")} × ${est.hMm.toFixed(1).replace(".", ",")} mm`),
        h("dt", null, "Pixels"), h("dd", null, o.format === "svg" ? "vectoriel" : `${est.w.toLocaleString("fr-FR")} × ${est.h.toLocaleString("fr-FR")} px`),
        h("dt", null, "Plaques"), h("dd", null, plates.map((p) => p.name).join(", ")),
      ),
      ...warns,
      running ? pb.el : null,
      h("div", { class: "btns end" }, button("Annuler", () => win.close(), { disabled: running }), go),
    ];
    win.body.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
  }

  async function run() {
    running = true;
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* rien */ }
    pb.set(0, "Préparation…");
    render();
    document.body.classList.add("busy");
    try {
      store.commit();
      const res = await client.export(store.doc, { ...o }, (f, label) => pb.set(f, label));
      pb.set(1, "Enregistrement…");
      const saved = await saveBytes(res.file.name, res.file.data, res.file.mime);
      const mb = (res.file.data.length / 1048576).toFixed(1).replace(".", ",");
      if (saved) toast("Export terminé", `${saved.split(/[\\/]/).pop()} (${mb} Mo)` + (res.warnings.length ? " — " + res.warnings.join(" ") : ""), "ok", 9000);
      win.close();
    } catch (e) {
      toast("Export impossible", e instanceof Error ? e.message : String(e), "err", 10000);
    } finally {
      running = false;
      document.body.classList.remove("busy");
      render();
    }
  }

  win.onShow = () => {
    // les préférences peuvent avoir été réglées par une destination d'impression
    let saved: Partial<ExportOptions> | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    } catch {
      saved = null;
    }
    if (saved) o = { ...o, ...saved };
    else o.dpi = store.doc.settings.dpi;
    render();
  };
  render();
}
