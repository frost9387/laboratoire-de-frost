// Barre de menus du haut (façon Mac OS), avec raccourcis et état de l'IA / du profil.
import { h } from "./dom.ts";
import { kbd } from "./platform.ts";

export interface MenuItem {
  label: string;
  kbd?: string;
  action?: () => void;
  enabled?: () => boolean;
  sep?: boolean;
}

export interface MenuDef {
  title: string;
  items: MenuItem[];
}

export function mountMenubar(root: HTMLElement, menus: MenuDef[], logoAction: () => void): { status: HTMLElement } {
  const logo = h("button", { class: "logo", type: "button", title: "À propos", style: "border:0;background:none" }, h("span", { class: "flake" }, "❄"), "Labo Frost");
  logo.addEventListener("click", logoAction);
  const status = h("div", { class: "status" });
  const bar = h("nav", { class: "menubar", "aria-label": "Menus" }, logo);
  let openMenu: HTMLElement | null = null;
  const closeAll = () => {
    openMenu?.classList.remove("open");
    openMenu = null;
  };
  for (const m of menus) {
    const list = h("div", { class: "mlist", role: "menu" });
    const title = h("button", { class: "mtitle", type: "button", "aria-haspopup": "true" }, m.title);
    const menu = h("div", { class: "menu" }, title, list);
    const fill = () => {
      list.replaceChildren(
        ...m.items.map((it) => {
          if (it.sep) return h("div", { class: "msep" });
          const b = h("button", { class: "mitem", type: "button", role: "menuitem", disabled: it.enabled ? !it.enabled() : false }, h("span", null, it.label), h("span", { class: "kbd" }, it.kbd ? kbd(it.kbd) : ""));
          b.addEventListener("click", () => {
            closeAll();
            it.action?.();
          });
          return b;
        }),
      );
    };
    title.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (openMenu === menu) return closeAll();
      closeAll();
      fill();
      menu.classList.add("open");
      openMenu = menu;
    });
    title.addEventListener("pointerenter", () => {
      if (openMenu && openMenu !== menu) {
        closeAll();
        fill();
        menu.classList.add("open");
        openMenu = menu;
      }
    });
    bar.append(menu);
  }
  bar.append(h("div", { class: "spacer" }), status);
  document.addEventListener("pointerdown", (e) => {
    if (!(e.target as HTMLElement).closest(".menubar")) closeAll();
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeAll());
  root.append(bar);
  return { status };
}
