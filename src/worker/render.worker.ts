/// <reference lib="webworker" />
// Calculs lourds hors du fil de l'interface : aperçu, loupe, atelier, export.
import wasmUrl from "lcms-wasm/dist/lcms.wasm?url";
import type { Asset, Doc, Intent, Params } from "../engine/types.ts";
import { ColorEngine } from "../engine/color.ts";
import { FontStore } from "../engine/fonts.ts";
import { FONT_URLS } from "../engine/fontUrls.ts";
import { makeEnv, type Env } from "../engine/render.ts";
import { renderLoupe, renderPreview, type LoupeReq, type PreviewReq } from "../engine/preview.ts";
import { elementGeom } from "../engine/elements.ts";
import { dessinTile } from "../engine/sources.ts";
import { makeDessinSampler } from "../engine/dessin.ts";
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
  | { type: "dessin"; id: number; assetId: string; params: Params; size: number }
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
          const tile = dessinTile(env.cache, asset, job.params, 256);
          const sample = makeDessinSampler(tile, 256, job.params);
          const n = job.size;
          const span = Math.max(0.5, Number(job.params.echelle)) * 2.5;
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
