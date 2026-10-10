// Fenêtre « Atelier de dessin » : on dessine une tuile (raccordable ou non), les curseurs en font une matière,
// et l'IA locale (Ollama) peut lire le croquis + la consigne pour régler les curseurs.
// Le dessin alimente une couche de texture (motif répété) OU un objet de la page (texte, logo… repris à la main).
import { h } from "../dom.ts";
import { slider, select, checkbox, group, button, note, segmented } from "../widgets.ts";
import { store } from "../../app/store.ts";
import { client } from "../../app/client.ts";
import { registerAsset, decodeImage, fontList } from "../../app/project.ts";
import { pickFile } from "../../app/desktop.ts";
import { restoreElement } from "../../app/actions.ts";
import { DESSIN_SLIDERS, defaultDessinParams } from "../../engine/dessin.ts";
import { RD_PRESETS } from "../../engine/rd.ts";
import { newLayer, newElement, inkKey, plateDescs, isElement, kindOf } from "../../engine/doc.ts";
import { uid } from "../../engine/util.ts";
import { aiConfig, askModel, probe, type AiStatus } from "../../ai/ollama.ts";
import { interpret } from "../../ai/heuristic.ts";
import type { AiSuggestion } from "../../ai/schema.ts";
import { toast } from "../toast.ts";
import type { Asset, Layer, Params } from "../../engine/types.ts";
import type { Win } from "../wm.ts";

/** Finesse de la tuile (px de côté). Plus fin = plus net à grande échelle, mais plus lourd. */
const SIZES = [512, 1024, 2048];

type Tool =
  | "crayon" | "pinceau" | "plume" | "feutre" | "fusain" | "sec" | "aero" | "points" | "eclabous" | "hachures"
  | "tampon" | "texte"
  | "ligne" | "rect" | "ellipse" | "pot" | "flou" | "gomme";

const TOOLS: { id: Tool; icon: string; label: string; key: string; hint: string; section?: string }[] = [
  { id: "crayon", icon: "✎", label: "Crayon", key: "c", hint: "Trait net, pixel par pixel.", section: "Pinceaux" },
  { id: "pinceau", icon: "●", label: "Pinceau", key: "b", hint: "Pinceau rond, dur ou doux." },
  { id: "plume", icon: "✒", label: "Plume", key: "n", hint: "Bec biseauté : pleins et déliés selon le sens du trait." },
  { id: "feutre", icon: "▰", label: "Feutre", key: "f", hint: "Marqueur à pointe plate, couvrance régulière." },
  { id: "fusain", icon: "▒", label: "Fusain", key: "k", hint: "Matière granuleuse qui accroche le grain du papier." },
  { id: "sec", icon: "≋", label: "Brosse", key: "d", hint: "Brosse sèche : poils qui laissent des stries." },
  { id: "aero", icon: "∴", label: "Aéro", key: "a", hint: "Pulvérisation de fines gouttes." },
  { id: "points", icon: "⁘", label: "Points", key: "p", hint: "Pointillisme : des points ronds au hasard." },
  { id: "eclabous", icon: "⁂", label: "Taches", key: "s", hint: "Éclaboussures d'encre, petites et grosses gouttes." },
  { id: "hachures", icon: "▤", label: "Hachures", key: "h", hint: "Traits parallèles le long du geste (croisés en option)." },
  { id: "tampon", icon: "★", label: "Tampon", key: "m", hint: "Pose une forme, un logo ou un objet de la page, au clic ou en traînant.", section: "Tampons" },
  { id: "texte", icon: "T", label: "Texte", key: "t", hint: "Pose du texte avec les polices du logiciel ou les tiennes." },
  { id: "ligne", icon: "╱", label: "Ligne", key: "l", hint: "Ligne droite (Maj : angles de 15°).", section: "Formes" },
  { id: "rect", icon: "▭", label: "Rect.", key: "r", hint: "Rectangle (Maj : carré, Alt : depuis le centre)." },
  { id: "ellipse", icon: "◯", label: "Ellipse", key: "o", hint: "Ellipse (Maj : cercle, Alt : depuis le centre)." },
  { id: "pot", icon: "◧", label: "Remplir", key: "g", hint: "Pot de peinture : remplit une zone fermée." },
  { id: "flou", icon: "◌", label: "Flou", key: "u", hint: "Adoucit les bords sous le pinceau." },
  { id: "gomme", icon: "▱", label: "Gomme", key: "e", hint: "Efface." },
];

interface Brush {
  size: number;
  opacity: number;
  hardness: number;
  flow: number;
  angle: number;
  nib: number;
  lineW: number;
  spacing: number;
  scatter: number;
  jitter: number;
  spin: number;
  grain: number;
  dryness: number;
  cross: boolean;
  filled: boolean;
  tolerance: number;
  pressure: boolean;
}
type BKey = keyof Brush;

const BASE: Brush = {
  size: 24, opacity: 100, hardness: 80, flow: 50, angle: 45, nib: 20, lineW: 2, spacing: 100, scatter: 0, jitter: 0, spin: 0,
  grain: 2, dryness: 45, cross: false, filled: true, tolerance: 25, pressure: true,
};
const DEFAULTS: Record<Tool, Partial<Brush>> = {
  crayon: { size: 4 },
  pinceau: { size: 24 },
  plume: { size: 32, angle: 40, nib: 20 },
  feutre: { size: 30, angle: 30, opacity: 75 },
  fusain: { size: 40, flow: 45, grain: 2 },
  sec: { size: 48, dryness: 45 },
  aero: { size: 64, flow: 50 },
  points: { size: 36, flow: 50 },
  eclabous: { size: 40, scatter: 100, jitter: 80 },
  hachures: { size: 36, angle: 45, spacing: 7, lineW: 2 },
  tampon: { size: 90, angle: 0, spacing: 140, pressure: false },
  texte: { size: 160, angle: 0, spacing: 250, pressure: false },
  ligne: { size: 8, hardness: 100 },
  rect: { size: 8, filled: false },
  ellipse: { size: 8, filled: false },
  pot: { tolerance: 25 },
  flou: { size: 50, flow: 60 },
  gomme: { size: 30, hardness: 80 },
};

/** Réglages montrés pour chaque outil. */
const UI: Record<Tool, BKey[]> = {
  crayon: ["size", "opacity", "pressure"],
  pinceau: ["size", "opacity", "hardness", "pressure"],
  plume: ["size", "opacity", "angle", "nib", "pressure"],
  feutre: ["size", "opacity", "angle"],
  fusain: ["size", "opacity", "flow", "grain", "pressure"],
  sec: ["size", "opacity", "dryness", "pressure"],
  aero: ["size", "opacity", "flow"],
  points: ["size", "opacity", "flow"],
  eclabous: ["size", "opacity", "scatter", "jitter"],
  hachures: ["size", "opacity", "angle", "spacing", "lineW", "cross"],
  tampon: ["size", "opacity", "angle", "spacing", "scatter", "jitter", "spin", "filled"],
  texte: ["size", "opacity", "angle", "spacing", "scatter", "jitter", "spin"],
  ligne: ["size", "opacity", "hardness"],
  rect: ["size", "opacity", "filled"],
  ellipse: ["size", "opacity", "filled"],
  pot: ["opacity", "tolerance"],
  flou: ["size", "flow"],
  gomme: ["size", "opacity", "hardness", "pressure"],
};

/** Outils qui peignent dans un calque de trait (l'opacité vaut pour tout le geste). */
const BUFFERED = new Set<Tool>(["crayon", "pinceau", "plume", "feutre", "fusain", "sec", "aero", "points", "eclabous", "hachures", "tampon", "texte", "ligne", "rect", "ellipse"]);

type ShapeKind = "cercle" | "carre" | "triangle" | "etoile" | "losange" | "croix" | "coeur" | "goutte" | "fleur";
const SHAPES: [ShapeKind, string][] = [
  ["cercle", "Cercle"], ["carre", "Carré"], ["triangle", "Triangle"], ["etoile", "Étoile"], ["losange", "Losange"],
  ["croix", "Croix"], ["coeur", "Cœur"], ["goutte", "Goutte"], ["fleur", "Fleur"],
];

type Sym = "aucune" | "x" | "y" | "xy" | "rad4" | "rad6" | "rad8" | "kaleido";

const PREFS = "frost.atelier.v2";

export interface AtelierApi {
  /** Nouvelle tuile à partir d'un objet de la page (texte, forme, logo), posé au centre, prête à dessiner. */
  fromObject(layerId: string): Promise<void>;
}

export function mountAtelier(win: Win, openAiHelp: () => void): AtelierApi {
  // ---- état
  let N = 1024;
  let tool: Tool = "pinceau";
  const brushes = {} as Record<Tool, Brush>;
  for (const t of TOOLS) brushes[t.id] = { ...BASE, ...DEFAULTS[t.id] };
  let wrap = true;
  let sym: Sym = "aucune";
  let stampSrc: "forme" | "image" | "objet" = "forme";
  let shape: ShapeKind = "etoile";
  let imageTip: HTMLCanvasElement | null = null;
  let imageName = "";
  let objTip: HTMLCanvasElement | null = null;
  let objId = "";
  let textTip: HTMLCanvasElement | null = null;
  let textContent = "FROST";
  let textFont = "inter-900";
  let params: Params = defaultDessinParams();
  let assetId: string = uid("dessin");
  let rev = 0;
  let undo: ImageData[] = [];
  let redo: ImageData[] = [];
  let lastAi: { before: Params } | null = null;
  let aiStatus: AiStatus = { online: false, models: [] };
  let aiBusy = false;
  let aiAnswer: AiSuggestion | null = null;
  let skipLoadOnShow = false;

  try {
    const saved = JSON.parse(localStorage.getItem(PREFS) ?? "null");
    if (saved) {
      if (SIZES.includes(saved.N)) N = saved.N;
      for (const t of TOOLS) if (saved.brushes?.[t.id]) brushes[t.id] = { ...brushes[t.id], ...saved.brushes[t.id] };
      if (saved.tool && TOOLS.some((t) => t.id === saved.tool)) tool = saved.tool;
      if (typeof saved.textContent === "string") textContent = saved.textContent;
      if (typeof saved.textFont === "string") textFont = saved.textFont;
      if (saved.shape) shape = saved.shape;
    }
  } catch {
    /* préférences illisibles : valeurs par défaut */
  }
  const savePrefs = () => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ N, brushes, tool, textContent, textFont, shape }));
    } catch {
      /* stockage indisponible */
    }
  };
  const cur = () => brushes[tool];

  // ---- toiles : dessin, trait en cours (opacité du geste), guides et aperçus
  const canvas = h("canvas", { width: N, height: N, "aria-label": "Tuile de dessin" });
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const live = h("canvas", { class: "live", width: N, height: N });
  const lctx = live.getContext("2d")!;
  const ghost = h("canvas", { class: "ghost", width: N, height: N });
  const gctx = ghost.getContext("2d")!;
  const wrapEl = h("div", { class: "draw-wrap" }, canvas, live, ghost);
  const caption = h("div", { class: "caption" });
  const zone = h("div", { class: "canvas-zone" }, wrapEl, caption);
  const mini = h("canvas", { class: "mini-prev", width: 220, height: 220, "aria-label": "Aperçu de la matière" });
  const toolsCol = h("div", { class: "tools" });
  const side = h("div", { class: "side" });
  const prompt = h("textarea", { class: "field", placeholder: "Décris la texture voulue : « corail fin et granuleux, style risographie », « labyrinthe épais en diagonale »…", "aria-label": "Consigne pour l'IA" });
  const aiStatusEl = h("div", { class: "ai-status" });
  const aiAnswerEl = h("div", { class: "ai-answer" });
  const aiBtn = button("✦ Améliorer avec l'IA", () => runAi(), { cls: "frost default", title: "L'IA lit ton croquis et ta consigne, puis règle les curseurs." });
  const varBtn = button("Variation", () => variation(), { cls: "small", title: "Petite variation aléatoire des curseurs." });
  const undoAiBtn = button("Annuler l'IA", () => { if (lastAi) { params = lastAi.before; lastAi = null; changed(true); renderSide(); renderAi(); } }, { cls: "small" });
  const diffBtn = button("Enrichir (diffusion) — à venir", () => {}, { cls: "small", disabled: true, title: "Prochaine version : génération d'image locale (Stable Diffusion + ControlNet via ComfyUI) pour ajouter du détail au croquis." });
  const aibar = h(
    "div",
    { class: "aibar" },
    prompt,
    h("div", { class: "ai-actions" }, aiBtn, h("div", { class: "btns" }, varBtn, undoAiBtn), diffBtn),
    aiStatusEl,
    aiAnswerEl,
  );
  win.body.append(h("div", { class: "atelier" }, toolsCol, zone, side, aibar));

  // ---- taille d'affichage
  const fit = () => {
    const avail = Math.max(160, Math.min(zone.clientWidth - 30, zone.clientHeight - 50));
    for (const c of [canvas, live, ghost]) c.style.width = c.style.height = avail + "px";
  };
  new ResizeObserver(fit).observe(zone);

  /** Change la finesse de la tuile ; `keep` = garder le dessin (agrandi ou réduit). */
  function setN(n: number, keep: boolean) {
    if (n === N) return;
    const old = keep ? (() => { const c = document.createElement("canvas"); c.width = c.height = N; c.getContext("2d")!.drawImage(canvas, 0, 0); return c; })() : null;
    const ratio = n / N;
    for (const t of TOOLS) {
      const b = brushes[t.id];
      b.size = Math.max(1, Math.round(b.size * ratio));
      if (t.id === "hachures") {
        b.spacing = Math.max(2, Math.round(b.spacing * ratio));
        b.lineW = Math.max(1, Math.round(b.lineW * ratio));
      }
    }
    N = n;
    for (const c of [canvas, live, ghost]) c.width = c.height = N;
    if (old) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(old, 0, 0, N, N);
    }
    undo = [];
    redo = [];
    drawOverlay(null);
    fit();
  }

  // ---- outils
  function renderTools() {
    const items: HTMLElement[] = [];
    for (const t of TOOLS) {
      if (t.section) items.push(h("div", { class: "tool-sec" }, t.section));
      const b = h("button", { class: "tool-btn" + (tool === t.id ? " sel" : ""), type: "button", title: `${t.label} (${t.key.toUpperCase()}) — ${t.hint}`, "aria-pressed": String(tool === t.id) }, t.icon, h("small", null, t.label));
      b.addEventListener("click", () => setTool(t.id));
      items.push(b);
    }
    items.push(
      h("div", { class: "tool-sec" }, "Tuile"),
      iconBtn("↶", "Annuler", "Annuler le trait (Ctrl+Z)", () => undoStroke()),
      iconBtn("↷", "Refaire", "Refaire le trait (Ctrl+Maj+Z)", () => redoStroke()),
      iconBtn("◐", "Inverser", "Inverser encre et papier", () => { snapshot(); invert(); commitDrawing(); }),
      iconBtn("⌫", "Vider", "Effacer la tuile", () => { snapshot(); ctx.clearRect(0, 0, N, N); commitDrawing(); }),
      iconBtn("⤓", "Logo", "Importer un logo ou une image (SVG, PNG, JPG) à poser au tampon", () => importLogo()),
      iconBtn("⇣", "Objet", "Prendre un texte, une forme ou un logo de la page comme tampon", () => { stampSrc = "objet"; setTool("tampon"); }),
    );
    toolsCol.replaceChildren(...items);
  }
  const iconBtn = (icon: string, label: string, title: string, fn: () => void) => {
    const b = h("button", { class: "tool-btn", type: "button", title }, icon, h("small", null, label));
    b.addEventListener("click", fn);
    return b;
  };
  function setTool(t: Tool) {
    tool = t;
    renderTools();
    renderSide();
    drawOverlay(null);
    savePrefs();
    if (t === "texte" && !textTip) refreshTextTip();
    if (t === "tampon" && stampSrc === "objet" && !objTip) loadObjectTip();
  }

  // ---- panneau de réglages
  const linkMode = (): "couche" | "objet" | null => {
    const l = store.layer;
    if (!l) return null;
    if (kindOf(l) === "image" && l.image?.dessin && l.assetId === assetId) return "objet";
    if (l.source.type === "dessin" && l.source.assetId === assetId && (!isElement(l) || l.fill?.mode === "texture")) return "couche";
    return null;
  };

  function brushControl(k: BKey): HTMLElement | null {
    const b = cur();
    const set = (v: number | boolean) => {
      (b as unknown as Record<string, number | boolean>)[k] = v;
      savePrefs();
      drawOverlay(null);
    };
    const num = (label: string, min: number, max: number, step: number, unit: string, hint?: string) =>
      slider({ label, value: Number(b[k]), min, max, step, unit, def: Number((DEFAULTS[tool][k] ?? BASE[k]) as number), hint, onInput: (v) => set(v) });
    switch (k) {
      case "size": {
        const label = tool === "texte" ? "Taille des lettres" : tool === "rect" || tool === "ellipse" ? "Épaisseur du contour" : tool === "hachures" ? "Longueur des traits" : "Taille";
        return num(label, 1, Math.round(N / 2), 1, "px", "Raccourcis : [ et ] pour réduire ou agrandir.");
      }
      case "opacity": return num("Opacité", 1, 100, 1, "%", "Opacité de tout le geste : les passages d'un même trait ne s'additionnent pas.");
      case "hardness": return num("Dureté", 0, 100, 1, "%");
      case "flow": return num(tool === "flou" ? "Force" : tool === "fusain" ? "Charge" : "Densité", 1, 100, 1, "%");
      case "angle": return num(tool === "tampon" || tool === "texte" ? "Rotation" : "Angle", 0, 360, 1, "°");
      case "nib": return num("Finesse du bec", 5, 100, 1, "%", "Épaisseur du bec par rapport à sa largeur : petit = déliés très fins.");
      case "lineW": return num("Épaisseur des traits", 1, 60, 1, "px");
      case "spacing":
        return tool === "hachures"
          ? num("Écart", 2, 200, 1, "px")
          : num("Espacement", 10, 800, 5, "%", "100 % : les tampons se touchent. Plus : ils s'espacent quand on traîne.");
      case "scatter": return num("Dispersion", 0, 300, 1, "%");
      case "jitter": return num("Variation de taille", 0, 100, 1, "%");
      case "spin": return num("Rotation au hasard", 0, 100, 1, "%");
      case "grain": return num("Grain", 1, 4, 1, "", "1 : grain fin, 4 : gros grain.");
      case "dryness": return num("Sécheresse", 0, 95, 1, "%", "Plus sec : les poils laissent plus de blancs.");
      case "tolerance": return num("Tolérance", 0, 100, 1, "%", "Jusqu'où le remplissage déborde sur les gris.");
      case "cross": return checkbox("Hachures croisées", b.cross, (v) => set(v));
      case "filled": return checkbox("Plein (sinon : contour)", b.filled, (v) => { set(v); if (tool === "tampon") renderSide(); });
      case "pressure": return checkbox("Pression du stylet → taille", b.pressure, (v) => set(v), "Tablette graphique (Huion, Wacom…).");
    }
    return null;
  }

  function stampSourceControls(): (HTMLElement | null)[] {
    if (tool === "texte") {
      const area = h("textarea", { class: "field", rows: 2, "aria-label": "Texte à poser" }, textContent);
      area.addEventListener("input", () => { textContent = area.value; savePrefs(); refreshTextTip(); });
      const fonts = fontList();
      const fsel = h("select", { class: "pop", "aria-label": "Police" });
      for (const fam of [...new Set(fonts.map((f) => f.family))]) {
        const og = h("optgroup", { label: fam });
        for (const f of fonts.filter((x) => x.family === fam)) og.append(h("option", { value: f.id, selected: f.id === textFont }, `${f.family} ${f.style}`));
        fsel.append(og);
      }
      fsel.addEventListener("change", () => { textFont = fsel.value; savePrefs(); refreshTextTip(); });
      return [
        area,
        h("div", { class: "row" }, h("label", null, "Police"), fsel),
        h("div", { class: "btns" }, button("Poser au centre, en grand", () => centerStamp(0.85), { cls: "small" })),
        h("div", { class: "muted" }, "Clique pour poser, traîne pour répéter. Tes polices importées sont dans la liste."),
      ];
    }
    if (tool !== "tampon") return [];
    const out: (HTMLElement | null)[] = [
      segmented("Source", stampSrc, [["forme", "Forme", "Une forme simple"], ["image", "Logo", "Un logo ou une image importée"], ["objet", "Page", "Un texte, une forme ou un logo de la mise en page"]], (v) => {
        stampSrc = v as typeof stampSrc;
        if (stampSrc === "objet" && !objTip) loadObjectTip();
        renderSide();
        drawOverlay(null);
      }),
    ];
    if (stampSrc === "forme") out.push(select("Forme", shape, SHAPES, (v) => { shape = v as ShapeKind; savePrefs(); drawOverlay(null); }));
    if (stampSrc === "image")
      out.push(
        imageTip ? h("div", { class: "muted" }, imageName) : note("Aucun logo : importe un SVG, PNG ou JPG.", "warn"),
        h("div", { class: "btns" }, button(imageTip ? "Changer de logo…" : "Importer un logo…", () => importLogo(), { cls: "small default" })),
      );
    if (stampSrc === "objet") {
      const els = store.doc.layers.filter((l) => isElement(l));
      if (!els.length) out.push(note("La page n'a pas encore de texte, de forme ou de logo.", "warn"));
      else {
        if (!els.some((l) => l.id === objId)) objId = els[els.length - 1].id;
        out.push(select("Objet", objId, els.map((l) => [l.id, l.name]), (v) => { objId = v; objTip = null; loadObjectTip(); }));
      }
    }
    out.push(h("div", { class: "btns" }, button("Poser au centre, en grand", () => centerStamp(0.85), { cls: "small" })));
    return out;
  }

  function renderSide() {
    const mode = linkMode();
    const l = store.layer;
    const linkInfo =
      mode === "objet"
        ? [
            note(`Ce dessin EST l'objet « ${l.name} » de la page : chaque trait s'y voit.`, "ok"),
            l.avantDessin ? h("div", { class: "btns" }, button("↺ Revenir à l'original", () => { restoreElement(l.id); renderSide(); }, { cls: "small", title: "L'objet redevient le texte, la forme ou le logo d'avant." })) : null,
          ]
        : [
            h("div", { class: "btns" },
              button(mode === "couche" ? "✓ Liée à la couche" : isElement(l) ? "Remplir l'objet actif" : "Appliquer à la couche active", () => applyToLayer(), { cls: mode === "couche" ? "small on" : "small default", title: isElement(l) ? "L'objet actif se remplit de cette matière (répétée)." : "La couche active utilise ce dessin comme source." }),
              button("+ Nouvelle couche", () => applyToNewLayer(), { cls: "small", title: "Une couche de texture : le dessin répété sur toute la page." }),
              button("◈ Poser comme objet", () => placeAsObject(), { cls: "small", title: "Le dessin devient un objet de la page, posé une seule fois, que l'on déplace comme un logo." }),
            ),
          ];
    const tdef = TOOLS.find((t) => t.id === tool)!;
    side.replaceChildren(
      group(mode === "objet" ? "Aperçu de l'objet" : "Aperçu de la matière", mini, h("div", { class: "muted" }, mode === "objet" ? "L'objet tel qu'il sera imprimé." : `${Number(params.echelle)} mm par tuile · 2,5 tuiles affichées`)),
      ...(linkInfo.filter(Boolean) as HTMLElement[]),
      group(
        `Outil : ${tdef.label}`,
        h("div", { class: "muted" }, tdef.hint),
        ...stampSourceControls(),
        ...UI[tool].map((k) => brushControl(k)),
      ),
      group(
        "Tuile",
        select("Finesse", String(N), SIZES.map((n) => [String(n), `${n} × ${n} px${n === 2048 ? " (objets, grandes échelles)" : n === 512 ? " (léger)" : ""}`]), (v) => {
          snapshotNone();
          setN(Number(v), true);
          savePrefs();
          commitDrawing();
          renderSide();
        }, "Plus fin = plus net quand le motif est grand ou quand le dessin devient un objet."),
        checkbox("Raccordable (les bords se rejoignent)", wrap, (v) => { wrap = v; updateCaption(); }, "À couper pour un objet posé une seule fois."),
        select("Symétrie", sym, [["aucune", "Aucune"], ["x", "Miroir vertical"], ["y", "Miroir horizontal"], ["xy", "Quatre quarts"], ["rad4", "Radiale ×4"], ["rad6", "Radiale ×6"], ["rad8", "Radiale ×8"], ["kaleido", "Kaléidoscope ×12"]], (v) => { sym = v as Sym; drawOverlay(null); }),
      ),
      group(
        "Matière",
        select("Motif organique", String(params.motif), Object.entries(RD_PRESETS).map(([k, v]) => [k, v.label]), (v) => { params.motif = v; changed(true); }, "Réaction-diffusion utilisée par « Croissance organique »."),
        ...DESSIN_SLIDERS.filter((s) => mode !== "objet" || !s.repetition).map((s) =>
          slider({
            label: s.label, value: Number(params[s.key]), min: s.min, max: s.max, step: s.step, unit: s.unit, def: s.def, hint: s.hint, log: s.log,
            onInput: (v) => { params[s.key] = v; changed(false); },
            onCommit: () => changed(true),
          }),
        ),
        h("div", { class: "btns" }, button("Réglages par défaut", () => { params = { ...defaultDessinParams(), graine: params.graine }; changed(true); renderSide(); }, { cls: "small" })),
      ),
    );
  }
  /** Le changement de finesse remplace la tuile : on vide l'historique plutôt que d'y garder une autre taille. */
  const snapshotNone = () => {
    undo = [];
    redo = [];
  };

  function updateCaption() {
    caption.textContent = `Tuile ${N} × ${N}` + (wrap ? " · raccordable ✓" : " · sans raccord") + (sym !== "aucune" ? " · symétrie" : "");
  }

  function renderAi() {
    const models = aiStatus.models;
    const visionModels = models.filter((m) => m.vision);
    const chosen = aiConfig.model && models.some((m) => m.name === aiConfig.model) ? aiConfig.model : (visionModels[0] ?? models[0])?.name ?? "";
    if (chosen && chosen !== aiConfig.model) aiConfig.model = chosen;
    const parts: (HTMLElement | string)[] = [];
    if (aiStatus.online && models.length) {
      const sel = h("select", { class: "pop", style: "width:auto", "aria-label": "Modèle d'IA" }, ...models.map((m) => h("option", { value: m.name, selected: m.name === chosen }, `${m.name}${m.vision ? " 👁" : ""} (${m.sizeGb.toFixed(1)} Go)`)));
      sel.addEventListener("change", () => { aiConfig.model = sel.value; renderAi(); });
      parts.push(h("span", null, h("span", { class: "dot on" }), "IA locale connectée"), sel);
      const m = models.find((x) => x.name === chosen);
      if (m && !m.vision) parts.push(h("span", { class: "muted" }, "(ce modèle ne voit pas le croquis : seule la consigne compte)"));
    } else if (aiStatus.online) {
      parts.push(h("span", null, h("span", { class: "dot off" }), "Ollama répond mais aucun modèle n'est installé"));
    } else parts.push(h("span", null, h("span", { class: "dot off" }), "IA locale hors ligne → mode règles (mots-clés)"));
    const help = h("button", { class: "btn small", type: "button" }, "Installer l'IA locale…");
    help.addEventListener("click", openAiHelp);
    const retry = h("button", { class: "btn small", type: "button" }, "Reconnecter");
    retry.addEventListener("click", () => refreshAi());
    parts.push(help, retry);
    if (aiBusy) parts.push(h("span", null, "⌛ l'IA réfléchit…"));
    aiStatusEl.replaceChildren(...parts);
    aiBtn.disabled = aiBusy;
    undoAiBtn.disabled = !lastAi || aiBusy;
    aiAnswerEl.replaceChildren(
      aiAnswer
        ? note((aiAnswer.source === "ia" ? "IA : " : "") + aiAnswer.explication + (aiAnswer.trame ? ` Trame conseillée : ${aiAnswer.trame}.` : ""), aiAnswer.source === "ia" ? "ok" : "info")
        : h("span"),
    );
  }

  async function refreshAi() {
    aiStatus = await probe();
    renderAi();
  }

  // ---- symétries et raccords : chaque empreinte est posée à travers ces transformations
  function symMatrices(): DOMMatrix[] {
    const c = N / 2;
    const mir = (sx: number, sy: number) => new DOMMatrix().translate(c, c).scale(sx, sy).translate(-c, -c);
    const rot = (deg: number) => new DOMMatrix().translate(c, c).rotate(deg).translate(-c, -c);
    const list = [new DOMMatrix()];
    if (sym === "x") list.push(mir(-1, 1));
    if (sym === "y") list.push(mir(1, -1));
    if (sym === "xy") list.push(mir(-1, 1), mir(1, -1), mir(-1, -1));
    const rads = sym === "rad4" ? 4 : sym === "rad6" || sym === "kaleido" ? 6 : sym === "rad8" ? 8 : 0;
    for (let k = 1; k < rads; k++) list.push(rot((360 / rads) * k));
    if (sym === "kaleido") for (let k = 0; k < 6; k++) list.push(rot(60 * k).multiply(mir(-1, 1)));
    return list;
  }

  /** Décalages de raccord : la même empreinte de l'autre côté du bord, si elle déborde. */
  function wrapOffsets(x: number, y: number, reach: number): [number, number][] {
    const offs: [number, number][] = [[0, 0]];
    if (!wrap) return offs;
    for (const ox of [-N, 0, N])
      for (const oy of [-N, 0, N])
        if ((ox || oy) && x + ox > -reach && x + ox < N + reach && y + oy > -reach && y + oy < N + reach) offs.push([ox, oy]);
    return offs;
  }

  /** Pose `draw` (dessin centré en x, y) à chaque copie symétrique et raccordée. */
  function place(g: CanvasRenderingContext2D, x: number, y: number, reach: number, draw: (g: CanvasRenderingContext2D) => void) {
    for (const M of symMatrices()) {
      const p = M.transformPoint({ x, y });
      for (const [ox, oy] of wrapOffsets(p.x, p.y, reach)) {
        g.setTransform(new DOMMatrix().translate(ox, oy).multiply(M));
        draw(g);
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---- grain du papier (fusain) : motif fixe, ancré sur la tuile
  const grainTile = (() => {
    const S = 128;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d")!;
    const img = g.createImageData(S, S);
    // bruit de valeur lissé, raccordable
    const cells = 32;
    const rnd = new Float32Array(cells * cells).map(() => Math.random());
    const at = (i: number, j: number) => rnd[((j + cells) % cells) * cells + ((i + cells) % cells)];
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const u = (x / S) * cells;
        const v = (y / S) * cells;
        const i = Math.floor(u);
        const j = Math.floor(v);
        const fu = u - i;
        const fv = v - j;
        const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fu;
        const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fu;
        const n = 0.6 * (a + (b - a) * fv) + 0.4 * Math.random();
        img.data[(y * S + x) * 4 + 3] = n > 0.52 ? Math.min(255, Math.round((n - 0.52) * 900)) : 0;
      }
    g.putImageData(img, 0, 0);
    return c;
  })();
  let grainPattern: CanvasPattern | null = null;
  let grainFor = -1;
  const grainFill = (g: CanvasRenderingContext2D, level: number) => {
    if (!grainPattern || grainFor !== level) {
      grainPattern = g.createPattern(grainTile, "repeat");
      grainFor = level;
    }
    grainPattern!.setTransform(new DOMMatrix().scale(2 ** (level - 1)));
    return grainPattern!;
  };

  // ---- formes de tampon
  const shapeTipCache = new Map<string, HTMLCanvasElement>();
  function shapeTip(kind: ShapeKind, filled: boolean): HTMLCanvasElement {
    const key = kind + filled;
    const hit = shapeTipCache.get(key);
    if (hit) return hit;
    const S = 256;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d")!;
    g.translate(S / 2, S / 2);
    const p = new Path2D();
    const poly = (pts: [number, number][]) => { pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); };
    const R = filled ? 122 : 112;
    switch (kind) {
      case "cercle": p.arc(0, 0, R, 0, Math.PI * 2); break;
      case "carre": p.rect(-R * 0.86, -R * 0.86, R * 1.72, R * 1.72); break;
      case "triangle": poly([0, 1, 2].map((i) => [Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / 3) * R, Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / 3) * R * 1.05 + R * 0.15])); break;
      case "etoile": poly(Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? R * 0.42 : R; const a = -Math.PI / 2 + (i * Math.PI) / 5; return [Math.cos(a) * r, Math.sin(a) * r] as [number, number]; })); break;
      case "losange": poly([[0, -R], [R * 0.7, 0], [0, R], [-R * 0.7, 0]]); break;
      case "croix": { const a = R * 0.32; poly([[-a, -R], [a, -R], [a, -a], [R, -a], [R, a], [a, a], [a, R], [-a, R], [-a, a], [-R, a], [-R, -a], [-a, -a]]); break; }
      case "coeur":
        p.moveTo(0, R * 0.95);
        p.bezierCurveTo(-R * 1.25, R * 0.05, -R * 0.75, -R * 1.05, 0, -R * 0.42);
        p.bezierCurveTo(R * 0.75, -R * 1.05, R * 1.25, R * 0.05, 0, R * 0.95);
        p.closePath();
        break;
      case "goutte":
        p.moveTo(0, -R);
        p.bezierCurveTo(R * 0.2, -R * 0.45, R * 0.72, -R * 0.05, R * 0.72, R * 0.32);
        p.arc(0, R * 0.32, R * 0.72, 0, Math.PI);
        p.bezierCurveTo(-R * 0.72, -R * 0.05, -R * 0.2, -R * 0.45, 0, -R);
        p.closePath();
        break;
      case "fleur":
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3;
          p.moveTo(Math.cos(a) * R * 0.55 + R * 0.42, Math.sin(a) * R * 0.55);
          p.arc(Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55, R * 0.42, 0, Math.PI * 2);
        }
        p.moveTo(R * 0.4, 0);
        p.arc(0, 0, R * 0.4, 0, Math.PI * 2);
        break;
    }
    if (filled) g.fill(p, "nonzero");
    else {
      g.lineWidth = 16;
      g.lineJoin = "round";
      g.stroke(p);
    }
    shapeTipCache.set(key, c);
    return c;
  }

  /** Masque (encre = noir opaque) depuis une couverture 0..255. */
  function alphaCanvas(alpha: Uint8Array, w: number, hgt: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = hgt;
    const img = new ImageData(w, hgt);
    for (let i = 0; i < w * hgt; i++) img.data[i * 4 + 3] = alpha[i];
    c.getContext("2d")!.putImageData(img, 0, 0);
    return c;
  }

  let textReq = 0;
  async function refreshTextTip() {
    const my = ++textReq;
    const content = textContent.trim() ? textContent : " ";
    const lines = content.split("\n");
    const longest = Math.max(...lines.map((s) => s.length), 1);
    // 100 pt = 35,28 mm ; on rend 200 px par cadratin
    const em = 35.28;
    const l = newElement("texte", { x: 0, y: 0, w: longest * em * 1.1 + 40, h: lines.length * em * 1.3 + 30 });
    l.text = { ...l.text!, content, font: textFont, size: 100, align: "centre", vAlign: "milieu" };
    try {
      const r = await client.raster(store.doc, l, 200 / em, true);
      if (my !== textReq) return;
      textTip = r.w > 1 ? alphaCanvas(r.alpha, r.w, r.h) : null;
      drawOverlay(null);
    } catch (e) {
      toast("Texte", "Rendu impossible : " + (e instanceof Error ? e.message : String(e)), "err");
    }
  }

  async function loadObjectTip() {
    const l = store.doc.layers.find((x) => x.id === objId && isElement(x));
    if (!l?.box) return;
    try {
      const r = await client.raster(store.doc, l, 512 / Math.max(l.box.w, l.box.h), true);
      objTip = r.w > 1 ? alphaCanvas(r.alpha, r.w, r.h) : null;
      if (!objTip) toast("Objet vide", "Cet objet n'a pas d'encre à prendre.", "info");
      drawOverlay(null);
    } catch (e) {
      toast("Objet", "Rendu impossible : " + (e instanceof Error ? e.message : String(e)), "err");
    }
  }

  async function importLogo() {
    const f = await pickFile(".svg,image/svg+xml,image/*");
    if (!f) return;
    try {
      let src: CanvasImageSource;
      let w: number;
      let hgt: number;
      if (f.type === "image/svg+xml" || /\.svg$/i.test(f.name)) {
        // le navigateur dessine le SVG ; on le rastérise net à 1024 px
        const url = URL.createObjectURL(f);
        const img = new Image();
        await new Promise<void>((ok, ko) => { img.onload = () => ok(); img.onerror = () => ko(new Error("SVG illisible")); img.src = url; });
        const k = 1024 / Math.max(img.naturalWidth || 1024, img.naturalHeight || 1024);
        w = Math.max(1, Math.round((img.naturalWidth || 1024) * k));
        hgt = Math.max(1, Math.round((img.naturalHeight || 1024) * k));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = hgt;
        c.getContext("2d")!.drawImage(img, 0, 0, w, hgt);
        URL.revokeObjectURL(url);
        src = c;
      } else {
        const d = await decodeImage(f, 1024);
        w = d.width;
        hgt = d.height;
        const c = document.createElement("canvas");
        c.width = w;
        c.height = hgt;
        c.getContext("2d")!.putImageData(new ImageData(d.rgba as Uint8ClampedArray<ArrayBuffer>, w, hgt), 0, 0);
        src = c;
      }
      // encre = sombre et opaque (le blanc et le transparent restent papier)
      const c = document.createElement("canvas");
      c.width = w;
      c.height = hgt;
      const g = c.getContext("2d")!;
      g.drawImage(src, 0, 0);
      const px = g.getImageData(0, 0, w, hgt);
      const alpha = new Uint8Array(w * hgt);
      for (let i = 0; i < w * hgt; i++) {
        const lum = (0.2126 * px.data[i * 4] + 0.7152 * px.data[i * 4 + 1] + 0.0722 * px.data[i * 4 + 2]) / 255;
        alpha[i] = Math.round((1 - lum) * px.data[i * 4 + 3]);
      }
      imageTip = alphaCanvas(alpha, w, hgt);
      imageName = f.name;
      stampSrc = "image";
      setTool("tampon");
      toast("Logo prêt", "Clique sur la tuile pour le poser, ou « Poser au centre, en grand ». Puis dessine par-dessus.", "ok", 7000);
    } catch (e) {
      toast("Logo illisible", e instanceof Error ? e.message : "Formats acceptés : SVG, PNG, JPG, WebP.", "err");
    }
  }

  /** Empreinte du tampon ou du texte, ou null s'il n'y en a pas encore. */
  function currentTip(): HTMLCanvasElement | null {
    if (tool === "texte") return textTip;
    if (stampSrc === "image") return imageTip;
    if (stampSrc === "objet") return objTip;
    return shapeTip(shape, cur().filled);
  }

  /** Pose le tampon courant au centre, à `frac` de la tuile (sans symétrie). */
  function centerStamp(frac: number) {
    const tip = currentTip();
    if (!tip) return toast("Rien à poser", tool === "texte" ? "Écris d'abord un texte." : "Choisis d'abord un logo ou un objet.", "info");
    snapshot();
    const k = (N * frac) / Math.max(tip.width, tip.height);
    ctx.save();
    ctx.globalAlpha = cur().opacity / 100;
    ctx.drawImage(tip, (N - tip.width * k) / 2, (N - tip.height * k) / 2, tip.width * k, tip.height * k);
    ctx.restore();
    commitDrawing();
  }

  // ---- empreintes
  interface Pt { x: number; y: number; p: number }
  let dirAngle = 0;
  let strokeDist = 0;

  function radiusAt(p: number) {
    const b = cur();
    return Math.max(0.5, (b.pressure ? b.size * (0.25 + p * 1.1) : b.size) / 2);
  }

  /** Une empreinte de l'outil courant, centrée en (x, y), dans le repère déjà posé par `place`. */
  function drawStamp(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
    const b = cur();
    g.fillStyle = "#000";
    g.strokeStyle = "#000";
    switch (tool) {
      case "crayon": {
        const s = Math.max(1, Math.round(r * 0.7));
        g.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
        break;
      }
      case "pinceau":
      case "ligne":
      case "gomme": {
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        const hard = Math.min(0.99, b.hardness / 100);
        gr.addColorStop(0, "rgba(0,0,0,1)");
        gr.addColorStop(hard, "rgba(0,0,0,1)");
        gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case "plume":
        g.save();
        g.translate(x, y);
        g.rotate((b.angle * Math.PI) / 180);
        g.scale(1, Math.max(0.03, b.nib / 100));
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fill();
        g.restore();
        break;
      case "feutre":
        g.save();
        g.translate(x, y);
        g.rotate((b.angle * Math.PI) / 180);
        g.fillRect(-r, -r * 0.32, 2 * r, r * 0.64);
        g.restore();
        break;
      case "fusain":
        g.save();
        g.globalAlpha = b.flow / 100;
        g.fillStyle = grainFill(g, b.grain);
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
        g.restore();
        break;
      case "sec": {
        const count = Math.max(5, Math.min(48, Math.round(r / 2)));
        const perp = dirAngle + Math.PI / 2;
        const cx = Math.cos(perp);
        const sy = Math.sin(perp);
        const br = Math.max(0.6, (r / count) * 1.15);
        const seg = Math.max(2, r * 0.5);
        const k = Math.floor(strokeDist / seg);
        const t = strokeDist / seg - k;
        for (let i = 0; i < count; i++) {
          const o = ((i + 0.5) / count) * 2 - 1;
          // chaque poil a son propre « manque d'encre », lissé le long du geste
          const n = hashN(i, k) * (1 - t) + hashN(i, k + 1) * t;
          if (n < (b.dryness / 100) * 0.9 + o * o * 0.25) continue;
          g.beginPath();
          g.arc(x + cx * o * r, y + sy * o * r, br, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case "aero": {
        const count = Math.ceil(r * 0.9 * (b.flow / 50));
        g.save();
        g.globalAlpha = 0.5;
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2;
          const rr = Math.sqrt(Math.random()) * r;
          g.beginPath();
          g.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, Math.max(0.6, N / 1024), 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
        break;
      }
      case "points": {
        const count = Math.max(1, Math.round(b.flow / 25));
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2;
          const rr = Math.sqrt(Math.random()) * r;
          g.beginPath();
          g.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, Math.max(1, r * 0.16), 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case "eclabous": {
        const drops = 2 + Math.floor(Math.random() * 5);
        for (let i = 0; i < drops; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = r * (0.15 + 2.6 * Math.random() ** 2) * (b.scatter / 100);
          const big = Math.random() ** 3;
          const dr = Math.max(0.8, r * (0.05 + 0.4 * big) * (1 + (Math.random() - 0.5) * (b.jitter / 100)));
          g.save();
          g.translate(x + Math.cos(a) * d, y + Math.sin(a) * d);
          g.rotate(a);
          if (Math.random() < 0.3) g.scale(1.9, 0.6);
          g.beginPath();
          g.arc(0, 0, dr, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
        break;
      }
      case "hachures": {
        g.lineWidth = b.lineW;
        g.lineCap = "butt";
        const one = (deg: number) => {
          const a = (deg * Math.PI) / 180;
          g.beginPath();
          g.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
          g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
          g.stroke();
        };
        one(b.angle);
        if (b.cross) one(b.angle + 90);
        break;
      }
      case "tampon":
      case "texte": {
        const tip = currentTip();
        if (!tip) break;
        const sz = r * 2 * (1 + (Math.random() - 0.5) * (b.jitter / 100));
        const k = sz / Math.max(tip.width, tip.height);
        const sa = Math.random() * Math.PI * 2;
        const sd = Math.random() * r * 2 * (b.scatter / 100);
        const rot = ((b.angle + (Math.random() - 0.5) * 360 * (b.spin / 100)) * Math.PI) / 180;
        g.save();
        g.translate(x + Math.cos(sa) * sd, y + Math.sin(sa) * sd);
        g.rotate(rot);
        g.drawImage(tip, (-tip.width * k) / 2, (-tip.height * k) / 2, tip.width * k, tip.height * k);
        g.restore();
        break;
      }
    }
  }
  const hashN = (i: number, k: number) => {
    let hh = Math.imul(i + 1, 0x27d4eb2d) ^ Math.imul(k + 7, 0x165667b1);
    hh = Math.imul(hh ^ (hh >>> 15), 0x85ebca6b);
    hh ^= hh >>> 13;
    return (hh >>> 0) / 4294967296;
  };

  /** Distance entre deux empreintes, selon l'outil. */
  function spacingFor(r: number): number {
    const b = cur();
    switch (tool) {
      case "crayon": return Math.max(0.7, r * 0.4);
      case "plume": return Math.max(0.5, r * 0.08);
      case "feutre": return Math.max(0.7, r * 0.12);
      case "fusain": return Math.max(1, r * 0.3);
      case "sec": return Math.max(0.7, r * 0.12);
      case "aero": return Math.max(1, r * 0.7);
      case "points": return Math.max(1, r * 0.5);
      case "eclabous": return Math.max(2, r * 1.6);
      case "hachures": return Math.max(1, b.spacing);
      case "tampon":
      case "texte": return Math.max(2, r * 2 * (b.spacing / 100));
      default: return Math.max(0.7, r * 0.36);
    }
  }

  /** Une empreinte posée sur sa cible (trait en cours, ou tuile pour la gomme et le flou). */
  function stampAt(x: number, y: number, p: number) {
    const r = radiusAt(p);
    if (tool === "flou") return blurAt(x, y, r);
    if (tool === "gomme") {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = cur().opacity / 100;
      place(ctx, x, y, r, (g) => drawStamp(g, x, y, r));
      ctx.restore();
      return;
    }
    const reach = tool === "eclabous" ? r * 4 : tool === "tampon" || tool === "texte" ? r * (2 + cur().scatter / 50) : r * 1.2;
    place(lctx, x, y, reach, (g) => drawStamp(g, x, y, r));
  }

  let last: Pt | null = null;
  let carry = 0;
  function strokeTo(pt: Pt) {
    if (!last) {
      stampAt(pt.x, pt.y, pt.p);
      last = pt;
      carry = 0;
      return;
    }
    const dx = pt.x - last.x;
    const dy = pt.y - last.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) return;
    dirAngle = Math.atan2(dy, dx);
    const step = spacingFor(radiusAt(pt.p));
    let d = step - carry;
    while (d <= dist) {
      const t = d / dist;
      strokeDist += step;
      stampAt(last.x + dx * t, last.y + dy * t, last.p + (pt.p - last.p) * t);
      d += step;
    }
    carry = dist - (d - step);
    last = pt;
  }

  /** Flou local (canal d'encre), avec atténuation vers le bord du pinceau. */
  function blurAt(x: number, y: number, r: number) {
    const force = cur().flow / 100;
    for (const M of symMatrices()) {
      const p = M.transformPoint({ x, y });
      const x0 = Math.max(0, Math.floor(p.x - r));
      const y0 = Math.max(0, Math.floor(p.y - r));
      const x1 = Math.min(N, Math.ceil(p.x + r));
      const y1 = Math.min(N, Math.ceil(p.y + r));
      const w = x1 - x0;
      const hh = y1 - y0;
      if (w < 3 || hh < 3) continue;
      const img = ctx.getImageData(x0, y0, w, hh);
      const a = new Float32Array(w * hh);
      for (let i = 0; i < w * hh; i++) a[i] = img.data[i * 4 + 3];
      const k = Math.max(1, Math.round(r * 0.12));
      const tmp = new Float32Array(w * hh);
      for (let pass = 0; pass < 2; pass++) {
        for (let yy = 0; yy < hh; yy++)
          for (let xx = 0; xx < w; xx++) {
            let s = 0;
            let c = 0;
            for (let d = -k; d <= k; d++) {
              const q = xx + d;
              if (q >= 0 && q < w) { s += a[yy * w + q]; c++; }
            }
            tmp[yy * w + xx] = s / c;
          }
        for (let yy = 0; yy < hh; yy++)
          for (let xx = 0; xx < w; xx++) {
            let s = 0;
            let c = 0;
            for (let d = -k; d <= k; d++) {
              const q = yy + d;
              if (q >= 0 && q < hh) { s += tmp[q * w + xx]; c++; }
            }
            a[yy * w + xx] = s / c;
          }
      }
      for (let yy = 0; yy < hh; yy++)
        for (let xx = 0; xx < w; xx++) {
          const dd = Math.hypot(x0 + xx + 0.5 - p.x, y0 + yy + 0.5 - p.y) / r;
          if (dd >= 1) continue;
          const t = force * (1 - dd);
          const i = yy * w + xx;
          img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 0;
          img.data[i * 4 + 3] = Math.round(img.data[i * 4 + 3] + (a[i] - img.data[i * 4 + 3]) * t);
        }
      ctx.putImageData(img, x0, y0);
    }
  }

  /** Pot de peinture : remplit la zone de même encre autour du point (raccordable si besoin). */
  function floodFill(sx: number, sy: number) {
    const img = ctx.getImageData(0, 0, N, N);
    const d = img.data;
    const fillA = Math.round((cur().opacity / 100) * 255);
    const tol = (cur().tolerance / 100) * 255;
    const seen = new Uint8Array(N * N);
    const stack = new Int32Array(N * N);
    for (const M of symMatrices()) {
      const p = M.transformPoint({ x: sx, y: sy });
      const x0 = Math.floor(p.x);
      const y0 = Math.floor(p.y);
      if (x0 < 0 || y0 < 0 || x0 >= N || y0 >= N) continue;
      const start = y0 * N + x0;
      if (seen[start]) continue;
      const seed = d[start * 4 + 3];
      let sp = 0;
      seen[start] = 1;
      stack[sp++] = start;
      while (sp) {
        const i = stack[--sp];
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 0;
        d[i * 4 + 3] = Math.max(d[i * 4 + 3], fillA);
        const x = i % N;
        const y = (i - x) / N;
        const nb = [
          x > 0 ? i - 1 : wrap ? i + N - 1 : -1,
          x < N - 1 ? i + 1 : wrap ? i - N + 1 : -1,
          y > 0 ? i - N : wrap ? i + N * (N - 1) : -1,
          y < N - 1 ? i + N : wrap ? i - N * (N - 1) : -1,
        ];
        for (const n of nb) {
          if (n < 0 || seen[n]) continue;
          if (Math.abs(d[n * 4 + 3] - seed) > tol) continue;
          seen[n] = 1;
          stack[sp++] = n;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Rectangle ou ellipse (et ligne) dessinés d'un coup dans le trait en cours. */
  function shapeInto(g: CanvasRenderingContext2D, a: Pt, b: Pt, e: { shiftKey: boolean; altKey: boolean }) {
    let w = b.x - a.x;
    let hh = b.y - a.y;
    if (e.shiftKey) {
      const m = Math.max(Math.abs(w), Math.abs(hh));
      w = Math.sign(w || 1) * m;
      hh = Math.sign(hh || 1) * m;
    }
    let x0 = a.x;
    let y0 = a.y;
    if (e.altKey) {
      x0 -= w;
      y0 -= hh;
      w *= 2;
      hh *= 2;
    }
    const cx = x0 + w / 2;
    const cy = y0 + hh / 2;
    const reach = Math.max(Math.abs(w), Math.abs(hh)) / 2 + cur().size;
    place(g, cx, cy, reach, (gg) => {
      gg.beginPath();
      if (tool === "rect") gg.rect(Math.min(x0, x0 + w), Math.min(y0, y0 + hh), Math.abs(w), Math.abs(hh));
      else gg.ellipse(cx, cy, Math.abs(w) / 2, Math.abs(hh) / 2, 0, 0, Math.PI * 2);
      gg.fillStyle = gg.strokeStyle = "#000";
      gg.lineWidth = cur().size;
      gg.lineJoin = "round";
      if (cur().filled) gg.fill();
      else gg.stroke();
    });
  }

  const lineEnd = (a: Pt, b: Pt, shift: boolean): Pt => {
    if (!shift) return b;
    const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 12)) * (Math.PI / 12);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len, p: b.p };
  };

  // ---- gestes
  let drawing = false;
  let start: Pt | null = null;

  const toTile = (e: PointerEvent): Pt => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * N, y: ((e.clientY - r.top) / r.height) * N, p: e.pointerType === "mouse" ? 0.6 : e.pressure || 0.5 };
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const pt = toTile(e);
    if (tool === "pot") {
      snapshot();
      floodFill(pt.x, pt.y);
      commitDrawing();
      return;
    }
    if ((tool === "tampon" || tool === "texte") && !currentTip()) {
      toast("Rien à poser", tool === "texte" ? "Écris un texte dans le panneau de droite." : stampSrc === "image" ? "Importe d'abord un logo (bouton ⤓)." : "Choisis un objet de la page.", "info");
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    snapshot();
    drawing = true;
    strokeDist = 0;
    live.style.opacity = BUFFERED.has(tool) ? String(cur().opacity / 100) : "1";
    lctx.clearRect(0, 0, N, N);
    start = pt;
    last = null;
    if (tool !== "ligne" && tool !== "rect" && tool !== "ellipse") strokeTo(pt);
  });

  canvas.addEventListener("pointermove", (e) => {
    const pt = toTile(e);
    if (!drawing) return drawOverlay(pt);
    if ((tool === "ligne" || tool === "rect" || tool === "ellipse") && start) {
      lctx.clearRect(0, 0, N, N);
      if (tool === "ligne") {
        const end = lineEnd(start, pt, e.shiftKey);
        last = null;
        strokeDist = 0;
        strokeTo({ ...start, p: 0.6 });
        strokeTo({ ...end, p: 0.6 });
      } else shapeInto(lctx, start, pt, e);
      return;
    }
    // les événements « fusionnés » donnent un trait fluide avec une tablette ; liste vide sur certains navigateurs
    const merged = e.getCoalescedEvents?.() ?? [];
    for (const ce of merged.length ? merged : [e]) strokeTo(toTile(ce));
  });

  const end = () => {
    if (!drawing) return;
    drawing = false;
    if (BUFFERED.has(tool)) {
      ctx.save();
      ctx.globalAlpha = cur().opacity / 100;
      ctx.drawImage(live, 0, 0);
      ctx.restore();
      lctx.clearRect(0, 0, N, N);
    }
    last = null;
    start = null;
    commitDrawing();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", () => { if (!drawing) drawOverlay(null); });

  /** Guides de symétrie et aperçu de l'outil sous le curseur. */
  function drawOverlay(pt: Pt | null) {
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.clearRect(0, 0, N, N);
    const lw = Math.max(1, N / 512);
    gctx.strokeStyle = "rgba(0,166,255,.55)";
    gctx.lineWidth = lw;
    gctx.setLineDash([6 * lw, 6 * lw]);
    const c = N / 2;
    const ray = (deg: number) => { const a = (deg * Math.PI) / 180; gctx.beginPath(); gctx.moveTo(c, c); gctx.lineTo(c + Math.cos(a) * N, c + Math.sin(a) * N); gctx.stroke(); };
    if (sym === "x" || sym === "xy") { gctx.beginPath(); gctx.moveTo(c, 0); gctx.lineTo(c, N); gctx.stroke(); }
    if (sym === "y" || sym === "xy") { gctx.beginPath(); gctx.moveTo(0, c); gctx.lineTo(N, c); gctx.stroke(); }
    const rads = sym === "rad4" ? 4 : sym === "rad6" ? 6 : sym === "rad8" ? 8 : sym === "kaleido" ? 12 : 0;
    for (let k = 0; k < rads; k++) ray((360 / rads) * k - 90);
    gctx.setLineDash([]);
    if (!pt || tool === "pot") return;
    gctx.strokeStyle = "rgba(255,0,144,.8)";
    gctx.lineWidth = lw;
    const b = cur();
    if (tool === "tampon" || tool === "texte") {
      const tip = currentTip();
      if (!tip) return;
      const k = b.size / Math.max(tip.width, tip.height);
      gctx.save();
      gctx.globalAlpha = 0.45;
      gctx.translate(pt.x, pt.y);
      gctx.rotate((b.angle * Math.PI) / 180);
      gctx.drawImage(tip, (-tip.width * k) / 2, (-tip.height * k) / 2, tip.width * k, tip.height * k);
      gctx.restore();
      return;
    }
    const r = tool === "rect" || tool === "ellipse" ? 4 * lw : b.size / 2;
    gctx.beginPath();
    if (tool === "plume" || tool === "feutre") {
      gctx.save();
      gctx.translate(pt.x, pt.y);
      gctx.rotate((b.angle * Math.PI) / 180);
      if (tool === "plume") gctx.ellipse(0, 0, r, Math.max(lw, r * (b.nib / 100)), 0, 0, Math.PI * 2);
      else gctx.rect(-r, -r * 0.32, 2 * r, r * 0.64);
      gctx.restore();
    } else gctx.arc(pt.x, pt.y, Math.max(lw, r), 0, Math.PI * 2);
    gctx.stroke();
  }

  // ---- historique
  function snapshot() {
    undo.push(ctx.getImageData(0, 0, N, N));
    // ~320 Mo au plus : 80 étapes en 1024 px, 20 en 2048 px
    const max = Math.max(6, Math.min(80, Math.floor((320 * 1024 * 1024) / (N * N * 4))));
    while (undo.length > max) undo.shift();
    redo = [];
  }
  function undoStroke() {
    const prev = undo.pop();
    if (!prev) return;
    redo.push(ctx.getImageData(0, 0, N, N));
    ctx.putImageData(prev, 0, 0);
    commitDrawing();
  }
  function redoStroke() {
    const next = redo.pop();
    if (!next) return;
    undo.push(ctx.getImageData(0, 0, N, N));
    ctx.putImageData(next, 0, 0);
    commitDrawing();
  }
  function invert() {
    const img = ctx.getImageData(0, 0, N, N);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
      img.data[i + 3] = 255 - img.data[i + 3];
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---- synchronisation avec le document
  function currentAsset(): Asset {
    const data = ctx.getImageData(0, 0, N, N).data;
    return { id: assetId, kind: "dessin", name: "Dessin", width: N, height: N, rgba: new Uint8ClampedArray(data) };
  }

  let pushTimer = 0;
  function commitDrawing() {
    rev++;
    params.rev = rev;
    registerAsset(currentAsset());
    updateCaption();
    changed(true);
  }

  /** Les curseurs ou le dessin ont changé : aperçu de l'atelier + couche ou objet lié. */
  function changed(commit: boolean) {
    clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => miniPreview(), 30);
    const mode = linkMode();
    if (!mode) return;
    const snap = { ...params };
    store.update((d) => {
      const l = d.layers.find((x) => x.id === d.activeLayerId);
      if (!l) return;
      if (mode === "objet" && l.image) l.image = { ...l.image, dessin: snap };
      else if (mode === "couche" && l.source.type === "dessin") l.source.params = snap;
    }, { live: !commit, origin: "atelier" });
  }

  async function miniPreview() {
    if (!store.assets.has(assetId)) return;
    const res = await client.dessin(assetId, params, 220, linkMode() === "objet" ? 1 : 2.5);
    if (!res) return;
    mini.getContext("2d")!.putImageData(new ImageData(res.rgba as Uint8ClampedArray<ArrayBuffer>, res.w, res.h), 0, 0);
  }

  function applyToLayer() {
    if (!store.assets.has(assetId)) commitDrawing();
    const snap = { ...params };
    store.update((d) => {
      const l = d.layers.find((x) => x.id === d.activeLayerId);
      if (!l) return;
      l.source = { type: "dessin", params: snap, assetId };
      // un objet se remplit alors de la matière dessinée
      if (isElement(l)) l.fill = { ...(l.fill ?? { tint: 100 }), mode: "texture" };
    });
    renderSide();
  }

  function applyToNewLayer() {
    if (!store.assets.has(assetId)) commitDrawing();
    const l = newLayer("dessin", "Dessin", store.doc.layers.length);
    l.source = { type: "dessin", params: { ...params }, assetId };
    // en tons directs, garder l'encre du calque actif : pas de plaque (ni de passage riso) en plus sans le vouloir
    const act = store.layer;
    if (act && store.doc.settings.mode === "directs") l.ink = { ...act.ink, cmyk: [...act.ink.cmyk] as Layer["ink"]["cmyk"] };
    store.update((d) => {
      // une texture s'insère sous les objets de mise en page
      let at = d.layers.length;
      while (at > 0 && isElement(d.layers[at - 1])) at--;
      d.layers.splice(at, 0, l);
      d.activeLayerId = l.id;
    });
    renderSide();
  }

  /** Le dessin devient un objet de la page (posé une fois, déplaçable comme un logo). */
  function placeAsObject() {
    if (!store.assets.has(assetId)) commitDrawing();
    const d = store.doc;
    const side0 = Math.round(Math.min(d.settings.widthMm, d.settings.heightMm) * 0.5);
    const l: Layer = newElement("image", { x: (d.settings.widthMm - side0) / 2, y: (d.settings.heightMm - side0) / 2, w: side0, h: side0 });
    l.name = "Dessin";
    l.assetId = assetId;
    l.image = { fit: "contenir", dessin: { ...params } };
    const act = store.layer;
    if (act && d.settings.mode === "directs") l.ink = { ...act.ink, cmyk: [...act.ink.cmyk] as Layer["ink"]["cmyk"] };
    store.update((dd) => {
      dd.layers.push(l);
      dd.activeLayerId = l.id;
    });
    wrap = false;
    renderSide();
    toast("Dessin posé", "C'est maintenant un objet de la page : déplace-le, redimensionne-le, donne-lui une encre. Chaque trait continue de s'y voir.", "ok", 8000);
  }

  /** Charge le dessin de la couche active (texture dessinée) ou de l'objet actif (objet dessiné). */
  function loadFromLayer() {
    const l = store.layer;
    if (!l) return;
    let a: Asset | undefined;
    let p: Params | undefined;
    let objet = false;
    if (kindOf(l) === "image" && l.image?.dessin && l.assetId) {
      a = store.assets.get(l.assetId);
      p = l.image.dessin;
      objet = true;
    } else if (l.source.type === "dessin" && (!isElement(l) || l.fill?.mode === "texture")) {
      p = l.source.params;
      if (!l.source.assetId) {
        params = { ...defaultDessinParams(), ...p };
        assetId = uid("dessin");
        commitDrawing();
        applyToLayer();
        return;
      }
      a = store.assets.get(l.source.assetId);
    } else return;
    params = { ...defaultDessinParams(), ...p };
    if (a?.rgba && a.id !== assetId) {
      assetId = a.id;
      setN(a.width, false);
      ctx.clearRect(0, 0, N, N);
      ctx.putImageData(new ImageData(new Uint8ClampedArray(a.rgba), a.width, a.height), 0, 0);
      undo = [];
      redo = [];
      wrap = !objet;
    }
    rev = Number(params.rev) || 0;
    updateCaption();
    renderSide();
    miniPreview();
  }

  // ---- IA
  function variation() {
    lastAi = { before: { ...params } };
    for (const s of DESSIN_SLIDERS) {
      if (s.key === "echelle" || s.key === "direction") continue;
      const span = s.max - s.min;
      params[s.key] = Math.min(s.max, Math.max(s.min, Math.round((Number(params[s.key]) + (Math.random() - 0.5) * span * 0.25) / s.step) * s.step));
    }
    params.graine = Math.floor(Math.random() * 9999) + 1;
    changed(true);
    renderSide();
    renderAi();
  }

  async function runAi() {
    if (aiBusy) return;
    if (!store.assets.has(assetId)) commitDrawing();
    lastAi = { before: { ...params } };
    aiBusy = true;
    renderAi();
    let sug: AiSuggestion;
    try {
      const st = aiStatus.online ? aiStatus : (aiStatus = await probe());
      const model = st.models.find((m) => m.name === aiConfig.model) ?? st.models[0];
      if (st.online && model) {
        const png = smallPng();
        sug = await askModel(model.name, prompt.value, png, stripForAi(params), model.vision);
      } else sug = interpret(prompt.value, params);
    } catch (e) {
      toast("IA locale", "Échec : " + (e instanceof Error ? e.message : String(e)) + ". Passage en mode règles.", "err");
      sug = interpret(prompt.value, params);
    }
    aiBusy = false;
    aiAnswer = sug;
    params = { ...params, ...sug.params, rev: params.rev };
    // d'abord écrire les nouveaux réglages dans la couche, ensuite seulement la trame conseillée
    changed(true);
    if (sug.trame && store.doc.settings.mode === "directs" && linkMode()) {
      const t = sug.trame;
      store.update((d) => {
        const l = d.layers.find((x) => x.id === d.activeLayerId);
        if (!l) return;
        const key = inkKey(l.ink);
        const cur = d.spotScreens[key] ?? plateDescs(d).find((p) => p.key === key)?.screen;
        if (cur) d.spotScreens[key] = { ...cur, type: t };
      }, { origin: "atelier" });
    }
    renderSide();
    renderAi();
  }

  const stripForAi = (p: Params) => {
    const out: Params = {};
    for (const s of DESSIN_SLIDERS) out[s.key] = p[s.key];
    out.motif = p.motif;
    return out;
  };

  function smallPng(): string {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 256, 256);
    g.drawImage(canvas, 0, 0, 256, 256);
    return c.toDataURL("image/png").split(",")[1];
  }

  // ---- raccourcis clavier (quand l'atelier est au premier plan)
  win.el.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).matches("input, textarea, select")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) redoStroke();
      else undoStroke();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "[" || e.key === "]") {
      const b = cur();
      b.size = Math.max(1, Math.min(N / 2, Math.round(b.size * (e.key === "]" ? 1.2 : 1 / 1.2))));
      e.preventDefault();
      e.stopPropagation();
      savePrefs();
      renderSide();
      drawOverlay(null);
      return;
    }
    const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
    if (t) {
      // la touche ne doit pas aussi changer l'outil de la Planche
      e.preventDefault();
      e.stopPropagation();
      setTool(t.id);
    }
  });
  win.el.tabIndex = -1;

  win.onShow = () => {
    fit();
    if (skipLoadOnShow) skipLoadOnShow = false;
    else loadFromLayer();
    refreshAi();
  };

  store.on((reason, origin) => {
    if (reason === "doc" && origin !== "atelier" && win.visible) {
      const l = store.layer;
      const drawnObj = l && kindOf(l) === "image" && l.image?.dessin && l.assetId;
      if (drawnObj && l.assetId !== assetId) loadFromLayer();
      else if (!drawnObj && l?.source.type === "dessin" && l.source.assetId && l.source.assetId !== assetId && (!isElement(l) || l.fill?.mode === "texture")) loadFromLayer();
      else if (linkMode()) {
        const src = linkMode() === "objet" ? l.image?.dessin : l.source.params;
        const before = JSON.stringify(params);
        params = { ...defaultDessinParams(), ...src };
        if (JSON.stringify(params) !== before) {
          renderSide();
          miniPreview();
        }
      } else renderSide();
    }
  });

  renderTools();
  renderSide();
  renderAi();
  updateCaption();
  drawOverlay(null);
  fit();

  return {
    async fromObject(layerId: string) {
      const l = store.doc.layers.find((x) => x.id === layerId);
      if (!l || !isElement(l)) return;
      skipLoadOnShow = true;
      win.open();
      assetId = uid("dessin");
      params = defaultDessinParams();
      rev = 0;
      wrap = true;
      ctx.clearRect(0, 0, N, N);
      undo = [];
      redo = [];
      objId = layerId;
      stampSrc = "objet";
      objTip = null;
      setTool("tampon");
      await loadObjectTip();
      if (objTip) centerStamp(0.7);
      else commitDrawing();
      renderSide();
      toast("Motif à partir de « " + l.name + " »", "Dessine par-dessus, puis « + Nouvelle couche » pour le répéter sur la page.", "ok", 8000);
    },
  };
}
