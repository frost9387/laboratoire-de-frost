// Contrôles d'interface au style Mac OS classique + typographies années 2000.
import { h, fmt, parseNum } from "./dom.ts";

export interface SliderOpts {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  def?: number;
  hint?: string;
  /** Curseur logarithmique : pour les plages très larges (0,5 mm → 1 m). */
  log?: boolean;
  /** Pendant le glissement (aperçu). */
  onInput: (v: number) => void;
  /** À la fin du geste (historique). */
  onCommit?: (v: number) => void;
}

/** Curseur + champ numérique + unité. Clic droit = valeur par défaut. Molette sur le champ = pas. */
export function slider(o: SliderOpts): HTMLElement {
  const step = o.step ?? 1;
  // logarithmique : la course du curseur est répartie en proportions (×2 prend la même place partout)
  const log = !!o.log && o.min > 0;
  const LOGN = 1000;
  const toPos = (v: number) => (log ? Math.round((Math.log(v / o.min) / Math.log(o.max / o.min)) * LOGN) : v);
  const fromPos = (p: number) => (log ? o.min * Math.pow(o.max / o.min, p / LOGN) : p);
  // pas « lisible » en log : 0,1 sous 10, 0,5 sous 100, 1 au-delà
  const snap = (v: number) => {
    const st = log ? Math.max(step, v < 10 ? 0.1 : v < 100 ? 0.5 : 1) : step;
    return Math.round(v / st) * st;
  };
  const range = h("input", log
    ? { type: "range", min: "0", max: String(LOGN), step: "1", value: String(toPos(o.value)), class: "rng" }
    : { type: "range", min: String(o.min), max: String(o.max), step: String(step), value: String(o.value), class: "rng" });
  const field = h("input", { type: "text", class: "num", value: fmt(o.value, step), inputmode: "decimal", "aria-label": o.label });
  const set = (v: number, commit: boolean, fromRange = false) => {
    if (!Number.isFinite(v)) return;
    v = Math.min(o.max, Math.max(o.min, fromRange ? snap(v) : Math.round(v / step) * step));
    if (!fromRange || !log) range.value = String(toPos(v));
    field.value = fmt(v, step);
    o.onInput(v);
    if (commit) o.onCommit?.(v);
  };
  range.addEventListener("input", () => set(fromPos(Number(range.value)), false, true));
  range.addEventListener("change", () => set(fromPos(Number(range.value)), true, true));
  field.addEventListener("change", () => set(parseNum(field.value), true));
  field.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const mul = e.shiftKey ? 10 : 1;
      set(parseNum(field.value) + (e.key === "ArrowUp" ? step : -step) * mul, true);
    }
  });
  field.addEventListener("wheel", (e) => {
    e.preventDefault();
    set(parseNum(field.value) + (e.deltaY < 0 ? step : -step), true);
  }, { passive: false });
  const reset = (e: Event) => {
    e.preventDefault();
    if (o.def !== undefined) set(o.def, true);
  };
  range.addEventListener("contextmenu", reset);
  field.addEventListener("contextmenu", reset);
  return h(
    "div",
    { class: "row slider", title: (o.hint ? o.hint + "\n" : "") + "Clic droit : valeur par défaut" },
    h("label", null, o.label),
    range,
    field,
    h("span", { class: "unit" }, o.unit ?? ""),
  );
}

export function select(label: string, value: string, options: [string, string][], onChange: (v: string) => void, hint?: string): HTMLElement {
  const sel = h("select", { class: "pop", "aria-label": label });
  for (const [v, l] of options) sel.append(h("option", { value: v, selected: v === value }, l));
  sel.addEventListener("change", () => onChange(sel.value));
  return h("div", { class: "row", title: hint ?? "" }, h("label", null, label), sel);
}

export function checkbox(label: string, value: boolean, onChange: (v: boolean) => void, hint?: string): HTMLElement {
  const box = h("input", { type: "checkbox", checked: value });
  box.addEventListener("change", () => onChange(box.checked));
  return h("label", { class: "row check", title: hint ?? "" }, box, h("span", null, label));
}

export function button(label: string, onClick: (e: MouseEvent) => void, opts: { cls?: string; title?: string; disabled?: boolean } = {}): HTMLButtonElement {
  const b = h("button", { class: "btn " + (opts.cls ?? ""), title: opts.title ?? "", disabled: opts.disabled ?? false, type: "button" }, label);
  b.addEventListener("click", onClick);
  return b;
}

export function group(title: string, ...children: (Node | null | false)[]): HTMLElement {
  return h("fieldset", { class: "grp" }, h("legend", null, title), ...children);
}

export function note(text: string, kind: "info" | "warn" | "err" | "ok" = "info"): HTMLElement {
  return h("p", { class: "note " + kind }, text);
}

export function colorInput(label: string, hex: string, onChange: (hex: string) => void): HTMLElement {
  const inp = h("input", { type: "color", value: hex, class: "swatch-in" });
  inp.addEventListener("input", () => onChange(inp.value));
  return h("div", { class: "row" }, h("label", null, label), inp, h("span", { class: "hex" }, hex.toUpperCase()));
}

/** Marque un contrôle comme « expert » : masqué en mode Simple. */
export function expert<T extends HTMLElement | null>(el: T): T {
  el?.classList.add("expert");
  return el;
}

/** Petit champ numérique avec unité (X, Y, L, H…). Molette et flèches : ± un pas. */
export function numField(label: string, value: number, unit: string, onCommit: (v: number) => void, step = 0.5, hint = ""): HTMLElement {
  const inp = h("input", { type: "text", class: "num small", value: fmt(value, step), inputmode: "decimal", "aria-label": label, title: hint });
  const set = (v: number) => {
    if (!Number.isFinite(v)) return;
    v = Math.round(v / step) * step;
    inp.value = fmt(v, step);
    onCommit(v);
  };
  inp.addEventListener("change", () => set(parseNum(inp.value)));
  inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      set(parseNum(inp.value) + (e.key === "ArrowUp" ? step : -step) * (e.shiftKey ? 10 : 1));
    }
  });
  inp.addEventListener("wheel", (e) => {
    e.preventDefault();
    set(parseNum(inp.value) + (e.deltaY < 0 ? step : -step));
  }, { passive: false });
  return h("label", { class: "nf", title: hint }, h("span", null, label), inp, h("span", { class: "unit" }, unit));
}

/** Rangée de boutons à choix unique (alignements, outils…). */
export function segmented(label: string, value: string, options: [string, string, string?][], onChange: (v: string) => void): HTMLElement {
  return h(
    "div",
    { class: "row" },
    h("label", null, label),
    h("div", { class: "seg", role: "radiogroup", "aria-label": label },
      ...options.map(([v, text, title]) => {
        const b = h("button", { type: "button", class: "btn small" + (v === value ? " on" : ""), role: "radio", "aria-checked": String(v === value), title: title ?? "" }, text);
        b.addEventListener("click", () => onChange(v));
        return b;
      }),
    ),
  );
}

/** Barre de progression « enseigne de barbier » du Mac classique. */
export function progressBar(): { el: HTMLElement; set: (f: number | null, label?: string) => void } {
  const fill = h("div", { class: "pfill" });
  const lab = h("div", { class: "plabel" });
  const el = h("div", { class: "progress" }, h("div", { class: "ptrack" }, fill), lab);
  return {
    el,
    set(f, label) {
      if (f === null) {
        el.classList.add("indeterminate");
        fill.style.width = "100%";
      } else {
        el.classList.remove("indeterminate");
        fill.style.width = Math.round(f * 100) + "%";
      }
      if (label !== undefined) lab.textContent = label;
    },
  };
}
