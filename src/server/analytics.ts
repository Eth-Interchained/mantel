/**
 * Analytics — the events collection made visible.
 *
 * Every number on the dashboard is a LIVE NQL GROUP BY against the
 * engine at request time. Nothing is precomputed, nothing is cached,
 * no counter documents exist to drift out of sync: the append-only
 * event log IS the analytics store, and the engine's aggregation is
 * the analytics engine. This endpoint is the dogfooding mission in
 * one file.
 *
 *   views          FROM events WHERE identityId='…' GROUP BY kind
 *   scans vs taps  … AND kind='profile_view' GROUP BY source
 *   top links      … AND kind='link_click'  GROUP BY blockId
 *
 * Engine grammar notes (probed live against nedbd 2.6.1):
 *   - GROUP BY returns [{ <field>, count }] rows.
 *   - ORDER BY on grouped rows returns [] silently — sort server-side.
 *   - SELECT COUNT(*) is not the grammar; FROM-first only.
 */

import { Router } from "express";

import { COLLECTIONS, type IdentityManifest } from "../lib/identity";
import { authOf, requireUser } from "./auth";
import { db } from "./db";
import { hasRole } from "./grants";
import { getManifest, listVisibleManifests } from "./identities";
import { wrap } from "./util";

export const analytics = Router({ mergeParams: true });
export const analyticsSummary = Router();

/** identityIds are ours (idn_ + hex) — validate before NQL interpolation.
 *  Defense in depth: no quoting gymnastics, just a strict format gate. */
const SAFE_ID = /^idn_[a-z0-9]{6,64}$/i;

interface GroupRow {
  count?: unknown;
  [k: string]: unknown;
}

/** App-side aggregation — the pure reducer behind the engine fallback.
 *  Exported for unit tests. */
export function aggregateBy(
  rows: Array<Record<string, unknown>>,
  by: string,
): Array<{ key: string; count: number }> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[by] ?? "unknown");
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

/** Did the engine actually aggregate? Native GROUP BY rows carry a
 *  numeric `count`; engines that parse-but-ignore the clause (rust
 *  nedb-v2 @ 2.6.1) return the RAW filtered events instead. */
function isAggregated(rows: GroupRow[]): boolean {
  return rows.length > 0 && rows.every((r) => typeof r.count === "number");
}

let warnedFallback = false;
function warnFallbackOnce(): void {
  if (warnedFallback) return;
  warnedFallback = true;
  console.warn(
    "[links] engine did not aggregate GROUP BY — computing analytics app-side. " +
      "Native aggregation works on the Python engine; the rust nedb-v2 daemon " +
      "parses but does not yet execute GROUP BY (parity gap, queued upstream).",
  );
}

/**
 * One live GROUP BY, normalized to sorted {key, count} rows — correct on
 * EVERY engine build:
 *   - Python 2.6.1:      native aggregation (bare or explicit COUNT).
 *   - rust nedb-core:    native aggregation.
 *   - rust nedb-v2:      REQUIRES the aggregate keyword and then ignores
 *                        the clause at execution, returning raw filtered
 *                        events — detected and aggregated app-side from
 *                        those same rows (no second query).
 *   - parse error paths: both daemons swallow NQL errors into [] — one
 *                        bounded plain-WHERE fetch distinguishes "truly
 *                        empty" from "engine couldn't", then reduces.
 */
async function groupCount(
  where: string,
  by: string,
): Promise<Array<{ key: string; count: number }>> {
  let rows: GroupRow[] = [];
  try {
    rows = (await db.query(
      `FROM ${COLLECTIONS.events} WHERE ${where} GROUP BY ${by} COUNT`,
    )) as GroupRow[];
  } catch {
    rows = [];
  }

  if (isAggregated(rows)) {
    return rows
      .map((r) => ({ key: String(r[by] ?? "unknown"), count: Number(r.count) }))
      .sort((a, b) => b.count - a.count);
  }

  if (rows.length > 0) {
    // Engine returned raw events (GROUP BY ignored) — count them here.
    warnFallbackOnce();
    return aggregateBy(rows, by);
  }

  // Empty: either no events at all, or the engine errored into [].
  try {
    const raw = (await db.query(
      `FROM ${COLLECTIONS.events} WHERE ${where} LIMIT 10000`,
    )) as GroupRow[];
    if (raw.length === 0) return [];
    warnFallbackOnce();
    return aggregateBy(raw, by);
  } catch {
    return [];
  }
}

function blockLabel(m: IdentityManifest, blockId: string): { label: string; url: string | null } {
  const b = m.blocks.find((x) => x.id === blockId);
  if (!b) return { label: "(removed block)", url: null };
  const d = b.data as Record<string, unknown>;
  switch (b.type) {
    case "link":
      return {
        label: typeof d.label === "string" && d.label ? d.label : "(untitled link)",
        url: typeof d.url === "string" ? d.url : null,
      };
    case "embed":
      return {
        label: typeof d.title === "string" && d.title ? d.title : "(embed)",
        url: typeof d.url === "string" ? d.url : null,
      };
    case "social":
      return { label: "(social row)", url: null };
    default:
      return { label: `(${b.type})`, url: null };
  }
}

/** GET /api/identities/:id/analytics — viewer-gated, live from the engine. */
analytics.get("/", requireUser, wrap(async (req, res) => {
  const auth = authOf(res);
  if (!auth) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const identityId = String((req.params as Record<string, string>).id ?? "");
  if (!SAFE_ID.test(identityId)) {
    res.status(400).json({ error: "invalid identity id" });
    return;
  }
  if (!(await hasRole(identityId, auth, "viewer"))) {
    res.status(403).json({ error: "viewer role required" });
    return;
  }
  const manifest = await getManifest(identityId);
  if (!manifest) {
    res.status(404).json({ error: "identity not found" });
    return;
  }

  const idWhere = `identityId = '${identityId}'`;
  const [byKind, viewsBySource, clicksByBlock] = await Promise.all([
    groupCount(idWhere, "kind"),
    groupCount(`${idWhere} AND kind = 'profile_view'`, "source"),
    groupCount(`${idWhere} AND kind = 'link_click'`, "blockId"),
  ]);

  const kind = (k: string) => byKind.find((r) => r.key === k)?.count ?? 0;
  const source = (s: string) => viewsBySource.find((r) => r.key === s)?.count ?? 0;

  res.json({
    identityId,
    handle: manifest.handle,
    totals: {
      views: kind("profile_view"),
      scans: source("qr"),
      taps: source("direct"),
      linkClicks: kind("link_click"),
      vcardDownloads: kind("vcard_download"),
    },
    viewsBySource: viewsBySource.map(({ key, count }) => ({ source: key, count })),
    topLinks: clicksByBlock.map(({ key, count }) => ({
      blockId: key,
      ...blockLabel(manifest, key),
      count,
    })),
    asOf: new Date().toISOString(),
  });
}));

/** Rollup breadth cap — the signed-in strip is a glance, not a report.
 *  Operators with huge instances still get a truthful (top-50 by
 *  recency) strip; the per-identity dashboard remains exact. */
const SUMMARY_CAP = 50;

/**
 * GET /api/analytics/summary — the whole portfolio in one response.
 *
 * Powers the signed-in strip under the nav and the identities
 * dashboard header: totals across every identity this principal can
 * see, with per-identity numbers riding along so the dashboard never
 * fans out N client calls. Same live GROUP BYs as the per-identity
 * endpoint — nothing precomputed here either.
 */
analyticsSummary.get("/summary", requireUser, wrap(async (_req, res) => {
  const auth = authOf(res);
  if (!auth) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const manifests = (await listVisibleManifests(auth))
    .filter((m) => SAFE_ID.test(m.identityId)) // ours by construction — belt and suspenders before NQL
    .slice(0, SUMMARY_CAP);

  const perIdentity = await Promise.all(
    manifests.map(async (m) => {
      const idWhere = `identityId = '${m.identityId}'`;
      const [byKind, bySource] = await Promise.all([
        groupCount(idWhere, "kind"),
        groupCount(`${idWhere} AND kind = 'profile_view'`, "source"),
      ]);
      const kind = (k: string) => byKind.find((r) => r.key === k)?.count ?? 0;
      const source = (s: string) => bySource.find((r) => r.key === s)?.count ?? 0;
      return {
        identityId: m.identityId,
        handle: m.handle,
        displayName: m.displayName,
        status: m.status,
        views: kind("profile_view"),
        scans: source("qr"),
        linkClicks: kind("link_click"),
        vcardDownloads: kind("vcard_download"),
      };
    }),
  );

  perIdentity.sort((a, b) => b.views - a.views);
  const sum = (f: (r: (typeof perIdentity)[number]) => number) =>
    perIdentity.reduce((n, r) => n + f(r), 0);

  res.json({
    identities: manifests.length,
    live: manifests.filter((m) => m.status === "published").length,
    totals: {
      views: sum((r) => r.views),
      scans: sum((r) => r.scans),
      linkClicks: sum((r) => r.linkClicks),
      vcardDownloads: sum((r) => r.vcardDownloads),
    },
    perIdentity,
    asOf: new Date().toISOString(),
  });
}));
