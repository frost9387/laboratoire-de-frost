import { h } from "./dom.ts";

let current: HTMLElement | null = null;
let timer = 0;

/** Message éphémère en bas à droite. */
export function toast(title: string, text: string, kind: "info" | "ok" | "err" = "info", ms = 6000) {
  current?.remove();
  clearTimeout(timer);
  const el = h("div", { class: "toast " + kind, role: kind === "err" ? "alert" : "status" }, h("b", null, title), text);
  el.addEventListener("click", () => el.remove());
  document.body.append(el);
  current = el;
  timer = window.setTimeout(() => el.remove(), ms);
}
