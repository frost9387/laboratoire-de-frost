// Pont vers la version bureau (Electron). Absent dans le navigateur : on retombe sur le web.
export interface FrostDesktop {
  isDesktop: true;
  listProfiles(): Promise<{ path: string; file: string }[]>;
  readProfile(path: string): Promise<ArrayBuffer>;
  saveFile(name: string, data: Uint8Array): Promise<string | null>;
}

declare global {
  interface Window {
    frostDesktop?: FrostDesktop;
  }
}

export const desktop: FrostDesktop | undefined = window.frostDesktop;

/** Enregistre un fichier : boîte de dialogue native sur le bureau, téléchargement dans le navigateur. */
export async function saveBytes(name: string, data: Uint8Array, mime: string): Promise<string | null> {
  if (desktop) return desktop.saveFile(name, data);
  const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return name;
}

/** Ouvre un sélecteur de fichier et renvoie le fichier choisi. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.onchange = () => resolve(inp.files?.[0] ?? null);
    inp.oncancel = () => resolve(null);
    inp.click();
  });
}
