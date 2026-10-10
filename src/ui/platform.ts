// Raccourcis : Ctrl sur Windows / Linux, Cmd (⌘) sur Mac — affichage adapté.
const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
const plat = (typeof navigator !== "undefined" && (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform) || (typeof navigator !== "undefined" ? navigator.platform : "") || "";

export const isMac = /mac/i.test(plat) || /Mac OS X/.test(ua);

/** Touche de commande principale (Ctrl ou ⌘) pressée ? */
export const modKey = (e: KeyboardEvent | MouseEvent | WheelEvent) => (isMac ? e.metaKey : e.ctrlKey);

/** Libellé d'un raccourci écrit « Ctrl+X » → « ⌘X » sur Mac, « Maj » → « ⇧ ». */
export function kbd(s: string): string {
  if (!isMac) return s;
  return s.replace(/Ctrl\+/g, "⌘").replace(/Maj\+/g, "⇧").replace(/Alt\+/g, "⌥");
}
