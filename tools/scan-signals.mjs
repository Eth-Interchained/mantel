#!/usr/bin/env node
/**
 * Deterministic signal scanner — the RSS/JSON sweep, no LLM in the loop.
 *
 *   MANTEL_URL=... MANTEL_OPERATOR_TOKEN=... npm run scan
 *
 * For every model in the catalog it queries public, keyless endpoints:
 *   Reddit  www.reddit.com/r/LocalLLaMA/search.json?q="<family>"  (new, 25)
 *   HN      hn.algolia.com/api/v1/search_by_date?query="<family>"
 * matches posts that actually mention the model (whole-word), grades tone
 * with a small transparent lexicon (scan-lib.mjs), and POSTs the results to
 * the operator-gated /api/ingest/signals.
 *
 * IDEMPOTENT: the server content-addresses each signal by (sourceUrl, model),
 * so re-running updates rows in place. Safe on a timer.
 *
 * HONEST SENTIMENT: no lexicon hit = "neutral", never a guess. The signal's
 * raw captured text is stored as the source document, so a later muse-extract
 * re-grade (optional, separate pass) has the full material with provenance.
 *
 * MANTEL_SCAN_LIMIT caps how many catalog models to scan (default all).
 * Reddit requires a User-Agent; a descriptive one is sent. A source that
 * blocks or rate-limits is logged per model and counted — never silent.
 */

import { hnToSignal, redditToSignal } from "./scan-lib.mjs";

const MANTEL = process.env.MANTEL_URL || "http://127.0.0.1:3001";
const TOKEN = process.env.MANTEL_OPERATOR_TOKEN;
// Reddit requires the documented UA format <platform>:<app-id>:<version> (by /u/<user>)
// — a generic web-style UA is treated as a bot and 403'd. Override the contact
// handle with MANTEL_REDDIT_USER if desired.
const REDDIT_USER = process.env.MANTEL_REDDIT_USER || "interchained";
const UA = `node:net.aiassist.mantel:v0.1.0 (by /u/${REDDIT_USER})`;

if (!TOKEN) {
  console.error("[scan] MANTEL_OPERATOR_TOKEN is not set — writes would be refused. Aborting.");
  process.exit(1);
}

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json", ...headers } });
  if (!r.ok) throw new Error(`${url} -> ${r.status} ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

async function postSignals(entries) {
  const r = await fetch(`${MANTEL}/api/ingest/signals`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ signals: entries }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 207) {
    throw new Error(`ingest -> ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ── Load the catalog from the target server ──────────────────────────────────
const catalog = await getJson(`${MANTEL}/api/models?limit=1000`);
let models = (catalog.models || []).map((m) => String(m._id));
const cap = Number(process.env.MANTEL_SCAN_LIMIT || 0);
if (cap > 0) models = models.slice(0, cap);
console.log(`[scan] ${models.length} catalog model(s) to sweep`);

let written = 0;
let failedSources = 0;
let scannedPosts = 0;

for (const id of models) {
  const family = id.split(":")[0];
  const found = [];

  // Reddit — r/LocalLLaMA search, newest first.
  try {
    const q = encodeURIComponent(`"${family}"`);
    const j = await getJson(
      `https://www.reddit.com/r/LocalLLaMA/search.json?q=${q}&restrict_sr=1&sort=new&limit=25`,
    );
    const children = j && j.data && Array.isArray(j.data.children) ? j.data.children : [];
    scannedPosts += children.length;
    for (const c of children) {
      const s = redditToSignal(c, id);
      if (s) found.push(s);
    }
  } catch (err) {
    failedSources++;
    console.error(`[scan] reddit failed for ${id}: ${err.message}`);
  }

  // HN — Algolia, newest first.
  try {
    const j = await getJson(
      `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(family)}&hitsPerPage=25`,
    );
    const hits = Array.isArray(j.hits) ? j.hits : [];
    scannedPosts += hits.length;
    for (const h of hits) {
      const s = hnToSignal(h, id);
      if (s) found.push(s);
    }
  } catch (err) {
    failedSources++;
    console.error(`[scan] hn failed for ${id}: ${err.message}`);
  }

  if (found.length > 0) {
    const entries = found.map((s) => {
      const { _raw, ...signal } = s;
      return { signal, raw: { capturedAt: new Date().toISOString(), body: _raw || s.excerpt } };
    });
    try {
      const res = await postSignals(entries);
      written += res.written || 0;
      console.log(`[scan] ${id}: ${res.written} signal(s) written (${res.failed || 0} failed)`);
    } catch (err) {
      failedSources++;
      console.error(`[scan] ingest failed for ${id}: ${err.message}`);
    }
  }

  // Be a polite client: modest pacing between models.
  await sleep(1200);
}

console.log(
  `[scan] done: ${written} signal(s) written from ${scannedPosts} post(s) scanned` +
    (failedSources > 0 ? `, ${failedSources} source failure(s)` : ""),
);
// Source failures are visible above; exit nonzero only if EVERYTHING failed,
// because individual sources throttling is normal weather for a sweep.
process.exit(written > 0 || failedSources === 0 ? 0 : 1);
