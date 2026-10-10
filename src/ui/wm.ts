// Gestionnaire de fenêtres façon System 7 : barres de titre rayées, case de fermeture,
// repli « WindowShade » (double-clic sur le titre), case d'agrandissement en bas à droite.
import { h } from "./dom.ts";

export interface WinOpts {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  resizable?: boolean;
  closable?: boolean;
  visible?: boolean;
  modal?: boolean;
  /** Palette flottante : reste au-dessus des fenêtres ordinaires (sous les dialogues). */
  floating?: boolean;
  shaded?: boolean;
}

interface Geom {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  shaded: boolean;
}

const KEY = "frost.fenetres.v1";

function loadGeoms(): Record<string, Geom> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export class Win {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  readonly opts: WinOpts;
  private titleText: HTMLElement;
  private wm: WM;
  onShow?: () => void;
  onResize?: () => void;
  onClose?: () => void;

  constructor(wm: WM, o: WinOpts, g: Geom) {
    this.wm = wm;
    this.opts = o;
    this.titleText = h("span", { class: "wtitle-text" }, o.title);
    const close = o.closable === false ? h("span", { class: "wbox ghost" }) : h("button", { class: "wbox close", title: "Fermer", type: "button", "aria-label": "Fermer " + o.title });
    const shade = h("button", { class: "wbox shade", title: "Replier / déplier", type: "button", "aria-label": "Replier " + o.title });
    const bar = h("div", { class: "wbar" }, close, h("div", { class: "wtitle" }, h("span", { class: "stripes" }), this.titleText, h("span", { class: "stripes" })), shade);
    this.body = h("div", { class: "wbody" });
    this.el = h("section", { class: "win" + (o.modal ? " modal" : ""), "data-win": o.id, role: "dialog", "aria-label": o.title }, bar, this.body);
    if (o.resizable !== false) {
      const grow = h("div", { class: "grow", title: "Redimensionner" });
      this.el.append(grow);
      this.dragResize(grow);
    }
    this.apply(g);
    this.el.addEventListener("pointerdown", () => this.focus(), true);
    close.addEventListener("click", () => this.close());
    shade.addEventListener("click", () => this.toggleShade());
    bar.addEventListener("dblclick", (e) => {
      if ((e.target as HTMLElement).closest(".wbox")) return;
      this.toggleShade();
    });
    this.dragMove(bar);
  }

  private apply(g: Geom) {
    this.el.style.left = g.x + "px";
    this.el.style.top = g.y + "px";
    this.el.style.width = g.w + "px";
    this.el.style.height = g.shaded ? "" : g.h + "px";
    if (g.shaded) this.el.dataset.h = String(g.h);
    this.el.classList.toggle("shaded", g.shaded);
    this.el.hidden = !g.visible;
  }

  /** Géométrie lue sur les styles (une fenêtre cachée mesure 0 × 0 : on ne se fie pas à offset*). */
  geom(): Geom {
    const shaded = this.el.classList.contains("shaded");
    const pos = (v: string, d: number) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : d;
    };
    const size = (v: string | undefined, d: number) => {
      const n = parseFloat(v ?? "");
      return Number.isFinite(n) && n > 40 ? n : d;
    };
    return {
      x: pos(this.el.style.left, this.opts.x),
      y: pos(this.el.style.top, this.opts.y),
      w: size(this.el.style.width, this.opts.w),
      h: shaded ? size(this.el.dataset.h, this.opts.h) : size(this.el.style.height, this.opts.h),
      visible: !this.el.hidden,
      shaded,
    };
  }

  setTitle(t: string) {
    this.titleText.textContent = t;
  }

  get visible() {
    return !this.el.hidden;
  }

  open() {
    this.el.hidden = false;
    this.wm.constrain(this);
    this.focus();
    this.onShow?.();
    this.wm.save();
  }

  close() {
    this.el.hidden = true;
    this.onClose?.();
    this.wm.save();
  }

  toggle() {
    if (this.visible) this.close();
    else this.open();
  }

  focus() {
    this.wm.focus(this);
  }

  toggleShade() {
    const shaded = !this.el.classList.contains("shaded");
    if (shaded) {
      this.el.dataset.h = String(this.el.offsetHeight);
      this.el.style.height = "";
    } else this.el.style.height = (this.el.dataset.h ?? this.opts.h) + "px";
    this.el.classList.toggle("shaded", shaded);
    this.wm.save();
    if (!shaded) this.onResize?.();
  }

  private dragMove(bar: HTMLElement) {
    bar.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest(".wbox") || e.button !== 0) return;
      const sx = e.clientX - this.el.offsetLeft;
      const sy = e.clientY - this.el.offsetTop;
      bar.setPointerCapture(e.pointerId);
      this.el.classList.add("dragging");
      const move = (ev: PointerEvent) => {
        this.el.style.left = ev.clientX - sx + "px";
        this.el.style.top = Math.max(0, ev.clientY - sy) + "px";
      };
      const up = () => {
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", up);
        this.el.classList.remove("dragging");
        this.wm.constrain(this);
        this.wm.save();
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", up);
    });
  }

  private dragResize(grow: HTMLElement) {
    grow.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const sx = e.clientX;
      const sy = e.clientY;
      const w0 = this.el.offsetWidth;
      const h0 = this.el.offsetHeight;
      grow.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        this.el.style.width = Math.max(this.opts.minW ?? 200, w0 + ev.clientX - sx) + "px";
        this.el.style.height = Math.max(this.opts.minH ?? 120, h0 + ev.clientY - sy) + "px";
        this.onResize?.();
      };
      const up = () => {
        grow.removeEventListener("pointermove", move);
        grow.removeEventListener("pointerup", up);
        this.wm.save();
        this.onResize?.();
      };
      grow.addEventListener("pointermove", move);
      grow.addEventListener("pointerup", up);
    });
  }
}

export class WM {
  readonly root: HTMLElement;
  readonly wins = new Map<string, Win>();
  private z = 10;
  private saved = loadGeoms();

  constructor(root: HTMLElement) {
    this.root = root;
    window.addEventListener("resize", () => this.wins.forEach((w) => this.constrain(w)));
  }

  create(o: WinOpts): Win {
    const def = { x: o.x, y: o.y, w: o.w, h: o.h, visible: o.visible ?? true, shaded: o.shaded ?? false };
    const s = this.saved[o.id];
    // une géométrie enregistrée abîmée (fenêtre minuscule) est ignorée
    const g = s && s.w >= (o.minW ?? 180) && s.h >= 60 ? s : def;
    const w = new Win(this, o, g);
    this.wins.set(o.id, w);
    this.root.append(w.el);
    this.constrain(w);
    return w;
  }

  get(id: string) {
    return this.wins.get(id);
  }

  focus(w: Win) {
    this.wins.forEach((x) => x.el.classList.toggle("active", x === w));
    const layer = w.opts.modal ? 40000 : w.opts.floating ? 20000 : 0;
    w.el.style.zIndex = String(layer + ++this.z);
  }

  constrain(w: Win) {
    if (w.el.hidden) return;
    const r = this.root.getBoundingClientRect();
    const maxX = Math.max(0, r.width - 80);
    const maxY = Math.max(0, r.height - 24);
    if (w.el.offsetLeft > maxX) w.el.style.left = maxX + "px";
    if (w.el.offsetLeft < -w.el.offsetWidth + 80) w.el.style.left = -w.el.offsetWidth + 80 + "px";
    if (w.el.offsetTop > maxY) w.el.style.top = maxY + "px";
  }

  save() {
    const all: Record<string, Geom> = {};
    this.wins.forEach((w, id) => {
      if (!w.opts.modal) all[id] = w.geom();
    });
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      /* stockage indisponible : on garde la disposition par défaut */
    }
  }

  resetLayout() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* rien */
    }
    location.reload();
  }
}
