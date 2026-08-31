/** Browser → mantel API. Thin, typed, and loud about failures. */

export interface HardwareProfile {
  id: string;
  label: string;
  vramGib: number;
  reservedGib: number;
}

export interface AppConfig {
  brandName: string;
  profiles: HardwareProfile[];
}

export type FitStatus = "fits" | "tight" | "too-big" | "unknown";

export interface QuantFit {
  quant: string;
  fileGib: number;
  minVramGib: number | null;
  status: FitStatus;
  headroomGib: number | null;
  reason: string;
}

export interface ModelFit {
  profile: HardwareProfile;
  quants: QuantFit[];
  best: FitStatus;
  bestQuant: string | null;
  unmeasured: number;
}

export interface ModelRow {
  _id: string;
  name: string;
  params?: string;
  license?: string;
  arch?: string;
  contextNative?: number;
  summary?: string;
  pull?: string;
  tags?: string[];
  labRef?: string;
  quants?: { name: string; fileGib: number; minVramGib: number | null }[];
  links?: { hf?: string; github?: string; ollama?: string };
}

export interface SignalRow {
  _id: string;
  modelRef: string;
  source: string;
  sourceUrl: string;
  authorHandle?: string;
  excerpt: string;
  sentiment: "positive" | "negative" | "mixed" | "neutral";
  hardware?: string;
  claim?: string;
  postedAt: string;
}

/**
 * One fetch helper. Non-2xx becomes a thrown Error carrying the status and the
 * server's own message — never a silent null, which would render as an empty
 * page indistinguishable from "no data".
 */
async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: { accept: "application/json" } });
  if (!r.ok) {
    let detail = "";
    try {
      const body = (await r.json()) as { error?: string; detail?: string };
      detail = body.detail || body.error || "";
    } catch {
      // Body was not JSON — the status alone is the whole story we have, and
      // saying so beats inventing a reason.
      detail = "(no JSON body)";
    }
    throw new Error(`${path} → ${r.status} ${detail}`);
  }
  return (await r.json()) as T;
}

export function getAppConfig(): Promise<AppConfig> {
  return get<AppConfig>("/api/config");
}

export function listModels(): Promise<{ models: ModelRow[]; count: number }> {
  return get("/api/models");
}

export function getModelPage(id: string): Promise<{
  model: ModelRow;
  signals: SignalRow[];
  sentiment: Record<string, number>;
  signalCount: number;
}> {
  return get(`/api/models/${encodeURIComponent(id)}`);
}

export function getFit(id: string): Promise<{ id: string; fits: ModelFit[] }> {
  return get(`/api/fit/${encodeURIComponent(id)}`);
}

export function getFitFor(id: string, profile: string): Promise<{ id: string; fit: ModelFit }> {
  return get(`/api/fit/${encodeURIComponent(id)}/${encodeURIComponent(profile)}`);
}
