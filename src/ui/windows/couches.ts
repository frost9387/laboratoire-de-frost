// Fenêtre « Calques » : textures pleine page ET objets de mise en page (texte, formes, logos).
// Chaque calque a sa propre encre, sa propre texture et sa propre pile d'effets.
import { h } from "../dom.ts";
import { slider, select, group, button, note, colorInput, checkbox, numField, segmented, expert } from "../widgets.ts";
import { store } from "../../app/store.ts";
import { client } from "../../app/client.ts";
import { newLayer, SPOT_INKS, kindOf, isElement, KIND_ICON, KIND_LABEL } from "../../engine/doc.ts";
import { SOURCE_DEFS, SOURCE_BY_TYPE, defaultSource } from "../../engine/sources.ts";
import { importImageFile, importLogoFile, importFontFile, fontList, listLocalFonts, importLocalFont } from "../../app/project.ts";
import { addElement, addLogo, deleteLayer, duplicateLayer } from "../../app/actions.ts";
import { pickFile } from "../../app/desktop.ts";
import { toast } from "../toast.ts";
import type { ParamDef } from "../../engine/effects.ts";
import type { Layer, Params, ShapeType, SourceType } from "../../engine/types.ts";
import type { Win } from "../wm.ts";

export function paramControls(defs: ParamDef[], params: Params, onChange: (k: string, v: number | string | boolean, live: boolean) => void): HTMLElement[] {
  return defs.map((d) => {
    if (d.kind === "select") return select(d.label, String(params[d.key]), d.options!, (v) => onChange(d.key, v, false), d.hint);
    if (d.kind === "bool") {
      const box = h("input", { type: "checkbox", checked: Boolean(params[d.key]) });
      box.addEventListener("change", () => onChange(d.key, box.checked, false));
      return h("label", { class: "row check", title: d.hint ?? "" }, box, h("span", null, d.label));
    }
    return slider({
      label: d.label, value: Number(params[d.key]), min: d.min!, max: d.max!, step: d.step, unit: d.unit, def: Number(d.def), hint: d.hint,
      onInput: (v) => onChange(d.key, v, true),
      onCommit: () => store.commit(),
    });
  });
}

export function mountCouches(win: Win, openAtelier: () => void, focusText: { fn?: () => void }) {
  const ORIGIN = "couches";
  const swatchCache = new Map<string, string>();
  let localFonts: Awaited<ReturnType<typeof listLocalFonts>> = null;

  const upd = (fn: (l: Layer) => void, live = false) =>
    store.update((d) => {
      const l = d.layers.find((x) => x.id === d.activeLayerId);
      if (l) fn(l);
    }, { live, origin: live ? ORIGIN : undefined });

  async function refreshSwatches() {
    const s = store.doc.settings;
    if (s.mode !== "cmjn") return;
    const recipes = store.doc.layers.map((l) => l.ink.cmyk as number[]);
    try {
      const hex = await client.swatches(s.profileId, s.intent, recipes);
      let changed = false;
      store.doc.layers.forEach((l, i) => {
        const key = s.profileId + "|" + l.ink.cmyk.join(",");
        if (swatchCache.get(key) !== hex[i]) changed = true;
        swatchCache.set(key, hex[i]);
      });
      if (changed) render();
    } catch {
      /* moteur pas prêt : on réessaiera au prochain changement */
    }
  }

  const inkHex = (l: Layer) => {
    const s = store.doc.settings;
    if (s.mode === "cmjn") return swatchCache.get(s.profileId + "|" + l.ink.cmyk.join(",")) ?? "#888888";
    if (s.mode === "directs") return l.ink.hex;
    return "#1d1d1b";
  };

  function list(): HTMLElement {
    const d = store.doc;
    const el = h("div", { class: "list", role: "listbox", "aria-label": "Calques (le plus haut est imprimé par-dessus)" });
    for (const l of [...d.layers].reverse()) {
      const eye = h("input", { type: "checkbox", checked: l.visible, title: "Visible", "aria-label": "Visible" });
      eye.addEventListener("click", (e) => e.stopPropagation());
      eye.addEventListener("change", () => store.update((dd) => { const x = dd.layers.find((y) => y.id === l.id); if (x) x.visible = eye.checked; }));
      const k = kindOf(l);
      const over = store.overflowIds.has(l.id);
      const row = h(
        "div",
        { class: "li clickable" + (l.id === d.activeLayerId ? " sel" : ""), role: "option", "aria-selected": String(l.id === d.activeLayerId), title: KIND_LABEL[k] },
        eye,
        h("span", { class: "kind" }, KIND_ICON[k]),
        h("span", { class: "sw", style: `background:${inkHex(l)}` }),
        h("span", { class: "name" }, l.name),
        over ? h("span", { class: "over", title: "Texte en excès : agrandissez le cadre" }, "+") : null,
        h("span", { class: "tag" }, k === "texture" ? SOURCE_BY_TYPE[l.source.type]?.label.split(" ")[0] ?? "" : l.fill?.mode === "texture" ? "texturé" : ""),
      );
      row.addEventListener("click", () => store.select(l.id));
      row.addEventListener("dblclick", () => { if (k === "texte") focusText.fn?.(); });
      el.append(row);
    }
    return el;
  }

  /** Encre du calque (recette CMJN, ton direct ou noir). */
  function inkGroup(l: Layer): HTMLElement {
    const s = store.doc.settings;
    let ink: HTMLElement[];
    if (s.mode === "cmjn") {
      ink = (["C", "M", "J", "N"] as const).map((lab, k) =>
        slider({ label: ["Cyan", "Magenta", "Jaune", "Noir"][k] + ` (${lab})`, value: l.ink.cmyk[k], min: 0, max: 100, step: 1, unit: "%", onInput: (v) => upd((x) => (x.ink.cmyk[k] = v), true), onCommit: () => { store.commit(); refreshSwatches(); } }),
      );
      const presets: [string, [number, number, number, number]][] = [["Noir", [0, 0, 0, 100]], ["Noir riche", [60, 40, 40, 100]], ["Cyan", [100, 0, 0, 0]], ["Magenta", [0, 100, 0, 0]], ["Jaune", [0, 0, 100, 0]], ["Rouge", [0, 95, 90, 0]], ["Bleu", [100, 60, 0, 10]], ["Blanc (réserve)", [0, 0, 0, 0]]];
      ink.unshift(
        h("div", { class: "row" }, h("label", null, "Couleur obtenue"), h("span", { class: "sw big", style: `background:${inkHex(l)}`, title: "Calculée avec le profil CMJN" })),
        h("div", { class: "btns" }, ...presets.map(([name, c]) => button(name, () => { upd((x) => { x.ink.cmyk = [...c]; x.ink.name = name; }); refreshSwatches(); }, { cls: "small" }))),
      );
    } else if (s.mode === "directs") {
      const used = [...new Map(store.doc.layers.map((x) => [x.ink.name + x.ink.hex, x.ink])).values()];
      ink = [
        select("Encre", SPOT_INKS.some((i) => i.name === l.ink.name) ? l.ink.name : "__perso", [...SPOT_INKS.map((i) => [i.name, i.name] as [string, string]), ["__perso", "Personnalisée"]], (v) => {
          const sp = SPOT_INKS.find((i) => i.name === v);
          if (sp) upd((x) => { x.ink.name = sp.name; x.ink.hex = sp.hex; });
        }, "Même encre = même plaque d'impression."),
        colorInput("Couleur d'affichage", l.ink.hex, (hex) => upd((x) => { x.ink.hex = hex; if (!SPOT_INKS.some((i) => i.hex === hex)) x.ink.name = "Encre " + hex.toUpperCase(); }, true)),
        used.length > 1
          ? h("div", { class: "btns" }, h("span", { class: "muted" }, "Encres du document :"), ...used.map((i) => {
              const b = button(i.name, () => upd((x) => { x.ink.name = i.name; x.ink.hex = i.hex; }), { cls: "small", title: "Réutiliser cette encre (même plaque)" });
              b.prepend(h("span", { class: "sw", style: `background:${i.hex};display:inline-block;width:9px;height:9px;margin-right:4px;border:1px solid #000` }));
              return b;
            }))
          : null,
      ].filter(Boolean) as HTMLElement[];
    } else ink = [note(s.mode === "bitmap" ? "Bitmap : une seule encre noire, tramée en 1 bit." : "Niveaux de gris : une seule encre noire.")];
    return group("Encre", ...ink, slider({ label: "Couverture", value: l.opacity, min: 0, max: 100, step: 1, unit: "%", def: 100, onInput: (v) => upd((x) => (x.opacity = v), true), onCommit: () => store.commit() }));
  }

  /** Source d'une texture (calque texture ou remplissage d'objet). */
  function sourceControls(l: Layer, allowTypes: SourceType[]): HTMLElement[] {
    const src = l.source;
    const def = SOURCE_BY_TYPE[src.type];
    const extra: (HTMLElement | null)[] = [];
    if (src.type === "image") {
      const a = src.assetId ? store.assets.get(src.assetId) : undefined;
      extra.push(
        h("div", { class: "btns" },
          button(a ? "Changer d'image…" : "Importer une image…", async () => {
            const f = await pickFile("image/*");
            if (!f) return;
            try {
              const asset = await importImageFile(f);
              upd((x) => (x.source.assetId = asset.id));
            } catch {
              toast("Image illisible", "Formats acceptés : JPG, PNG, WebP, GIF, BMP, AVIF.", "err");
            }
          }, { cls: "small default" }),
        ),
        a ? h("div", { class: "muted" }, `${a.name} — ${a.width} × ${a.height} px`) : note("Aucune image : importez-en une (JPG, PNG…).", "warn"),
      );
    }
    if (src.type === "dessin") {
      extra.push(
        h("div", { class: "btns" }, button("✎ Ouvrir l'Atelier de dessin", openAtelier, { cls: "frost" })),
        src.assetId ? h("div", { class: "muted" }, "Les curseurs de la texture sont dans l'Atelier.") : note("Pas encore de dessin : ouvrez l'Atelier.", "warn"),
      );
    }
    return [
      select("Type", src.type, SOURCE_DEFS.filter((x) => allowTypes.includes(x.type)).map((x) => [x.type, x.label]), (v) => {
        upd((x) => {
          const keep = x.source.assetId;
          x.source = defaultSource(v as SourceType);
          if (keep && v === "image") x.source.assetId = keep;
        });
        if (v === "dessin") openAtelier();
      }),
      ...(extra.filter(Boolean) as HTMLElement[]),
      ...paramControls(def.params, src.params, (k, v, live) => upd((x) => (x.source.params[k] = v), live)),
    ];
  }

  /** Propriétés d'un objet de mise en page. */
  function elementProps(l: Layer): HTMLElement[] {
    const k = kindOf(l);
    const b = l.box!;
    const setBox = (key: "x" | "y" | "w" | "h" | "rot", v: number) => upd((x) => { if (x.box) x.box[key] = key === "w" || key === "h" ? Math.max(1, v) : v; });
    const out: HTMLElement[] = [
      group(
        "Position (mm)",
        h("div", { class: "nfgrid" },
          numField("X", b.x, "mm", (v) => setBox("x", v), 0.5, "Distance depuis le bord gauche du format fini"),
          numField("Y", b.y, "mm", (v) => setBox("y", v), 0.5, "Distance depuis le haut du format fini"),
          numField("L", b.w, "mm", (v) => setBox("w", v), 0.5, "Largeur du cadre"),
          numField("H", b.h, "mm", (v) => setBox("h", v), 0.5, "Hauteur du cadre"),
          numField("↻", b.rot, "°", (v) => setBox("rot", v), 1, "Rotation"),
        ),
        checkbox("Verrouiller la position", !!l.pinned, (v) => upd((x) => (x.pinned = v))),
      ),
    ];
    if (k === "texte" && l.text) {
      const t = l.text;
      const area = h("textarea", { class: "field text-content", rows: 4, "aria-label": "Texte", spellcheck: "true" }, t.content);
      area.addEventListener("input", () => upd((x) => { if (x.text) x.text.content = area.value; }, true));
      area.addEventListener("change", () => store.commit());
      focusText.fn = () => { win.open(); area.focus(); area.select(); };
      const fonts = fontList();
      const fsel = h("select", { class: "pop", "aria-label": "Police" });
      const fams = [...new Set(fonts.map((f) => f.family))];
      for (const fam of fams) {
        const og = h("optgroup", { label: fam });
        for (const f of fonts.filter((x) => x.family === fam)) og.append(h("option", { value: f.id, selected: f.id === t.font }, `${f.family} ${f.style}`));
        fsel.append(og);
      }
      fsel.addEventListener("change", () => upd((x) => { if (x.text) x.text.font = fsel.value; }));
      const localBtn = button("Polices de l'ordinateur…", async () => {
        try {
          localFonts = await listLocalFonts();
          if (!localFonts) return toast("Polices de l'ordinateur", "Ce navigateur ne donne pas accès aux polices installées. Utilisez « Importer une police… » (TTF, OTF, WOFF) ou la version bureau.", "info", 9000);
          render();
        } catch {
          toast("Polices de l'ordinateur", "Accès refusé. Vous pouvez importer un fichier de police à la place.", "err");
        }
      }, { cls: "small", title: "Liste les polices installées sur cet ordinateur (une autorisation est demandée)." });
      let localSel: HTMLElement | null = null;
      if (localFonts?.length) {
        const sel = h("select", { class: "pop", "aria-label": "Police de l'ordinateur" }, h("option", { value: "" }, `Choisir parmi ${localFonts.length} polices…`), ...localFonts.map((f, i) => h("option", { value: String(i) }, f.fullName)));
        sel.addEventListener("change", async () => {
          const f = localFonts![Number(sel.value)];
          if (!f) return;
          try {
            const a = await importLocalFont(f);
            upd((x) => { if (x.text) x.text.font = a.id; });
            toast("Police ajoutée", `${a.family} ${a.name}`, "ok");
          } catch (e) {
            toast("Police illisible", e instanceof Error ? e.message : String(e), "err");
          }
        });
        localSel = h("div", { class: "row" }, h("label", null, "Ordinateur"), sel);
      }
      out.push(
        group(
          "Texte",
          area,
          h("div", { class: "row" }, h("label", null, "Police"), fsel),
          h("div", { class: "btns" },
            button("Importer une police…", async () => {
              const f = await pickFile(".ttf,.otf,.woff,font/ttf,font/otf,font/woff");
              if (!f) return;
              try {
                const a = await importFontFile(f);
                upd((x) => { if (x.text) x.text.font = a.id; });
                toast("Police importée", `${a.family} ${a.name}`, "ok");
              } catch (e) {
                toast("Police refusée", e instanceof Error ? e.message : String(e), "err");
              }
            }, { cls: "small" }),
            localBtn,
          ),
          localSel,
          slider({ label: "Taille", value: t.size, min: 4, max: 400, step: 0.5, unit: "pt", def: 36, onInput: (v) => upd((x) => { if (x.text) x.text.size = v; }, true), onCommit: () => store.commit() }),
          slider({ label: "Interligne", value: t.leading, min: 0, max: 400, step: 0.5, unit: "pt", def: 0, hint: "0 = automatique (120 % de la taille).", onInput: (v) => upd((x) => { if (x.text) x.text.leading = v; }, true), onCommit: () => store.commit() }),
          slider({ label: "Approche", value: t.tracking, min: -200, max: 800, step: 5, unit: "‰", def: 0, hint: "Espacement entre les lettres, en millièmes de cadratin.", onInput: (v) => upd((x) => { if (x.text) x.text.tracking = v; }, true), onCommit: () => store.commit() }),
          segmented("Alignement", t.align, [["gauche", "⇤", "À gauche"], ["centre", "↔", "Centré"], ["droite", "⇥", "À droite"], ["justifie", "≡", "Justifié"]], (v) => upd((x) => { if (x.text) x.text.align = v as typeof t.align; })),
          segmented("Vertical", t.vAlign, [["haut", "▔", "En haut"], ["milieu", "─", "Au milieu"], ["bas", "▁", "En bas"]], (v) => upd((x) => { if (x.text) x.text.vAlign = v as typeof t.vAlign; })),
          checkbox("Tout en capitales", t.caps, (v) => upd((x) => { if (x.text) x.text.caps = v; })),
          expert(checkbox("Aligner sur la grille de ligne de base", t.baseline, (v) => upd((x) => { if (x.text) x.text.baseline = v; }), "Les lignes tombent sur la grille réglée dans « Grille & marges ».")),
          store.overflowIds.has(l.id) ? note("Texte en excès : le cadre est trop petit pour tout afficher.", "warn") : null,
        ),
      );
    }
    if (k === "forme" && l.shape) {
      const s = l.shape;
      const updS = (fn: (x: NonNullable<Layer["shape"]>) => void, live = false) => upd((x) => { if (x.shape) fn(x.shape); }, live);
      out.push(
        group(
          "Forme",
          select("Type", s.type, [["rect", "Rectangle"], ["ellipse", "Ellipse"], ["ligne", "Ligne"], ["polygone", "Polygone"], ["etoile", "Étoile"]], (v) => updS((x) => (x.type = v as ShapeType))),
          s.type === "rect" ? slider({ label: "Arrondi", value: s.radius, min: 0, max: 100, step: 0.5, unit: "mm", def: 0, onInput: (v) => updS((x) => (x.radius = v), true), onCommit: () => store.commit() }) : null,
          s.type === "polygone" || s.type === "etoile" ? slider({ label: s.type === "etoile" ? "Branches" : "Côtés", value: s.sides, min: 3, max: 40, step: 1, def: 6, onInput: (v) => updS((x) => (x.sides = v), true), onCommit: () => store.commit() }) : null,
          s.type === "etoile" ? slider({ label: "Creux", value: s.inner, min: 5, max: 95, step: 1, unit: "%", def: 50, onInput: (v) => updS((x) => (x.inner = v), true), onCommit: () => store.commit() }) : null,
          s.type !== "ligne" ? checkbox("Fond", s.fill, (v) => updS((x) => (x.fill = v))) : null,
          checkbox("Contour", s.stroke || s.type === "ligne", (v) => updS((x) => (x.stroke = v))),
          s.stroke || s.type === "ligne" ? slider({ label: "Épaisseur", value: s.strokePt, min: 0.25, max: 60, step: 0.25, unit: "pt", def: 2, onInput: (v) => updS((x) => (x.strokePt = v), true), onCommit: () => store.commit() }) : null,
        ),
      );
    }
    if (k === "image") {
      const a = l.assetId ? store.assets.get(l.assetId) : undefined;
      out.push(
        group(
          "Logo / image",
          a ? h("div", { class: "muted" }, `${a.name} — ${a.kind === "vecteur" ? "vectoriel (net à toute taille)" : `${a.width} × ${a.height} px`}`) : note("Aucun fichier : importez un SVG, PNG ou JPG.", "warn"),
          h("div", { class: "btns" }, button(a ? "Remplacer…" : "Importer…", async () => {
            const f = await pickFile(".svg,image/svg+xml,image/*");
            if (!f) return;
            try {
              const { asset, warnings } = await importLogoFile(f);
              upd((x) => (x.assetId = asset.id));
              if (warnings.length) toast("Logo importé", warnings.join(" "), "info", 9000);
            } catch (e) {
              toast("Logo illisible", e instanceof Error ? e.message : String(e), "err");
            }
          }, { cls: "small default" })),
          select("Ajustement", l.image?.fit ?? "contenir", [["contenir", "Contenir"], ["remplir", "Remplir le cadre"], ["etirer", "Étirer"]], (v) => upd((x) => { x.image = { fit: v as "contenir" }; })),
          a && a.kind !== "vecteur" && (a.width < 1000 || a.height < 1000) ? note(`Image de ${a.width} × ${a.height} px : à grande taille, ses bords seront doux. Un SVG reste net.`, "warn") : null,
        ),
      );
    }
    out.push(inkGroup(l));
    const fill = l.fill ?? { mode: "aplat", tint: 100 };
    out.push(
      group(
        "Remplissage",
        segmented("Matière", fill.mode, [["aplat", "Aplat"], ["texture", "Texture"]], (v) => upd((x) => { x.fill = { ...(x.fill ?? { tint: 100 }), mode: v as "aplat" | "texture" }; })),
        slider({ label: "Teinte", value: fill.tint, min: 0, max: 100, step: 1, unit: "%", def: 100, hint: "100 % = encre pleine, nette. Moins = tramé.", onInput: (v) => upd((x) => { x.fill = { ...(x.fill ?? { mode: "aplat" }), tint: v }; }, true), onCommit: () => store.commit() }),
        ...(fill.mode === "texture"
          ? [note("La texture ne remplit que cet objet. La « Pile d'effets » s'applique à elle."), ...sourceControls(l, ["rd", "bruit", "image", "dessin", "aplat"])]
          : []),
        checkbox("Les effets déforment aussi la forme", !!l.fxOnShape, (v) => upd((x) => (x.fxOnShape = v)), "Texte qui fond, logo en onde… Les bords suivent alors la résolution du ton continu."),
        checkbox("Surimpression", !!l.overprint, (v) => upd((x) => (x.overprint = v)), "Coché : l'objet se mélange aux encres du dessous (effet riso). Décoché : il les réserve (efface), comme dans InDesign."),
      ),
    );
    return out;
  }

  function render() {
    const d = store.doc;
    const l = store.layer;
    if (!l) return;
    const idx = d.layers.findIndex((x) => x.id === l.id);
    const k = kindOf(l);
    const addSel = h("select", { class: "pop", "aria-label": "Type de texture à ajouter" });
    for (const sd of SOURCE_DEFS) addSel.append(h("option", { value: sd.type }, sd.label));

    const nameIn = h("input", { type: "text", class: "field", value: l.name, "aria-label": "Nom du calque" });
    nameIn.addEventListener("change", () => upd((x) => (x.name = nameIn.value.trim() || "Calque")));

    win.setTitle(`Calques — ${d.layers.length}`);
    win.body.replaceChildren(
      h("div", { class: "btns add-bar" },
        button("T  Texte", () => { addElement("texte"); setTimeout(() => focusText.fn?.(), 50); }, { cls: "small", title: "Ajouter un bloc de texte (outil T sur la Planche)" }),
        button("▭ Forme", () => addElement("forme"), { cls: "small", title: "Ajouter une forme vectorielle" }),
        button("◈ Logo…", async () => {
          try {
            const r = await addLogo();
            if (r?.warnings.length) toast("Logo importé", r.warnings.join(" "), "info", 9000);
          } catch (e) {
            toast("Logo illisible", e instanceof Error ? e.message : String(e), "err");
          }
        }, { cls: "small", title: "Importer un logo SVG (vectoriel) ou une image" }),
      ),
      h("div", { class: "btns" },
        addSel,
        button("+ Texture", () => {
          const t = addSel.value as SourceType;
          const nl = newLayer(t, SOURCE_BY_TYPE[t].label, d.layers.length);
          // une texture s'insère sous les objets de mise en page
          store.update((dd) => {
            let at = dd.layers.length;
            while (at > 0 && isElement(dd.layers[at - 1])) at--;
            dd.layers.splice(at, 0, nl);
            dd.activeLayerId = nl.id;
          });
          if (t === "dessin") openAtelier();
        }, { cls: "small" }),
      ),
      list(),
      h("div", { class: "btns" },
        button("▲", () => store.update((dd) => { const i = dd.layers.findIndex((x) => x.id === l.id); if (i < dd.layers.length - 1) [dd.layers[i], dd.layers[i + 1]] = [dd.layers[i + 1], dd.layers[i]]; }), { cls: "small icon", title: "Monter (imprimé plus haut)", disabled: idx === d.layers.length - 1 }),
        button("▼", () => store.update((dd) => { const i = dd.layers.findIndex((x) => x.id === l.id); if (i > 0) [dd.layers[i], dd.layers[i - 1]] = [dd.layers[i - 1], dd.layers[i]]; }), { cls: "small icon", title: "Descendre", disabled: idx === 0 }),
        button("Dupliquer", () => duplicateLayer(l.id), { cls: "small" }),
        button("Supprimer", () => deleteLayer(l.id), { cls: "small", disabled: d.layers.length <= 1 }),
      ),
      group(KIND_LABEL[k], h("div", { class: "row" }, h("label", null, "Nom"), nameIn)),
      ...(k === "texture" ? [inkGroup(l), group("Source", ...sourceControls(l, SOURCE_DEFS.map((x) => x.type)))] : elementProps(l)),
    );
  }

  render();
  refreshSwatches();
  /** Ne pas reconstruire le panneau pendant qu'on y tape (on perdrait le curseur). */
  const typing = () => {
    const a = document.activeElement;
    return !!a && win.body.contains(a) && a.matches("textarea, input[type=text]");
  };
  store.on((reason, origin) => {
    if (reason === "overflow") {
      if (!typing()) render();
      return;
    }
    if ((reason === "doc" && origin !== ORIGIN) || reason === "selection") {
      render();
      refreshSwatches();
    }
    if (reason === "profiles" || reason === "assets") {
      render();
      refreshSwatches();
    }
  });
}
