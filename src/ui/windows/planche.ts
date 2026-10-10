// Fenêtre « Planche » : épreuve écran + plan de travail de mise en page (façon InDesign).
// Outils, règles, repères, marges/colonnes, ligne de base, magnétisme, poignées, zoom.
import { h } from "../dom.ts";
import { store } from "../../app/store.ts";
import { client } from "../../app/client.ts";
import { docBox, isElement, kindOf, plateDescs, pxSize } from "../../engine/doc.ts";
import { addElement, addLogo, duplicateLayer } from "../../app/actions.ts";
import { importFontFile, openProject } from "../../app/project.ts";
import { importProfile } from "../../app/profiles.ts";
import { PT_TO_MM } from "../../engine/text.ts";
import { toast } from "../toast.ts";
import { kbd, modKey } from "../platform.ts";
import type { Box, Layer, ShapeType } from "../../engine/types.ts";
import type { Win } from "../wm.ts";

const CSS_PX_PER_MM = 96 / 25.4;
const ZOOMS = [0.125, 0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
const PAD = 44; // marge autour de la page (px), place pour les règles
const RULER = 18;
const MAX_PX = 5e6;

export type Tool = "select" | "texte" | "rect" | "ellipse" | "ligne" | "polygone" | "etoile" | "logo" | "main";

const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: "select", icon: "↖", label: "Sélection", key: "V" },
  { id: "texte", icon: "T", label: "Texte", key: "T" },
  { id: "rect", icon: "▭", label: "Rectangle", key: "M" },
  { id: "ellipse", icon: "◯", label: "Ellipse", key: "L" },
  { id: "ligne", icon: "╱", label: "Ligne", key: "\\" },
  { id: "polygone", icon: "⬠", label: "Polygone", key: "Y" },
  { id: "etoile", icon: "★", label: "Étoile", key: "G" },
  { id: "logo", icon: "◈", label: "Logo / image", key: "K" },
  { id: "main", icon: "✋", label: "Main (déplacer la vue)", key: "H" },
];

export interface PlancheApi {
  refresh(): void;
  /** Centre de la loupe en mm (repère du fond perdu) ou null. */
  loupeAt: { xMm: number; yMm: number } | null;
  onLoupePick?: (xMm: number, yMm: number) => void;
  setLoupeMode(on: boolean, sizeMm?: number): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomFit(): void;
  zoom100(): void;
  setTool(t: Tool): void;
  toolFromKey(key: string): boolean;
  deselect(): void;
  hasSelection(): boolean;
}

type Drag =
  | { type: "move"; id: string; start: { x: number; y: number }; box0: Box }
  | { type: "resize"; id: string; hx: number; hy: number; start: { x: number; y: number }; box0: Box; keep: boolean }
  | { type: "rotate"; id: string; box0: Box; a0: number }
  | { type: "create"; tool: Tool; start: { x: number; y: number }; cur: { x: number; y: number } }
  | { type: "guide"; axis: "v" | "h"; index: number; pos: number }
  | { type: "pan"; sx: number; sy: number; l0: number; t0: number }
  | { type: "click"; x: number; y: number };

export function mountPlanche(win: Win, focusText: { fn?: () => void }): PlancheApi {
  let zoom: "fit" | number = "fit";
  let view = "composite";
  let screened = true;
  let loupeMode = false;
  let loupeSizeMm = 5;
  let cssPerMm = 1;
  let busy = false;
  let lastMs = 0;
  let tool: Tool = "select";
  let selId: string | null = isElement(store.layer) ? store.layer.id : null;
  let drag: Drag | null = null;
  let snapLines: { axis: "v" | "h"; pos: number }[] = [];
  let cursorMm: { x: number; y: number } | null = null;
  let spaceDown = false;
  let rendered = { x0: 0, y0: 0, x1: 0, y1: 0, ppi: 0, zoomKey: "" };
  let tac = 0;
  let tooFine: string[] = [];

  // ---- barre d'outils
  const toolBtns = new Map<Tool, HTMLButtonElement>();
  const toolbox = h("div", { class: "toolbox", role: "toolbar", "aria-label": "Outils" });
  for (const t of TOOLS) {
    const b = h("button", { class: "tool-btn mini", type: "button", title: `${t.label} (${t.key})`, "aria-label": t.label }, t.icon);
    b.addEventListener("click", () => api.setTool(t.id));
    toolBtns.set(t.id, b);
    toolbox.append(b);
  }
  const zoomSel = h("select", { class: "pop", "aria-label": "Zoom" });
  const fillZoom = () => {
    zoomSel.textContent = "";
    zoomSel.append(h("option", { value: "fit" }, "Ajusté"));
    for (const z of ZOOMS) zoomSel.append(h("option", { value: String(z) }, Math.round(z * 100) + " %"));
    if (zoom !== "fit" && !ZOOMS.includes(zoom)) zoomSel.append(h("option", { value: String(zoom) }, Math.round(zoom * 100) + " %"));
    zoomSel.value = String(zoom);
  };
  fillZoom();
  const zoomOutBtn = h("button", { class: "btn small icon", type: "button", title: `Zoom arrière (${kbd("Ctrl+")}−)` }, "−");
  const zoomInBtn = h("button", { class: "btn small icon", type: "button", title: `Zoom avant (${kbd("Ctrl+")}+)` }, "+");
  const viewSel = h("select", { class: "pop", "aria-label": "Affichage" });
  const screenBox = h("input", { type: "checkbox", checked: true });
  const gridBox = h("input", { type: "checkbox", checked: true });
  const snapBox = h("input", { type: "checkbox", checked: store.doc.layout.snap });
  const toolbar = h(
    "div",
    { class: "toolbar" },
    toolbox,
    h("div", { class: "tool" }, zoomOutBtn, zoomSel, zoomInBtn),
    h("label", { class: "tool" }, h("span", null, "Voir"), viewSel),
    h("label", { class: "tool", title: "Montre la vraie trame quand le zoom le permet (sinon : ton continu)." }, screenBox, h("span", null, "Trame")),
    h("label", { class: "tool", title: "Marges, colonnes, repères et cadres des objets." }, gridBox, h("span", null, "Grille")),
    h("label", { class: "tool", title: "Les objets s'aimantent aux marges, colonnes, repères et autres objets." }, snapBox, h("span", null, "Aimant")),
  );
  const canvas = h("canvas", { class: "main", width: 10, height: 10, "aria-label": "Aperçu de la mise en page" });
  const inner = h("div", { class: "stage-inner" }, canvas);
  const stage = h("div", { class: "stage" }, inner);
  const overlay = h("canvas", { class: "overlay", tabindex: "0", "aria-label": "Plan de travail : cliquer pour sélectionner, glisser pour déplacer" });
  const wrap = h("div", { class: "stage-wrap" }, stage, overlay);
  const status = h("div", { class: "statusbar", "aria-live": "polite" });
  win.body.append(toolbar, wrap, status);

  const page = () => store.doc.settings;
  const bleed = () => docBox(store.doc).bleed;
  const origin = () => {
    const ir = inner.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    return { x: ir.left - wr.left + PAD, y: ir.top - wr.top + PAD };
  };
  /** mm (repère du format fini) → px de l'overlay */
  const toScreen = (xMm: number, yMm: number) => {
    const o = origin();
    const b = bleed();
    return { x: o.x + (b + xMm) * cssPerMm, y: o.y + (b + yMm) * cssPerMm };
  };
  const toMm = (sx: number, sy: number) => {
    const o = origin();
    const b = bleed();
    return { x: (sx - o.x) / cssPerMm - b, y: (sy - o.y) / cssPerMm - b };
  };
  const localPoint = (e: { clientX: number; clientY: number }) => {
    const r = overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const elements = () => store.doc.layers.filter((l) => l.visible && isElement(l) && l.box);
  const selLayer = () => (selId ? store.doc.layers.find((l) => l.id === selId && isElement(l) && l.box) ?? null : null);

  // ---- géométrie des objets
  const corners = (b: Box) => {
    const a = (b.rot * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    return [[-b.w / 2, -b.h / 2], [b.w / 2, -b.h / 2], [b.w / 2, b.h / 2], [-b.w / 2, b.h / 2]].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
  };
  const aabb = (b: Box) => {
    const cs = corners(b);
    return { x0: Math.min(...cs.map((p) => p.x)), x1: Math.max(...cs.map((p) => p.x)), y0: Math.min(...cs.map((p) => p.y)), y1: Math.max(...cs.map((p) => p.y)) };
  };
  /** point (mm) → repère local du cadre (origine = coin haut-gauche, non tourné) */
  const toLocal = (b: Box, p: { x: number; y: number }) => {
    const a = (-b.rot * Math.PI) / 180;
    const dx = p.x - (b.x + b.w / 2);
    const dy = p.y - (b.y + b.h / 2);
    return { x: dx * Math.cos(a) - dy * Math.sin(a) + b.w / 2, y: dx * Math.sin(a) + dy * Math.cos(a) + b.h / 2 };
  };
  const handlesOf = (b: Box) => {
    const out: { hx: number; hy: number; x: number; y: number }[] = [];
    for (const hy of [0, 0.5, 1]) for (const hx of [0, 0.5, 1]) if (!(hx === 0.5 && hy === 0.5)) out.push({ hx, hy, x: hx * b.w, y: hy * b.h });
    return out;
  };
  const fromLocal = (b: Box, lx: number, ly: number) => {
    const a = (b.rot * Math.PI) / 180;
    const dx = lx - b.w / 2;
    const dy = ly - b.h / 2;
    return { x: b.x + b.w / 2 + dx * Math.cos(a) - dy * Math.sin(a), y: b.y + b.h / 2 + dx * Math.sin(a) + dy * Math.cos(a) };
  };

  // ---- magnétisme
  function candidates(exclude: string | null) {
    const s = page();
    const L = store.doc.layout;
    const xs = [0, s.widthMm, s.widthMm / 2, L.margins.inside, s.widthMm - L.margins.outside];
    const ys = [0, s.heightMm, s.heightMm / 2, L.margins.top, s.heightMm - L.margins.bottom];
    const cw = s.widthMm - L.margins.inside - L.margins.outside;
    const colW = (cw - (L.columns - 1) * L.gutter) / Math.max(1, L.columns);
    for (let i = 0; i < L.columns; i++) xs.push(L.margins.inside + i * (colW + L.gutter), L.margins.inside + i * (colW + L.gutter) + colW);
    const rh = s.heightMm - L.margins.top - L.margins.bottom;
    const rowH = (rh - (L.rows - 1) * L.rowGutter) / Math.max(1, L.rows);
    for (let i = 0; i < L.rows; i++) ys.push(L.margins.top + i * (rowH + L.rowGutter), L.margins.top + i * (rowH + L.rowGutter) + rowH);
    for (const g of L.guides) (g.axis === "v" ? xs : ys).push(g.pos);
    for (const l of elements()) {
      if (l.id === exclude) continue;
      const a = aabb(l.box!);
      xs.push(a.x0, a.x1, (a.x0 + a.x1) / 2);
      ys.push(a.y0, a.y1, (a.y0 + a.y1) / 2);
    }
    return { xs, ys };
  }
  const tol = () => 6 / cssPerMm;
  /** Cherche le meilleur alignement d'une série de positions sur les candidats. */
  function snap1(values: number[], cands: number[]): { d: number; at: number } | null {
    let best: { d: number; at: number } | null = null;
    for (const v of values)
      for (const c of cands) {
        const d = c - v;
        if (Math.abs(d) <= tol() && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: c };
      }
    return best;
  }
  const snapOn = () => store.doc.layout.snap && !!snapBox.checked;

  // ---- zoom
  const effZoom = () => cssPerMm / CSS_PX_PER_MM;
  function setZoom(z: "fit" | number, anchor?: { sx: number; sy: number }) {
    const wr = wrap.getBoundingClientRect();
    const ax = anchor?.sx ?? wr.width / 2;
    const ay = anchor?.sy ?? wr.height / 2;
    const keep = toMm(ax, ay);
    zoom = z;
    fillZoom();
    layout();
    if (z !== "fit") {
      // garde le point sous le curseur (ou le centre) immobile
      const after = toScreen(keep.x, keep.y);
      stage.scrollLeft += after.x - ax;
      stage.scrollTop += after.y - ay;
    }
    drawOverlay();
    schedule();
  }
  const zoomStep = (dir: 1 | -1, anchor?: { sx: number; sy: number }) => {
    const cur = effZoom();
    const next = dir > 0 ? ZOOMS.find((z) => z > cur * 1.01) ?? ZOOMS[ZOOMS.length - 1] : [...ZOOMS].reverse().find((z) => z < cur * 0.99) ?? ZOOMS[0];
    setZoom(next, anchor);
  };

  function layout() {
    const box = docBox(store.doc);
    if (zoom === "fit") {
      const aw = Math.max(80, stage.clientWidth - 2 * PAD);
      const ah = Math.max(80, stage.clientHeight - 2 * PAD);
      cssPerMm = Math.min(aw / box.wMm, ah / box.hMm);
    } else cssPerMm = zoom * CSS_PX_PER_MM;
    inner.style.width = Math.round(box.wMm * cssPerMm + 2 * PAD) + "px";
    inner.style.height = Math.round(box.hMm * cssPerMm + 2 * PAD) + "px";
  }

  // ---- rendu de l'aperçu (zone visible seulement)
  let timer = 0;
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(render, 40);
  };

  function visibleRegionMm() {
    const box = docBox(store.doc);
    const wr = wrap.getBoundingClientRect();
    const o = origin();
    const x0 = Math.max(0, (0 - o.x) / cssPerMm);
    const y0 = Math.max(0, (0 - o.y) / cssPerMm);
    const x1 = Math.min(box.wMm, (wr.width - o.x) / cssPerMm);
    const y1 = Math.min(box.hMm, (wr.height - o.y) / cssPerMm);
    return { x0, y0, x1: Math.max(x0 + 1, x1), y1: Math.max(y0 + 1, y1), box };
  }

  async function render() {
    if (!win.visible) return;
    fillViews();
    layout();
    const dpr = window.devicePixelRatio || 1;
    const v = visibleRegionMm();
    // on rend un peu plus large que la vue pour pouvoir défiler sans attendre
    const mx = (v.x1 - v.x0) * 0.25;
    const my = (v.y1 - v.y0) * 0.25;
    const r = zoom === "fit"
      ? { x0: 0, y0: 0, x1: v.box.wMm, y1: v.box.hMm }
      : { x0: Math.max(0, v.x0 - mx), y0: Math.max(0, v.y0 - my), x1: Math.min(v.box.wMm, v.x1 + mx), y1: Math.min(v.box.hMm, v.y1 + my) };
    let ppi = cssPerMm * dpr * 25.4;
    const px = pxSize(r.x1 - r.x0, ppi) * pxSize(r.y1 - r.y0, ppi);
    if (px > MAX_PX) ppi *= Math.sqrt(MAX_PX / px);
    const region = { x0: (r.x0 / 25.4) * ppi, y0: (r.y0 / 25.4) * ppi, x1: (r.x1 / 25.4) * ppi, y1: (r.y1 / 25.4) * ppi };
    busy = true;
    paintStatus();
    const t0 = performance.now();
    let res;
    try {
      res = await client.preview(store.doc, { ppi, screened, plate: view, region });
    } catch (e) {
      busy = false;
      status.textContent = "Erreur d'aperçu : " + (e instanceof Error ? e.message : String(e));
      return;
    }
    if (!res) return; // remplacé par une demande plus récente
    busy = false;
    lastMs = performance.now() - t0;
    canvas.width = res.w;
    canvas.height = res.h;
    canvas.getContext("2d")!.putImageData(new ImageData(res.rgba as Uint8ClampedArray<ArrayBuffer>, res.w, res.h), 0, 0);
    const k = cssPerMm * 25.4 / ppi;
    canvas.style.left = PAD + res.x0 * k + "px";
    canvas.style.top = PAD + res.y0 * k + "px";
    canvas.style.width = res.w * k + "px";
    canvas.style.height = res.h * k + "px";
    rendered = { x0: (res.x0 / ppi) * 25.4, y0: (res.y0 / ppi) * 25.4, x1: ((res.x0 + res.w) / ppi) * 25.4, y1: ((res.y0 + res.h) / ppi) * 25.4, ppi, zoomKey: String(zoom) };
    tac = res.tacPeak;
    tooFine = res.tooFine;
    const before = [...store.overflowIds].join("|");
    store.overflowIds = new Set(res.overflow);
    if (before !== res.overflow.join("|")) store.emit("overflow");
    drawOverlay();
    paintStatus();
  }

  stage.addEventListener("scroll", () => {
    drawOverlay();
    if (zoom === "fit") return;
    const v = visibleRegionMm();
    if (v.x0 < rendered.x0 - 0.01 || v.y0 < rendered.y0 - 0.01 || v.x1 > rendered.x1 + 0.01 || v.y1 > rendered.y1 + 0.01) schedule();
  });

  const fillViews = () => {
    const cur = view;
    viewSel.textContent = "";
    viewSel.append(h("option", { value: "composite" }, "Composite"));
    for (const p of plateDescs(store.doc)) viewSel.append(h("option", { value: p.key }, "Plaque " + p.name));
    viewSel.value = [...viewSel.options].some((o) => o.value === cur) ? cur : "composite";
    view = viewSel.value;
  };

  // ---- surcouche : règles, grilles, cadres, poignées
  function drawOverlay() {
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    if (overlay.width !== Math.round(W * dpr) || overlay.height !== Math.round(H * dpr)) {
      overlay.width = Math.round(W * dpr);
      overlay.height = Math.round(H * dpr);
    }
    const g = overlay.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const s = page();
    const L = store.doc.layout;
    const show = gridBox.checked;
    const P = (x: number, y: number) => toScreen(x, y);
    const line = (x0: number, y0: number, x1: number, y1: number) => {
      g.beginPath();
      g.moveTo(Math.round(x0) + 0.5, Math.round(y0) + 0.5);
      g.lineTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
      g.stroke();
    };
    const tl = P(0, 0);
    const br = P(s.widthMm, s.heightMm);
    // format fini
    g.lineWidth = 1;
    g.strokeStyle = "#00a6ff";
    g.strokeRect(Math.round(tl.x) + 0.5, Math.round(tl.y) + 0.5, Math.round(br.x - tl.x), Math.round(br.y - tl.y));
    if (show) {
      if (L.show.baseline) {
        g.strokeStyle = "rgba(0,170,255,.28)";
        const step = L.baselineStep * PT_TO_MM;
        if (step * cssPerMm >= 3) for (let y = L.baselineStart; y <= s.heightMm; y += step) line(tl.x, P(0, y).y, br.x, P(0, y).y);
      }
      if (L.show.margins) {
        g.strokeStyle = "rgba(255,0,170,.85)";
        const a = P(L.margins.inside, L.margins.top);
        const b = P(s.widthMm - L.margins.outside, s.heightMm - L.margins.bottom);
        g.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x), Math.round(b.y - a.y));
      }
      if (L.show.columns && (L.columns > 1 || L.rows > 1)) {
        g.strokeStyle = "rgba(140,80,255,.75)";
        const cw = s.widthMm - L.margins.inside - L.margins.outside;
        const colW = (cw - (L.columns - 1) * L.gutter) / Math.max(1, L.columns);
        for (let i = 1; i < L.columns; i++) {
          const xa = L.margins.inside + i * colW + (i - 1) * L.gutter;
          line(P(xa, 0).x, P(0, L.margins.top).y, P(xa, 0).x, P(0, s.heightMm - L.margins.bottom).y);
          line(P(xa + L.gutter, 0).x, P(0, L.margins.top).y, P(xa + L.gutter, 0).x, P(0, s.heightMm - L.margins.bottom).y);
        }
        const rh = s.heightMm - L.margins.top - L.margins.bottom;
        const rowH = (rh - (L.rows - 1) * L.rowGutter) / Math.max(1, L.rows);
        for (let i = 1; i < L.rows; i++) {
          const ya = L.margins.top + i * rowH + (i - 1) * L.rowGutter;
          line(P(L.margins.inside, 0).x, P(0, ya).y, P(s.widthMm - L.margins.outside, 0).x, P(0, ya).y);
          line(P(L.margins.inside, 0).x, P(0, ya + L.rowGutter).y, P(s.widthMm - L.margins.outside, 0).x, P(0, ya + L.rowGutter).y);
        }
      }
      if (L.show.guides) {
        g.strokeStyle = "rgba(0,190,255,.95)";
        for (const gd of L.guides) {
          if (gd.axis === "v") line(P(gd.pos, 0).x, 0, P(gd.pos, 0).x, H);
          else line(0, P(0, gd.pos).y, W, P(0, gd.pos).y);
        }
      }
    }
    // cadres des objets
    const sel = selLayer();
    for (const l of elements()) {
      const cs = corners(l.box!).map((p) => P(p.x, p.y));
      const isSel = l.id === sel?.id;
      if (!isSel && !(show && L.show.frames)) continue;
      g.setLineDash(isSel ? [] : [3, 3]);
      g.strokeStyle = isSel ? "#0040ff" : "rgba(40,90,255,.6)";
      g.lineWidth = isSel ? 1.5 : 1;
      g.beginPath();
      cs.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.stroke();
      g.setLineDash([]);
      if (store.overflowIds.has(l.id)) {
        const p = cs[2];
        g.fillStyle = "#ff1744";
        g.fillRect(p.x - 9, p.y - 9, 10, 10);
        g.fillStyle = "#fff";
        g.font = "bold 10px Tahoma";
        g.fillText("+", p.x - 7, p.y - 0.5);
      }
    }
    if (sel) {
      const b = sel.box!;
      g.lineWidth = 1;
      for (const hd of handlesOf(b)) {
        const p = P(fromLocal(b, hd.x, hd.y).x, fromLocal(b, hd.x, hd.y).y);
        g.fillStyle = "#fff";
        g.strokeStyle = "#000";
        g.fillRect(Math.round(p.x) - 3.5, Math.round(p.y) - 3.5, 7, 7);
        g.strokeRect(Math.round(p.x) - 3.5, Math.round(p.y) - 3.5, 7, 7);
      }
      const top = fromLocal(b, b.w / 2, 0);
      const rot = fromLocal(b, b.w / 2, -18 / cssPerMm);
      const pt = P(top.x, top.y);
      const pr = P(rot.x, rot.y);
      g.strokeStyle = "#000";
      line(pt.x, pt.y, pr.x, pr.y);
      g.beginPath();
      g.arc(pr.x, pr.y, 4.5, 0, Math.PI * 2);
      g.fillStyle = "#8fdcff";
      g.fill();
      g.stroke();
      if (sel.pinned) {
        g.fillStyle = "#000";
        g.font = "11px Tahoma";
        g.fillText("🔒", pt.x + 8, pt.y - 4);
      }
    }
    // magnétisme
    g.strokeStyle = "#ff00a8";
    g.lineWidth = 1;
    for (const sl of snapLines) {
      if (sl.axis === "v") line(P(sl.pos, 0).x, 0, P(sl.pos, 0).x, H);
      else line(0, P(0, sl.pos).y, W, P(0, sl.pos).y);
    }
    // création en cours / repère en cours
    if (drag?.type === "create") {
      const a = P(Math.min(drag.start.x, drag.cur.x), Math.min(drag.start.y, drag.cur.y));
      const b = P(Math.max(drag.start.x, drag.cur.x), Math.max(drag.start.y, drag.cur.y));
      g.setLineDash([4, 3]);
      g.strokeStyle = "#000";
      g.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y);
      g.setLineDash([]);
    }
    if (drag?.type === "guide") {
      g.strokeStyle = "#00b7ff";
      if (drag.axis === "v") line(P(drag.pos, 0).x, 0, P(drag.pos, 0).x, H);
      else line(0, P(0, drag.pos).y, W, P(0, drag.pos).y);
    }
    // loupe
    if (loupeMode && api.loupeAt) {
      const k = cssPerMm;
      const o = origin();
      const half = (loupeSizeMm / 2) * k;
      const x = o.x + api.loupeAt.xMm * k;
      const y = o.y + api.loupeAt.yMm * k;
      g.lineWidth = 2;
      g.strokeStyle = "#000";
      g.strokeRect(x - half, y - half, half * 2, half * 2);
      g.lineWidth = 1;
      g.strokeStyle = "#fff";
      g.strokeRect(x - half + 1, y - half + 1, half * 2 - 2, half * 2 - 2);
    }
    drawRulers(g, W, H);
  }

  function drawRulers(g: CanvasRenderingContext2D, W: number, H: number) {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, W, RULER);
    g.fillRect(0, 0, RULER, H);
    g.strokeStyle = "#000";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, RULER + 0.5);
    g.lineTo(W, RULER + 0.5);
    g.moveTo(RULER + 0.5, 0);
    g.lineTo(RULER + 0.5, H);
    g.stroke();
    // pas des graduations selon le zoom
    const steps = [1, 2, 5, 10, 20, 50, 100, 200];
    const minor = steps.find((st) => st * cssPerMm >= 6) ?? 200;
    const major = steps.find((st) => st * cssPerMm >= 60) ?? 500;
    g.fillStyle = "#000";
    g.font = "13px VT323, monospace";
    const o0 = toMm(0, 0);
    const o1 = toMm(W, H);
    g.beginPath();
    for (let mm = Math.floor(o0.x / minor) * minor; mm <= o1.x; mm += minor) {
      const x = Math.round(toScreen(mm, 0).x) + 0.5;
      if (x < RULER) continue;
      const big = Math.abs(mm % major) < 1e-6;
      g.moveTo(x, RULER);
      g.lineTo(x, big ? 4 : RULER - 5);
      if (big) g.fillText(String(Math.round(mm)), x + 2, 11);
    }
    for (let mm = Math.floor(o0.y / minor) * minor; mm <= o1.y; mm += minor) {
      const y = Math.round(toScreen(0, mm).y) + 0.5;
      if (y < RULER) continue;
      const big = Math.abs(mm % major) < 1e-6;
      g.moveTo(RULER, y);
      g.lineTo(big ? 4 : RULER - 5, y);
      if (big) {
        g.save();
        g.translate(11, y + 2);
        g.rotate(-Math.PI / 2);
        g.fillText(String(Math.round(mm)), 0, 0);
        g.restore();
      }
    }
    g.stroke();
    if (cursorMm) {
      const c = toScreen(cursorMm.x, cursorMm.y);
      g.strokeStyle = "#ff00a8";
      g.beginPath();
      g.moveTo(Math.round(c.x) + 0.5, 0);
      g.lineTo(Math.round(c.x) + 0.5, RULER);
      g.moveTo(0, Math.round(c.y) + 0.5);
      g.lineTo(RULER, Math.round(c.y) + 0.5);
      g.stroke();
    }
    g.fillStyle = "#fff";
    g.fillRect(0, 0, RULER, RULER);
    g.strokeStyle = "#000";
    g.strokeRect(0.5, 0.5, RULER, RULER);
    g.fillStyle = "#000";
    g.font = "12px VT323, monospace";
    g.fillText("mm", 2, 13);
  }

  function paintStatus() {
    const s = page();
    const box = docBox(store.doc);
    const W = pxSize(box.wMm, s.dpi);
    const H = pxSize(box.hMm, s.dpi);
    const parts: (HTMLElement | string)[] = [
      h("span", null, `${s.widthMm} × ${s.heightMm} mm + ${s.bleedMm} mm fond perdu`),
      h("span", { class: "expert-inline" }, `Sortie ${s.dpi} dpi = ${W.toLocaleString("fr-FR")} × ${H.toLocaleString("fr-FR")} px`),
      h("span", { class: tac > s.tacMax ? "warn" : "" }, `Encrage ${Math.round(tac)} %` + (tac > s.tacMax ? ` → limité à ${s.tacMax} %` : "")),
      h("span", null, busy ? "⌛ calcul…" : `${Math.round(effZoom() * 100)} % · ${Math.round(lastMs)} ms`),
    ];
    if (cursorMm) parts.push(h("span", null, `X ${cursorMm.x.toFixed(1).replace(".", ",")} · Y ${cursorMm.y.toFixed(1).replace(".", ",")} mm`));
    if (store.overflowIds.size) parts.push(h("span", { class: "warn" }, `Texte en excès (${store.overflowIds.size}) : agrandissez le cadre`));
    if (screened && tooFine.length) parts.push(h("span", { class: "warn" }, `Trame trop fine à ce zoom (${tooFine.join(", ")}) : zoomez ou ouvrez la Loupe`));
    status.replaceChildren(...parts);
  }

  // ---- interactions
  const updateBox = (id: string, b: Box) =>
    store.update((d) => {
      const l = d.layers.find((x) => x.id === id);
      if (l?.box) l.box = { ...b };
    }, { live: true, origin: "planche" });

  function hitElement(p: { x: number; y: number }): Layer | null {
    const t = 4 / cssPerMm;
    const els = elements();
    for (let i = els.length - 1; i >= 0; i--) {
      const b = els[i].box!;
      const q = toLocal(b, p);
      if (q.x >= -t && q.y >= -t && q.x <= b.w + t && q.y <= b.h + t) return els[i];
    }
    return null;
  }
  function hitHandle(l: Layer, sp: { x: number; y: number }): { hx: number; hy: number } | "rot" | null {
    const b = l.box!;
    const rot = fromLocal(b, b.w / 2, -18 / cssPerMm);
    const pr = toScreen(rot.x, rot.y);
    if (Math.hypot(pr.x - sp.x, pr.y - sp.y) <= 7) return "rot";
    for (const hd of handlesOf(b)) {
      const q = fromLocal(b, hd.x, hd.y);
      const pq = toScreen(q.x, q.y);
      if (Math.abs(pq.x - sp.x) <= 6 && Math.abs(pq.y - sp.y) <= 6) return { hx: hd.hx, hy: hd.hy };
    }
    return null;
  }
  function hitGuide(sp: { x: number; y: number }): number {
    const L = store.doc.layout;
    if (!L.show.guides || !gridBox.checked) return -1;
    return L.guides.findIndex((g) => (g.axis === "v" ? Math.abs(toScreen(g.pos, 0).x - sp.x) <= 4 : Math.abs(toScreen(0, g.pos).y - sp.y) <= 4));
  }

  overlay.addEventListener("pointerdown", (e) => {
    overlay.focus({ preventScroll: true });
    const sp = localPoint(e);
    const p = toMm(sp.x, sp.y);
    overlay.setPointerCapture(e.pointerId);
    // règles → nouveau repère
    if (sp.y < RULER && sp.x > RULER) return void (drag = { type: "guide", axis: "h", index: -1, pos: p.y });
    if (sp.x < RULER && sp.y > RULER) return void (drag = { type: "guide", axis: "v", index: -1, pos: p.x });
    if (tool === "main" || spaceDown || e.button === 1) return void (drag = { type: "pan", sx: e.clientX, sy: e.clientY, l0: stage.scrollLeft, t0: stage.scrollTop });
    if (tool === "logo") {
      api.setTool("select");
      addLogo(null, p).then((r) => r?.warnings.length && toast("Logo importé", r.warnings.join(" "), "info", 9000)).catch((err) => toast("Logo illisible", String(err?.message ?? err), "err"));
      return;
    }
    if (tool !== "select") {
      const sp0 = snapOn() ? snapPoint(p) : p;
      drag = { type: "create", tool, start: sp0, cur: sp0 };
      return;
    }
    const sel = selLayer();
    if (sel && !sel.pinned) {
      const hh = hitHandle(sel, sp);
      if (hh === "rot") {
        const b = sel.box!;
        return void (drag = { type: "rotate", id: sel.id, box0: { ...b }, a0: Math.atan2(p.y - (b.y + b.h / 2), p.x - (b.x + b.w / 2)) });
      }
      if (hh) return void (drag = { type: "resize", id: sel.id, hx: hh.hx, hy: hh.hy, start: p, box0: { ...sel.box! }, keep: e.shiftKey });
    }
    const hit = hitElement(p);
    if (hit) {
      let id = hit.id;
      if (e.altKey && !hit.pinned) {
        duplicateLayer(hit.id);
        id = store.doc.activeLayerId;
      }
      selId = id;
      store.select(id);
      const l = store.doc.layers.find((x) => x.id === id)!;
      drag = l.pinned ? { type: "click", x: sp.x, y: sp.y } : { type: "move", id, start: p, box0: { ...l.box! } };
      drawOverlay();
      return;
    }
    const gi = hitGuide(sp);
    if (gi >= 0) {
      const gd = store.doc.layout.guides[gi];
      return void (drag = { type: "guide", axis: gd.axis, index: gi, pos: gd.pos });
    }
    selId = null;
    drag = { type: "click", x: sp.x, y: sp.y };
    drawOverlay();
  });

  function snapPoint(p: { x: number; y: number }) {
    const c = candidates(null);
    const sx = snap1([p.x], c.xs);
    const sy = snap1([p.y], c.ys);
    snapLines = [];
    if (sx) snapLines.push({ axis: "v", pos: sx.at });
    if (sy) snapLines.push({ axis: "h", pos: sy.at });
    return { x: p.x + (sx?.d ?? 0), y: p.y + (sy?.d ?? 0) };
  }

  overlay.addEventListener("pointermove", (e) => {
    const sp = localPoint(e);
    const p = toMm(sp.x, sp.y);
    cursorMm = p;
    if (!drag) {
      // curseur selon ce qui est survolé
      let cur = "var(--cur-arrow)";
      if ((sp.y < RULER) !== (sp.x < RULER)) cur = sp.y < RULER ? "row-resize" : "col-resize";
      else if (tool === "main" || spaceDown) cur = "var(--cur-hand)";
      else if (tool !== "select") cur = "var(--cur-cross)";
      else {
        const sel = selLayer();
        const hh = sel && !sel.pinned ? hitHandle(sel, sp) : null;
        if (hh === "rot") cur = "alias";
        else if (hh) cur = hh.hx === 0.5 ? "ns-resize" : hh.hy === 0.5 ? "ew-resize" : (hh.hx === hh.hy ? "nwse-resize" : "nesw-resize");
        else if (hitElement(p)) cur = "move";
        else if (hitGuide(sp) >= 0) cur = "grab";
      }
      overlay.style.cursor = cur;
      drawOverlay();
      return;
    }
    switch (drag.type) {
      case "pan":
        stage.scrollLeft = drag.l0 - (e.clientX - drag.sx);
        stage.scrollTop = drag.t0 - (e.clientY - drag.sy);
        break;
      case "guide":
        drag.pos = drag.axis === "v" ? p.x : p.y;
        break;
      case "create":
        drag.cur = snapOn() ? snapPoint(p) : p;
        break;
      case "move": {
        const b = { ...drag.box0, x: drag.box0.x + p.x - drag.start.x, y: drag.box0.y + p.y - drag.start.y };
        snapLines = [];
        if (snapOn() && !e.altKey) {
          const c = candidates(drag.id);
          const a = aabb(b);
          const sx = snap1([a.x0, (a.x0 + a.x1) / 2, a.x1], c.xs);
          const sy = snap1([a.y0, (a.y0 + a.y1) / 2, a.y1], c.ys);
          if (sx) { b.x += sx.d; snapLines.push({ axis: "v", pos: sx.at }); }
          if (sy) { b.y += sy.d; snapLines.push({ axis: "h", pos: sy.at }); }
        }
        if (e.shiftKey) {
          // contrainte horizontale / verticale
          if (Math.abs(p.x - drag.start.x) > Math.abs(p.y - drag.start.y)) b.y = drag.box0.y;
          else b.x = drag.box0.x;
        }
        updateBox(drag.id, b);
        break;
      }
      case "resize": {
        const b0 = drag.box0;
        const a = (-b0.rot * Math.PI) / 180;
        const dxw = p.x - drag.start.x;
        const dyw = p.y - drag.start.y;
        let dx = dxw * Math.cos(a) - dyw * Math.sin(a);
        let dy = dxw * Math.sin(a) + dyw * Math.cos(a);
        let left = 0, top = 0, right = b0.w, bottom = b0.h;
        snapLines = [];
        if (snapOn() && b0.rot === 0) {
          const c = candidates(drag.id);
          if (drag.hx !== 0.5) {
            const edge = (drag.hx === 0 ? b0.x : b0.x + b0.w) + dx;
            const s1 = snap1([edge], c.xs);
            if (s1) { dx += s1.d; snapLines.push({ axis: "v", pos: s1.at }); }
          }
          if (drag.hy !== 0.5) {
            const edge = (drag.hy === 0 ? b0.y : b0.y + b0.h) + dy;
            const s1 = snap1([edge], c.ys);
            if (s1) { dy += s1.d; snapLines.push({ axis: "h", pos: s1.at }); }
          }
        }
        if (drag.hx === 0) left += dx;
        if (drag.hx === 1) right += dx;
        if (drag.hy === 0) top += dy;
        if (drag.hy === 1) bottom += dy;
        let w = Math.max(1, right - left);
        let hgt = Math.max(1, bottom - top);
        if ((drag.keep || e.shiftKey) && drag.hx !== 0.5 && drag.hy !== 0.5) {
          const k = Math.max(w / b0.w, hgt / b0.h);
          w = b0.w * k;
          hgt = b0.h * k;
          if (drag.hx === 0) left = right - w; else right = left + w;
          if (drag.hy === 0) top = bottom - hgt; else bottom = top + hgt;
        }
        if (drag.hx === 0) left = right - w; else right = left + w;
        if (drag.hy === 0) top = bottom - hgt; else bottom = top + hgt;
        const c = fromLocal(b0, (left + right) / 2, (top + bottom) / 2);
        updateBox(drag.id, { x: c.x - w / 2, y: c.y - hgt / 2, w, h: hgt, rot: b0.rot });
        break;
      }
      case "rotate": {
        const b0 = drag.box0;
        const ang = Math.atan2(p.y - (b0.y + b0.h / 2), p.x - (b0.x + b0.w / 2));
        let rot = b0.rot + ((ang - drag.a0) * 180) / Math.PI;
        if (e.shiftKey) rot = Math.round(rot / 15) * 15;
        rot = ((rot % 360) + 540) % 360 - 180;
        updateBox(drag.id, { ...b0, rot: Math.round(rot * 10) / 10 });
        break;
      }
    }
    drawOverlay();
    paintStatus();
  });

  overlay.addEventListener("pointerup", (e) => {
    const d = drag;
    drag = null;
    snapLines = [];
    if (!d) return;
    const sp = localPoint(e);
    const p = toMm(sp.x, sp.y);
    if (d.type === "guide") {
      const overRuler = d.axis === "h" ? sp.y < RULER : sp.x < RULER;
      store.update((doc) => {
        const gs = doc.layout.guides;
        if (d.index >= 0) {
          if (overRuler) gs.splice(d.index, 1);
          else gs[d.index].pos = Math.round(d.pos * 2) / 2;
        } else if (!overRuler) gs.push({ axis: d.axis, pos: Math.round(d.pos * 2) / 2 });
      });
    } else if (d.type === "create") {
      const x0 = Math.min(d.start.x, d.cur.x);
      const y0 = Math.min(d.start.y, d.cur.y);
      let w = Math.abs(d.cur.x - d.start.x);
      let hh = Math.abs(d.cur.y - d.start.y);
      const clickOnly = w < 2 && hh < 2;
      const kind = d.tool === "texte" ? "texte" : "forme";
      if (clickOnly) {
        w = kind === "texte" ? 90 : 40;
        hh = kind === "texte" ? 25 : 40;
      }
      if (d.tool === "ligne" && !clickOnly) hh = Math.max(hh, 2);
      const shape: Record<string, ShapeType> = { rect: "rect", ellipse: "ellipse", ligne: "ligne", polygone: "polygone", etoile: "etoile" };
      const l = addElement(kind, { x: x0, y: y0, w, h: d.tool === "ligne" && clickOnly ? 4 : hh }, (nl) => {
        if (nl.shape && shape[d.tool]) {
          nl.shape.type = shape[d.tool];
          nl.name = ({ rect: "Rectangle", ellipse: "Ellipse", ligne: "Ligne", polygone: "Polygone", etoile: "Étoile" } as Record<string, string>)[d.tool] ?? nl.name;
          if (d.tool === "ligne") nl.shape.stroke = true;
        }
      });
      selId = l.id;
      api.setTool("select");
      if (kind === "texte") setTimeout(() => focusText.fn?.(), 60);
    } else if (d.type === "move" || d.type === "resize" || d.type === "rotate") {
      store.commit();
    }
    // Loupe ouverte : un simple clic (sur le vide ou sur un objet, sans le déplacer) la place là
    const still = d.type === "click" || (d.type === "move" && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 0.5);
    if (loupeMode && still) {
      const b = bleed();
      api.loupeAt = { xMm: p.x + b, yMm: p.y + b };
      api.onLoupePick?.(api.loupeAt.xMm, api.loupeAt.yMm);
    }
    drawOverlay();
  });

  overlay.addEventListener("dblclick", (e) => {
    const p = toMm(localPoint(e).x, localPoint(e).y);
    const hit = hitElement(p);
    if (hit && kindOf(hit) === "texte") focusText.fn?.();
  });

  overlay.addEventListener("pointerleave", () => {
    cursorMm = null;
    drawOverlay();
  });

  overlay.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (modKey(e) || e.ctrlKey) {
        const sp = localPoint(e);
        zoomStep(e.deltaY < 0 ? 1 : -1, { sx: sp.x, sy: sp.y });
      } else {
        stage.scrollLeft += e.shiftKey ? e.deltaY : e.deltaX;
        stage.scrollTop += e.shiftKey ? 0 : e.deltaY;
      }
    },
    { passive: false },
  );

  // glisser-déposer de fichiers sur la planche
  overlay.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  overlay.addEventListener("drop", async (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])];
    const sp = localPoint(e);
    const at = toMm(sp.x, sp.y);
    for (const f of files) {
      try {
        if (/\.frost$/i.test(f.name)) await openProject(f);
        else if (/\.(ttf|otf|woff)$/i.test(f.name)) {
          const a = await importFontFile(f);
          toast("Police ajoutée", `${a.family} ${a.name} — choisissez-la dans Calques › Texte.`, "ok");
        } else if (/\.(icc|icm)$/i.test(f.name)) {
          const i = await importProfile(f);
          toast(i ? "Profil importé" : "Profil refusé", i ? i.name : "Fichier ICC illisible.", i ? "ok" : "err");
        } else if (/^image\//.test(f.type) || /\.svg$/i.test(f.name)) {
          const r = await addLogo(f, at);
          if (r?.warnings.length) toast("Logo importé", r.warnings.join(" "), "info", 9000);
        }
      } catch (err) {
        toast("Fichier refusé", `${f.name} : ${err instanceof Error ? err.message : String(err)}`, "err");
      }
    }
  });

  window.addEventListener("keydown", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (e.key === " " && !t?.matches("input, textarea, select, button")) spaceDown = true;
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === " ") spaceDown = false;
  });

  // ---- contrôles
  zoomSel.addEventListener("change", () => setZoom(zoomSel.value === "fit" ? "fit" : Number(zoomSel.value)));
  zoomInBtn.addEventListener("click", () => zoomStep(1));
  zoomOutBtn.addEventListener("click", () => zoomStep(-1));
  viewSel.addEventListener("change", () => { view = viewSel.value; schedule(); });
  screenBox.addEventListener("change", () => { screened = screenBox.checked; schedule(); });
  gridBox.addEventListener("change", () => drawOverlay());
  snapBox.addEventListener("change", () => store.update((d) => (d.layout.snap = snapBox.checked)));

  const api: PlancheApi = {
    refresh: () => schedule(),
    loupeAt: null,
    setLoupeMode(on, sizeMm) {
      loupeMode = on;
      if (sizeMm) loupeSizeMm = sizeMm;
      drawOverlay();
    },
    zoomIn: () => zoomStep(1),
    zoomOut: () => zoomStep(-1),
    zoomFit: () => setZoom("fit"),
    zoom100: () => setZoom(1),
    setTool(t) {
      tool = t;
      toolBtns.forEach((b, id) => {
        b.classList.toggle("sel", id === t);
        b.setAttribute("aria-pressed", String(id === t));
      });
      overlay.style.cursor = t === "select" ? "var(--cur-arrow)" : t === "main" ? "var(--cur-hand)" : "var(--cur-cross)";
    },
    toolFromKey(key) {
      const t = TOOLS.find((x) => x.key.toLowerCase() === key.toLowerCase());
      if (!t) return false;
      api.setTool(t.id);
      return true;
    },
    deselect() {
      selId = null;
      drawOverlay();
    },
    hasSelection: () => !!selLayer(),
  };
  api.setTool("select");

  win.onResize = () => { layout(); drawOverlay(); schedule(); };
  win.onShow = () => schedule();
  new ResizeObserver(() => { layout(); drawOverlay(); schedule(); }).observe(wrap);
  store.on((reason, origin) => {
    if (reason === "selection") {
      const l = store.layer;
      selId = l && isElement(l) ? l.id : null;
      drawOverlay();
    }
    if (reason === "doc" || reason === "profiles" || reason === "assets") {
      if (reason === "doc") {
        const l = store.layer;
        if (origin !== "planche") selId = l && isElement(l) ? l.id : selId && store.doc.layers.some((x) => x.id === selId) ? selId : null;
        snapBox.checked = store.doc.layout.snap;
      }
      drawOverlay();
      schedule();
    }
  });
  return api;
}
