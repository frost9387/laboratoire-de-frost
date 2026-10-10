// Ce que l'IA a le droit de régler : les curseurs de l'Atelier (mêmes bornes que l'interface).
import { DESSIN_SLIDERS, ORGANIC_PRESETS } from "../engine/dessin.ts";
import { RD_PRESETS } from "../engine/rd.ts";
import type { Params, ScreenType } from "../engine/types.ts";

export interface AiSuggestion {
  params: Params;
  trame?: ScreenType;
  explication: string;
  source: "ia" | "regles";
}

export const TRAMES_IA: ScreenType[] = ["am", "stochastique", "fm", "bayer", "diffusion", "seuil", "aucune"];

export function jsonSchema() {
  const props: Record<string, unknown> = {
    explication: { type: "string", description: "Une ou deux phrases en français : ce que tu as compris et réglé." },
    motif_organique: { type: "string", enum: ORGANIC_PRESETS },
    trame_suggeree: { type: "string", enum: TRAMES_IA },
  };
  for (const s of DESSIN_SLIDERS) {
    if (s.key === "graine") continue;
    props[s.key] = { type: "number", minimum: s.min, maximum: s.max };
  }
  return { type: "object", properties: props, required: ["explication", ...DESSIN_SLIDERS.filter((s) => s.key !== "graine").map((s) => s.key)] };
}

export function systemPrompt(): string {
  const sliders = DESSIN_SLIDERS.filter((s) => s.key !== "graine")
    .map((s) => `- ${s.key} (${s.min} à ${s.max}${s.unit ? " " + s.unit : ""}) : ${s.label}. ${s.hint}`)
    .join("\n");
  const motifs = Object.entries(RD_PRESETS).map(([k, v]) => `${k} (${v.label})`).join(", ");
  return `Tu es l'assistant texture du « Laboratoire de Frost », un logiciel de textures IMPRIMABLES pour graphistes.
On te donne le croquis de l'utilisateur (une tuile qui se répète : encre noire sur fond blanc) et, parfois, une consigne écrite.
Ta mission : choisir les réglages du moteur de texture pour que le résultat imprimé corresponde à l'intention.
Tu ne dessines pas : tu règles des curseurs. Le moteur fera le rendu à n'importe quelle résolution.

Curseurs disponibles :
${sliders}
- motif_organique : motif de réaction-diffusion utilisé quand « organique » > 0. Choix : ${motifs}.
- trame_suggeree : trame d'impression conseillée (am = points classiques, stochastique = organique, fm = grain de risographie, bayer = pixel rétro, diffusion = bitmap, seuil = trait pur, aucune = ton continu).

Règles :
- Respecte d'abord la consigne écrite, puis l'esprit du croquis.
- Pense impression : évite les détails plus petits que 0,1 mm (échelle trop faible + netteté faible).
- Réponds UNIQUEMENT avec l'objet JSON demandé. L'explication est en français, courte.`;
}

/** Ramène chaque valeur dans ses bornes (l'IA peut se tromper). */
export function sanitize(raw: Record<string, unknown>): AiSuggestion {
  const params: Params = {};
  for (const s of DESSIN_SLIDERS) {
    if (s.key === "graine") continue;
    const v = Number(raw[s.key]);
    if (Number.isFinite(v)) params[s.key] = Math.min(s.max, Math.max(s.min, Math.round(v / s.step) * s.step));
  }
  const motif = String(raw.motif_organique ?? "");
  if (ORGANIC_PRESETS.includes(motif)) params.motif = motif;
  const t = String(raw.trame_suggeree ?? "") as ScreenType;
  return {
    params,
    trame: TRAMES_IA.includes(t) ? t : undefined,
    explication: String(raw.explication ?? "").slice(0, 400) || "Réglages proposés.",
    source: "ia",
  };
}
