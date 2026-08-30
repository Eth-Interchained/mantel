/**
 * The model catalog and its signals — mantel's domain.
 *
 * Collections (all in the embedded engine):
 *   models            the catalog. id is family:tag, e.g. "deepseek-r1:32b"
 *   signals           one observation from one public post about one model
 *   source_documents  the raw capture a signal was extracted from
 *   labs              publishers, enriched with company/hiring data
 *
 * Provenance is the product: every signal cites a source_document by hash via
 * caused_by, so `TRACE caused_by` walks any claim back to the post it came
 * from. A signal with no traceable source is a rumor, and mantel does not
 * store rumors.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { db, causalParent } from "./db";

export const COLLECTIONS = {
  models: "models",
  signals: "signals",
  sources: "source_documents",
  labs: "labs",
} as const;

/** A quantization of a model: what it weighs and what it needs to run. */
export const QuantSchema = z.object({
  /** Quant name as the ecosystem writes it: Q4_K_M, Q8_0, FP16, MLX-4bit. */
  name: z.string().min(1).max(32),
  /** On-disk size of the weights, in GiB. */
  fileGib: z.number().positive().max(2048),
  /**
   * Minimum VRAM to load at the model's default context, in GiB.
   *
   * Nullable ON PURPOSE. This is the number every other directory guesses at,
   * and a guess here is the one lie that would break mantel's promise. When we
   * have not measured or computed it, it is null and the UI says "unmeasured"
   * — never a plausible-looking estimate.
   */
  minVramGib: z.number().positive().max(2048).nullable(),
});

export const ModelSchema = z.object({
  /** family:tag — the id you would actually pull. */
  id: z
    .string()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/, "id must look like family:tag"),
  name: z.string().min(1).max(160),
  /** Publisher key into the labs collection (e.g. "deepseek", "qwen"). */
  labRef: z.string().min(1).max(80).optional(),
  /** Parameter count as published, free text because publishers vary: "32B", "0.8B", "8x7B". */
  params: z.string().min(1).max(32).optional(),
  arch: z.string().max(80).optional(),
  license: z.string().max(120).optional(),
  /** Native context window in tokens. */
  contextNative: z.number().int().positive().max(100_000_000).optional(),
  quants: z.array(QuantSchema).max(64).default([]),
  /** What this model is actually for — drives the ranked feeds. */
  tags: z.array(z.string().min(1).max(40)).max(24).default([]),
  links: z
    .object({
      hf: z.string().url().optional(),
      github: z.string().url().optional(),
      ollama: z.string().url().optional(),
    })
    .default({}),
  /** Pull command shown in the copy-box, npm-style. */
  pull: z.string().max(200).optional(),
  summary: z.string().max(2000).optional(),
});

export type Model = z.infer<typeof ModelSchema>;
export type Quant = z.infer<typeof QuantSchema>;

export const SENTIMENTS = ["positive", "negative", "mixed", "neutral"] as const;
export const SOURCES = ["x", "bluesky", "reddit", "hn", "hf", "github", "mantel"] as const;

export const SignalSchema = z.object({
  modelRef: z.string().min(2).max(120),
  source: z.enum(SOURCES),
  sourceUrl: z.string().url(),
  /** Author handle as published. Never an email, never a real name we resolved. */
  authorHandle: z.string().max(120).optional(),
  /** SHORT quote. Aggregation is fine; republishing someone's post is not. */
  excerpt: z.string().min(1).max(600),
  sentiment: z.enum(SENTIMENTS),
  /** Hardware named in the post, verbatim-ish: "3090", "M2 Max 64GB". */
  hardware: z.string().max(120).optional(),
  /** The single claim this signal carries, in one line. */
  claim: z.string().max(400).optional(),
  postedAt: z.string().datetime(),
});

export type Signal = z.infer<typeof SignalSchema>;

// ── Reads ───────────────────────────────────────────────────────────────────

export async function getModel(id: string): Promise<Record<string, unknown> | null> {
  return db.get(COLLECTIONS.models, id);
}

export async function listModels(limit = 200): Promise<Record<string, unknown>[]> {
  const rows = (await db.query(
    `FROM ${COLLECTIONS.models} LIMIT ${clampLimit(limit)}`,
  )) as Record<string, unknown>[];
  return rows;
}

/** Signals for one model, newest first.
 *
 *  ORDER BY … DESC is real engine grammar (probed: s5,s4 back from a 5-row
 *  ascending seed). It matters here: `ORDER BY x LIMIT n` + reverse() would
 *  truncate to the OLDEST n and then flip them — newest-first of the wrong
 *  subset. DESC makes the engine truncate from the right end. */
export async function signalsFor(
  modelRef: string,
  limit = 100,
): Promise<Record<string, unknown>[]> {
  return (await db.query(
    `FROM ${COLLECTIONS.signals} WHERE modelRef = ${nqlString(modelRef)} ` +
      `ORDER BY postedAt DESC LIMIT ${clampLimit(limit)}`,
  )) as Record<string, unknown>[];
}

/**
 * The latest signals across ALL models, newest first — the homepage wire.
 *
 * Ordered by ORDER BY postedAt (the post's own timestamp, not our capture
 * time): the wire shows when people actually said things, so a backfilled
 * old post lands in its historical place instead of masquerading as news.
 */
export async function latestSignals(limit = 30): Promise<Record<string, unknown>[]> {
  return (await db.query(
    `FROM ${COLLECTIONS.signals} ORDER BY postedAt DESC LIMIT ${clampLimit(limit)}`,
  )) as Record<string, unknown>[];
}

/**
 * Sentiment tally for one model. Uses the engine's GROUP BY rather than
 * counting in JS, so the aggregate is computed where the data lives.
 */
export async function sentimentTally(
  modelRef: string,
): Promise<Record<string, number>> {
  const rows = (await db.query(
    `FROM ${COLLECTIONS.signals} WHERE modelRef = ${nqlString(modelRef)} ` +
      `GROUP BY sentiment COUNT`,
  )) as Record<string, unknown>[];
  const tally: Record<string, number> = {};
  for (const r of rows) {
    // GROUP BY rows carry the grouped value plus its count; field naming has
    // varied across engine versions, so read defensively and skip anything
    // that does not yield a usable (value, count) pair — never invent a zero.
    const key = typeof r.sentiment === "string" ? r.sentiment : null;
    const raw = r.count ?? r.COUNT ?? r._count;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (key === null || !Number.isFinite(n)) {
      console.warn(
        `[mantel] skipping an unreadable GROUP BY row for ${modelRef} — ` +
          `expected {sentiment, count}, got keys [${Object.keys(r).join(", ")}]`,
      );
      continue;
    }
    tally[key] = n;
  }
  return tally;
}

export interface TimelineBucket {
  /** Month key, "YYYY-MM". */
  period: string;
  positive: number;
  negative: number;
  mixed: number;
  neutral: number;
  total: number;
}

/**
 * Sentiment over time for one model — the shareable curve.
 *
 * Buckets signals by the MONTH THEY WERE POSTED (postedAt, not capture time),
 * so the curve reflects when the community actually reacted. Bucketing is done
 * in JS after an ordered pull, deliberately: NQL GROUP BY groups by a stored
 * field value, and there is no stored month field to group on — deriving one
 * at write time would denormalize the same fact twice and risk drift. At these
 * volumes an ordered scan + tally is honest and fast; if signal counts ever
 * make this heavy, the right fix is a materialized month field written ONCE at
 * ingest, not a clever query.
 *
 * Every bucket is reconstructable: the same WHERE + postedAt range that
 * produced a bar returns exactly the signals behind it, so a point on the
 * curve is auditable, not asserted.
 */
export async function sentimentTimeline(
  modelRef: string,
  limit = 1000,
): Promise<TimelineBucket[]> {
  const rows = (await db.query(
    `FROM ${COLLECTIONS.signals} WHERE modelRef = ${nqlString(modelRef)} ` +
      `ORDER BY postedAt LIMIT ${clampLimit(limit)}`,
  )) as Record<string, unknown>[];

  const buckets = new Map<string, TimelineBucket>();
  for (const r of rows) {
    const posted = typeof r.postedAt === "string" ? r.postedAt : null;
    const sentiment = typeof r.sentiment === "string" ? r.sentiment : null;
    // A signal without a usable date or sentiment cannot be placed on the
    // curve — skip it loudly rather than dropping it into a bogus bucket.
    if (!posted || posted.length < 7 || !sentiment) {
      console.warn(
        `[mantel] timeline skipping a signal for ${modelRef} with no usable ` +
          `postedAt/sentiment (id ${String(r._id)})`,
      );
      continue;
    }
    const period = posted.slice(0, 7); // YYYY-MM
    let b = buckets.get(period);
    if (!b) {
      b = { period, positive: 0, negative: 0, mixed: 0, neutral: 0, total: 0 };
      buckets.set(period, b);
    }
    if (sentiment === "positive") b.positive++;
    else if (sentiment === "negative") b.negative++;
    else if (sentiment === "mixed") b.mixed++;
    else if (sentiment === "neutral") b.neutral++;
    else {
      // An unknown sentiment value still counts toward total (it is real
      // evidence) but has no bar segment; log so a new enum value is noticed.
      console.warn(`[mantel] timeline: unknown sentiment "${sentiment}" for ${modelRef}`);
    }
    b.total++;
  }

  // Chronological order for the chart's x-axis.
  return [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period));
}

/** The provenance chain behind one signal — the receipt for a claim. */
export async function traceSignal(signalId: string): Promise<Record<string, unknown>[]> {
  return (await db.query(
    `FROM ${COLLECTIONS.signals} WHERE _id = ${nqlString(signalId)} TRACE caused_by`,
  )) as Record<string, unknown>[];
}

// ── Writes ──────────────────────────────────────────────────────────────────

export async function upsertModel(model: Model): Promise<Record<string, unknown>> {
  const existing = await getModel(model.id);
  const put = await db.put(
    COLLECTIONS.models,
    model.id,
    model as unknown as Record<string, unknown>,
    {
      causedBy: causalParent(existing),
      evidence: existing ? `catalog update: ${model.id}` : `catalog entry: ${model.id}`,
    },
  );
  return put.doc;
}

/**
 * Store a signal and the document it came from, chained.
 *
 * Two writes, deliberately: the raw capture is its own document so the
 * signal's caused_by can point at something immutable and re-readable. The
 * source id is content-addressed (sha256 of the URL) so re-ingesting the same
 * post updates one row instead of growing the store.
 */
export async function recordSignal(
  signal: Signal,
  raw: { capturedAt: string; body: string },
): Promise<{ signalId: string; sourceId: string }> {
  const { createHash } = await import("node:crypto");
  const sourceId = `src_${createHash("sha256").update(signal.sourceUrl).digest("hex").slice(0, 32)}`;
  const signalId = `sig_${createHash("sha256")
    .update(`${signal.sourceUrl}|${signal.modelRef}`)
    .digest("hex")
    .slice(0, 32)}`;

  const existingSource = await db.get(COLLECTIONS.sources, sourceId);
  const source = await db.put(
    COLLECTIONS.sources,
    sourceId,
    {
      url: signal.sourceUrl,
      source: signal.source,
      capturedAt: raw.capturedAt,
      body: raw.body.slice(0, 20_000),
    },
    {
      causedBy: causalParent(existingSource),
      evidence: `capture: ${signal.sourceUrl}`,
    },
  );

  await db.put(
    COLLECTIONS.signals,
    signalId,
    signal as unknown as Record<string, unknown>,
    {
      causedBy: causalParent(source.doc),
      evidence: `extracted from ${sourceId}`,
    },
  );

  return { signalId, sourceId };
}

// ── NQL helpers ─────────────────────────────────────────────────────────────

/**
 * Quote a value for an NQL string literal.
 *
 * VERIFIED ENGINE BEHAVIOR (nedb-engine 2.8.2): NQL string literals have NO
 * escape mechanism. Probed against the real parser:
 *
 *   WHERE v = "back\\slash"   (raw backslash)     -> MATCHES a value with one backslash
 *   WHERE v = "back\\\\slash" (doubled backslash) -> matches nothing
 *   WHERE v = "say \\"hi\\""    (escaped quote)     -> matches nothing
 *
 * So backslashes must pass through UNTOUCHED — doubling them corrupts the
 * value — and a double quote cannot be represented in a literal at all.
 *
 * Worse, a quote does not merely fail to match: it TERMINATES THE LITERAL and
 * the remainder is parsed as further NQL clauses. Confirmed by experiment —
 * a value of `same" LIMIT 2` turned a 5-row result into 2 rows, because the
 * injected LIMIT was honored. That is clause injection.
 *
 * Since the engine offers no escape, the only correct behavior is to REFUSE.
 * Throwing is the honest option: silently stripping the quote would return
 * results for a query the caller did not ask for, which is the failure mode
 * this function exists to prevent. Callers handling untrusted free text should
 * use SEARCH, or filter in JS, rather than building an equality literal.
 *
 * Upstream: nedb should support \\" inside NQL string literals (and reject
 * unterminated ones). Filed as a follow-up on Eth-Interchained/nedb.
 */
export function nqlString(value: string): string {
  if (value.includes('"')) {
    throw new Error(
      `cannot express a value containing a double quote in NQL: ${JSON.stringify(value)} — ` +
        `the engine's string literals have no escape syntax, and the quote would ` +
        `terminate the literal and inject the remainder as NQL clauses`,
    );
  }
  // Backslashes pass through raw: the parser treats them literally.
  return `"${value}"`;
}

/** LIMIT is interpolated, so it must provably be a small positive integer. */
export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 100;
  return Math.min(1000, Math.max(1, Math.floor(limit)));
}

// ── Routes ──────────────────────────────────────────────────────────────────

export const models = Router();

/** The wire: latest signals across every model, for the homepage ticker. */
export const signalsWire = Router();

signalsWire.get("/latest", async (req: Request, res: Response) => {
  const limit = req.query.limit === undefined ? 30 : Number(req.query.limit);
  const rows = await latestSignals(limit);
  res.json({ signals: rows, count: rows.length });
});

models.get("/", async (req: Request, res: Response) => {
  const limit = req.query.limit === undefined ? 200 : Number(req.query.limit);
  const rows = await listModels(limit);
  res.json({ models: rows, count: rows.length });
});

models.get("/:id", async (req: Request, res: Response) => {
  const id = req.params.id;
  const model = await getModel(id);
  if (!model) {
    res.status(404).json({ error: "unknown model", id });
    return;
  }
  const [signals, tally] = await Promise.all([signalsFor(id), sentimentTally(id)]);
  res.json({ model, signals, sentiment: tally, signalCount: signals.length });
});

models.get("/:id/signals", async (req: Request, res: Response) => {
  const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
  const rows = await signalsFor(req.params.id, limit);
  res.json({ signals: rows, count: rows.length });
});

/** Sentiment over time — the shareable curve, one bar per month. */
models.get("/:id/timeline", async (req: Request, res: Response) => {
  const model = await getModel(req.params.id);
  if (!model) {
    res.status(404).json({ error: "unknown model", id: req.params.id });
    return;
  }
  const timeline = await sentimentTimeline(req.params.id);
  res.json({ id: req.params.id, timeline });
});

/** The receipt: walk a claim back to its source document. */
models.get("/:id/signals/:signalId/trace", async (req: Request, res: Response) => {
  const chain = await traceSignal(req.params.signalId);
  if (chain.length === 0) {
    res.status(404).json({ error: "unknown signal", signalId: req.params.signalId });
    return;
  }
  res.json({ trace: chain, depth: chain.length });
});
