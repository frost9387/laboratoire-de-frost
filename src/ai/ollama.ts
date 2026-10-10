// IA locale via Ollama (tourne sur la carte graphique du PC, rien ne sort de la machine).
import { jsonSchema, sanitize, systemPrompt, type AiSuggestion } from "./schema.ts";
import type { Params } from "../engine/types.ts";

const KEY_URL = "frost.ia.url";
const KEY_MODEL = "frost.ia.modele";

export interface AiModel {
  name: string;
  vision: boolean;
  sizeGb: number;
}

export interface AiStatus {
  online: boolean;
  models: AiModel[];
  error?: string;
}

const read = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* rien */
  }
};

export const aiConfig = {
  get url() {
    return read(KEY_URL, "http://127.0.0.1:11434").replace(/\/$/, "");
  },
  set url(v: string) {
    write(KEY_URL, v);
  },
  get model() {
    return read(KEY_MODEL, "");
  },
  set model(v: string) {
    write(KEY_MODEL, v);
  },
};

async function withTimeout<T>(p: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await p(ctl.signal);
  } finally {
    clearTimeout(t);
  }
}

/** Vérifie qu'Ollama répond et liste les modèles installés (avec leur capacité « vision »). */
export async function probe(): Promise<AiStatus> {
  try {
    const tags = await withTimeout((signal) => fetch(aiConfig.url + "/api/tags", { signal }).then((r) => r.json()), 2500);
    const models: AiModel[] = [];
    for (const m of tags.models ?? []) {
      // modèles « cloud » : ils enverraient le croquis sur internet → exclus (l'IA doit rester locale)
      if (/(^|[:-])cloud\b/i.test(m.name) || m.remote_host) continue;
      let vision = /vl|vision|llava|gemma[34]|moondream|minicpm|qwen.*vl|granite.*vision|mistral-small3/i.test(m.name);
      try {
        const show = await withTimeout(
          (signal) => fetch(aiConfig.url + "/api/show", { method: "POST", body: JSON.stringify({ model: m.name }), signal }).then((r) => r.json()),
          3000,
        );
        if (Array.isArray(show.capabilities)) vision = show.capabilities.includes("vision");
      } catch {
        /* ancienne version d'Ollama : on garde la devinette par le nom */
      }
      models.push({ name: m.name, vision, sizeGb: (m.size ?? 0) / 1e9 });
    }
    return { online: true, models };
  } catch (e) {
    return { online: false, models: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Demande des réglages au modèle local. `imagePng` = croquis en PNG base64 (sans préfixe). */
export async function askModel(model: string, consigne: string, imagePng: string | null, current: Params, vision: boolean): Promise<AiSuggestion> {
  const user =
    (consigne.trim() ? `Consigne : « ${consigne.trim()} »\n` : "Pas de consigne écrite : interprète le croquis.\n") +
    `Réglages actuels : ${JSON.stringify(current)}\n` +
    (imagePng && vision ? "Le croquis est joint." : "Croquis non transmis (modèle sans vision) : base-toi sur la consigne.");
  const body = {
    model,
    stream: false,
    format: jsonSchema(),
    options: { temperature: 0.35 },
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: user, ...(imagePng && vision ? { images: [imagePng] } : {}) },
    ],
  };
  const res = await withTimeout(
    (signal) => fetch(aiConfig.url + "/api/chat", { method: "POST", body: JSON.stringify(body), signal }),
    180000,
  );
  if (!res.ok) throw new Error(`Ollama a répondu ${res.status} : ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const content = data.message?.content ?? "";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = /\{[\s\S]*\}/.exec(content);
    if (!m) throw new Error("Réponse de l'IA illisible.");
    parsed = JSON.parse(m[0]);
  }
  return sanitize(parsed);
}
