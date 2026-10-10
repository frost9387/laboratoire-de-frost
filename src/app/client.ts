// Client du worker de rendu : chaque demande renvoie une promesse ; les aperçus périmés sont ignorés.
import type { Asset, Doc, Intent, Layer, Params, ProfileInfo } from "../engine/types.ts";
import type { LoupeReq, PreviewReq, PreviewRes } from "../engine/preview.ts";
import type { ExportOptions, ExportResult } from "../export/exporter.ts";

export interface RasterRes {
  /** Couverture 0..255 (encre), w × h. */
  alpha: Uint8Array;
  w: number;
  h: number;
  /** Coin du recadrage dans le cadre de l'objet (px). */
  ox: number;
  oy: number;
  pxPerMm: number;
}

export interface ImageRes {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; progress?: (f: number, label: string) => void };

class RenderClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private latestOf = new Map<string, number>();
  readonly ready: Promise<void>;
  onLog?: (text: string, level: string) => void;

  constructor() {
    this.worker = new Worker(new URL("../worker/render.worker.ts", import.meta.url), { type: "module" });
    let hello: () => void = () => {};
    this.ready = new Promise((r) => (hello = r));
    this.worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === "hello") return hello();
      if (m.type === "log") return this.onLog?.(m.text, m.level);
      const key = m.reqId ?? m.id;
      const p = this.pending.get(key);
      if (!p) return;
      if (m.type === "progress") return p.progress?.(m.fraction, m.label);
      this.pending.delete(key);
      if (m.type === "error") p.reject(new Error(m.text));
      else p.resolve(m);
    };
    this.worker.onerror = (e) => this.onLog?.("Erreur du moteur de rendu : " + e.message, "error");
  }

  private call<T>(msg: Record<string, unknown>, transfer: Transferable[] = [], progress?: Pending["progress"]): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      this.worker.postMessage({ ...msg, id, reqId: id }, transfer);
    });
  }

  /** Comme `call`, mais une demande plus récente du même type rend la précédente caduque. */
  private latest<T>(kind: string, msg: Record<string, unknown>): Promise<T | null> {
    const p = this.call<T>({ ...msg, type: kind });
    const id = this.seq;
    const prev = this.latestOf.get(kind);
    if (prev !== undefined) {
      const old = this.pending.get(prev);
      if (old) {
        this.pending.delete(prev);
        old.resolve(null);
      }
    }
    this.latestOf.set(kind, id);
    return p.then((r) => (this.latestOf.get(kind) === id ? r : null));
  }

  preview(doc: Doc, req: PreviewReq) {
    return this.latest<PreviewRes>("preview", { doc, req });
  }

  loupe(doc: Doc, req: LoupeReq) {
    return this.latest<ImageRes>("loupe", { doc, req });
  }

  /** Aperçu de la texture dessinée répétée (`tiles` tuiles sur `size` px). */
  dessin(assetId: string, params: Params, size: number, tiles = 2.5) {
    return this.latest<ImageRes>("dessin", { assetId, params, size, tiles });
  }

  /** Rend un objet de mise en page à plat (sans rotation), à `pxPerMm` ; `crop` = recadré sur l'encre. */
  raster(doc: Doc, layer: Layer, pxPerMm: number, crop: boolean): Promise<RasterRes> {
    return this.call<RasterRes>({ type: "raster", doc, layer, pxPerMm, crop });
  }

  /** Liste des objets texte dont le contenu déborde du cadre. */
  async overflow(doc: Doc): Promise<string[] | null> {
    const r = await this.latest<{ ids: string[] }>("overflow", { doc });
    return r ? r.ids : null;
  }

  addAsset(a: Asset) {
    this.worker.postMessage({ type: "asset", asset: { ...a, rgba: a.rgba?.slice(), bytes: a.bytes?.slice() } });
  }

  async addProfile(id: string, bytes: Uint8Array, origin: ProfileInfo["origin"], path?: string): Promise<ProfileInfo | null> {
    const r = await this.call<{ info: ProfileInfo | null }>({ type: "profile", id, bytes: bytes.slice(), origin, path });
    return r.info;
  }

  async swatches(profileId: string, intent: Intent, recipes: number[][]): Promise<string[]> {
    const r = await this.call<{ hex: string[] }>({ type: "swatches", profileId, intent, recipes });
    return r.hex;
  }

  export(doc: Doc, opts: ExportOptions, progress: (f: number, label: string) => void): Promise<ExportResult> {
    return this.call<ExportResult>({ type: "export", doc, opts }, [], progress);
  }
}

export const client = new RenderClient();
