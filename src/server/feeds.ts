/**
 * Ranked feeds — "best coder under 20GB", "best reasoner that fits 48GB".
 *
 * One boring ranked list per use case, and the ranking is TRANSPARENT: this
 * file is the whole algorithm, there is no hidden model. A feed is
 *   a use-case tag  +  a VRAM ceiling
 * and it ranks the models that (a) carry the tag and (b) actually fit that
 * VRAM, by how people feel about them — with a floor of evidence so a single
 * glowing post cannot top a model with a real track record.
 *
 * WHERE HONESTY BITES: a model whose quants are all unmeasured cannot be
 * proven to fit, so it CANNOT rank in a VRAM-constrained feed. It is not
 * dropped silently — the feed response reports how many candidates were
 * excluded for lack of measurement, so "my model isn't listed" has a visible
 * answer instead of looking like censorship.
 */

import { Router, type Request, type Response } from "express";

import { fitModel, customProfile, type FitStatus } from "./fit";
import { listModels, sentimentTally } from "./models";

/** The curated feeds. Kept small and legible — this is the whole menu. */
export interface FeedDef {
  id: string;
  label: string;
  /** Model must carry this tag to be a candidate. */
  tag: string;
  /** VRAM ceiling in GiB the model must fit within. */
  vramGib: number;
  blurb: string;
}

export const FEEDS: FeedDef[] = [
  { id: "coder-under-20", label: "Best coder under 20GB", tag: "coder", vramGib: 20, blurb: "Coding models that load on a 16–20GB card." },
  { id: "reasoner-under-24", label: "Best reasoner on a 24GB card", tag: "reasoning", vramGib: 24, blurb: "Reasoning models that fit a single 3090/4090." },
  { id: "reasoner-under-48", label: "Best reasoner that fits 48GB", tag: "reasoning", vramGib: 48, blurb: "Reasoning models for an A6000-class card." },
  { id: "chat-under-12", label: "Best chat under 12GB", tag: "chat", vramGib: 12, blurb: "General chat models for modest GPUs." },
  { id: "vision-under-24", label: "Best vision model under 24GB", tag: "vision", vramGib: 24, blurb: "Multimodal models that fit a 24GB card." },
];

/** Sentiment weights: a positive is +1, negative −1, mixed a light −, neutral 0. */
const WEIGHT: Record<string, number> = { positive: 1, negative: -1, mixed: -0.25, neutral: 0 };

/**
 * A Wilson-flavored score that rewards evidence, not just ratio.
 *
 * raw ratio alone lets one 5-star review (1 signal, score 1.0) beat a model
 * with 40 mostly-positive ones. We damp by volume: score = weightedSum /
 * (total + SMOOTH). A model with 1 positive scores 1/(1+4)=0.2; a model with
 * 20 positive scores 20/24=0.83. Evidence wins, as it should on a site whose
 * whole pitch is receipts.
 */
const SMOOTH = 4;

export interface RankedRow {
  id: string;
  name: string;
  params?: string;
  fitStatus: FitStatus;
  fitQuant: string | null;
  signalCount: number;
  score: number;
  sentiment: Record<string, number>;
}

export function scoreFrom(tally: Record<string, number>): { score: number; total: number } {
  let weighted = 0;
  let total = 0;
  for (const [k, n] of Object.entries(tally)) {
    weighted += (WEIGHT[k] ?? 0) * n;
    total += n;
  }
  return { score: Number((weighted / (total + SMOOTH)).toFixed(4)), total };
}

export interface FeedResult {
  feed: FeedDef;
  ranked: RankedRow[];
  /** Candidates that carry the tag but were excluded because no quant is
   *  measured, so fit cannot be proven. Surfaced, never hidden. */
  excludedUnmeasured: number;
}

/**
 * Build one feed. `profileVram` overrides the feed's default ceiling (the
 * "type your own VRAM" case).
 */
export async function buildFeed(def: FeedDef, profileVram?: number): Promise<FeedResult> {
  const vram = profileVram ?? def.vramGib;
  const profile = customProfile(vram);
  if (!profile) {
    throw new Error(`invalid VRAM ceiling ${vram} for feed ${def.id}`);
  }

  const all = await listModels(1000);
  const candidates = all.filter(
    (m) => Array.isArray(m.tags) && (m.tags as string[]).includes(def.tag),
  );

  const ranked: RankedRow[] = [];
  let excludedUnmeasured = 0;

  for (const m of candidates) {
    const quants = readQuants(m);
    const fit = fitModel(quants, profile);

    // Must be PROVEN to fit. "unknown" (all quants unmeasured) and "too-big"
    // are both out — but for different reasons, and we only count the former
    // as "excluded for lack of measurement" since that is the fixable one.
    if (fit.best === "unknown") {
      excludedUnmeasured++;
      continue;
    }
    if (fit.best === "too-big") continue;

    const tally = await sentimentTally(String(m._id));
    const { score, total } = scoreFrom(tally);
    ranked.push({
      id: String(m._id),
      name: String(m.name ?? m._id),
      params: typeof m.params === "string" ? m.params : undefined,
      fitStatus: fit.best,
      fitQuant: fit.bestQuant,
      signalCount: total,
      score,
      sentiment: tally,
    });
  }

  // Highest score first; ties broken by evidence volume, then id for stability.
  ranked.sort(
    (a, b) => b.score - a.score || b.signalCount - a.signalCount || a.id.localeCompare(b.id),
  );

  return { feed: { ...def, vramGib: vram }, ranked, excludedUnmeasured };
}

/** Local copy of the app's defensive quant reader — same never-invent rule. */
function readQuants(
  model: Record<string, unknown>,
): { name: string; fileGib: number; minVramGib: number | null }[] {
  const raw = model.quants;
  if (!Array.isArray(raw)) return [];
  const out: { name: string; fileGib: number; minVramGib: number | null }[] = [];
  for (const q of raw) {
    if (typeof q !== "object" || q === null) continue;
    const e = q as Record<string, unknown>;
    if (typeof e.name !== "string" || typeof e.fileGib !== "number") continue;
    out.push({
      name: e.name,
      fileGib: e.fileGib,
      minVramGib: typeof e.minVramGib === "number" ? e.minVramGib : null,
    });
  }
  return out;
}

export const feeds = Router();

/** The menu of feeds. */
feeds.get("/", (_req: Request, res: Response) => {
  res.json({ feeds: FEEDS });
});

/** One ranked feed. Optional ?vram=N overrides the ceiling. */
feeds.get("/:id", async (req: Request, res: Response) => {
  const def = FEEDS.find((f) => f.id === req.params.id);
  if (!def) {
    res.status(404).json({ error: "unknown feed", id: req.params.id, known: FEEDS.map((f) => f.id) });
    return;
  }
  const vram = req.query.vram === undefined ? undefined : Number(req.query.vram);
  if (vram !== undefined && !customProfile(vram)) {
    res.status(400).json({ error: "invalid vram", vram: req.query.vram, hint: "a GiB figure like 24" });
    return;
  }
  const result = await buildFeed(def, vram);
  res.json(result);
});
