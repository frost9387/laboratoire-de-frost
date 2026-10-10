// Import de logos SVG : on laisse le navigateur résoudre styles et transformations,
// puis on garde des tracés simples + une densité d'encre par tracé (noir = encre, blanc = papier).
import type { VectorData, VectorItem } from "../engine/types.ts";

const SKIP_PARENTS = new Set(["defs", "clipPath", "mask", "symbol", "pattern", "marker", "linearGradient", "radialGradient"]);

function num(el: Element, a: string, d = 0): number {
  const v = parseFloat(el.getAttribute(a) ?? "");
  return Number.isFinite(v) ? v : d;
}

function geometry(el: SVGElement): string | null {
  switch (el.tagName.toLowerCase()) {
    case "path":
      return el.getAttribute("d");
    case "rect": {
      const x = num(el, "x"), y = num(el, "y"), w = num(el, "width"), h = num(el, "height");
      if (w <= 0 || h <= 0) return null;
      let rx = num(el, "rx", NaN), ry = num(el, "ry", NaN);
      if (!Number.isFinite(rx)) rx = Number.isFinite(ry) ? ry : 0;
      if (!Number.isFinite(ry)) ry = rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (rx <= 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case "circle": {
      const cx = num(el, "cx"), cy = num(el, "cy"), r = num(el, "r");
      return r > 0 ? `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z` : null;
    }
    case "ellipse": {
      const cx = num(el, "cx"), cy = num(el, "cy"), rx = num(el, "rx"), ry = num(el, "ry");
      return rx > 0 && ry > 0 ? `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z` : null;
    }
    case "line":
      return `M${num(el, "x1")} ${num(el, "y1")}L${num(el, "x2")} ${num(el, "y2")}`;
    case "polyline":
    case "polygon": {
      const pts = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
      if (pts.length < 4) return null;
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
      return el.tagName.toLowerCase() === "polygon" ? d + "Z" : d;
    }
  }
  return null;
}

/** Couleur CSS calculée → densité d'encre (0 = papier, 1 = encre pleine). */
function density(color: string, alpha: number, warn: (w: string) => void): number | null {
  if (!color || color === "none" || color === "transparent") return null;
  if (color.startsWith("url(")) {
    warn("Les dégradés du logo sont remplacés par une teinte unique.");
    return 0.6 * alpha;
  }
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (!m) return alpha;
  const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return (1 - lum) * alpha * a;
}

export function parseSvgLogo(text: string): { vector: VectorData; warnings: string[] } {
  const warnings = new Set<string>();
  const warn = (w: string) => warnings.add(w);
  const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.tagName.toLowerCase() !== "svg" || parsed.querySelector("parsererror")) throw new Error("Ce fichier n'est pas un SVG lisible.");
  let vb = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v)) || vb[2] <= 0 || vb[3] <= 0) {
    const w = parseFloat(root.getAttribute("width") ?? "") || 100;
    const h = parseFloat(root.getAttribute("height") ?? "") || 100;
    vb = [0, 0, w, h];
  }
  const [, , vbW, vbH] = vb;
  // rendu hors écran pour que le navigateur calcule styles et matrices
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-100000px;top:0;width:1px;height:1px;overflow:hidden;visibility:hidden";
  const node = document.importNode(root, true) as unknown as SVGSVGElement;
  node.setAttribute("width", String(vbW));
  node.setAttribute("height", String(vbH));
  node.setAttribute("preserveAspectRatio", "none");
  host.append(node);
  document.body.append(host);
  const items: VectorItem[] = [];
  try {
    if (node.querySelector("text")) warn("Le texte du logo est ignoré : vectorisez-le (contours) avant l'import.");
    if (node.querySelector("image")) warn("Les images intégrées au SVG sont ignorées.");
    if (node.querySelector("use")) warn("Les éléments <use> ne sont pas encore pris en charge.");
    node.querySelectorAll("path, rect, circle, ellipse, line, polyline, polygon").forEach((el) => {
      for (let p = el.parentElement; p && p !== (node as unknown as Element); p = p.parentElement) if (SKIP_PARENTS.has(p.tagName)) return;
      const svgEl = el as SVGGraphicsElement;
      const cs = getComputedStyle(svgEl);
      if (cs.display === "none" || cs.visibility === "hidden") return;
      const d = geometry(svgEl);
      if (!d) return;
      let alpha = parseFloat(cs.opacity || "1");
      for (let p = svgEl.parentElement; p && p !== (node as unknown as Element); p = p.parentElement) alpha *= parseFloat(getComputedStyle(p).opacity || "1");
      const ctm = svgEl.getCTM();
      if (!ctm) return;
      const fill = svgEl.tagName.toLowerCase() === "line" ? null : density(cs.fill, alpha * parseFloat(cs.fillOpacity || "1"), warn);
      const stroke = density(cs.stroke, alpha * parseFloat(cs.strokeOpacity || "1"), warn);
      items.push({
        d,
        m: [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f],
        fill,
        stroke,
        sw: parseFloat(cs.strokeWidth || "0") || 0,
        evenodd: cs.fillRule === "evenodd",
      });
    });
  } finally {
    host.remove();
  }
  if (!items.length) throw new Error("Aucune forme trouvée dans ce SVG.");
  return { vector: { vbX: 0, vbY: 0, vbW, vbH, items }, warnings: [...warnings] };
}
