// État de l'application + historique complet (annuler / rétablir), point faible n°25 de Mosh corrigé.
import type { Asset, Doc, Layer, ProfileInfo } from "../engine/types.ts";
import { defaultDoc } from "../engine/doc.ts";

const EXPERT_KEY = "frost.expert";

export type Reason = "doc" | "selection" | "profiles" | "assets" | "status" | "overflow";
type Listener = (reason: Reason, origin?: string) => void;

const MAX_HISTORY = 120;

class Store {
  doc: Doc = defaultDoc();
  assets = new Map<string, Asset>();
  profiles: ProfileInfo[] = [];
  /** Profils encore en chargement (découverte système). */
  profilesLoading = true;
  selectedEffectId: string | null = null;
  /** Mode Expert : affiche tous les réglages techniques (sinon : mode Simple). */
  expert = (() => {
    try {
      return localStorage.getItem(EXPERT_KEY) === "1";
    } catch {
      return false;
    }
  })();
  /** Objets dont le texte déborde du cadre (calculé par le moteur). */
  overflowIds = new Set<string>();

  setExpert(on: boolean) {
    this.expert = on;
    try {
      localStorage.setItem(EXPERT_KEY, on ? "1" : "0");
    } catch {
      /* rien */
    }
    document.body.classList.toggle("simple", !on);
    this.emit("status");
  }
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private committed = JSON.stringify(this.doc);
  private listeners = new Set<Listener>();
  private pendingTimer = 0;

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason: Reason, origin?: string) {
    this.listeners.forEach((fn) => fn(reason, origin));
  }

  get layer(): Layer {
    return this.doc.layers.find((l) => l.id === this.doc.activeLayerId) ?? this.doc.layers[0];
  }

  /** Change le calque actif SANS créer d'étape d'annulation (une sélection n'est pas une modification). */
  select(id: string) {
    if (this.doc.activeLayerId === id) return;
    this.doc.activeLayerId = id;
    try {
      const c = JSON.parse(this.committed);
      c.activeLayerId = id;
      this.committed = JSON.stringify(c);
    } catch {
      /* rien */
    }
    this.emit("selection");
  }

  /**
   * Modifie le document. `live` : pendant un geste (curseur), l'historique est écrit
   * à la fin du geste ou après une courte pause.
   */
  update(mut: (d: Doc) => void, opts: { live?: boolean; origin?: string } = {}) {
    mut(this.doc);
    this.emit("doc", opts.origin);
    if (opts.live) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = window.setTimeout(() => this.commit(), 700);
    } else this.commit();
  }

  commit() {
    clearTimeout(this.pendingTimer);
    const now = JSON.stringify(this.doc);
    if (now === this.committed) return;
    this.undoStack.push(this.committed);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.committed = now;
    this.emit("status");
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    this.commit();
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.committed);
    this.committed = prev;
    this.doc = JSON.parse(prev);
    this.emit("doc");
    this.emit("status");
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.committed);
    this.committed = next;
    this.doc = JSON.parse(next);
    this.emit("doc");
    this.emit("status");
  }

  /** Remplace tout le document (nouveau / ouverture de projet). */
  replace(doc: Doc, keepHistory = false) {
    if (!keepHistory) {
      this.undoStack = [];
      this.redoStack = [];
    } else this.undoStack.push(this.committed);
    this.doc = doc;
    this.committed = JSON.stringify(doc);
    this.emit("doc");
    this.emit("status");
  }

  addAsset(a: Asset) {
    this.assets.set(a.id, a);
    this.emit("assets");
  }

  setProfiles(list: ProfileInfo[], loading: boolean) {
    this.profiles = list;
    this.profilesLoading = loading;
    this.emit("profiles");
  }
}

export const store = new Store();
