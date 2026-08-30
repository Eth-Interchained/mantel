/**
 * Giveaways — provably fair lead generation, the OurLynx unlock.
 *
 * Lifecycle (see src/lib/raffle.ts for the math):
 *   create  — happens inside the manifest PUT when a giveaway block is
 *             saved without a raffleId: secret minted, commitment
 *             published as a hash-chained write (createRaffleForBlock).
 *   enter   — POST name + phone + email → 6-digit code by mail
 *             (challenge doc, 30-min TTL, single-use).
 *   confirm — code redeems into a raffle_entries doc with a random
 *             public ticket id. One entry per verified email.
 *   draw    — owner, after closesAt: beacon = first ITC block AFTER
 *             close (fallback: engine head, labeled). Winners by
 *             rejection sampling. Everything needed to recompute is
 *             written back to the raffle doc; the secret is revealed.
 *   verify  — GET /r/:id/verify re-runs computeDraw live and shows the
 *             whole trail. If recompute ≠ recorded, the page SAYS SO.
 *
 * PII rules: name/phone/email live in raffle_entries and leave the
 * server only through the owner-gated leads endpoint. Public surfaces
 * see ticket ids. The entrant consents on the form to sharing their
 * contact details with the page owner — that's the lead-gen trade,
 * stated plainly.
 */

import { randomBytes, randomInt } from "node:crypto";

import { Router } from "express";
import { z } from "zod";

import { conicStops, giveawayStops, linearStops } from "../lib/giveawayTheme";
import { COLLECTIONS, type IdentityManifest } from "../lib/identity";
import { commitmentOf, computeDraw, sha256Hex } from "../lib/raffle";
import { esc } from "../lib/renderers/html";
import { authOf, requireUser } from "./auth";
import { causalParent, db } from "./db";
import { config } from "./config";
import { giveawayCodeEmail, giveawayTicketEmail, giveawayWinnerEmail } from "./emails";
import { sendMail } from "./mailer";
import { hasRole } from "./grants";
import { wrap } from "./util";

export interface RaffleDoc {
  raffleId: string;
  identityId: string;
  handle: string;
  prize: string;
  description?: string;
  winners: number;
  closesAt: string;
  /** Owner ended entries early — the EFFECTIVE close when present. */
  closedEarlyAt?: string;
  rules?: string;
  maxEntries?: number;
  commitment: string;
  /** NEVER serialized to a public response; revealed only after draw. */
  secret: string;
  createdAt: string;
  drawnAt?: string;
  beaconKind?: "itc-block" | "engine-head";
  beaconValue?: string;
  beaconDetail?: string;
  merkleRoot?: string;
  winnerTicketIds?: string[];
}

interface EntryDoc {
  ticketId: string;
  raffleId: string;
  name: string;
  phone: string;
  email: string;
  principal: string;
  confirmedAt: string;
}

const TOKEN_TTL_MS = 30 * 60 * 1000;

// ── Creation (called from the manifest PUT hook) ─────────────────────────────

export async function createRaffleForBlock(
  m: Pick<IdentityManifest, "identityId" | "handle">,
  block: { prize: string; description?: string; closesAt: string; winners?: number; rules?: string; maxEntries?: number },
): Promise<RaffleDoc> {
  const secret = randomBytes(32).toString("hex");
  const doc: RaffleDoc = {
    raffleId: `rfl_${randomBytes(10).toString("hex")}`,
    identityId: m.identityId,
    handle: m.handle,
    prize: block.prize,
    description: block.description,
    winners: block.winners ?? 1,
    closesAt: new Date(block.closesAt).toISOString(),
    rules: block.rules,
    maxEntries: block.maxEntries,
    commitment: commitmentOf(secret),
    secret,
    createdAt: new Date().toISOString(),
  };
  await db.put(COLLECTIONS.raffles, doc.raffleId, doc as unknown as Record<string, unknown>, {
    evidence: `giveaway commitment ${doc.commitment.slice(0, 16)}… for ${m.identityId}`,
  });
  return doc;
}

export async function getRaffle(id: string): Promise<RaffleDoc | null> {
  if (!/^rfl_[a-f0-9]{20}$/.test(id)) return null;
  return ((await db.get(COLLECTIONS.raffles, id)) as RaffleDoc | null) ?? null;
}

async function entriesOf(raffleId: string): Promise<EntryDoc[]> {
  const rows = (await db.query(
    `FROM ${COLLECTIONS.raffleEntries} WHERE raffleId = "${raffleId}" LIMIT 10000`,
  )) as unknown as EntryDoc[];
  return rows;
}

/** The moment entries actually stop: the scheduled close, or the
 *  owner's early end — whichever comes first. The beacon anchors here
 *  too, so an early end can't cherry-pick a favorable block. */
function effectiveClose(r: RaffleDoc): string {
  if (r.closedEarlyAt && new Date(r.closedEarlyAt).getTime() < new Date(r.closesAt).getTime()) {
    return r.closedEarlyAt;
  }
  return r.closesAt;
}

function state(r: RaffleDoc): "open" | "closed" | "drawn" {
  if (r.drawnAt) return "drawn";
  return Date.now() < new Date(effectiveClose(r)).getTime() ? "open" : "closed";
}

/** The public projection — PII-free, secret-free until drawn. */
function publicView(r: RaffleDoc, entryCount: number) {
  return {
    raffleId: r.raffleId,
    handle: r.handle,
    prize: r.prize,
    description: r.description,
    winners: r.winners,
    closesAt: r.closesAt,
    closedEarlyAt: r.closedEarlyAt,
    effectiveClosesAt: effectiveClose(r),
    rules: r.rules,
    maxEntries: r.maxEntries,
    commitment: r.commitment,
    createdAt: r.createdAt,
    state: state(r),
    entryCount,
    ...(r.drawnAt
      ? {
          drawnAt: r.drawnAt,
          beaconKind: r.beaconKind,
          beaconValue: r.beaconValue,
          beaconDetail: r.beaconDetail,
          merkleRoot: r.merkleRoot,
          revealedSecret: r.secret,
          winnerTicketIds: r.winnerTicketIds,
        }
      : {}),
  };
}

// ── The beacon ───────────────────────────────────────────────────────────────

/** JSON-RPC against the ITC node. The URL may carry basic auth — never log it. */
async function itcRpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(config.itcRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "1.0", id: "links", method, params }),
    signal: AbortSignal.timeout(8000),
  });
  const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? "rpc error");
  return j.result;
}

/**
 * The first ITC block whose timestamp is >= closesAt — public
 * randomness that did not exist at commitment time and that nobody
 * could steer. Walk back from the tip; error if the chain hasn't
 * passed close yet (the draw simply waits for the next block).
 */
async function itcBeacon(closesAtMs: number): Promise<{ value: string; detail: string }> {
  const tip = Number(await itcRpc("getblockcount", []));
  let height = tip;
  let candidate: { hash: string; height: number; time: number } | null = null;
  for (let i = 0; i < 2000 && height >= 0; i++, height--) {
    const hash = String(await itcRpc("getblockhash", [height]));
    const header = (await itcRpc("getblockheader", [hash])) as { time: number };
    if (header.time * 1000 >= closesAtMs) {
      candidate = { hash, height, time: header.time };
    } else {
      break; // first block older than close — the previous candidate is THE block
    }
  }
  if (!candidate) throw new Error("beacon not ready — the chain hasn't produced a block after close yet");
  return {
    value: candidate.hash,
    detail: `ITC block ${candidate.height} (first block at/after close)`,
  };
}

async function beaconAfterClose(closesAt: string): Promise<{
  kind: "itc-block" | "engine-head";
  value: string;
  detail: string;
}> {
  if (config.itcRpcUrl) {
    try {
      const b = await itcBeacon(new Date(closesAt).getTime());
      return { kind: "itc-block", ...b };
    } catch (err) {
      console.warn(`[links] itc beacon unavailable, engine fallback: ${err instanceof Error ? err.message : err}`);
    }
  }
  // Fallback: the engine's verified head — hash-chained, tamper-evident,
  // and auditable, but server-adjacent (we write to this database). The
  // verify page labels which beacon was used; the trust difference is
  // documented, never hidden.
  const report = await db.verify();
  return {
    kind: "engine-head",
    value: `${report.head}:${report.seq}`,
    detail: `engine verified head at seq ${report.seq} (ITC RPC unavailable)`,
  };
}

// ── Throttle (per key, in-memory — same pattern as magic/uploads) ────────────

const hits = new Map<string, { n: number; resetAt: number }>();
function throttled(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now > h.resetAt) {
    hits.set(key, { n: 1, resetAt: now + windowMs });
    return false;
  }
  h.n++;
  return h.n > max;
}

// ── Routes ───────────────────────────────────────────────────────────────────

export const raffles = Router();

const enterSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(5).max(30),
  email: z.string().trim().toLowerCase().email().max(254),
});

/** GET /api/raffles/:id — public state. No PII, no secret until drawn. */
raffles.get("/api/raffles/:id", wrap(async (req, res) => {
  let r = await getRaffle(String(req.params.id));
  if (!r) {
    res.status(404).json({ error: "not found" });
    return;
  }
  r = await settleIfDue(r); // lazy auto-draw — the API view settles it too
  const entries = await entriesOf(r.raffleId);
  res.json({ raffle: publicView(r, entries.length) });
}));

/** POST /api/raffles/:id/enter — name + phone + email → code by mail. */
raffles.post("/api/raffles/:id/enter", wrap(async (req, res) => {
  const r = await getRaffle(String(req.params.id));
  if (!r) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (state(r) !== "open") {
    res.status(409).json({ error: "this giveaway is closed" });
    return;
  }
  const body = enterSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "name, phone, and email required" });
    return;
  }
  if (throttled(`enter:${req.ip}:${r.raffleId}`, 5, 10 * 60 * 1000)) {
    res.status(429).json({ error: "too many attempts — try again in a few minutes" });
    return;
  }
  const email = body.data.email;
  const principal = `eml_${sha256Hex(email).slice(0, 20)}`;

  const all = await entriesOf(r.raffleId);
  // Already in? Say so warmly — no duplicate tickets, no enumeration drama.
  const existing = all.find((e) => e.principal === principal);
  if (existing) {
    res.json({ ok: true, already: true });
    return;
  }
  if (r.maxEntries && all.length >= r.maxEntries) {
    res.status(409).json({ error: "all spots are taken — this one filled up" });
    return;
  }

  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  const pendingId = `rfe_${randomBytes(12).toString("hex")}`;
  await db.put(COLLECTIONS.challenges, pendingId, {
    challengeId: pendingId,
    kind: "raffle_entry",
    raffleId: r.raffleId,
    codeHash: sha256Hex(`${pendingId}:${code}`),
    name: body.data.name,
    phone: body.data.phone,
    email,
    principal,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  }, { evidence: `giveaway entry pending: ${r.raffleId}` });

  try {
    await sendMail(giveawayCodeEmail({ to: email, code, prize: r.prize, handle: r.handle }));
  } catch (err) {
    console.error(`[links] giveaway code send failed: ${err instanceof Error ? err.message : err}`);
    res.status(502).json({ error: "couldn't send the confirmation email — try again in a moment" });
    return;
  }
  res.json({ ok: true, pendingId });
}));

/** POST /api/raffles/:id/confirm — {pendingId, code} → ticket. */
raffles.post("/api/raffles/:id/confirm", wrap(async (req, res) => {
  const body = z.object({
    pendingId: z.string().min(8).max(60),
    code: z.string().regex(/^\d{6}$/),
  }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "that code didn't look right" });
    return;
  }
  if (throttled(`confirm:${req.ip}`, 10, 10 * 60 * 1000)) {
    res.status(429).json({ error: "too many attempts — try again in a few minutes" });
    return;
  }
  const r = await getRaffle(String(req.params.id));
  if (!r) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (state(r) !== "open") {
    res.status(409).json({ error: "this giveaway closed before the code was confirmed" });
    return;
  }
  const pending = (await db.get(COLLECTIONS.challenges, body.data.pendingId)) as
    | { kind: string; raffleId: string; codeHash: string; name: string; phone: string; email: string; principal: string; expiresAt: string }
    | null;
  if (
    !pending ||
    pending.kind !== "raffle_entry" ||
    pending.raffleId !== r.raffleId ||
    new Date(pending.expiresAt).getTime() < Date.now() ||
    pending.codeHash !== sha256Hex(`${body.data.pendingId}:${body.data.code}`)
  ) {
    res.status(400).json({ error: "that code didn't work — request a fresh one" });
    return;
  }
  await db.delete(COLLECTIONS.challenges, body.data.pendingId); // single-use, tombstoned

  // Race-safe duplicate + cap checks at confirm time too.
  const confirmed = await entriesOf(r.raffleId);
  const dupe = confirmed.find((e) => e.principal === pending.principal);
  if (dupe) {
    res.json({ ok: true, ticketId: dupe.ticketId, already: true });
    return;
  }
  if (r.maxEntries && confirmed.length >= r.maxEntries) {
    res.status(409).json({ error: "all spots filled while the code was in flight" });
    return;
  }

  const entry: EntryDoc = {
    ticketId: `tkt_${randomBytes(8).toString("hex")}`,
    raffleId: r.raffleId,
    name: pending.name,
    phone: pending.phone,
    email: pending.email,
    principal: pending.principal,
    confirmedAt: new Date().toISOString(),
  };
  await db.put(COLLECTIONS.raffleEntries, entry.ticketId, entry as unknown as Record<string, unknown>, {
    evidence: `giveaway entry ${entry.ticketId} in ${r.raffleId}`,
  });
  sendMail(giveawayTicketEmail({
    to: entry.email,
    name: entry.name,
    ticketId: entry.ticketId,
    prize: r.prize,
    handle: r.handle,
    closesAt: r.closesAt,
    verifyUrl: `${config.publicOrigin || ""}/r/${r.raffleId}/verify`,
  })).catch((err) => console.warn(`[links] ticket email failed: ${err instanceof Error ? err.message : err}`));
  res.status(201).json({ ok: true, ticketId: entry.ticketId });
}));

/**
 * The draw itself — shared by three triggers so the outcome mechanics
 * can never differ by path:
 *   1. the owner's manual Draw button,
 *   2. the owner's End-giveaway-now action (end + draw in one motion),
 *   3. LAZY AUTO-DRAW: any public view of a closed-but-undrawn raffle
 *      settles it on the spot. No cron, no scheduler — the first
 *      visitor after close (usually an entrant checking) triggers the
 *      settlement, the winner email fires, and the verify page fills
 *      in. A giveaway can no longer sit closed and unresolved because
 *      nobody clicked a button.
 * Returns the updated doc, or null when there's nothing to draw
 * (no entries) — that raffle stays 'closed', honestly unresolved.
 */
async function performDraw(r: RaffleDoc): Promise<RaffleDoc | null> {
  if (r.drawnAt) return r;
  const entries = await entriesOf(r.raffleId);
  if (entries.length === 0) return null;
  const beacon = await beaconAfterClose(effectiveClose(r));
  const tickets = entries.map((e) => e.ticketId);
  const { merkleRoot, winners } = computeDraw(r.secret, beacon.value, tickets, r.winners);

  const next: RaffleDoc = {
    ...r,
    drawnAt: new Date().toISOString(),
    beaconKind: beacon.kind,
    beaconValue: beacon.value,
    beaconDetail: beacon.detail,
    merkleRoot,
    winnerTicketIds: winners,
  };
  await db.put(COLLECTIONS.raffles, r.raffleId, next as unknown as Record<string, unknown>, {
    causedBy: causalParent(r as unknown as Record<string, unknown>),
    evidence: `giveaway drawn: ${winners.join(",")} via ${beacon.kind}`,
  });

  for (const t of winners) {
    const w = entries.find((e) => e.ticketId === t);
    if (w) {
      sendMail(giveawayWinnerEmail({
        to: w.email,
        name: w.name,
        ticketId: w.ticketId,
        prize: r.prize,
        handle: r.handle,
        verifyUrl: `${config.publicOrigin || ""}/r/${r.raffleId}/verify`,
      })).catch((err) => console.warn(`[links] winner email failed: ${err instanceof Error ? err.message : err}`));
    }
  }
  return next;
}

/** Lazy settlement: closed + undrawn + has entries → draw NOW. */
async function settleIfDue(r: RaffleDoc): Promise<RaffleDoc> {
  if (state(r) !== "closed") return r;
  try {
    const drawn = await performDraw(r);
    return drawn ?? r;
  } catch (err) {
    // A failed auto-draw (e.g. beacon hiccup) never breaks a page view;
    // the next view retries.
    console.warn(`[links] auto-draw failed for ${r.raffleId}: ${err instanceof Error ? err.message : err}`);
    return r;
  }
}

/** POST /api/raffles/:id/draw — owner, after close. Idempotent. */
raffles.post("/api/raffles/:id/draw", requireUser, wrap(async (req, res) => {
  const auth = authOf(res);
  if (!auth) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const r = await getRaffle(String(req.params.id));
  if (!r) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (!(await hasRole(r.identityId, auth, "editor"))) {
    res.status(403).json({ error: "only the page owner draws" });
    return;
  }
  if (r.drawnAt) {
    const entries = await entriesOf(r.raffleId);
    res.json({ raffle: publicView(r, entries.length), already: true });
    return;
  }
  if (state(r) !== "closed") {
    res.status(409).json({ error: "entries are still open — the draw waits for close" });
    return;
  }
  const drawn = await performDraw(r);
  if (!drawn) {
    res.status(409).json({ error: "no confirmed entries to draw from" });
    return;
  }
  const entries = await entriesOf(r.raffleId);
  res.json({ raffle: publicView(drawn, entries.length) });
}));

/** POST /api/raffles/:id/end — the owner ends entries NOW, at will,
 *  and the draw settles in the same motion (when entries exist).
 *  Ending early only ever REDUCES the entry window — the beacon
 *  anchors to the early close, so timing can't cherry-pick a winner. */
raffles.post("/api/raffles/:id/end", requireUser, wrap(async (req, res) => {
  const auth = authOf(res);
  if (!auth) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const r = await getRaffle(String(req.params.id));
  if (!r) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (!(await hasRole(r.identityId, auth, "editor"))) {
    res.status(403).json({ error: "only the page owner ends a giveaway" });
    return;
  }
  if (r.drawnAt) {
    const entries = await entriesOf(r.raffleId);
    res.json({ raffle: publicView(r, entries.length), already: true });
    return;
  }
  let current = r;
  if (state(r) === "open") {
    current = { ...r, closedEarlyAt: new Date().toISOString() };
    await db.put(COLLECTIONS.raffles, r.raffleId, current as unknown as Record<string, unknown>, {
      causedBy: causalParent(r as unknown as Record<string, unknown>),
      evidence: `giveaway ended early by owner`,
    });
  }
  const drawn = await performDraw(current);
  const entries = await entriesOf(r.raffleId);
  res.json({ raffle: publicView(drawn ?? current, entries.length), drew: Boolean(drawn) });
}));

/** GET /api/raffles/:id/leads — owner only. The lead-gen payoff.
 *  ?format=csv downloads; default JSON. */
raffles.get("/api/raffles/:id/leads", requireUser, wrap(async (req, res) => {
  const auth = authOf(res);
  if (!auth) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const r = await getRaffle(String(req.params.id));
  if (!r) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (!(await hasRole(r.identityId, auth, "editor"))) {
    res.status(403).json({ error: "leads belong to the page owner" });
    return;
  }
  const entries = await entriesOf(r.raffleId);
  const winners = new Set(r.winnerTicketIds ?? []);
  if (req.query.format === "csv") {
    const rows = [
      "name,email,phone,ticket,entered_at,winner",
      ...entries.map((e) =>
        [e.name, e.email, e.phone, e.ticketId, e.confirmedAt, winners.has(e.ticketId) ? "yes" : ""]
          .map((v) => `"${String(v).replaceAll('"', '""')}"`)
          .join(","),
      ),
    ];
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${r.raffleId}-leads.csv"`);
    res.send(rows.join("\r\n"));
    return;
  }
  res.json({
    leads: entries.map((e) => ({
      name: e.name,
      email: e.email,
      phone: e.phone,
      ticketId: e.ticketId,
      confirmedAt: e.confirmedAt,
      winner: winners.has(e.ticketId),
    })),
  });
}));

// ── Zero-JS public pages: /r/:id (enter) and /r/:id/verify ───────────────────

export function pageShell(title: string, body: string): string {
  const dots = giveawayStops(config.holoColors);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
${config.faviconUrl ? `<link rel="icon" href="${esc(config.faviconUrl)}" />` : ""}
<style>
  /* ── The dopamine kit — pure CSS, zero JS, killed by reduced-motion ── */
  @property --gvang { syntax: "<angle>"; initial-value: 0deg; inherits: false; }
  * { margin: 0; box-sizing: border-box; }
  /* Without this, browsers assume a LIGHT page and paint native form
     chrome accordingly — most visibly, autofilled Name/Phone/Email
     (exactly what this form asks for) render with a forced light
     background and dark text no CSS override below can fully escape.
     Declaring the scheme up front is what makes the explicit input{}
     colors and the autofill override actually stick everywhere. */
  :root { color-scheme: dark; }
  body { background: #070a12; color: #f8fafc; font: 16px/1.6 system-ui, -apple-system, sans-serif; min-height: 100dvh; overflow-x: clip; }
  body::before { content: ""; position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background: radial-gradient(60% 34% at 50% -4%, ${dots[0]}1f, transparent 70%),
                radial-gradient(40% 30% at 85% 20%, ${dots[2] ?? dots[1]}14, transparent 70%),
                radial-gradient(40% 30% at 10% 60%, ${dots[1]}10, transparent 70%); }
  main { position: relative; z-index: 1; max-width: 620px; margin: 0 auto; padding: 52px 22px 72px; }
  /* Print-registration offset — the cheap screen-print misregistration
     look, the single most recognizable pop-art visual cue. */
  h1 { font-size: 27px; font-weight: 800; letter-spacing: -0.02em;
       text-shadow: 2px 2px 0 ${dots[0]}66, -1px -1px 0 ${dots[2] ?? dots[1]}44; }
  .sub { color: #94a3b8; margin-top: 8px; font-size: 15px; }

  /* POP ART, not a circus wheel: a tight curated palette, a fully
     OPAQUE card (the actual "can't read the labels" bug was a 5-hue
     rainbow ring bleeding through a ~93%-opacity glassy card), and a
     bold screen-print outline instead of a soft blurred halo. A
     subtle Ben-Day halftone dot texture is the authentic pop-art
     signature touch — Lichtenstein, not liquid-glass. */
  @keyframes gvspin { to { --gvang: 360deg; } }
  .card { position: relative; background: #0e1424; border: 2px solid rgb(0 0 0 / 0.6);
          border-radius: 18px; padding: 24px; margin-top: 22px;
          background-image: radial-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px);
          background-size: 10px 10px;
          box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.09); }
  .card::before { content: ""; position: absolute; inset: -3px; border-radius: 20px; z-index: -1;
    background: conic-gradient(from var(--gvang), ${conicStops(config.holoColors)});
    animation: gvspin 9s linear infinite; }
  .card:hover::before { animation-duration: 3s; }

  label { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .12em;
          color: #94a3b8; margin: 14px 0 6px; transition: color .2s ease; }
  input { width: 100%; background: #0d1322; color: #f8fafc; font-size: 16px; border: 1px solid #ffffff1f;
          border-radius: 12px; padding: 12px 15px; outline: none;
          transition: border-color .2s ease, box-shadow .2s ease, transform .15s ease; }
  /* onfocus/onblur dopamine: the field you're feeding lights up */
  input:focus { border-color: transparent;
    box-shadow: 0 0 0 2px #6366f1, 0 0 18px -4px #6366f1cc, 0 0 34px -8px #22d3ee88; transform: scale(1.008); }
  input:focus + label, label:has(+ input:focus) { color: #a5b4fc; }
  input:not(:placeholder-shown):valid { border-color: #34d39955; }
  input::placeholder { color: #4b5871; }
  /* The actual "can't read the font colors" bug: Chrome/Safari force
     an opaque light-yellow (or system light) background + near-black
     text onto AUTOFILLED fields, ignoring the input{} rule above —
     and this form asks for exactly what autofill loves (name/phone/
     email). The giant transition-delay is the standard trick: it
     stalls the browser's own background-color transition long enough
     that ours wins instead of flashing yellow first. */
  input:-webkit-autofill,
  input:-webkit-autofill:hover,
  input:-webkit-autofill:focus {
    -webkit-text-fill-color: #f8fafc;
    -webkit-box-shadow: 0 0 0px 1000px #0d1322 inset;
    box-shadow: 0 0 0px 1000px #0d1322 inset;
    caret-color: #f8fafc;
    transition: background-color 9999s ease-in-out 0s;
  }
  input:autofill { color: #f8fafc; }

  /* Payment QR — white plate on purpose. A QR inverted onto a dark card
     is unreliable to scan on many phone cameras, and this one is the
     difference between getting paid and not. */
  .qrwrap { margin-top: 14px; text-align: center; }
  .qr { display: block; margin: 0 auto 8px; width: 180px; height: 180px;
        background: #fff; border-radius: 12px; padding: 8px; }

  /* Slot picker — a whole row is the tap target, because a bare radio
     on a phone is a ~14px dot and this is the step that decides which
     hour of someone's life gets sold. */
  label.slot { display: flex; align-items: center; gap: 10px; margin-top: 8px;
               padding: 12px 14px; border: 1px solid rgb(148 163 184 / .22);
               border-radius: 12px; cursor: pointer; font-weight: 600;
               background: rgb(148 163 184 / .05); transition: border-color .15s ease, background .15s ease; }
  label.slot:hover { border-color: rgb(148 163 184 / .45); background: rgb(148 163 184 / .09); }
  label.slot:has(input:checked) { border-color: #f8fafc88; background: rgb(248 250 252 / .10); }
  label.slot input { width: 18px; height: 18px; accent-color: #f8fafc; margin: 0; flex: none; }
  hr.sep { border: 0; border-top: 1px solid rgb(148 163 184 / .18); margin: 16px 0; }

  /* "a.btn" gives a LINK the same weight as a submit button — needed
     because the buy page's primary action ("Pay with UPI") is an
     anchor to a payment-app intent link, not a form submit, and the
     money step must not read as a footnote next to the form. */
  a.btn { display: block; text-align: center; text-decoration: none; }
  button, a.btn { position: relative; margin-top: 18px; width: 100%; color: #0b0d11; font-weight: 800; font-size: 15px;
           letter-spacing: .01em; border: 2px solid rgb(0 0 0 / 0.6); border-radius: 12px; padding: 14px; cursor: pointer;
           background: linear-gradient(120deg, ${linearStops(config.holoColors)}); background-size: 300% 100%;
           animation: gvstream 6s linear infinite;
           box-shadow: inset 0 1px 0 rgb(255 255 255 / .35), 0 10px 30px -10px rgb(0 0 0 / .6);
           transition: transform .12s ease, box-shadow .2s ease; }
  @keyframes gvstream { to { background-position: 300% 0; } }
  button:hover, a.btn:hover { transform: translateY(-2px); box-shadow: inset 0 1px 0 rgb(255 255 255 / .35), 0 16px 40px -12px rgb(0 0 0 / .7); animation-duration: 2.5s; }
  button:active, a.btn:active { transform: translateY(0) scale(.985); box-shadow: inset 0 2px 6px rgb(0 0 0 / .5); }

  /* Scarcity bar — the SAME palette as the ring and button, so the
     page tells one color story instead of three. */
  .bar { margin-top: 14px; height: 10px; border-radius: 999px; background: #0d1322; overflow: hidden;
         border: 1px solid rgb(0 0 0 / 0.5); }
  .fill { height: 100%; border-radius: 999px; min-width: 6px;
          background: linear-gradient(90deg, ${linearStops(config.holoColors)}); background-size: 200% 100%;
          animation: gvstream 3s linear infinite; }
  .spots { display: flex; justify-content: space-between; font-size: 12px; color: #94a3b8; margin-top: 6px; }
  .spots b { color: #a5b4fc; }

  .fine { color: #64748b; font-size: 12px; margin-top: 12px; line-height: 1.5; }
  .rules { white-space: pre-wrap; color: #94a3b8; font-size: 13px; border-left: 3px solid #6366f155;
           padding: 4px 0 4px 14px; margin-top: 14px; }
  .mono { font-family: ui-monospace, monospace; }
  .kv { display: grid; gap: 10px; margin-top: 14px; font-size: 13.5px; }
  .kv div { display: grid; gap: 2px; }
  .kv b { color: #94a3b8; font-size: 10.5px; text-transform: uppercase; letter-spacing: .12em; }
  .kv span { word-break: break-all; color: #e2e8f0; }
  .ok { color: #34d399; } .bad { color: #f87171; }

  /* The ticket — the dopamine peak: a bold flat poster chip (the
     winning stop, solid — not another gradient) with a shine sweep. */
  .win { position: relative; overflow: hidden; background: ${dots[0]}; color: #0b0d11;
         border: 2px solid rgb(0 0 0 / 0.6); border-radius: 12px; padding: 14px 18px;
         margin-top: 8px; font-weight: 800; text-align: center;
         box-shadow: inset 0 1px 0 rgb(255 255 255 / .35); }
  .win::after { content: ""; position: absolute; top: 0; bottom: 0; width: 55%; left: -80%;
    background: linear-gradient(105deg, transparent, rgb(255 255 255 / .45), transparent);
    animation: gvshine 3.2s ease-in-out infinite; }
  @keyframes gvshine { 0%, 55% { left: -80%; } 85%, 100% { left: 130%; } }

  a { color: #a5b4fc; }
  footer { margin-top: 44px; text-align: center; }
  footer a { color: #94a3b8; font-size: 12px; text-decoration: none; border: 1px solid #ffffff14;
             border-radius: 999px; padding: 7px 14px; }

  @media (prefers-reduced-motion: reduce) {
    .card::before, .fill, .win::after, button, a.btn { animation: none; }
    input:focus, button, .card { transition: none; transform: none; }
  }
</style></head><body><main>${body}
<footer><a href="/">${config.brandLogoUrl ? `<img src="${esc(config.brandLogoUrl)}" style="width:15px;height:15px;object-fit:contain;vertical-align:-2px" alt="" /> ` : "⬡ "}${esc(config.brandName)}</a></footer>
</main></body></html>`;
}

/** GET /r/:id — the giveaway page: state + entry form, zero JS. */
raffles.get("/r/:id", wrap(async (req, res, next) => {
  let r = await getRaffle(String(req.params.id));
  if (!r) {
    next();
    return;
  }
  r = await settleIfDue(r); // the first visitor after close settles the draw
  const entries = await entriesOf(r.raffleId);
  const st = state(r);
  const closes = new Date(effectiveClose(r)).toUTCString();
  let body = `<h1>${esc(r.prize)}</h1>
<p class="sub">A giveaway by <a href="/${esc(r.handle)}">@${esc(r.handle)}</a> · ${entries.length} entered · ${
    st === "open" ? `closes ${esc(closes)}` : st === "closed" ? "closed — draw pending" : "winner drawn"
  }</p>`;
  if (r.description) body += `<p class="sub">${esc(r.description)}</p>`;
  if (r.rules) body += `<div class="rules">${esc(r.rules)}</div>`;

  const spotsBar = r.maxEntries
    ? `<div class="bar"><div class="fill" style="width:${Math.min(100, Math.round((entries.length / r.maxEntries) * 100))}%"></div></div>
<p class="spots"><span><b>${entries.length}</b> of ${r.maxEntries} spots taken</span><span>${Math.max(0, r.maxEntries - entries.length)} left</span></p>`
    : "";

  if (st === "open" && r.maxEntries && entries.length >= r.maxEntries) {
    body += `<div class="card">${spotsBar}<p class="sub" style="margin-top:12px">All spots are taken — this one filled up fast. The draw happens after ${esc(closes)}.</p>
<p class="fine"><a href="/r/${esc(r.raffleId)}/verify">Verify the draw</a> when it lands.</p></div>`;
  } else if (st === "open") {
    body += `<div class="card">
${spotsBar}
<form method="post" action="/r/${esc(r.raffleId)}/enter">
  <label>Name</label><input name="name" autocomplete="name" required maxlength="80" />
  <label>Phone</label><input name="phone" type="tel" autocomplete="tel" required maxlength="30" />
  <label>Email</label><input name="email" type="email" autocomplete="email" required maxlength="254" />
  <button>Enter the giveaway</button>
  <p class="fine">We'll email you a 6-digit code to confirm your entry. By entering you share your
  name, phone, and email with @${esc(r.handle)} and agree to be contacted about this giveaway.
  One entry per person — every entry has an equal shot (<a href="/fair">how draws stay honest</a>).</p>
</form></div>`;
  } else if (st === "drawn") {
    body += `<div class="card"><b>Winning ticket${(r.winnerTicketIds?.length ?? 0) > 1 ? "s" : ""}:</b>
${(r.winnerTicketIds ?? []).map((t) => `<div class="win mono">${esc(t)}</div>`).join("")}
<p class="fine">Winners were notified by email. Anyone can <a href="/r/${esc(r.raffleId)}/verify">check this draw</a> — it's all on the record.</p></div>`;
  } else {
    body += `<div class="card"><p class="sub">Entries closed ${esc(closes)}. The winner gets drawn
shortly — <a href="/r/${esc(r.raffleId)}/verify">watch this space</a>.</p></div>`;
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(pageShell(`${r.prize} — giveaway by @${r.handle}`, body));
}));

/** POST /r/:id/enter — HTML form target; renders the code step. */
raffles.post("/r/:id/enter", wrap(async (req, res) => {
  const r = await getRaffle(String(req.params.id));
  if (!r) {
    res.status(404).send("not found");
    return;
  }
  // Reuse the API logic by calling into the same flow via fetch? No —
  // shared handler: build a faux JSON body and reuse validation inline.
  const parsed = enterSchema.safeParse(req.body);
  const back = `<p class="sub"><a href="/r/${esc(r.raffleId)}">← back</a></p>`;
  if (state(r) !== "open") {
    res.send(pageShell("Giveaway closed", `<h1>Entries are closed</h1>${back}`));
    return;
  }
  if (!parsed.success) {
    res.send(pageShell("Check the form", `<h1>Something's missing</h1><p class="sub">${esc(parsed.error.issues[0]?.message ?? "name, phone, and a valid email are required")}</p>${back}`));
    return;
  }
  if (throttled(`enter:${req.ip}:${r.raffleId}`, 5, 10 * 60 * 1000)) {
    res.send(pageShell("Slow down", `<h1>Too many attempts</h1><p class="sub">Try again in a few minutes.</p>${back}`));
    return;
  }
  const email = parsed.data.email;
  const principal = `eml_${sha256Hex(email).slice(0, 20)}`;
  const allEntries = await entriesOf(r.raffleId);
  const existing = allEntries.find((e) => e.principal === principal);
  if (existing) {
    res.send(pageShell("Already entered", `<h1>You're already in ✓</h1><p class="sub">This email already holds ticket <span class="mono">${esc(existing.ticketId)}</span>. One entry per person keeps the draw fair.</p>${back}`));
    return;
  }
  if (r.maxEntries && allEntries.length >= r.maxEntries) {
    res.send(pageShell("Full", `<h1>All spots are taken</h1><p class="sub">This one filled up. The draw is still on — <a href="/r/${esc(r.raffleId)}/verify">watch it settle</a>.</p>${back}`));
    return;
  }
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  const pendingId = `rfe_${randomBytes(12).toString("hex")}`;
  await db.put(COLLECTIONS.challenges, pendingId, {
    challengeId: pendingId, kind: "raffle_entry", raffleId: r.raffleId,
    codeHash: sha256Hex(`${pendingId}:${code}`),
    name: parsed.data.name, phone: parsed.data.phone, email, principal,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  }, { evidence: `giveaway entry pending: ${r.raffleId}` });
  try {
    await sendMail(giveawayCodeEmail({ to: email, code, prize: r.prize, handle: r.handle }));
  } catch {
    res.send(pageShell("Mail hiccup", `<h1>Couldn't send the code</h1><p class="sub">Try again in a moment.</p>${back}`));
    return;
  }
  res.send(pageShell("Check your inbox", `<h1>Check your inbox</h1>
<p class="sub">We sent a 6-digit code to <b>${esc(email)}</b>. Enter it here to lock your ticket:</p>
<div class="card"><form method="post" action="/r/${esc(r.raffleId)}/confirm">
<input type="hidden" name="pendingId" value="${esc(pendingId)}" />
<label>6-digit code</label><input name="code" inputmode="numeric" pattern="\\d{6}" autocomplete="one-time-code" maxlength="6" required class="mono" />
<button>Confirm my entry</button>
<p class="fine">The code expires in 30 minutes and works once.</p>
</form></div>`));
}));

/** POST /r/:id/confirm — HTML form target; renders the ticket. */
raffles.post("/r/:id/confirm", wrap(async (req, res) => {
  const r = await getRaffle(String(req.params.id));
  if (!r) {
    res.status(404).send("not found");
    return;
  }
  const back = `<p class="sub"><a href="/r/${esc(r.raffleId)}">← back</a></p>`;
  const body = z.object({ pendingId: z.string().min(8).max(60), code: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
  if (!body.success || throttled(`confirm:${req.ip}`, 10, 10 * 60 * 1000)) {
    res.send(pageShell("Try again", `<h1>That didn't work</h1><p class="sub">Check the code and try again.</p>${back}`));
    return;
  }
  if (state(r) !== "open") {
    res.send(pageShell("Closed", `<h1>The giveaway closed</h1><p class="sub">This code arrived after entries ended.</p>${back}`));
    return;
  }
  const pending = (await db.get(COLLECTIONS.challenges, body.data.pendingId)) as
    | { kind: string; raffleId: string; codeHash: string; name: string; phone: string; email: string; principal: string; expiresAt: string }
    | null;
  if (
    !pending || pending.kind !== "raffle_entry" || pending.raffleId !== r.raffleId ||
    new Date(pending.expiresAt).getTime() < Date.now() ||
    pending.codeHash !== sha256Hex(`${body.data.pendingId}:${body.data.code}`)
  ) {
    res.send(pageShell("Try again", `<h1>That code didn't work</h1><p class="sub">Request a fresh one from the giveaway page.</p>${back}`));
    return;
  }
  await db.delete(COLLECTIONS.challenges, body.data.pendingId);
  const confirmAll = await entriesOf(r.raffleId);
  if (r.maxEntries && !confirmAll.some((e) => e.principal === pending.principal) && confirmAll.length >= r.maxEntries) {
    res.send(pageShell("Full", `<h1>All spots filled</h1><p class="sub">The last spot went while your code was in flight — brutal, we know. Fairness cuts both ways.</p>${back}`));
    return;
  }
  const dupe = confirmAll.find((e) => e.principal === pending.principal);
  const entry: EntryDoc = dupe ?? {
    ticketId: `tkt_${randomBytes(8).toString("hex")}`,
    raffleId: r.raffleId,
    name: pending.name, phone: pending.phone, email: pending.email, principal: pending.principal,
    confirmedAt: new Date().toISOString(),
  };
  if (!dupe) {
    await db.put(COLLECTIONS.raffleEntries, entry.ticketId, entry as unknown as Record<string, unknown>, {
      evidence: `giveaway entry ${entry.ticketId} in ${r.raffleId}`,
    });
    sendMail(giveawayTicketEmail({
      to: entry.email, name: entry.name, ticketId: entry.ticketId, prize: r.prize,
      handle: r.handle, closesAt: r.closesAt,
      verifyUrl: `${config.publicOrigin || ""}/r/${r.raffleId}/verify`,
    })).catch(() => undefined);
  }
  res.send(pageShell("You're in", `<h1>You're in ✓</h1>
<p class="sub">Your ticket for <b>${esc(r.prize)}</b>:</p>
<div class="card"><div class="win mono">${esc(entry.ticketId)}</div>
<p class="fine">Keep this id — it's your ticket in the draw, and it never shows your name.
When the winner is picked, <a href="/r/${esc(r.raffleId)}/verify">anyone can check it was fair</a>.
Drawing ${esc(new Date(effectiveClose(r)).toUTCString())}.</p></div>`));
}));

/**
 * GET /fair — how draws stay honest, in plain words.
 *
 * Marisa's call, 7/8: the hash-chain vocabulary was scaring her
 * clients off the MAIN surfaces. The math didn't move — it lives here
 * (and on each giveaway's own verify page), linked from the footer,
 * one tap away for the skeptic and out of everyone else's way.
 */
raffles.get("/fair", (_req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(pageShell("How our giveaways stay honest", `<h1>How our giveaways stay honest</h1>
<p class="sub">Short version: nobody — not the page owner, not us — can pick a friend.
Here's why you can trust a draw you can't see.</p>

<div class="card"><b>1. The promise locks before anyone enters.</b>
<p class="sub">When a giveaway is created, its recipe — the prize, the closing time, how many
winners — is published and sealed. Quietly changing any of it afterwards would break the seal
in public.</p></div>

<div class="card"><b>2. The randomness belongs to no one.</b>
<p class="sub">The winning pick uses public randomness that doesn't exist yet when entries
close. Nobody can know it in advance — and everybody can look it up afterwards.</p></div>

<div class="card"><b>3. Anyone can re-run the draw.</b>
<p class="sub">Every giveaway has its own check page that re-computes the winner from public
data, live, every time it loads. If anything had been tampered with, that page would say so
in red — loudly.</p></div>

<div class="card"><b>4. Entries are people, not bots.</b>
<p class="sub">Every entry is confirmed by email — one entry per person, every entry an equal
shot. On the public record, entrants are anonymous ticket ids; names are never shown.</p></div>

<div class="card"><b>For the skeptics (welcome, friends)</b>
<p class="fine">The full protocol: at creation the server publishes commitment = sha256(secret).
After close, the draw seed is sha256("draw:" + secret + ":" + beacon + ":" + merkleRoot(sorted tickets)),
where the beacon is the first ITC blockchain block after the effective close (or the engine's
verified head when the chain is unreachable — the check page labels which). Winners are picked by
rejection-sampled uniform draws from the sorted ticket list, winners removed between rounds. The
revealed secret must match the published commitment, and every giveaway's check page re-runs the
whole computation in the open.</p></div>`));
});

/** GET /r/:id/verify — the recompute trail. If the live recompute ever
 *  disagrees with the recorded draw, this page says so in red. */
raffles.get("/r/:id/verify", wrap(async (req, res, next) => {
  let r = await getRaffle(String(req.params.id));
  if (!r) {
    next();
    return;
  }
  r = await settleIfDue(r);
  const entries = await entriesOf(r.raffleId);
  const tickets = entries.map((e) => e.ticketId).sort();
  let body = `<h1>Check this draw</h1>
<p class="sub">Giveaway by <a href="/${esc(r.handle)}">@${esc(r.handle)}</a>. Nobody — not the owner,
not us — can steer who wins. You don't need the math below for that to protect you; it's here for
anyone who wants to check it (<a href="/fair">plain-words version</a>).</p>
<div class="card"><div class="kv">
<div><b>Prize</b><span>${esc(r.prize)}</span></div>
<div><b>Commitment (published before entries opened)</b><span class="mono">${esc(r.commitment)}</span></div>
<div><b>Entries close</b><span>${esc(new Date(effectiveClose(r)).toUTCString())}${r.closedEarlyAt ? " — ended early by the owner" : ""}</span></div>
<div><b>Confirmed tickets (${tickets.length})</b><span class="mono">${tickets.map(esc).join(" · ") || "—"}</span></div>
</div></div>`;

  if (!r.drawnAt) {
    body += `<div class="card"><p class="sub">Not drawn yet. When it is, the secret behind the commitment is revealed
here along with the public beacon, and this page re-runs the whole draw live.</p>
<p class="fine">The protocol: seed = sha256("draw:" + secret + ":" + beacon + ":" + merkleRoot(sorted tickets)),
winners by rejection-sampled uniform picks. The commitment above binds the secret NOW — it can't be
swapped after entries land.</p></div>`;
  } else {
    const re = computeDraw(r.secret, r.beaconValue ?? "", tickets, r.winners);
    const match =
      re.merkleRoot === r.merkleRoot &&
      JSON.stringify(re.winners) === JSON.stringify(r.winnerTicketIds ?? []);
    body += `<div class="card"><div class="kv">
<div><b>Revealed secret</b><span class="mono">${esc(r.secret)}</span></div>
<div><b>sha256 check: commitment matches secret</b><span class="${commitmentOf(r.secret) === r.commitment ? "ok" : "bad"} mono">${commitmentOf(r.secret) === r.commitment ? "✓ matches" : "✗ MISMATCH"}</span></div>
<div><b>Beacon (${esc(r.beaconKind ?? "")})</b><span class="mono">${esc(r.beaconValue ?? "")}</span><span class="fine">${esc(r.beaconDetail ?? "")}</span></div>
<div><b>Merkle root of sorted tickets</b><span class="mono">${esc(r.merkleRoot ?? "")}</span></div>
<div><b>Live recompute of this page</b><span class="${match ? "ok" : "bad"}">${match ? "✓ recompute matches the recorded draw" : "✗ RECOMPUTE DOES NOT MATCH — do not trust this draw"}</span></div>
</div>
<b style="display:block;margin-top:16px">Winning ticket${re.winners.length > 1 ? "s" : ""}:</b>
${(r.winnerTicketIds ?? []).map((t) => `<div class="win mono">${esc(t)}</div>`).join("")}
<p class="fine">Recompute it yourself: seed = sha256("draw:" + secret + ":" + beacon + ":" + merkleRoot);
pick i = first sha256("pick:" + seed + ":" + round + ":" + counter) under the rejection bound, mod remaining tickets;
remove the winner and repeat per round. Tickets are sorted; PII never appears — people are tickets here.</p></div>`;
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(pageShell(`Verify — ${r.prize}`, body));
}));
