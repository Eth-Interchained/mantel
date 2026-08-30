/**
 * Tier-1 digital product sales — the manual-settle loop, done honestly.
 *
 * WHY IT WORKS THIS WAY
 * A UPI intent has no callback. Nothing tells this server whether money
 * moved. The options were: (a) force every seller through a payment
 * gateway (KYC, merchant account, a cut, and Interchained sitting in the
 * middle of someone else's money), or (b) let the buyer pay directly and
 * have the SELLER confirm from their own bank app. Mark chose (b) on
 * 2026-08-21 — Tier 1 stands. It costs one human step and buys: no
 * signup, no KYC, no fee, and no plausible reading in which we are the
 * intermediary.
 *
 * THE FLOW
 *   GET  /buy/:identityId/:blockId        the product + pay button + claim form
 *   POST /buy/:identityId/:blockId        buyer submits UPI ref + email → pending
 *   GET  /api/identities/:id/purchases    seller lists claims (editor+)
 *   POST /api/identities/:id/purchases/:pid/confirm   (owner) → delivers by email
 *   POST /api/identities/:id/purchases/:pid/reject    (owner) → closes it
 *
 * WHAT WE NEVER DO
 * Never assert a payment happened. A claim is exactly that — the BUYER's
 * assertion. Until the seller confirms against their own bank, every
 * surface says "claimed", never "paid". The deliverable never appears on
 * a public page and never ships before confirmation.
 */

import { randomBytes } from "node:crypto";

import { Router } from "express";
import { z } from "zod";

import { COLLECTIONS, type AccountRecord, type Block } from "../lib/identity";
import { esc, productUpiHref } from "../lib/renderers/html";
import { authOf, requireUser } from "./auth";
import { causalParent, db } from "./db";
import { track } from "./events";
import { productDeliveryEmail, productClaimEmail } from "./emails";
import { grantsFor, hasRole } from "./grants";
import { getManifest } from "./identities";
import { sendMail } from "./mailer";
import { pageShell } from "./raffles";
import { wrap } from "./util";

export const purchases = Router();
export const purchasesApi = Router({ mergeParams: true });

export type PurchaseStatus = "claimed" | "delivered" | "rejected";

export interface PurchaseDoc {
  purchaseId: string;
  identityId: string;
  blockId: string;
  handle: string;
  title: string;
  price: number;
  /** The buyer's assertion, not our observation. 12-digit UPI reference. */
  reference: string;
  buyerEmail: string;
  /** Bookings only: the slot the buyer chose, in the seller's own words. */
  slot?: string;
  status: PurchaseStatus;
  createdAt: string;
  settledAt?: string;
}

const hits = new Map<string, { n: number; resetAt: number }>();
function throttled(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now > h.resetAt) {
    hits.set(key, { n: 1, resetAt: now + windowMs });
    return false;
  }
  h.n += 1;
  return h.n > max;
}

/** Find a sellable block (product or booking) on a published identity. */
type Manifest = NonNullable<Awaited<ReturnType<typeof getManifest>>>;

async function findProduct(
  identityId: string,
  blockId: string,
): Promise<{ manifest: Manifest; block: Block } | null> {
  if (!/^idn_[a-f0-9]{20}$/.test(identityId)) return null;
  const manifest = await getManifest(identityId);
  if (!manifest) return null;
  const block = manifest.blocks.find(
    (b) => b.id === blockId && (b.type === "product" || b.type === "booking"),
  );
  return block ? { manifest, block } : null;
}

/**
 * The seller's email, resolved through the owner grant.
 *
 * Wallet-mode deployments have no email for an owner at all, so this
 * returns null there and the claim simply lands without a notification —
 * the seller finds it in their purchases list. A missing notification
 * must never block a buyer's claim from being recorded.
 */
async function ownerEmail(identityId: string): Promise<string | null> {
  const owners = (await grantsFor(identityId)).filter((g) => g.role === "owner");
  for (const g of owners) {
    const acct = (await db.get(COLLECTIONS.accounts, g.address)) as AccountRecord | null;
    if (acct?.email) return acct.email;
  }
  return null;
}

/**
 * Slots still open on a booking block.
 *
 * "Open" means no claim holds it that hasn't been rejected — a pending
 * claim reserves the time. That is the deliberate call: a slot held by
 * someone who turns out not to have paid can be freed by rejecting them,
 * but a slot double-sold means the seller stands someone up for a call
 * they were paid for. Reversible beats efficient here.
 */
async function openSlots(blockId: string, all: unknown): Promise<string[]> {
  const declared = Array.isArray(all) ? all.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  if (!declared.length) return [];
  const rows = (await db.query(
    `FROM ${COLLECTIONS.purchases} WHERE blockId = "${blockId}" LIMIT 1000`,
  )) as unknown as PurchaseDoc[];
  const held = new Set(
    rows.filter((r) => r.status !== "rejected" && r.slot).map((r) => String(r.slot)),
  );
  return declared.filter((sl) => !held.has(sl));
}

const claimSchema = z.object({
  // UPI reference numbers are 12 digits. Accept 8–24 so a bank that
  // formats differently doesn't lock an honest buyer out of claiming.
  reference: z.string().trim().regex(/^[A-Za-z0-9]{8,24}$/, "that doesn't look like a UPI reference number"),
  email: z.string().trim().toLowerCase().email().max(254),
  /** Bookings only — validated against the block's real slot list below,
   *  never trusted as free text. */
  slot: z.string().trim().max(80).optional(),
});

// ── Public, zero-JS buy page ────────────────────────────────────────────────

purchases.get("/buy/:identityId/:blockId", wrap(async (req, res, next) => {
  const found = await findProduct(String(req.params.identityId), String(req.params.blockId));
  if (!found) {
    next();
    return;
  }
  const d = found.block.data as Record<string, unknown>;
  const pay = productUpiHref(d);
  if (!pay) {
    next();
    return;
  }
  const price = Number(d.price);
  const back = `/${esc(found.manifest.handle)}`;
  const isBooking = found.block.type === "booking";
  const free = isBooking ? await openSlots(found.block.id, d.slots) : [];
  if (isBooking && !free.length) {
    res.send(
      pageShell(
        String(d.title ?? "Fully booked"),
        `<h1>Fully booked</h1>
<p class="sub">Every time for <b>${esc(d.title)}</b> is taken right now. Check back — @${esc(found.manifest.handle)} may open more.</p>
<p class="sub"><a href="${back}">← back to @${esc(found.manifest.handle)}</a></p>`,
      ),
    );
    return;
  }
  // ONE form wraps the whole flow. The slot radios must be inside it to
  // submit at all, and a picker rendered outside looks interactive while
  // silently sending nothing — so the pay link lives in here too and the
  // steps read top to bottom in the order a buyer performs them. Radios
  // rather than a <select>: on a phone every time is visible at a glance.
  const step = (n: number): number => (isBooking ? n : n - 1);
  res.send(
    pageShell(
      String(d.title ?? "Buy"),
      `<h1>${esc(d.title)}</h1>
${d.blurb ? `<p class="sub">${esc(d.blurb)}</p>` : ""}
<form method="post" action="/buy/${esc(found.manifest.identityId)}/${esc(found.block.id)}">
${
  isBooking
    ? `<div class="card">
  <p class="sub">Step 1 — pick your time${d.duration ? ` <span class="fine">(${esc(String(d.duration))})</span>` : ""}</p>
  ${free
    .map(
      (sl, i) =>
        `<label class="slot"><input type="radio" name="slot" value="${esc(sl)}" ${i === 0 ? "checked" : ""} required /> ${esc(sl)}</label>`,
    )
    .join("\n  ")}
</div>`
    : ""
}
<div class="card">
  <p class="sub">Step ${step(2)} — pay <b>₹${esc(price.toFixed(2).replace(/\.00$/, ""))}</b> to
     <span class="mono">${esc(String(d.vpa))}</span></p>
  <p><a class="btn" href="${esc(pay)}">Open my UPI app</a></p>
  <p class="fine">On a phone this opens GPay, PhonePe, Paytm, CRED or whichever UPI
     app you use.</p>
  <div class="qrwrap">
    <img class="qr" src="/upi/${esc(found.manifest.identityId)}/${esc(found.block.id)}.svg"
         alt="UPI QR code to pay ₹${esc(price.toFixed(2).replace(/\.00$/, ""))} to ${esc(String(d.vpa))}"
         width="180" height="180" />
    <p class="fine">On a computer? Scan this with any UPI app on your phone.</p>
  </div>
  <p class="fine">Or send it manually to <span class="mono">${esc(String(d.vpa))}</span>.
     The money goes straight to the seller's bank — this site is not part of the
     transaction and takes no fee.</p>
</div>
<div class="card">
  <p class="sub">Step ${step(3)} — tell ${isBooking ? "them" : "the seller"} you paid</p>
  <label>UPI reference number</label>
  <input name="reference" inputmode="numeric" maxlength="24" required class="mono"
         placeholder="12-digit ref from your UPI app" />
  <label>Your email</label>
  <input name="email" type="email" maxlength="254" required placeholder="where we send it" />
  <button>I've paid — ${isBooking ? "book my slot" : "send it to me"}</button>
  <p class="fine">The seller checks this reference against their own bank, then
     ${isBooking ? "confirms your booking and sends the meeting link" : "releases your download"}.
     You'll get an email the moment they confirm.</p>
</div>
</form>
<p class="sub"><a href="${back}">← back to @${esc(found.manifest.handle)}</a></p>`,
    ),
  );
}));

purchases.post("/buy/:identityId/:blockId", wrap(async (req, res, next) => {
  const found = await findProduct(String(req.params.identityId), String(req.params.blockId));
  if (!found) {
    next();
    return;
  }
  const d = found.block.data as Record<string, unknown>;
  const backLink = `<p class="sub"><a href="/buy/${esc(found.manifest.identityId)}/${esc(found.block.id)}">← back</a></p>`;
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) {
    res.send(
      pageShell(
        "Check the form",
        `<h1>Something's missing</h1><p class="sub">${esc(parsed.error.issues[0]?.message ?? "reference and email are required")}</p>${backLink}`,
      ),
    );
    return;
  }
  if (throttled(`buy:${req.ip}:${found.block.id}`, 5, 10 * 60 * 1000)) {
    res.send(pageShell("Slow down", `<h1>Too many attempts</h1><p class="sub">Try again in a few minutes.</p>${backLink}`));
    return;
  }

  // Bookings: the slot must be one the seller actually offered AND still
  // free. Validated against the block, never trusted from the form — a
  // hand-crafted POST must not be able to invent a time or take one
  // that's already sold.
  const isBooking = found.block.type === "booking";
  let slot: string | undefined;
  if (isBooking) {
    const free = await openSlots(found.block.id, d.slots);
    const wanted = parsed.data.slot ?? "";
    if (!wanted || !free.includes(wanted)) {
      res.send(
        pageShell(
          "That time just went",
          `<h1>${wanted ? "That time was just taken" : "Pick a time first"}</h1>
<p class="sub">${
            free.length
              ? "Someone booked it while you were paying, or it wasn't on offer. Pick another — and if you already paid, the seller will sort you out."
              : "Every slot is taken now. If you already paid, contact the seller."
          }</p>${backLink}`,
        ),
      );
      return;
    }
    slot = wanted;
  }

  // One claim per reference: a UPI ref identifies a single transaction, so
  // re-submitting it is a duplicate, not a second purchase. This is also
  // what stops someone spamming a seller with one number.
  const existing = (await db.query(
    `FROM ${COLLECTIONS.purchases} WHERE reference = "${parsed.data.reference}" LIMIT 1`,
  )) as unknown as PurchaseDoc[];
  if (existing.length) {
    res.send(
      pageShell(
        "Already sent",
        `<h1>That reference is already in</h1><p class="sub">The seller has it and will confirm shortly. You'll get an email when they do.</p>${backLink}`,
      ),
    );
    return;
  }

  const purchaseId = `pur_${randomBytes(10).toString("hex")}`;
  const doc: PurchaseDoc = {
    purchaseId,
    identityId: found.manifest.identityId,
    blockId: found.block.id,
    handle: found.manifest.handle,
    title: String(d.title ?? ""),
    price: Number(d.price),
    reference: parsed.data.reference,
    buyerEmail: parsed.data.email,
    ...(slot ? { slot } : {}),
    status: "claimed",
    createdAt: new Date().toISOString(),
  };
  await db.put(COLLECTIONS.purchases, purchaseId, doc as unknown as Record<string, unknown>, {
    evidence: `purchase claimed: ${found.manifest.handle}/${found.block.id} ref ${parsed.data.reference}`,
  });

  // Sales were invisible to analytics until now — every dashboard reads
  // the event log, so a purchase that emits nothing may as well not have
  // happened as far as the product's own numbers are concerned.
  track({
    kind: "purchase_claimed",
    identityId: doc.identityId,
    blockId: doc.blockId,
    amount: doc.price,
    source: doc.slot ? "booking" : "product",
  });

  // Tell the seller there's something to check. Best-effort: a mail
  // failure must not lose the claim the buyer just made.
  const sellerEmail = await ownerEmail(found.manifest.identityId);
  if (sellerEmail) {
    sendMail(
      productClaimEmail({
        to: sellerEmail,
        title: doc.title,
        price: doc.price,
        reference: doc.reference,
        buyerEmail: doc.buyerEmail,
        handle: doc.handle,
        slot: doc.slot,
      }),
    ).catch((err) => console.error(`[links] claim notice failed: ${err instanceof Error ? err.message : err}`));
  }

  res.send(
    pageShell(
      "Sent to the seller",
      `<h1>Sent ✓</h1>
<p class="sub">${doc.slot ? `Your slot <b>${esc(doc.slot)}</b> is held. ` : ""}The seller is checking reference
   <span class="mono">${esc(doc.reference)}</span> against their bank. As soon as they confirm,
   <b>${esc(doc.buyerEmail)}</b> gets the ${doc.slot ? "meeting link" : "delivery email"}.</p>
<p class="fine">Nothing was charged by this site — your payment went directly to the seller's UPI address.</p>
<p class="sub"><a href="/${esc(doc.handle)}">← back to @${esc(doc.handle)}</a></p>`,
    ),
  );
}));

// ── Seller API (mounted at /api/identities/:id/purchases) ───────────────────

purchasesApi.get("/", requireUser, wrap(async (req, res) => {
  const identityId = String((req.params as Record<string, string>).id);
  const auth = authOf(res);
  if (!auth || !(await hasRole(identityId, auth, "editor"))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const rows = (await db.query(
    `FROM ${COLLECTIONS.purchases} WHERE identityId = "${identityId}" LIMIT 1000`,
  )) as unknown as PurchaseDoc[];
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ purchases: rows });
}));

/**
 * Mark a purchase delivered and email the buyer — the ONE code path that
 * releases a deliverable, whether a human confirmed it or a verified
 * webhook did. Two paths would eventually disagree about what "delivered"
 * means, and the disagreement would be discovered by a buyer who paid.
 *
 * Mails BEFORE writing the new status: if the send fails the claim stays
 * actionable rather than silently closing with nothing sent.
 */
export async function deliverPurchase(doc: PurchaseDoc): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
  const manifest = await getManifest(doc.identityId);
  const block = manifest?.blocks.find((b) => b.id === doc.blockId);
  const deliverable = String((block?.data as Record<string, unknown> | undefined)?.deliverable ?? "");
  if (!/^https:\/\//.test(deliverable)) {
    return {
      ok: false,
      code: "no_deliverable",
      error: "this product has no delivery link yet — add one to the block before confirming",
    };
  }
  try {
    await sendMail(
      productDeliveryEmail({
        to: doc.buyerEmail,
        title: doc.title,
        deliverable,
        handle: doc.handle,
        slot: doc.slot,
      }),
    );
  } catch (err) {
    return { ok: false, error: `couldn't send the delivery email — ${err instanceof Error ? err.message : "try again"}` };
  }
  const updated: PurchaseDoc = { ...doc, status: "delivered", settledAt: new Date().toISOString() };
  await db.put(COLLECTIONS.purchases, doc.purchaseId, updated as unknown as Record<string, unknown>, {
    causedBy: causalParent(doc as unknown as Record<string, unknown>),
    evidence: `purchase delivered: ${doc.purchaseId} (${doc.reference})`,
  });
  // Emitted only after the write lands: "delivered" in the log must mean
  // the state actually changed, not that we were about to try.
  track({
    kind: "purchase_delivered",
    identityId: doc.identityId,
    blockId: doc.blockId,
    amount: doc.price,
    source: doc.slot ? "booking" : "product",
  });
  return { ok: true };
}

/** Load one purchase, or null. Used by the verified-webhook path. */
export async function getPurchase(purchaseId: string): Promise<PurchaseDoc | null> {
  return ((await db.get(COLLECTIONS.purchases, purchaseId)) as PurchaseDoc | null) ?? null;
}

async function settle(
  req: Parameters<Parameters<typeof wrap>[0]>[0],
  res: Parameters<Parameters<typeof wrap>[0]>[1],
  next: PurchaseStatus,
): Promise<void> {
  const identityId = String((req.params as Record<string, string>).id);
  const purchaseId = String((req.params as Record<string, string>).pid);
  const auth = authOf(res);
  // Owner only: releasing a paid product (or refusing one) is the money
  // decision, not an editing one.
  if (!auth || !(await hasRole(identityId, auth, "owner"))) {
    res.status(403).json({ error: "owner role required" });
    return;
  }
  const doc = (await db.get(COLLECTIONS.purchases, purchaseId)) as PurchaseDoc | null;
  if (!doc || doc.identityId !== identityId) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (doc.status !== "claimed") {
    res.status(409).json({ error: `already ${doc.status}` });
    return;
  }

  if (next === "delivered") {
    const out = await deliverPurchase(doc);
    if (!out.ok) {
      res.status(out.code === "no_deliverable" ? 400 : 502).json({ error: out.error, code: out.code });
      return;
    }
    res.json({ purchase: { ...doc, status: "delivered" } });
    return;
  }

  const updated: PurchaseDoc = { ...doc, status: next, settledAt: new Date().toISOString() };
  await db.put(COLLECTIONS.purchases, purchaseId, updated as unknown as Record<string, unknown>, {
    causedBy: causalParent(doc as unknown as Record<string, unknown>),
    evidence: `purchase ${next}: ${purchaseId} (${doc.reference})`,
  });
  if (next === "rejected") {
    track({
      kind: "purchase_rejected",
      identityId: doc.identityId,
      blockId: doc.blockId,
      amount: doc.price,
      source: doc.slot ? "booking" : "product",
    });
  }
  res.json({ purchase: updated });
}

purchasesApi.post("/:pid/confirm", requireUser, wrap(async (req, res) => settle(req, res, "delivered")));
purchasesApi.post("/:pid/reject", requireUser, wrap(async (req, res) => settle(req, res, "rejected")));
