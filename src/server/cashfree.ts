/**
 * Cashfree adapter — Tier 2, using the CREATOR's own account.
 *
 * THE POSITION THIS ENCODES
 * Interchained is never merchant of record. Orders are created with the
 * creator's own `x-client-id` / `x-client-secret`, so settlement lands in
 * THEIR bank and we take no cut and hold no funds. What Tier 2 adds over
 * the plain UPI intent is the one thing an intent cannot give us: a
 * signed callback, which is what makes auto-delivery honest instead of a
 * guess.
 *
 * WHY CASHFREE FIRST (Mark, 2026-08-21)
 * Its webhook signs `timestamp + rawBody`, so replay protection is
 * intrinsic. Razorpay signs the body alone, which means anyone who
 * captures one valid callback can resend it forever unless we track
 * event ids ourselves. Both are securable; this one is securable by
 * default, and defaults are what survive contact with production.
 *
 * SIGNATURE VERIFICATION, THE PART THAT MUST NOT BE WRONG
 *   - Verify against the RAW body. Re-serializing parsed JSON changes
 *     bytes (key order, spacing, unicode escapes) and every mismatch
 *     becomes either a false reject or, worse, a scheme someone can
 *     grind against.
 *   - Compare in constant time (secretbox.safeEqual).
 *   - Reject stale timestamps. A signature that never expires is a
 *     replay waiting to happen even with the timestamp signed.
 *   - Fail CLOSED. Any missing header, unparseable field, or absent
 *     credential is a rejection, never a pass-through.
 */

import { createHmac } from "node:crypto";

import { raw, type Express } from "express";

import { unsealPsp } from "./payments";
import { deliverPurchase, getPurchase } from "./purchases";
import { safeEqual } from "./secretbox";

/** Cashfree's live and sandbox bases. Sandbox when the id says so. */
const LIVE = "https://api.cashfree.com/pg";
const SANDBOX = "https://sandbox.cashfree.com/pg";
const API_VERSION = "2023-08-01";

/** How far out of step a callback's clock may be before we refuse it. */
export const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

export function cashfreeBase(keyId: string): string {
  // Cashfree test credentials are prefixed TEST — routing them at the
  // live host produces a confusing 401 rather than an obvious "you're
  // using sandbox keys" error.
  return /^TEST/i.test(keyId) ? SANDBOX : LIVE;
}

export interface CashfreeOrder {
  orderId: string;
  /** Handed to the buyer's browser to complete payment. */
  paymentSessionId: string;
}

/**
 * Create an order on the creator's Cashfree account.
 *
 * Throws on any non-2xx so callers can't accidentally treat a failed
 * order as a live one. The thrown message deliberately carries Cashfree's
 * own text (useful) but never the credentials used (radioactive).
 */
export async function createCashfreeOrder(opts: {
  keyId: string;
  keySecret: string;
  orderId: string;
  amount: number;
  customerEmail: string;
  customerPhone?: string;
  returnUrl: string;
  note?: string;
}): Promise<CashfreeOrder> {
  const res = await fetch(`${cashfreeBase(opts.keyId)}/orders`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-version": API_VERSION,
      "x-client-id": opts.keyId,
      "x-client-secret": opts.keySecret,
    },
    body: JSON.stringify({
      order_id: opts.orderId,
      order_amount: Number(opts.amount.toFixed(2)),
      order_currency: "INR",
      order_note: opts.note?.slice(0, 200),
      customer_details: {
        // Cashfree requires a customer id; derive one rather than
        // inventing an account system for buyers who never sign up.
        customer_id: `buy_${Buffer.from(opts.customerEmail).toString("hex").slice(0, 24)}`,
        customer_email: opts.customerEmail,
        customer_phone: opts.customerPhone || "9999999999",
      },
      order_meta: { return_url: opts.returnUrl },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const j = JSON.parse(text) as { message?: string };
      if (j.message) msg = j.message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`cashfree order failed: ${msg}`);
  }
  const j = JSON.parse(text) as { order_id?: string; payment_session_id?: string };
  if (!j.order_id || !j.payment_session_id) {
    throw new Error("cashfree order failed: response missing order_id/payment_session_id");
  }
  return { orderId: j.order_id, paymentSessionId: j.payment_session_id };
}

export interface WebhookVerdict {
  ok: boolean;
  /** Why it failed — for OUR logs. Never returned to a caller. */
  reason?: string;
}

/**
 * Verify a Cashfree webhook signature.
 *
 * `rawBody` must be the exact bytes received. Anything re-serialized is
 * a different message as far as HMAC is concerned.
 */
export function verifyCashfreeWebhook(opts: {
  rawBody: string;
  timestamp: string;
  signature: string;
  webhookSecret: string;
  /** Injectable for tests; defaults to now. */
  now?: number;
}): WebhookVerdict {
  const { rawBody, timestamp, signature, webhookSecret } = opts;
  if (!webhookSecret) return { ok: false, reason: "no webhook secret configured" };
  if (!rawBody) return { ok: false, reason: "empty body" };
  if (!timestamp || !signature) return { ok: false, reason: "missing signature headers" };

  // Cashfree sends epoch SECONDS. Reject anything unparseable rather than
  // coercing — NaN comparisons are false, which would silently pass the
  // freshness check in a naive implementation.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "unparseable timestamp" };
  const ageMs = Math.abs((opts.now ?? Date.now()) - ts * 1000);
  if (ageMs > MAX_SIGNATURE_AGE_MS) return { ok: false, reason: "stale timestamp" };

  const expected = createHmac("sha256", webhookSecret)
    .update(`${timestamp}${rawBody}`)
    .digest("base64");
  return safeEqual(expected, signature)
    ? { ok: true }
    : { ok: false, reason: "signature mismatch" };
}

/** The bit of a verified callback we actually act on. */
export interface CashfreeEvent {
  type: string;
  orderId: string;
  /** True only for a terminal, successful payment. */
  paid: boolean;
  amount: number | null;
}

/**
 * Read a verified webhook body.
 *
 * `paid` is true ONLY for an explicit SUCCESS on a payment event. Every
 * other shape — pending, failed, dropped, an event type we don't know —
 * is false. A delivery must never fire on an optimistic reading of a
 * status string we didn't recognise.
 */
export function parseCashfreeEvent(rawBody: string): CashfreeEvent | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = String(j.type ?? "");
  const data = (j.data ?? {}) as Record<string, unknown>;
  const order = (data.order ?? {}) as Record<string, unknown>;
  const payment = (data.payment ?? {}) as Record<string, unknown>;
  const orderId = String(order.order_id ?? "");
  if (!orderId) return null;
  const status = String(payment.payment_status ?? "").toUpperCase();
  const amountRaw = payment.payment_amount ?? order.order_amount;
  const amount = Number(amountRaw);
  return {
    type,
    orderId,
    paid: type === "PAYMENT_SUCCESS_WEBHOOK" && status === "SUCCESS",
    amount: Number.isFinite(amount) ? amount : null,
  };
}

// ── The verified-callback endpoint ──────────────────────────────────────────

/**
 * Mount POST /api/cashfree/:identityId/webhook.
 *
 * Mounted with a RAW body parser, before express.json(), because HMAC is
 * computed over exact bytes — re-serialized JSON is a different message.
 * The identity is in the path so we know whose webhook secret to check
 * against: each creator brings their own, and one creator's secret must
 * never validate another's callback.
 *
 * Responses are deliberately terse. A webhook endpoint that explains why
 * a signature failed is an oracle; Cashfree only needs to know whether to
 * retry.
 */
export function mountCashfreeWebhook(app: Express): void {
  app.post("/api/cashfree/:identityId/webhook", raw({ type: "*/*" }), (req, res) => {
    void (async () => {
      const identityId = String((req.params as Record<string, string>).identityId ?? "");
      const creds = await unsealPsp(identityId);
      if (!creds || creds.provider !== "cashfree" || !creds.webhookSecret) {
        res.status(404).json({ error: "not configured" });
        return;
      }
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");
      const verdict = verifyCashfreeWebhook({
        rawBody,
        timestamp: String(req.headers["x-webhook-timestamp"] ?? ""),
        signature: String(req.headers["x-webhook-signature"] ?? ""),
        webhookSecret: creds.webhookSecret,
      });
      if (!verdict.ok) {
        // Logged for us, never returned — the reason is a hint we don't give.
        console.warn(`[links] cashfree webhook rejected (${identityId}): ${verdict.reason}`);
        res.status(400).json({ error: "invalid signature" });
        return;
      }

      const event = parseCashfreeEvent(rawBody);
      // 200 on events we understand but don't act on: a non-2xx makes
      // Cashfree retry forever something we're deliberately ignoring.
      if (!event) {
        res.json({ ok: true, ignored: "unreadable" });
        return;
      }
      if (!event.paid) {
        res.json({ ok: true, ignored: event.type || "not a completed payment" });
        return;
      }

      const purchase = await getPurchase(event.orderId);
      if (!purchase || purchase.identityId !== identityId) {
        res.json({ ok: true, ignored: "unknown order" });
        return;
      }
      // Idempotent by construction: providers retry, and a second
      // delivery email for one purchase is a bug the buyer sees.
      if (purchase.status !== "claimed") {
        res.json({ ok: true, ignored: `already ${purchase.status}` });
        return;
      }

      const out = await deliverPurchase(purchase);
      if (!out.ok) {
        // 500 so Cashfree retries — the payment IS verified, so failing to
        // deliver is our problem to recover from, not a reason to drop it.
        console.error(`[links] cashfree delivery failed (${event.orderId}): ${out.error}`);
        res.status(500).json({ error: "delivery failed" });
        return;
      }
      res.json({ ok: true, delivered: event.orderId });
    })().catch((err: unknown) => {
      console.error(`[links] cashfree webhook error: ${err instanceof Error ? err.message : err}`);
      res.status(500).json({ error: "webhook error" });
    });
  });
}
