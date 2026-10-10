// Sauvegarde automatique dans le navigateur (IndexedDB) : rien n'est perdu en cas de fermeture.
import { store } from "./store.ts";
import { projectJson } from "./project.ts";

const DB = "laboratoire-de-frost";
const STORE = "autosave";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(value: unknown) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, "dernier");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export interface AutosaveEntry {
  json: string;
  name: string;
  time: number;
}

export async function readAutosave(): Promise<AutosaveEntry | null> {
  try {
    const db = await open();
    const v = await new Promise<AutosaveEntry | null>((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get("dernier");
      req.onsuccess = () => resolve((req.result as AutosaveEntry) ?? null);
      req.onerror = () => resolve(null);
    });
    db.close();
    return v;
  } catch {
    return null;
  }
}

let last = "";
let timer = 0;
let armed = false;

/**
 * Autorise la sauvegarde automatique. Au démarrage elle est désarmée : le document vide
 * d'ouverture ne doit pas écraser le travail précédent avant qu'on ait pu le « Reprendre ».
 */
export function armAutosave() {
  armed = true;
}

async function saveNow() {
  if (!armed && !store.canUndo) return;
  try {
    const json = projectJson();
    if (json === last) return;
    last = json;
    await put({ json, name: store.doc.settings.name, time: Date.now() } satisfies AutosaveEntry);
  } catch {
    /* quota dépassé ou stockage indisponible : on réessaiera */
  }
}

/** Démarre la sauvegarde automatique : après chaque modification (3 s) et à la fermeture. */
export function startAutosave() {
  store.on((r) => {
    if (r !== "doc" && r !== "assets") return;
    clearTimeout(timer);
    timer = window.setTimeout(saveNow, 3000);
  });
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && saveNow());
  window.addEventListener("pagehide", () => saveNow());
}
