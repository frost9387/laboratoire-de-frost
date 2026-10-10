// Aperçu de la Planche (région visible seulement) et Loupe à la résolution de sortie.
import type { Doc } from "./types.ts";
import { composeRegion, openSession } from "./compose.ts";
import { proof, type Env } from "./render.ts";
import { docBox, pxSize } from "./doc.ts";

export interface PreviewReq {
  ppi: number;
  screened: boolean;
  plate: string; // "composite" ou clé de plaque
  /** Région visible en pixels à `ppi` (repère du fond perdu). Absente = toute la page. */
  region?: { x0: number; y0: number; x1: number; y1: number };
}

export interface PreviewRes {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
  x0: number;
  y0: number;
  fullW: number;
  fullH: number;
  tacPeak: number;
  tacLimited: boolean;
  tooFine: string[];
  overflow: string[];
  ms: number;
}

function toRgba(doc: Doc, s: Awaited<ReturnType<typeof openSession>>, planes: Uint8Array[], n: number, plate: string, env: Env) {
  if (plate !== "composite") {
    const k = Math.max(0, s.descs.findIndex((d) => d.key === plate));
    const one = { ...doc, settings: { ...doc.settings, mode: "directs" as const } };
    return proof(one, [s.descs[k]], [planes[k]], n, env);
  }
  return proof(doc, s.descs, planes, n, env);
}

export async function renderPreview(doc: Doc, req: PreviewReq, env: Env): Promise<PreviewRes> {
  const t0 = performance.now();
  const cppi = Math.min(req.ppi, doc.settings.contonePpi);
  const s = await openSession(doc, env, { dpi: req.ppi, cppi, screened: req.screened, autoContone: true });
  const r = req.region ?? { x0: 0, y0: 0, x1: s.fullW, y1: s.fullH };
  const x0 = Math.max(0, Math.min(s.fullW - 1, Math.floor(r.x0)));
  const y0 = Math.max(0, Math.min(s.fullH - 1, Math.floor(r.y0)));
  const x1 = Math.max(x0 + 1, Math.min(s.fullW, Math.ceil(r.x1)));
  const y1 = Math.max(y0 + 1, Math.min(s.fullH, Math.ceil(r.y1)));
  const planes = composeRegion(s, x0, y0, x1, y1);
  const n = (x1 - x0) * (y1 - y0);
  return {
    rgba: toRgba(doc, s, planes, n, req.plate, env),
    w: x1 - x0, h: y1 - y0, x0, y0, fullW: s.fullW, fullH: s.fullH,
    tacPeak: s.tacPeak, tacLimited: s.tacLimited, tooFine: s.tooFine, overflow: s.overflow,
    ms: performance.now() - t0,
  };
}

export interface LoupeReq {
  cxMm: number; // centre, en mm depuis le coin du fond perdu
  cyMm: number;
  size: number; // côté en pixels de sortie
  plate: string;
}

/** Vue à la résolution de sortie réelle (contrôle des points et des bords du texte). */
export async function renderLoupe(doc: Doc, req: LoupeReq, env: Env): Promise<{ rgba: Uint8ClampedArray; w: number; h: number }> {
  const st = doc.settings;
  const cppi = Math.min(st.contonePpi, st.dpi);
  const s = await openSession(doc, env, { dpi: st.dpi, cppi, screened: true, autoContone: false });
  const box = docBox(doc);
  const W = pxSize(box.wMm, st.dpi);
  const H = pxSize(box.hMm, st.dpi);
  const size = Math.min(req.size, W, H);
  const x0 = Math.max(0, Math.min(W - size, Math.round((req.cxMm / 25.4) * st.dpi - size / 2)));
  const y0 = Math.max(0, Math.min(H - size, Math.round((req.cyMm / 25.4) * st.dpi - size / 2)));
  const planes = composeRegion(s, x0, y0, x0 + size, y0 + size);
  return { rgba: toRgba(doc, s, planes, size * size, req.plate, env), w: size, h: size };
}
