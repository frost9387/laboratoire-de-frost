/// <reference lib="webworker" />
// Calculs lourds hors du fil de l'interface : aperçu, loupe, atelier, export.
import wasmUrl from "lcms-wasm/dist/lcms.wasm?url";
import type { Asset, Doc, Intent, Layer, Params } from "../engine/types.ts";
import { ColorEngine } from "../engine/color.ts";
import { FontStore } from "../engine/fonts.ts";
import { FONT_URLS } from "../engine/fontUrls.ts";
import { makeEnv, type Env } from "../engine/render.ts";
import { renderLoupe, renderPreview, type LoupeReq, type PreviewReq } from "../engine/preview.ts";
import { elementGeom, prepareBitmaps, rasterizeElement } from "../engine/elements.ts";
import { dessinTile } from "../engine/sources.ts";
import { dessinResolution, makeDessinSampler } from "../engine/dessin.ts";
import { exportDoc, type ExportOptions } from "../export/exporter.ts";
import { rgbToHex } from "../engine/util.ts";

declare const self: DedicatedWorkerGlobalScope;

const fonts = new FontStore(async (def) => {
  const url = FONT_URLS[def.id];
  if (!url) throw new Error("police inconnue " + def.id);
  return (await fetch(new URL(url, self.location.href))).arrayBuffer();
});
let env: Env = makeEnv(null, fonts);
const ready = ColorEngine.create(new URL(wasmUrl, self.location.href).href)
  .then((c) => {
    env.color = c;
  })
  .catch((e) => {
    post({ type: "log", level: "error", text: "LittleCMS indisponible : " + String(e) });
  });

function post(msg: unknown, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

type Job =
  | { type: "preview"; id: number; doc: Doc; req: PreviewReq }
  | { type: "loupe"; id: number; doc: Doc; req: LoupeReq }
  | { type: "dessin"; id: number; assetId: string; params: Params; size: number; tiles?: number }
  | { type: "overflow"; id: number; doc: Doc };

const latest = new Map<string, Job>();
let running = false;

async function pump() {
  if (running) return;
  running = true;
  await ready;
  try {
    for (;;) {
      const kind = ["dessin", "preview", "overflow", "loupe"].find((k) => latest.has(k));
      if (!kind) break;
      const job = latest.get(kind)!;
      latest.delete(kind);
      try {
        if (job.type === "preview") {
          const r = await renderPreview(job.doc, job.req, env);
          post({ type: "preview", id: job.id, ...r }, [r.rgba.buffer]);
        } else if (job.type === "loupe") {
          const r = await renderLoupe(job.doc, job.req, env);
          post({ type: "loupe", id: job.id, ...r }, [r.rgba.buffer]);
        } else if (job.type === "overflow") {
          const over: string[] = [];
          for (const l of job.doc.layers) {
            if (l.kind !== "texte") continue;
            const g = await elementGeom(job.doc, l, fonts, env.assets, env.cache);
            if (g.overflow) over.push(l.id);
          }
          post({ type: "overflow", id: job.id, ids: over });
        } else {
          const asset = env.assets.get(job.assetId);
          if (!asset) continue;
          const n = job.size;
          const span = Math.max(0.5, Number(job.params.echelle)) * (job.tiles ?? 2.5);
          const tn = dessinResolution(Number(job.params.echelle), (n / span) * 25.4, asset.width);
          const tile = dessinTile(env.cache, asset, job.params, tn);
          const sample = makeDessinSampler(tile, tn, job.params);
          const rgba = new Uint8ClampedArray(n * n * 4);
          for (let y = 0; y < n; y++)
            for (let x = 0; x < n; x++) {
              const v = 255 - Math.round(sample((x / n) * span, (y / n) * span) * 255);
              const i = (y * n + x) * 4;
              rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
              rgba[i + 3] = 255;
            }
          post({ type: "dessin", id: job.id, rgba, w: n, h: n }, [rgba.buffer]);
        }
      } catch (e) {
        post({ type: "error", id: job.id, job: job.type, text: e instanceof Error ? e.message : String(e) });
      }
      // laisser arriver les messages plus récents entre deux tâches
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    running = false;
  }
}

/** Couverture d'un objet dans son propre cadre (px), éventuellement recadrée sur l'encre. */
async function rasterLocal(doc: Doc, layer: Layer, pxPerMm: number, crop: boolean) {
  const box = layer.box ?? { x: 0, y: 0, w: 50, h: 20, rot: 0 };
  const flat: Layer = { ...layer, box: { x: 0, y: 0, w: box.w, h: box.h, rot: 0 }, text: layer.text ? { ...layer.text, baseline: false } : undefined };
  const g = await elementGeom(doc, flat, fonts, env.assets, env.cache);
  await prepareBitmaps([g]);
  const k = Math.min(pxPerMm, 6000 / Math.max(box.w, box.h));
  const W = Math.max(1, Math.ceil(box.w * k));
  const H = Math.max(1, Math.ceil(box.h * k));
  const m = rasterizeElement(g, 0, k * 25.4, 0, 0, W, H);
  if (!crop) return { alpha: m, w: W, h: H, ox: 0, oy: 0, pxPerMm: k };
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (m[y * W + x] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return { alpha: new Uint8Array(1), w: 1, h: 1, ox: 0, oy: 0, pxPerMm: k };
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const out = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) out.set(m.subarray((y0 + y) * W + x0, (y0 + y) * W + x0 + cw), y * cw);
  return { alpha: out, w: cw, h: ch, ox: x0, oy: y0, pxPerMm: k };
}

self.onmessage = async (ev: MessageEvent) => {
  const m = ev.data;
  switch (m.type) {
    case "asset": {
      const a = m.asset as Asset;
      env.assets.set(a.id, a);
      if (a.kind === "police" && a.bytes) fonts.register(a.id, a.bytes);
      break;
    }
    case "profile": {
      await ready;
      const info = env.color?.addProfile(m.id, new Uint8Array(m.bytes), m.origin, m.path) ?? null;
      post({ type: "profile", id: m.id, info, reqId: m.reqId });
      break;
    }
    case "swatches": {
      await ready;
      const recipes: number[][] = m.recipes;
      const cmyk = new Uint8Array(recipes.length * 4);
      recipes.forEach((r, i) => r.forEach((v, c) => (cmyk[i * 4 + c] = Math.round((v / 100) * 255))));
      const rgb = env.color ? env.color.cmykToSrgb(m.profileId, cmyk, recipes.length, m.intent as Intent) : new Uint8Array(recipes.length * 3);
      const hex = recipes.map((_, i) => rgbToHex(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]));
      post({ type: "swatches", reqId: m.reqId, hex });
      break;
    }
    case "preview":
    case "loupe":
    case "dessin":
    case "overflow":
      latest.set(m.type, m as Job);
      pump();
      break;
    case "raster": {
      // un objet (texte, forme, logo) rendu à plat, sans rotation, pour l'Atelier
      await ready;
      try {
        const r = await rasterLocal(m.doc as Doc, m.layer as Layer, Number(m.pxPerMm), !!m.crop);
        post({ type: "raster", id: m.id, ...r }, [r.alpha.buffer]);
      } catch (e) {
        post({ type: "error", id: m.id, job: "raster", text: e instanceof Error ? e.message : String(e) });
      }
      break;
    }
    case "export": {
      await ready;
      try {
        const res = await exportDoc(m.doc as Doc, m.opts as ExportOptions, env, (f, label) =>
          post({ type: "progress", id: m.id, fraction: f, label }),
        );
        post({ type: "exported", id: m.id, ...res }, [res.file.data.buffer]);
      } catch (e) {
        post({ type: "error", id: m.id, job: "export", text: e instanceof Error ? e.message : String(e) });
      }
      break;
    }
    case "reset": {
      const assets = env.assets;
      env = makeEnv(env.color, fonts);
      env.assets = assets;
      break;
    }
  }
};

post({ type: "hello" });
