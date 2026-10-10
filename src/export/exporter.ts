// Export print : composition calque par calque, tramée bande par bande à la résolution de sortie
// (mémoire bornée), traits de coupe, plaques séparées, fichier CMJN, ZIP + fiche technique.
import type { Doc, PlateDesc } from "../engine/types.ts";
import { proof, type Env } from "../engine/render.ts";
import { composeRegion, openSession } from "../engine/compose.ts";
import { docBox, pxSize } from "../engine/doc.ts";
import { SCREEN_TYPES, AM_SHAPES, KERNELS } from "../engine/screens.ts";
import { SRGB_ID } from "../engine/color.ts";
import { PngWriter, pngRowBytes, type PngOptions } from "./png.ts";
import { TiffWriter, tiffRowBytes, type TiffCompression, type TiffKind } from "./tiff.ts";
import { embedJpegIcc, setJpegDpi } from "./jpg.ts";
import { exportSvg } from "./svgExport.ts";
import { zipStore } from "./bytes.ts";

export type ExportFormat = "jpg" | "png" | "tiff" | "svg";
export type ExportContent = "composite" | "plaques" | "cmjn";

export interface ExportOptions {
  format: ExportFormat;
  content: ExportContent;
  dpi: number;
  bleed: boolean;
  marks: boolean;
  jpgQuality: number; // 0..100
  tiffCompression: TiffCompression;
  embedIcc: boolean;
}

export interface ExportFile {
  name: string;
  mime: string;
  data: Uint8Array;
}

export interface ExportResult {
  file: ExportFile;
  warnings: string[];
  summary: string;
}

type Progress = (fraction: number, label: string) => void;

const MIME: Record<ExportFormat, string> = { jpg: "image/jpeg", png: "image/png", tiff: "image/tiff", svg: "image/svg+xml" };

const safe = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "texture";

/** Limites que chaque format sait réellement porter (affichées dans le dialogue d'export). */
export function formatCapabilities(format: ExportFormat, mode: Doc["settings"]["mode"]) {
  return {
    composite: true,
    plaques: true,
    cmjn: format === "tiff" && mode === "cmjn",
    note:
      format === "png" ? "PNG ne sait pas porter le CMJN : RVB (épreuve) ou plaques en niveaux de gris / 1 bit."
      : format === "jpg" ? "JPG : compression avec perte, RVB uniquement. À réserver aux épreuves et au web."
      : format === "svg" ? "SVG : vectoriel. Texte et formes en vrais contours ; trame AM = vrais points ; autres trames = pixels vectorisés."
      : "TIFF : le format de l'imprimeur. 1 bit, gris, RVB ou CMJN, avec profil ICC et résolution.",
  };
}

export function estimate(doc: Doc, o: ExportOptions) {
  const box = docBox(doc);
  const slug = o.marks ? 10 : 0;
  const bl = o.bleed ? box.bleed : 0;
  const wMm = doc.settings.widthMm + 2 * (bl + slug);
  const hMm = doc.settings.heightMm + 2 * (bl + slug);
  return { wMm, hMm, w: pxSize(wMm, o.dpi), h: pxSize(hMm, o.dpi), originMm: box.bleed - bl - slug };
}

function screenLabel(p: PlateDesc): string {
  const s = p.screen;
  const t = SCREEN_TYPES.find(([k]) => k === s.type)?.[1] ?? s.type;
  let d = t;
  if (s.type === "am") d += `, ${s.lpi} lpi, ${s.angle}°, point ${AM_SHAPES.find(([k]) => k === s.shape)?.[1] ?? s.shape}`;
  if (s.type === "stochastique") d += `, ${s.lpi} lpi équivalent, motif ${s.rdPreset}, ${s.angle}°`;
  if (s.type === "fm" || s.type === "bayer") d += `, grain ${s.grainUm} µm`;
  if (s.type === "diffusion") d += `, ${KERNELS[s.kernel]?.label ?? s.kernel}, grain ${s.grainUm} µm`;
  if (s.type === "seuil") d += `, seuil ${s.level} %`;
  d += ` · engraissement compensé ${s.dotGain} % · point mini ${s.minDot} % · maxi ${s.maxDot} %`;
  return d;
}

/** Dessine les traits de coupe (encre sur toutes les plaques = repérage). */
function drawMarks(buf: Uint8Array, W: number, y0: number, rows: number, dpi: number, doc: Doc, o: ExportOptions) {
  if (!o.marks) return;
  const px = (mm: number) => (mm / 25.4) * dpi;
  const slug = 10;
  const bl = o.bleed ? doc.settings.bleedMm : 0;
  const tx0 = px(slug + bl);
  const ty0 = tx0;
  const tx1 = px(slug + bl + doc.settings.widthMm);
  const ty1 = px(slug + bl + doc.settings.heightMm);
  const gap = px(Math.max(doc.settings.bleedMm, 3) + 0.5);
  const len = px(6);
  const half = Math.max(0.5, px(0.1) / 2);
  const segs: [number, number, number, number][] = [];
  for (const x of [tx0, tx1]) {
    segs.push([x - half, ty0 - gap - len, x + half, ty0 - gap]);
    segs.push([x - half, ty1 + gap, x + half, ty1 + gap + len]);
  }
  for (const y of [ty0, ty1]) {
    segs.push([tx0 - gap - len, y - half, tx0 - gap, y + half]);
    segs.push([tx1 + gap, y - half, tx1 + gap + len, y + half]);
  }
  for (const [ax, ay, bx, by] of segs) {
    const r0 = Math.max(y0, Math.floor(ay));
    const r1 = Math.min(y0 + rows, Math.ceil(by));
    const c0 = Math.max(0, Math.floor(ax));
    const c1 = Math.min(W, Math.ceil(bx));
    for (let y = r0; y < r1; y++) for (let x = c0; x < c1; x++) buf[(y - y0) * W + x] = 255;
  }
}

export async function exportDoc(doc: Doc, o: ExportOptions, env: Env, progress: Progress): Promise<ExportResult> {
  const s = doc.settings;
  const warnings: string[] = [];
  const cppi = Math.min(s.contonePpi, o.dpi);
  const est = estimate(doc, o);
  const base = safe(s.name);
  const files: ExportFile[] = [];
  const profileInfo = env.color?.info(s.profileId);
  const cmykIcc = profileInfo?.space === "CMYK" ? env.color!.bytes(s.profileId) : undefined;
  const rgbId = s.rgbProfileId || SRGB_ID;
  const rgbIcc = rgbId !== SRGB_ID ? env.color?.bytes(rgbId) : undefined;
  const rgbName = env.color?.info(rgbId)?.name ?? "sRGB";

  if (o.content === "cmjn" && !(o.format === "tiff" && s.mode === "cmjn")) {
    throw new Error("Le fichier CMJN unique n'existe qu'en TIFF et en mode CMJN.");
  }

  progress(0.02, "Préparation des calques…");
  const session = await openSession(doc, env, { dpi: o.dpi, cppi, screened: true, autoContone: o.content === "composite" });
  const descs = session.descs;
  if (session.tacLimited) warnings.push(`Taux d'encrage limité à ${s.tacMax} % (pic avant correction : ${Math.round(session.tacPeak)} %).`);
  if (session.tooFine.length) warnings.push(`Épreuve en ton continu pour ${session.tooFine.join(", ")} : la trame est trop fine pour ${o.dpi} dpi.`);
  for (const id of session.overflow) warnings.push(`Texte en excès dans « ${doc.layers.find((l) => l.id === id)?.name ?? id} » : agrandissez le cadre.`);

  // ---------------------------------------------------------------- SVG
  if (o.format === "svg") {
    const svgs = await exportSvg(doc, { originMm: est.originMm, wMm: est.wMm, hMm: est.hMm, dpi: o.dpi, cppi, separate: o.content === "plaques", marks: o.marks, bleedIncluded: o.bleed }, env, warnings, progress);
    const enc = new TextEncoder();
    if (o.content === "plaques") svgs.forEach((x, k) => files.push({ name: `${base}_${String(k + 1).padStart(2, "0")}_${safe(x.name)}.svg`, mime: MIME.svg, data: enc.encode(x.svg) }));
    else files.push({ name: `${base}.svg`, mime: MIME.svg, data: enc.encode(svgs[0].svg) });
    return finalize(doc, o, descs, session.tacPeak, files, warnings, est, profileInfo?.name, rgbName);
  }

  // ---------------------------------------------------------------- raster (bande par bande)
  const W = est.w;
  const H = est.h;
  const box = docBox(doc);
  const PW = pxSize(box.wMm, o.dpi);
  const PH = pxSize(box.hMm, o.dpi);
  const originPx = Math.round((est.originMm / 25.4) * o.dpi);
  if (o.format === "jpg" && (W > 16384 || H > 16384 || W * H > 180e6)) {
    throw new Error(`JPG trop grand (${W} × ${H} px). Utilisez TIFF ou PNG, ou baissez la résolution.`);
  }

  type Sink = { add: (planes: Uint8Array[], rows: number) => Promise<void>; end: () => Promise<void> };
  const sinks: Sink[] = [];

  const packBilevel = (src: Uint8Array, rows: number, invert: boolean, rb: number) => {
    const out = new Uint8Array(rb * rows);
    for (let r = 0; r < rows; r++)
      for (let x = 0; x < W; x++) {
        const ink = src[r * W + x] >= 128;
        if (ink !== invert) out[r * rb + (x >> 3)] |= 0x80 >> (x & 7);
      }
    return out;
  };

  const makeCanvasSink = (name: string, toRgba: (planes: Uint8Array[], rows: number) => Uint8ClampedArray, icc?: Uint8Array): Sink => {
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d")!;
    let y = 0;
    return {
      add: async (planes, rows) => {
        ctx.putImageData(new ImageData(toRgba(planes, rows) as Uint8ClampedArray<ArrayBuffer>, W, rows), 0, y);
        y += rows;
      },
      end: async () => {
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: o.jpgQuality / 100 });
        let bytes: Uint8Array = new Uint8Array(await blob.arrayBuffer());
        bytes = setJpegDpi(bytes, o.dpi);
        if (icc && o.embedIcc) bytes = embedJpegIcc(bytes, icc);
        files.push({ name, mime: MIME.jpg, data: bytes });
      },
    };
  };

  const compositeRgb = (planes: Uint8Array[], rows: number): Uint8Array => {
    const n = W * rows;
    const rgba = proof(doc, descs, planes, n, env);
    let rgb: Uint8Array = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = rgba[i * 4];
      rgb[i * 3 + 1] = rgba[i * 4 + 1];
      rgb[i * 3 + 2] = rgba[i * 4 + 2];
    }
    if (rgbId !== SRGB_ID && env.color) rgb = env.color.srgbToRgb(rgbId, rgb, n, s.intent);
    return rgb;
  };

  if (o.content === "composite") {
    if (o.format === "jpg") {
      sinks.push(
        makeCanvasSink(`${base}_epreuve.jpg`, (planes, rows) => {
          const rgb = compositeRgb(planes, rows);
          const n = W * rows;
          const out = new Uint8ClampedArray(n * 4);
          for (let i = 0; i < n; i++) {
            out[i * 4] = rgb[i * 3];
            out[i * 4 + 1] = rgb[i * 3 + 1];
            out[i * 4 + 2] = rgb[i * 3 + 2];
            out[i * 4 + 3] = 255;
          }
          return out;
        }, rgbIcc),
      );
    } else if (o.format === "png") {
      const opt: PngOptions = { width: W, height: H, kind: "rgb8", dpi: o.dpi, srgb: !rgbIcc, icc: rgbIcc && o.embedIcc ? { name: rgbName, bytes: rgbIcc } : undefined };
      const pw = new PngWriter(opt);
      sinks.push({ add: async (planes, rows) => pw.addRows(compositeRgb(planes, rows), rows), end: async () => { files.push({ name: `${base}_epreuve.png`, mime: MIME.png, data: await pw.finish() }); } });
    } else {
      const tw = new TiffWriter({ width: W, height: H, kind: "rgb8", dpi: o.dpi, compression: o.tiffCompression, icc: o.embedIcc ? rgbIcc : undefined });
      sinks.push(stripSink(tw, (planes, rows) => compositeRgb(planes, rows), async (data) => { files.push({ name: `${base}_epreuve.tif`, mime: MIME.tiff, data }); }));
    }
  } else if (o.content === "cmjn") {
    const tw = new TiffWriter({ width: W, height: H, kind: "cmyk8", dpi: o.dpi, compression: o.tiffCompression, icc: o.embedIcc ? cmykIcc : undefined });
    if (!cmykIcc) warnings.push("Aucun profil ICC CMJN chargé : le TIFF n'embarque pas de profil (CMJN générique).");
    sinks.push(
      stripSink(tw, (planes, rows) => {
        const n = W * rows;
        const out = new Uint8Array(n * 4);
        for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) out[i * 4 + c] = planes[c][i];
        return out;
      }, async (data) => { files.push({ name: `${base}_CMJN.tif`, mime: MIME.tiff, data }); }),
    );
  } else {
    descs.forEach((d, k) => {
      const fname = `${base}_${String(k + 1).padStart(2, "0")}_${safe(d.name)}`;
      const bilevel = session.bitsK[k];
      if (o.format === "png") {
        const opt: PngOptions = { width: W, height: H, kind: bilevel ? "gray1" : "gray8", dpi: o.dpi };
        const pw = new PngWriter(opt);
        const rb = pngRowBytes(opt);
        sinks.push({
          add: async (planes, rows) => {
            const src = planes[k];
            if (bilevel) await pw.addRows(packBilevel(src, rows, true, rb), rows);
            else {
              const g = new Uint8Array(W * rows);
              for (let i = 0; i < g.length; i++) g[i] = 255 - src[i];
              await pw.addRows(g, rows);
            }
          },
          end: async () => { files.push({ name: fname + ".png", mime: MIME.png, data: await pw.finish() }); },
        });
      } else if (o.format === "tiff") {
        const kind: TiffKind = bilevel ? "bilevel" : "gray8";
        const comp: TiffCompression = bilevel && o.tiffCompression === "lzw" ? "packbits" : o.tiffCompression;
        const tw = new TiffWriter({ width: W, height: H, kind, dpi: o.dpi, compression: comp });
        const rb = tiffRowBytes({ width: W, height: H, kind, dpi: o.dpi, compression: comp });
        sinks.push(
          stripSink(tw, (planes, rows) => {
            const src = planes[k];
            if (bilevel) return packBilevel(src, rows, false, rb);
            const g = new Uint8Array(W * rows);
            for (let i = 0; i < g.length; i++) g[i] = 255 - src[i];
            return g;
          }, async (data) => { files.push({ name: fname + ".tif", mime: MIME.tiff, data }); }),
        );
      } else {
        sinks.push(
          makeCanvasSink(fname + ".jpg", (planes, rows) => {
            const src = planes[k];
            const out = new Uint8ClampedArray(W * rows * 4);
            for (let i = 0; i < W * rows; i++) {
              const v = 255 - src[i];
              out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
              out[i * 4 + 3] = 255;
            }
            return out;
          }),
        );
      }
    });
  }

  // boucle principale : une bande à la fois
  const BAND = Math.max(8, Math.min(256, Math.floor(8e6 / Math.max(1, W))));
  const planes = descs.map(() => new Uint8Array(W * BAND));
  for (let y = 0; y < H; y += BAND) {
    const rows = Math.min(BAND, H - y);
    planes.forEach((p) => p.fill(0, 0, W * rows));
    const py0 = Math.max(0, y + originPx);
    const py1 = Math.min(PH, y + rows + originPx);
    const c0 = Math.max(0, originPx);
    const c1 = Math.min(PW, W + originPx);
    if (py1 > py0 && c1 > c0) {
      const cw = c1 - c0;
      const region = composeRegion(session, c0, py0, c1, py1);
      region.forEach((src, k) => {
        for (let py = py0; py < py1; py++) {
          const dst = (py - originPx - y) * W + (c0 - originPx);
          planes[k].set(src.subarray((py - py0) * cw, (py - py0 + 1) * cw), dst);
        }
      });
    }
    planes.forEach((p) => drawMarks(p, W, y, rows, o.dpi, doc, o));
    for (const sk of sinks) await sk.add(planes.map((p) => p.subarray(0, W * rows)), rows);
    progress(0.05 + 0.9 * ((y + rows) / H), `Tramage ${Math.round(((y + rows) / H) * 100)} %`);
  }
  for (const sk of sinks) await sk.end();
  return finalize(doc, o, descs, session.tacPeak, files, warnings, est, profileInfo?.name, rgbName);
}

/** Adapte un TiffWriter (bandes de taille fixe) à la boucle de rendu. */
function stripSink(tw: TiffWriter, pack: (planes: Uint8Array[], rows: number) => Uint8Array, done: (d: Uint8Array) => Promise<void>) {
  let pending: Uint8Array[] = [];
  let pendingRows = 0;
  let rowBytes = 0;
  const flush = (force: boolean) => {
    while (pendingRows >= tw.rowsPerStrip || (force && pendingRows > 0)) {
      const all = new Uint8Array(pendingRows * rowBytes);
      let o = 0;
      for (const p of pending) { all.set(p, o); o += p.length; }
      const take = Math.min(tw.rowsPerStrip, pendingRows);
      tw.addStrip(all.subarray(0, take * rowBytes), take);
      pending = [all.slice(take * rowBytes)];
      pendingRows -= take;
    }
  };
  return {
    add: async (planes: Uint8Array[], rows: number) => {
      const packed = pack(planes, rows);
      rowBytes = packed.length / rows;
      pending.push(packed);
      pendingRows += rows;
      flush(false);
    },
    end: async () => {
      flush(true);
      await done(tw.finish());
    },
  };
}

function finalize(
  doc: Doc,
  o: ExportOptions,
  descs: PlateDesc[],
  tacPeak: number,
  files: ExportFile[],
  warnings: string[],
  est: { wMm: number; hMm: number; w: number; h: number },
  profileName: string | undefined,
  rgbName: string,
): ExportResult {
  const s = doc.settings;
  const mode = { cmjn: "CMJN (quadrichromie)", gris: "Niveaux de gris", bitmap: "Bitmap 1 bit", directs: "Tons directs" }[s.mode];
  const objets = doc.layers.filter((l) => l.visible && l.kind && l.kind !== "texture");
  const lines = [
    "LE LABORATOIRE DE FROST — fiche technique d'export",
    "==================================================",
    `Document        : ${s.name}`,
    `Format fini     : ${s.widthMm} × ${s.heightMm} mm`,
    `Fond perdu      : ${s.bleedMm} mm ${o.bleed ? "(inclus)" : "(non inclus)"}`,
    `Traits de coupe : ${o.marks ? "oui (marge technique 10 mm)" : "non"}`,
    `Taille fichier  : ${est.wMm.toFixed(1)} × ${est.hMm.toFixed(1)} mm — ${est.w} × ${est.h} px à ${o.dpi} dpi`,
    `Mode couleur    : ${mode}`,
    `Profil CMJN     : ${profileName ?? "CMJN générique (approximation, sans ICC)"}`,
    `Profil RVB      : ${rgbName}`,
    `Intention       : ${s.intent}${s.bpc ? " + compensation du point noir" : ""}`,
    `Encrage max     : ${s.tacMax} % (pic mesuré sur les textures ${Math.round(tacPeak)} %)`,
    `Format          : ${o.format.toUpperCase()} — ${o.content === "composite" ? "épreuve composite" : o.content === "cmjn" ? "fichier CMJN" : "plaques séparées"}`,
    "",
    "Plaques :",
    ...descs.map((p, i) => `  ${i + 1}. ${p.name} (${p.hex}) — ${screenLabel(p)}`),
    ...(objets.length
      ? ["", "Objets de mise en page :", ...objets.map((l) => `  - ${l.name} (${l.image?.dessin ? "dessin à la main" : l.kind}) — encre ${l.ink.name}${l.overprint ? ", en surimpression" : ", en réserve"}${l.fill?.mode === "texture" ? ", texturé" : ""}`)]
      : []),
    "",
    ...(warnings.length ? ["Avertissements :", ...warnings.map((w) => "  - " + w), ""] : []),
    "Fichiers :",
    ...files.map((f) => `  ${f.name} (${(f.data.length / 1048576).toFixed(2)} Mo)`),
  ];
  const summary = lines.join("\n");
  if (files.length === 1) return { file: files[0], warnings, summary };
  const zip = zipStore([...files, { name: "LISEZ-MOI_fiche-technique.txt", mime: "text/plain", data: new TextEncoder().encode(summary) }]);
  return { file: { name: `${safe(s.name)}_export.zip`, mime: "application/zip", data: zip }, warnings, summary };
}
