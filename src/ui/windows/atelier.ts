// Fenêtre « Atelier de dessin » : on dessine une tuile raccordable, les curseurs en font une texture,
// et l'IA locale (Ollama) peut lire le croquis + la consigne pour régler les curseurs.
import { h } from "../dom.ts";
import { slider, select, checkbox, group, button, note } from "../widgets.ts";
import { store } from "../../app/store.ts";
import { client } from "../../app/client.ts";
import { registerAsset, decodeImage } from "../../app/project.ts";
import { pickFile } from "../../app/desktop.ts";
import { DESSIN_SLIDERS, defaultDessinParams } from "../../engine/dessin.ts";
import { RD_PRESETS } from "../../engine/rd.ts";
import { newLayer, inkKey, plateDescs } from "../../engine/doc.ts";
import { uid } from "../../engine/util.ts";
import { aiConfig, askModel, probe, type AiStatus } from "../../ai/ollama.ts";
import { interpret } from "../../ai/heuristic.ts";
import type { AiSuggestion } from "../../ai/schema.ts";
import { toast } from "../toast.ts";
import type { Asset, Params } from "../../engine/types.ts";
import type { Win } from "../wm.ts";

const N = 512; // résolution de la tuile dessinée

type Tool = "crayon" | "pinceau" | "aero" | "points" | "ligne" | "gomme";
const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: "crayon", icon: "✎", label: "Crayon", key: "c" },
  { id: "pinceau", icon: "●", label: "Pinceau", key: "b" },
  { id: "aero", icon: "∴", label: "Aéro", key: "a" },
  { id: "points", icon: "⁘", label: "Points", key: "p" },
  { id: "ligne", icon: "╱", label: "Ligne", key: "l" },
  { id: "gomme", icon: "▭", label: "Gomme", key: "e" },
];

export function mountAtelier(win: Win, openAiHelp: () => void) {
  // ---- état
  let tool: Tool = "pinceau";
  let size = 18;
  let opacity = 100;
  let hardness = 80;
  let pressureSize = true;
  let wrap = true;
  let sym: "aucune" | "x" | "y" | "xy" | "rad6" = "aucune";
  let params: Params = defaultDessinParams();
  let assetId: string = uid("dessin");
  let rev = 0;
  let undo: ImageData[] = [];
  let redo: ImageData[] = [];
  let lastAi: { before: Params } | null = null;
  let aiStatus: AiStatus = { online: false, models: [] };
  let aiBusy = false;
  let aiAnswer: AiSuggestion | null = null;

  // ---- toiles
  const canvas = h("canvas", { width: N, height: N, "aria-label": "Tuile de dessin" });
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const ghost = h("canvas", { class: "ghost", width: N, height: N });
  const gctx = ghost.getContext("2d")!;
  const wrapEl = h("div", { class: "draw-wrap" }, canvas, ghost);
  const caption = h("div", { class: "caption" }, "Dessine une tuile : elle se répète sans couture.");
  const zone = h("div", { class: "canvas-zone" }, wrapEl, caption);
  const mini = h("canvas", { class: "mini-prev", width: 220, height: 220, "aria-label": "Aperçu de la texture répétée" });
  const toolsCol = h("div", { class: "tools" });
  const side = h("div", { class: "side" });
  const prompt = h("textarea", { class: "field", placeholder: "Décris la texture voulue : « corail fin et granuleux, style risographie », « labyrinthe épais en diagonale »…", "aria-label": "Consigne pour l'IA" });
  const aiStatusEl = h("div", { class: "ai-status" });
  const aiAnswerEl = h("div", { class: "ai-answer" });
  const aiBtn = button("✦ Améliorer avec l'IA", () => runAi(), { cls: "frost default", title: "L'IA lit ton croquis et ta consigne, puis règle les curseurs." });
  const varBtn = button("Variation", () => variation(), { cls: "small", title: "Petite variation aléatoire des curseurs." });
  const undoAiBtn = button("Annuler l'IA", () => { if (lastAi) { params = lastAi.before; lastAi = null; changed(true); renderSide(); renderAi(); } }, { cls: "small" });
  const diffBtn = button("Enrichir (diffusion) — v0.2", () => {}, { cls: "small", disabled: true, title: "Prochaine version : génération d'image locale (Stable Diffusion + ControlNet via ComfyUI) pour ajouter du détail au croquis." });
  const aibar = h(
    "div",
    { class: "aibar" },
    prompt,
    h("div", { class: "ai-actions" }, aiBtn, h("div", { class: "btns" }, varBtn, undoAiBtn), diffBtn),
    aiStatusEl,
    aiAnswerEl,
  );
  win.body.append(h("div", { class: "atelier" }, toolsCol, zone, side, aibar));

  // ---- taille d'affichage de la toile
  const fit = () => {
    const avail = Math.max(160, Math.min(zone.clientWidth - 30, zone.clientHeight - 50));
    canvas.style.width = canvas.style.height = avail + "px";
    ghost.style.width = ghost.style.height = avail + "px";
  };
  new ResizeObserver(fit).observe(zone);

  // ---- outils
  function renderTools() {
    toolsCol.replaceChildren(
      ...TOOLS.map((t) => {
        const b = h("button", { class: "tool-btn" + (tool === t.id ? " sel" : ""), type: "button", title: `${t.label} (${t.key.toUpperCase()})`, "aria-pressed": String(tool === t.id) }, t.icon, h("small", null, t.label));
        b.addEventListener("click", () => { tool = t.id; renderTools(); });
        return b;
      }),
      h("div", { class: "tool-sep" }),
      iconBtn("↶", "Annuler", "Annuler le trait (Ctrl+Z dans l'atelier)", () => undoStroke()),
      iconBtn("↷", "Refaire", "Refaire le trait", () => redoStroke()),
      iconBtn("◐", "Inverser", "Inverser encre et papier", () => { snapshot(); invert(); commitDrawing(); }),
      iconBtn("⌫", "Vider", "Effacer la tuile", () => { snapshot(); ctx.clearRect(0, 0, N, N); commitDrawing(); }),
      iconBtn("⤓", "Image", "Importer une image dans la tuile", () => importIntoTile()),
    );
  }
  const iconBtn = (icon: string, label: string, title: string, fn: () => void) => {
    const b = h("button", { class: "tool-btn", type: "button", title }, icon, h("small", null, label));
    b.addEventListener("click", fn);
    return b;
  };

  // ---- panneau de réglages
  function renderSide() {
    const linked = isLinked();
    side.replaceChildren(
      group("Aperçu de la texture", mini, h("div", { class: "muted" }, `${Number(params.echelle)} mm par tuile · 2,5 tuiles affichées`)),
      h("div", { class: "btns" },
        button(linked ? "✓ Liée à la couche" : "Appliquer à la couche active", () => applyToLayer(), { cls: linked ? "small on" : "small default", title: "La couche active utilise ce dessin comme source." }),
        button("+ Nouvelle couche", () => applyToNewLayer(), { cls: "small" }),
      ),
      group(
        "Pinceau",
        slider({ label: "Taille", value: size, min: 1, max: 160, step: 1, unit: "px", def: 18, onInput: (v) => (size = v) }),
        slider({ label: "Opacité", value: opacity, min: 1, max: 100, step: 1, unit: "%", def: 100, onInput: (v) => (opacity = v) }),
        slider({ label: "Dureté", value: hardness, min: 0, max: 100, step: 1, unit: "%", def: 80, onInput: (v) => (hardness = v) }),
        checkbox("Pression du stylet → taille", pressureSize, (v) => (pressureSize = v), "Tablette graphique (Huion, Wacom…)."),
        checkbox("Dessin raccordable (bords qui se rejoignent)", wrap, (v) => { wrap = v; }),
        select("Symétrie", sym, [["aucune", "Aucune"], ["x", "Miroir vertical"], ["y", "Miroir horizontal"], ["xy", "Quatre quarts"], ["rad6", "Radiale ×6"]], (v) => { sym = v as typeof sym; drawGuides(); }),
      ),
      group(
        "Texture",
        select("Motif organique", String(params.motif), Object.entries(RD_PRESETS).map(([k, v]) => [k, v.label]), (v) => { params.motif = v; changed(true); }, "Réaction-diffusion utilisée par « Croissance organique »."),
        ...DESSIN_SLIDERS.map((s) =>
          slider({
            label: s.label, value: Number(params[s.key]), min: s.min, max: s.max, step: s.step, unit: s.unit, def: s.def, hint: s.hint,
            onInput: (v) => { params[s.key] = v; changed(false); },
            onCommit: () => changed(true),
          }),
        ),
        h("div", { class: "btns" }, button("Réglages par défaut", () => { params = { ...defaultDessinParams(), graine: params.graine }; changed(true); renderSide(); }, { cls: "small" })),
      ),
    );
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

  // ---- dessin
  let drawing = false;
  let last: { x: number; y: number; p: number } | null = null;
  let lineStart: { x: number; y: number } | null = null;

  const toTile = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * N, y: ((e.clientY - r.top) / r.height) * N, p: e.pointerType === "mouse" ? 0.6 : e.pressure || 0.5 };
  };

  const symPoints = (x: number, y: number): [number, number][] => {
    const pts: [number, number][] = [[x, y]];
    if (sym === "x" || sym === "xy") pts.push([N - x, y]);
    if (sym === "y" || sym === "xy") pts.push([x, N - y]);
    if (sym === "xy") pts.push([N - x, N - y]);
    if (sym === "rad6") {
      const cx = N / 2;
      const cy = N / 2;
      for (let k = 1; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        const dx = x - cx;
        const dy = y - cy;
        pts.push([cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)]);
      }
    }
    return pts;
  };

  /** Pose une empreinte (avec ses copies raccordées sur les bords). */
  function stamp(x: number, y: number, pressure: number) {
    const s = Math.max(0.5, (pressureSize ? size * (0.25 + pressure * 1.1) : size) / 2);
    const a = opacity / 100;
    ctx.save();
    ctx.globalCompositeOperation = tool === "gomme" ? "destination-out" : "source-over";
    for (const [px, py] of symPoints(x, y)) {
      const offs: [number, number][] = [[0, 0]];
      if (wrap) {
        for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) if ((ox || oy) && px + ox > -s && px + ox < N + s && py + oy > -s && py + oy < N + s) offs.push([ox, oy]);
      }
      for (const [ox, oy] of offs) {
        const cx = px + ox;
        const cy = py + oy;
        if (tool === "crayon") {
          ctx.fillStyle = `rgba(0,0,0,${a})`;
          const r = Math.max(0.6, s * 0.35);
          ctx.fillRect(Math.round(cx - r), Math.round(cy - r), Math.max(1, Math.round(r * 2)), Math.max(1, Math.round(r * 2)));
        } else if (tool === "aero" || tool === "points") {
          const count = tool === "aero" ? Math.ceil(s * 0.9) : 2;
          for (let i = 0; i < count; i++) {
            const ang = Math.random() * Math.PI * 2;
            const rr = Math.sqrt(Math.random()) * s;
            const dot = tool === "aero" ? 1 : Math.max(1, s * 0.18);
            ctx.fillStyle = `rgba(0,0,0,${tool === "aero" ? a * 0.5 : a})`;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, dot, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, s);
          const hard = Math.min(0.99, hardness / 100);
          g.addColorStop(0, `rgba(0,0,0,${a})`);
          g.addColorStop(hard, `rgba(0,0,0,${a})`);
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, s, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  function strokeTo(x: number, y: number, p: number) {
    if (!last) {
      stamp(x, y, p);
      last = { x, y, p };
      return;
    }
    const dx = x - last.x;
    const dy = y - last.y;
    const dist = Math.hypot(dx, dy);
    const spacing = Math.max(1, size * (tool === "aero" ? 0.35 : 0.18));
    const steps = Math.max(1, Math.floor(dist / spacing));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      stamp(last.x + dx * t, last.y + dy * t, last.p + (p - last.p) * t);
    }
    last = { x, y, p };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    snapshot();
    drawing = true;
    const pt = toTile(e);
    if (tool === "ligne") lineStart = pt;
    else {
      last = null;
      strokeTo(pt.x, pt.y, pt.p);
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const pt = toTile(e);
    if (tool === "ligne" && lineStart) {
      drawGuides();
      gctx.strokeStyle = "#ff0090";
      gctx.lineWidth = Math.max(1, size);
      gctx.lineCap = "round";
      gctx.beginPath();
      gctx.moveTo(lineStart.x, lineStart.y);
      gctx.lineTo(pt.x, pt.y);
      gctx.stroke();
      return;
    }
    // les événements « fusionnés » donnent un trait fluide avec une tablette ; liste vide sur certains navigateurs
    const merged = e.getCoalescedEvents?.() ?? [];
    for (const ce of merged.length ? merged : [e]) {
      const q = toTile(ce);
      strokeTo(q.x, q.y, q.p);
    }
  });
  const end = (e: PointerEvent) => {
    if (!drawing) return;
    drawing = false;
    if (tool === "ligne" && lineStart) {
      const pt = toTile(e);
      last = { x: lineStart.x, y: lineStart.y, p: 0.6 };
      strokeTo(pt.x, pt.y, 0.6);
      lineStart = null;
      drawGuides();
    }
    last = null;
    commitDrawing();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  function drawGuides() {
    gctx.clearRect(0, 0, N, N);
    gctx.strokeStyle = "rgba(0,166,255,.55)";
    gctx.lineWidth = 1;
    gctx.setLineDash([6, 6]);
    if (sym === "x" || sym === "xy") { gctx.beginPath(); gctx.moveTo(N / 2, 0); gctx.lineTo(N / 2, N); gctx.stroke(); }
    if (sym === "y" || sym === "xy") { gctx.beginPath(); gctx.moveTo(0, N / 2); gctx.lineTo(N, N / 2); gctx.stroke(); }
    if (sym === "rad6") for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; gctx.beginPath(); gctx.moveTo(N / 2, N / 2); gctx.lineTo(N / 2 + Math.cos(a) * N, N / 2 + Math.sin(a) * N); gctx.stroke(); }
    gctx.setLineDash([]);
  }

  function snapshot() {
    undo.push(ctx.getImageData(0, 0, N, N));
    if (undo.length > 40) undo.shift();
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

  async function importIntoTile() {
    const f = await pickFile("image/*");
    if (!f) return;
    try {
      const img = await decodeImage(f, N);
      snapshot();
      const tmp = new OffscreenCanvas(img.width, img.height);
      tmp.getContext("2d")!.putImageData(new ImageData(img.rgba as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
      const out = ctx.createImageData(N, N);
      const sc = Math.max(N / img.width, N / img.height);
      const c2 = new OffscreenCanvas(N, N);
      const g2 = c2.getContext("2d")!;
      g2.fillStyle = "#fff";
      g2.fillRect(0, 0, N, N);
      g2.drawImage(tmp, (N - img.width * sc) / 2, (N - img.height * sc) / 2, img.width * sc, img.height * sc);
      const src = g2.getImageData(0, 0, N, N).data;
      for (let i = 0; i < N * N; i++) {
        const lum = (0.2126 * src[i * 4] + 0.7152 * src[i * 4 + 1] + 0.0722 * src[i * 4 + 2]) / 255;
        out.data[i * 4 + 3] = Math.round((1 - lum) * 255);
      }
      ctx.putImageData(out, 0, 0);
      commitDrawing();
    } catch {
      toast("Image illisible", "Formats acceptés : JPG, PNG, WebP, GIF, BMP, AVIF.", "err");
    }
  }

  // ---- synchronisation avec le document
  const isLinked = () => {
    const l = store.layer;
    return l.source.type === "dessin" && l.source.assetId === assetId;
  };

  function currentAsset(): Asset {
    const data = ctx.getImageData(0, 0, N, N).data;
    return { id: assetId, kind: "dessin", name: "Dessin", width: N, height: N, rgba: new Uint8ClampedArray(data) };
  }

  let pushTimer = 0;
  function commitDrawing() {
    rev++;
    params.rev = rev;
    registerAsset(currentAsset());
    caption.textContent = "Tuile 512 × 512 · raccordable" + (wrap ? " ✓" : " (désactivé)");
    changed(true);
  }

  /** Les curseurs ou le dessin ont changé : aperçu de l'atelier + couche liée. */
  function changed(commit: boolean) {
    clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => miniPreview(), 30);
    if (isLinked()) {
      const snap = { ...params };
      store.update((d) => {
        const l = d.layers.find((x) => x.id === d.activeLayerId);
        if (l && l.source.type === "dessin") l.source.params = snap;
      }, { live: !commit, origin: "atelier" });
    }
  }

  async function miniPreview() {
    if (!store.assets.has(assetId)) return;
    const res = await client.dessin(assetId, params, 220);
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
    });
    renderSide();
  }

  function applyToNewLayer() {
    if (!store.assets.has(assetId)) commitDrawing();
    const l = newLayer("dessin", "Dessin", store.doc.layers.length);
    l.source = { type: "dessin", params: { ...params }, assetId };
    store.update((d) => { d.layers.push(l); d.activeLayerId = l.id; });
    renderSide();
  }

  /** Charge le dessin de la couche active si c'en est un. */
  function loadFromLayer() {
    const l = store.layer;
    if (l.source.type !== "dessin") return;
    params = { ...defaultDessinParams(), ...l.source.params };
    if (l.source.assetId && l.source.assetId !== assetId) {
      const a = store.assets.get(l.source.assetId);
      if (a?.rgba) {
        assetId = a.id;
        ctx.putImageData(new ImageData(new Uint8ClampedArray(a.rgba), N, N), 0, 0);
        undo = [];
        redo = [];
      }
    } else if (!l.source.assetId) {
      assetId = uid("dessin");
      commitDrawing();
      applyToLayer();
    }
    rev = Number(params.rev) || 0;
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
    if (sug.trame && store.doc.settings.mode === "directs" && isLinked()) {
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
    const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
    if (t && !e.ctrlKey && !e.metaKey) {
      tool = t.id;
      renderTools();
    }
  });
  win.el.tabIndex = -1;

  win.onShow = () => {
    fit();
    loadFromLayer();
    refreshAi();
  };

  store.on((reason, origin) => {
    if (reason === "doc" && origin !== "atelier" && win.visible) {
      const l = store.layer;
      if (l.source.type === "dessin" && l.source.assetId !== assetId) loadFromLayer();
      else if (isLinked()) {
        const before = JSON.stringify(params);
        params = { ...defaultDessinParams(), ...l.source.params };
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
  drawGuides();
}
