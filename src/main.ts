// Le laboratoire de Frost — point d'entrée.
import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "@fontsource/vt323/400.css";
import "@fontsource/orbitron/700.css";
import "@fontsource/orbitron/900.css";
import "./styles/main.css";

import { h } from "./ui/dom.ts";
import { WM } from "./ui/wm.ts";
import { installCursors } from "./ui/cursors.ts";
import { mountMenubar } from "./ui/menubar.ts";
import { mountPlanche } from "./ui/windows/planche.ts";
import { mountDocument } from "./ui/windows/document.ts";
import { mountCouches } from "./ui/windows/couches.ts";
import { mountPile } from "./ui/windows/pile.ts";
import { mountTrame } from "./ui/windows/trame.ts";
import { mountAtelier } from "./ui/windows/atelier.ts";
import { mountLoupe } from "./ui/windows/loupe.ts";
import { mountExport } from "./ui/windows/exporter.ts";
import { mountGrille } from "./ui/windows/grille.ts";
import { mountAccueil, accueilAuDemarrage } from "./ui/windows/accueil.ts";
import { mountGuide, flash } from "./ui/windows/guide.ts";
import { mountAbout, mountAiHelp, mountShortcuts } from "./ui/windows/infos.ts";
import { toast } from "./ui/toast.ts";
import { kbd, modKey } from "./ui/platform.ts";
import { store } from "./app/store.ts";
import { client } from "./app/client.ts";
import { discoverProfiles, importProfile, preferredCmyk } from "./app/profiles.ts";
import { importImageFile, importFontFile, openProject, saveProject } from "./app/project.ts";
import { pickFile, desktop } from "./app/desktop.ts";
import { mosh, shuffleEffects, disableAllEffects, newSeed, addElement, addLogo, duplicateLayer, deleteLayer, nudge } from "./app/actions.ts";
import { startAutosave } from "./app/autosave.ts";
import { probe } from "./ai/ollama.ts";
import { GENERIC_CMYK_ID } from "./engine/color.ts";
import { defaultSource } from "./engine/sources.ts";
import { isElement } from "./engine/doc.ts";

installCursors();
document.title = "Le laboratoire de Frost";
document.body.classList.toggle("simple", !store.expert);

const desk = h("main", { id: "desktop" });
document.body.append(desk);
const wm = new WM(desk);

// ---- disposition par défaut, calée sur la taille de l'écran
const W = window.innerWidth;
const H = window.innerHeight - 24;
const wide = W >= 1150;
const left = 300;
const right = 318;
const mid = wide ? W - left - right - 24 : W - right - 24;

const planche = wm.create({ id: "planche", title: "Planche", x: wide ? left + 8 : 8, y: 8, w: mid, h: H - 16, minW: 360, minH: 260 });
const couches = wm.create({ id: "couches", title: "Calques", x: wide ? 8 : W - right - 8, y: 8, w: wide ? left - 8 : right, h: Math.round(H * (wide ? 0.62 : 0.5)) - 12 });
const docWin = wm.create({ id: "document", title: "Document", x: wide ? 8 : W - right - 8, y: wide ? Math.round(H * 0.62) : Math.round(H * 0.5), w: wide ? left - 8 : right, h: Math.round(H * 0.38) - 8, shaded: !wide });
const pile = wm.create({ id: "pile", title: "Pile d'effets", x: W - right - 8, y: wide ? 8 : Math.round(H * 0.5) + 26, w: right, h: Math.round(H * (wide ? 0.5 : 0.5)) - 34, shaded: !wide });
const trame = wm.create({ id: "trame", title: "Trame", x: W - right - 8, y: wide ? Math.round(H * 0.5) : Math.round(H * 0.5) + 52, w: right, h: Math.round(H * 0.5) - 8, shaded: !wide });
const grille = wm.create({ id: "grille", title: "Grille & marges", x: W - right - 8, y: 30, w: right, h: Math.min(640, H - 40), visible: false });
const atelier = wm.create({ id: "atelier", title: "Atelier de dessin", x: Math.max(8, Math.round(W / 2 - 470)), y: 30, w: Math.min(940, W - 16), h: Math.min(660, H - 40), minW: 640, minH: 460, visible: false });
const loupe = wm.create({ id: "loupe", title: "Loupe — sortie réelle", x: W - right - 290, y: 40, w: 272, h: 440, visible: false, floating: true });
const exportWin = wm.create({ id: "export", title: "Exporter", x: Math.round(W / 2 - 220), y: 50, w: 440, h: Math.min(600, H - 70), visible: false, modal: true });
const accueil = wm.create({ id: "accueil", title: "Bienvenue", x: Math.max(8, Math.round(W / 2 - 400)), y: 20, w: Math.min(800, W - 16), h: Math.min(700, H - 30), visible: false, modal: true });
const guide = wm.create({ id: "guide", title: "Guide pas à pas", x: Math.max(8, W - right - 340), y: 60, w: 330, h: Math.min(520, H - 80), visible: false });
const about = wm.create({ id: "apropos", title: "À propos", x: Math.round(W / 2 - 200), y: 80, w: 400, h: 340, visible: false, resizable: false });
const aiHelp = wm.create({ id: "aide-ia", title: "Installer l'IA locale", x: Math.round(W / 2 - 230), y: 60, w: 460, h: 560, visible: false });
const keys = wm.create({ id: "raccourcis", title: "Raccourcis clavier", x: Math.round(W / 2 - 230), y: 70, w: 460, h: 470, visible: false });

const focusText: { fn?: () => void } = {};
const plancheApi = mountPlanche(planche, focusText);
mountCouches(couches, () => atelier.open(), focusText);
mountDocument(docWin);
mountPile(pile);
mountTrame(trame);
mountGrille(grille);
mountAtelier(atelier, () => aiHelp.open());
mountLoupe(loupe, plancheApi);
mountExport(exportWin);
mountAbout(about);
mountAiHelp(aiHelp);
mountShortcuts(keys);
mountAccueil(accueil, { openProject: () => doOpenProject(), openGuide: () => guide.open() });
mountGuide(guide, () => [
  { title: "1. Où vas-tu imprimer ?", text: "Choisis la destination : le logiciel règle couleurs, résolution et trame.", show: () => flash(docWin) },
  { title: "2. Crée ta texture", text: "Dans Calques : « + Texture », ou dessine-la dans l'Atelier ✎.", show: () => flash(couches) },
  { title: "3. Ajoute texte et logos", text: "Outils T, ▭ et ◈ en haut de la Planche. Glisse un SVG directement dessus.", show: () => { flash(planche); plancheApi.setTool("texte"); } },
  { title: "4. Joue avec les effets", text: "Clique MOSH ! pour essayer des effets au hasard. 🔒 garde ceux que tu aimes.", show: () => flash(pile) },
  { title: "5. Vérifie à la loupe", text: "La Loupe montre les vrais points d'impression. Clique sur la Planche pour la déplacer.", show: () => flash(loupe) },
  { title: "6. Exporte", text: "Le bon format est déjà choisi selon ta destination.", show: () => exportWin.open() },
]);
wm.focus(planche);

// ---- actions de fichier
async function doOpenProject() {
  const f = await pickFile(".frost,application/json");
  if (!f) return;
  try {
    await openProject(f);
    toast("Projet ouvert", f.name, "ok");
  } catch (e) {
    toast("Ouverture impossible", e instanceof Error ? e.message : String(e), "err");
  }
}

async function doImportImage() {
  const f = await pickFile("image/*");
  if (!f) return;
  try {
    const a = await importImageFile(f);
    store.update((d) => {
      const l = d.layers.find((x) => x.id === d.activeLayerId);
      if (!l) return;
      if (isElement(l)) {
        l.fill = { mode: "texture", tint: l.fill?.tint ?? 100 };
        l.source = { ...defaultSource("image"), assetId: a.id };
      } else {
        if (l.source.type !== "image") l.source = defaultSource("image");
        l.source.assetId = a.id;
      }
    });
    toast("Image importée", `${a.name} — ${a.width} × ${a.height} px, placée sur le calque actif.`, "ok");
  } catch {
    toast("Image illisible", "Formats acceptés : JPG, PNG, WebP, GIF, BMP, AVIF.", "err");
  }
}

async function doAddLogo() {
  try {
    const r = await addLogo();
    if (r?.warnings.length) toast("Logo importé", r.warnings.join(" "), "info", 9000);
  } catch (e) {
    toast("Logo illisible", e instanceof Error ? e.message : String(e), "err");
  }
}

const toggleGrid = () =>
  store.update((d) => {
    const on = !(d.layout.show.margins || d.layout.show.columns || d.layout.show.guides);
    d.layout.show = { ...d.layout.show, margins: on, columns: on, guides: on, frames: on };
  });

const winItem = (label: string, w: { toggle(): void; visible: boolean }, k?: string) => ({ label: (w.visible ? "✓ " : "   ") + label, kbd: k, action: () => w.toggle() });

const { status } = mountMenubar(
  document.body,
  [
    {
      title: "Fichier",
      items: [
        { label: "Nouveau…", kbd: "Ctrl+N", action: () => accueil.open() },
        { label: "Ouvrir un projet…", kbd: "Ctrl+O", action: doOpenProject },
        { label: "Enregistrer le projet", kbd: "Ctrl+S", action: () => saveProject() },
        { sep: true, label: "" },
        { label: "Importer une image (texture)…", kbd: "Ctrl+I", action: doImportImage },
        { label: "Importer un logo (SVG, PNG)…", action: doAddLogo },
        { label: "Importer une police…", action: async () => { const f = await pickFile(".ttf,.otf,.woff"); if (f) { try { const a = await importFontFile(f); toast("Police importée", `${a.family} ${a.name}`, "ok"); } catch (e) { toast("Police refusée", String((e as Error).message), "err"); } } } },
        { label: "Importer un profil ICC…", action: async () => { const f = await pickFile(".icc,.icm"); if (f) { const i = await importProfile(f); toast(i ? "Profil importé" : "Profil refusé", i ? i.name : "Fichier ICC illisible.", i ? "ok" : "err"); } } },
        { sep: true, label: "" },
        { label: "Exporter…", kbd: "Ctrl+E", action: () => exportWin.open() },
      ],
    },
    {
      title: "Édition",
      items: [
        { label: "Annuler", kbd: "Ctrl+Z", action: () => store.undo(), enabled: () => store.canUndo },
        { label: "Rétablir", kbd: "Ctrl+Maj+Z", action: () => store.redo(), enabled: () => store.canRedo },
        { sep: true, label: "" },
        { label: "Dupliquer le calque", kbd: "Ctrl+Maj+D", action: () => duplicateLayer() },
        { label: "Supprimer le calque", kbd: "Suppr", action: () => deleteLayer(), enabled: () => store.doc.layers.length > 1 },
      ],
    },
    {
      title: "Mise en page",
      items: [
        { label: "Ajouter un texte", kbd: "T", action: () => { addElement("texte"); setTimeout(() => focusText.fn?.(), 60); } },
        { label: "Ajouter une forme", kbd: "M", action: () => addElement("forme") },
        { label: "Importer un logo…", kbd: "K", action: doAddLogo },
        { sep: true, label: "" },
        { label: "Grille & marges…", action: () => grille.open() },
        { label: "Afficher / masquer la grille", action: toggleGrid },
        { label: (store.doc.layout.snap ? "✓ " : "   ") + "Magnétisme", action: () => store.update((d) => (d.layout.snap = !d.layout.snap)) },
      ],
    },
    {
      title: "Affichage",
      items: [
        { label: "Zoom avant", kbd: "Ctrl++", action: () => plancheApi.zoomIn() },
        { label: "Zoom arrière", kbd: "Ctrl+−", action: () => plancheApi.zoomOut() },
        { label: "Toute la page", kbd: "Ctrl+0", action: () => plancheApi.zoomFit() },
        { label: "Taille réelle (100 %)", kbd: "Ctrl+1", action: () => plancheApi.zoom100() },
        { sep: true, label: "" },
        { label: "Loupe (vrais points)", action: () => loupe.open() },
      ],
    },
    {
      title: "Texture",
      items: [
        { label: "MOSH ! (effets au hasard)", kbd: "Ctrl+M", action: mosh },
        { label: "Mélanger l'ordre des effets", action: shuffleEffects },
        { label: "Désactiver tous les effets", action: disableAllEffects },
        { label: "Nouvelle graine globale", action: newSeed },
        { sep: true, label: "" },
        { label: "Atelier de dessin", kbd: "Ctrl+D", action: () => atelier.open() },
      ],
    },
    {
      title: "Fenêtres",
      get items() {
        return [
          winItem("Planche", planche),
          winItem("Calques", couches),
          winItem("Document", docWin),
          winItem("Pile d'effets", pile),
          winItem("Trame", trame),
          winItem("Grille & marges", grille),
          winItem("Atelier de dessin", atelier, "Ctrl+D"),
          winItem("Loupe", loupe),
          { sep: true, label: "" },
          { label: "Réinitialiser la disposition", action: () => wm.resetLayout() },
        ];
      },
    },
    {
      title: "Aide",
      items: [
        { label: "Écran d'accueil…", action: () => accueil.open() },
        { label: "Guide pas à pas", action: () => guide.open() },
        { label: "Installer l'IA locale…", action: () => aiHelp.open() },
        { label: "Raccourcis clavier", action: () => keys.open() },
        { label: "À propos du laboratoire", action: () => about.open() },
      ],
    },
  ],
  () => about.open(),
);

// boutons directs dans la barre de menus : Atelier + mode Simple / Expert
const atelierBtn = h("button", { class: "btn small frost", type: "button", style: "margin:2px 6px", title: `Atelier de dessin (${kbd("Ctrl+D")})` }, "✎ Atelier");
atelierBtn.addEventListener("click", () => atelier.open());
const modeBtn = h("button", { class: "btn small", type: "button", style: "margin:2px 6px" });
const paintMode = () => {
  modeBtn.textContent = store.expert ? "Mode : Expert" : "Mode : Simple";
  modeBtn.title = store.expert ? "Tous les réglages techniques sont visibles. Cliquer pour le mode Simple." : "Les réglages techniques sont cachés et choisis pour toi. Cliquer pour le mode Expert.";
};
modeBtn.addEventListener("click", () => {
  store.setExpert(!store.expert);
  paintMode();
  toast(store.expert ? "Mode Expert" : "Mode Simple", store.expert ? "Tous les réglages d'imprimeur sont visibles." : "Les réglages techniques sont cachés : la destination d'impression s'en occupe.", "info", 5000);
});
paintMode();
status.before(atelierBtn, modeBtn);

// ---- barre d'état (profil, IA, plateforme)
let aiOnline = false;
function paintStatus() {
  const s = store.doc.settings;
  const prof = store.profiles.find((p) => p.id === s.profileId);
  status.replaceChildren(
    h("span", { title: "Profil CMJN de sortie" }, (s.profileId === GENERIC_CMYK_ID ? "⚠ " : "") + (prof?.name ?? "…").slice(0, 30)),
    h("span", { title: "IA locale (Ollama)" }, h("span", { class: "dot " + (aiOnline ? "on" : "off") }), aiOnline ? "IA locale" : "IA hors ligne"),
    h("span", { class: "muted" }, desktop ? "bureau" : "web"),
  );
}
store.on((r) => (r === "doc" || r === "profiles") && paintStatus());
paintStatus();
probe().then((st) => {
  aiOnline = st.online && st.models.length > 0;
  paintStatus();
});

// ---- raccourcis (Ctrl sur Windows, ⌘ sur Mac)
document.addEventListener("keydown", (e) => {
  const t = e.target instanceof Element ? e.target : document.body;
  const typing = t.matches("input[type=text], textarea, select, [contenteditable]");
  const inAtelier = !!t.closest('[data-win="atelier"]');
  const mod = modKey(e);
  const k = e.key.toLowerCase();
  // zoom : intercepté avant le navigateur (AZERTY, QWERTY et pavé numérique)
  if (mod && (e.key === "+" || e.key === "=" || e.code === "NumpadAdd" || e.code === "Equal")) {
    e.preventDefault();
    return plancheApi.zoomIn();
  }
  if (mod && (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract" || e.code === "Minus")) {
    e.preventDefault();
    return plancheApi.zoomOut();
  }
  if (mod && !e.shiftKey && (e.code === "Digit0" || e.code === "Numpad0")) {
    e.preventDefault();
    return plancheApi.zoomFit();
  }
  if (mod && !e.shiftKey && (e.code === "Digit1" || e.code === "Numpad1")) {
    e.preventDefault();
    return plancheApi.zoom100();
  }
  if (mod && k === "z" && !typing && !inAtelier) {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
  } else if (mod && k === "y" && !typing) {
    e.preventDefault();
    store.redo();
  } else if (mod && k === "m") {
    e.preventDefault();
    mosh();
  } else if (mod && k === "e") {
    e.preventDefault();
    exportWin.open();
  } else if (mod && k === "s") {
    e.preventDefault();
    saveProject();
  } else if (mod && k === "o") {
    e.preventDefault();
    doOpenProject();
  } else if (mod && k === "i") {
    e.preventDefault();
    doImportImage();
  } else if (mod && e.shiftKey && k === "d") {
    e.preventDefault();
    duplicateLayer();
  } else if (mod && k === "d") {
    e.preventDefault();
    atelier.open();
  } else if (mod && k === "n") {
    e.preventDefault();
    accueil.open();
  } else if (!typing && !inAtelier && !mod && !e.altKey) {
    if ((e.key === "Delete" || e.key === "Backspace") && plancheApi.hasSelection()) {
      e.preventDefault();
      deleteLayer();
    } else if (e.key.startsWith("Arrow") && plancheApi.hasSelection()) {
      e.preventDefault();
      const st = e.shiftKey ? 5 : 0.5;
      nudge(e.key === "ArrowLeft" ? -st : e.key === "ArrowRight" ? st : 0, e.key === "ArrowUp" ? -st : e.key === "ArrowDown" ? st : 0);
    } else if (e.key === "Escape") {
      plancheApi.deselect();
    } else if (e.key.length === 1 && !e.shiftKey && plancheApi.toolFromKey(e.key)) {
      e.preventDefault();
    }
  }
});
// Ctrl + molette hors de la planche : on bloque le zoom du navigateur (il casserait l'interface)
window.addEventListener("wheel", (e) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); }, { passive: false });

client.onLog = (text, level) => level === "error" && toast("Moteur", text, "err");

// ---- profils ICC : on choisit un vrai profil CMJN dès que la recherche est finie
let autoProfileDone = false;
store.on((r) => {
  if (r !== "profiles" || autoProfileDone || store.profilesLoading) return;
  autoProfileDone = true;
  if (store.doc.settings.profileId !== GENERIC_CMYK_ID) return;
  const best = preferredCmyk(store.profiles);
  if (best) {
    store.doc.settings.profileId = best;
    store.replace(store.doc);
  }
});
client.ready.then(() => discoverProfiles());
startAutosave();
if (accueilAuDemarrage()) accueil.open();
