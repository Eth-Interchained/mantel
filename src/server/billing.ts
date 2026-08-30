/**
 * Monetization — the anti-Linktree model.
 *
 *   Free: one profile per account, forever.
 *   Premium, two doors:
 *     - pay what you want, ONCE (Stripe; floor $1) — no subscriptions,
 *       no rent. Buys up to premiumProfileLimit profiles (the anti-squat
 *       ceiling; a $5 payment must never buy the alphabet) + unlimited
 *       blocks and every premium feature. The receipt is an entitlement
 *       document in the engine, provenance and all. Entitlements older
 *       than premiumCapEpoch keep the uncapped deal they bought.
 *     - hold ≥ LINKS_ITC_THRESHOLD ITC on your account address —
 *       ownership was proven by the login signature, so the check is
 *       one ElectrumX query. Hold the coin, never pay the fee. Holders
 *       stay uncapped: their capital is locked the whole time.
 *
 * Self-hosters who configure neither Stripe nor a limit run unlimited
 * free. Monetize the hosted instance; never the GPLv3 code.
 */

import { Router, raw, type Express } from "express";
import Stripe from "stripe";
import { z } from "zod";

import { COLLECTIONS } from "../lib/identity";
import { maybeSendReceiptEmail } from "./accounts-email";
import { authOf, requireUser, type AuthContext } from "./auth";
import { config } from "./config";
import { db } from "./db";
import { confirmedItcBalance } from "./electrum";
import { grantsFor, grantsOf } from "./grants";
import { wrap } from "./util";

export const billing = Router();

const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;

export interface EntitlementRecord {
  address: string;
  kind: "supporter";
  amountCents: number;
  currency: string;
  stripeSessionId: string;
  createdAt: string;
}

export async function getEntitlement(
  address: string,
): Promise<EntitlementRecord | null> {
  const doc = await db.get(COLLECTIONS.entitlements, address);
  return (doc as EntitlementRecord | null) ?? null;
}

export async function ownedProfileCount(address: string): Promise<number> {
  // Only pages you CLAIMED yourself spend your allowance (claims always
  // self-grant, grantedBy === you). Ownership someone handed you can't —
  // otherwise a stranger could spend your limit without consent (Mark's
  // catch, 7/9: two hostile owner-grants would brick a free account).
  const grants = await grantsOf(address);
  return grants.filter((g) => g.role === "owner" && g.grantedBy === address).length;
}

/**
 * Premium for PAGE features: the page's OWNERS carry the entitlement.
 * A free editor on a premium page wields the page's powers; a premium
 * editor can't smuggle premium features onto a free page. (Mark's
 * model, 7/9: entitlements attach to the page, not the actor.)
 */
export async function pageUnlimited(identityId: string): Promise<boolean> {
  if (!config.limitEnabled) return true;
  const owners = (await grantsFor(identityId)).filter((g) => g.role === "owner");
  for (const g of owners) {
    const ctx = { address: g.address, isOperator: false } as AuthContext;
    if ((await unlimitedStatus(ctx)).unlimited) return true;
  }
  return false;
}

export interface UnlimitedStatus {
  unlimited: boolean;
  via: "operator" | "supporter" | "holder" | "unlimited-instance" | "none";
}

export async function unlimitedStatus(auth: AuthContext): Promise<UnlimitedStatus> {
  if (!config.limitEnabled) return { unlimited: true, via: "unlimited-instance" };
  if (auth.isOperator) return { unlimited: true, via: "operator" };
  if (await getEntitlement(auth.address)) return { unlimited: true, via: "supporter" };
  // Holder status is a WALLET-mode concept: email principals (eml_…) have
  // no chain address, and feeding one to the bech32 decoder is a category
  // error ("Unknown character b" in production logs). Skip unless this is
  // wallet mode AND the principal actually looks like an itc1 address.
  if (config.authMode === "wallet" && auth.address.startsWith("itc1")) {
    const itc = await confirmedItcBalance(auth.address);
    if (itc !== null && itc >= config.itcThreshold) {
      return { unlimited: true, via: "holder" };
    }
  }
  return { unlimited: false, via: "none" };
}

export interface ClaimGate {
  ok: boolean;
  /** Which ceiling said no — the claim route words the 402 accordingly. */
  reason: "free_limit" | "premium_limit" | null;
}

/** Is this supporter exempt from the premium profile cap? Entitlements
 *  bought before the cap existed keep the uncapped deal they paid for —
 *  a paid promise is never rewritten retroactively. */
export function isGrandfathered(ent: EntitlementRecord): boolean {
  return ent.createdAt < config.premiumCapEpoch;
}

/**
 * The claim gate: may this account create one more profile?
 *
 * Free tier: freeProfileLimit. Supporters: premiumProfileLimit — the
 * anti-squat lever (a one-time payment must never buy the alphabet) —
 * unless grandfathered. Operators, holders (capital stays locked the
 * whole time — different economics), and unlimited instances are
 * uncapped.
 */
export async function canClaimAnother(auth: AuthContext): Promise<ClaimGate> {
  if (!config.limitEnabled || auth.isOperator) return { ok: true, reason: null };
  const owned = await ownedProfileCount(auth.address);
  if (owned < config.freeProfileLimit) return { ok: true, reason: null };
  const status = await unlimitedStatus(auth);
  if (!status.unlimited) return { ok: false, reason: "free_limit" };
  if (status.via === "supporter" && config.premiumProfileLimit > 0) {
    const ent = await getEntitlement(auth.address);
    if (ent && !isGrandfathered(ent) && owned >= config.premiumProfileLimit) {
      return { ok: false, reason: "premium_limit" };
    }
  }
  return { ok: true, reason: null };
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/billing/status — everything the upgrade UI needs. */
billing.get("/status", requireUser, wrap(async (_req, res) => {
  const auth = authOf(res);
  if (!auth) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const [owned, status, itc] = await Promise.all([
    config.limitEnabled ? ownedProfileCount(auth.address) : Promise.resolve(0),
    unlimitedStatus(auth),
    config.limitEnabled && config.authMode === "wallet" && auth.address.startsWith("itc1")
      ? confirmedItcBalance(auth.address)
      : Promise.resolve(null),
  ]);
  // Cap exemption: operators, holders, unlimited instances, and
  // grandfathered supporters have no profile ceiling.
  const ent = status.via === "supporter" ? await getEntitlement(auth.address) : null;
  const capExempt =
    status.unlimited &&
    (status.via !== "supporter" ||
      config.premiumProfileLimit === 0 ||
      (ent !== null && isGrandfathered(ent)));
  res.json({
    limitEnabled: config.limitEnabled,
    freeLimit: config.freeProfileLimit,
    freeBlockLimit: config.freeBlockLimit,
    premiumProfileLimit: config.premiumProfileLimit,
    capExempt,
    owned,
    unlimited: status.unlimited,
    via: status.via,
    itcThreshold: config.itcThreshold,
    itcBalance: itc,
    holderCheckAvailable: itc !== null,
    fiatDoor: Boolean(stripe),
    pwywMinCents: config.pwywMinCents,
    address: auth.isOperator ? null : auth.address,
  });
}));

/**
 * Where should Stripe land the buyer afterwards? Same-origin PATH only —
 * never a foreign origin, never a protocol, never a hash. Anything
 * suspicious falls back to /identities. Exported for unit tests.
 *
 * This exists because Marisa upgraded MID-EDIT and the hard-coded
 * /identities success_url navigated her away from unsaved work. The
 * checkout now returns you to where you were standing.
 */
export function safeReturnPath(p: string | undefined, fallback = "/identities"): string {
  if (!p || !p.startsWith("/") || p.startsWith("//")) return fallback;
  if (p.includes("\\") || p.includes("://")) return fallback;
  const path = p.split(/[?#]/)[0];
  return path.length > 1 && path.length <= 200 ? path : fallback;
}

/** POST /api/billing/checkout { amountCents, returnTo? } — pay what you
 *  want, once; land back where you were standing. */
billing.post("/checkout", requireUser, wrap(async (req, res) => {
  const auth = authOf(res);
  if (!auth || auth.isOperator) {
    res.status(400).json({ error: "wallet account required" });
    return;
  }
  if (!stripe) {
    res.status(503).json({ error: "payments are not configured on this instance" });
    return;
  }
  const body = z
    .object({
      amountCents: z.number().int().min(config.pwywMinCents).max(50_000),
      returnTo: z.string().max(300).optional(),
    })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({
      error: `amount must be between ${config.pwywMinCents} and 50000 cents`,
    });
    return;
  }
  // Honor PUBLIC_ORIGIN — behind Cloudflare/nginx, req.protocol reports
  // plain http and Stripe would redirect buyers back to http:// URLs.
  const origin =
    config.publicOrigin || `${req.protocol}://${req.get("host") ?? "localhost"}`;
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: body.data.amountCents,
          // The contract surface — this sentence is what people buy.
          // It must promise exactly what the gate enforces: N profiles,
          // not "unlimited" (the squatter's favorite word).
          product_data: {
            name: `${config.brandName} Premium — pay once`,
            description:
              config.premiumProfileLimit > 0
                ? `Pay what you want, once. Up to ${config.premiumProfileLimit} profiles, unlimited blocks, galleries, the QR studio, custom SEO, team access, giveaways, Discover & the font vault. No subscription, ever.`
                : "Pay what you want, once. Unlimited blocks, galleries, the QR studio, custom SEO, team access, giveaways, Discover & the font vault. No subscription, ever.",
          },
        },
      },
    ],
    metadata: { address: auth.address },
    success_url: `${origin}${safeReturnPath(body.data.returnTo)}?upgraded=1`,
    cancel_url: `${origin}${safeReturnPath(body.data.returnTo)}`,
  });
  res.json({ url: session.url });
}));

/**
 * Stripe webhook — mounted with a RAW body BEFORE express.json()
 * (signature verification needs the exact bytes). See mountWebhook.
 */
export function mountWebhook(app: Express): void {
  app.post(
    "/api/billing/webhook",
    raw({ type: "application/json" }),
    (req, res) => {
      void (async () => {
        if (!stripe || !config.stripeWebhookSecret) {
          res.status(503).json({ error: "webhook not configured" });
          return;
        }
        let event: Stripe.Event;
        try {
          event = stripe.webhooks.constructEvent(
            req.body as Buffer,
            req.headers["stripe-signature"] as string,
            config.stripeWebhookSecret,
          );
        } catch (err) {
          res.status(400).json({
            error: `signature verification failed: ${err instanceof Error ? err.message : err}`,
          });
          return;
        }

        if (event.type === "checkout.session.completed") {
          const session = event.data.object;
          const address = session.metadata?.address;
          if (address) {
            const record: EntitlementRecord = {
              address,
              kind: "supporter",
              amountCents: session.amount_total ?? 0,
              currency: session.currency ?? "usd",
              stripeSessionId: session.id,
              createdAt: new Date().toISOString(),
            };
            await db.put(
              COLLECTIONS.entitlements,
              address,
              record as unknown as Record<string, unknown>,
              { evidence: `pay-what-you-want supporter: ${session.id}` },
            );
            console.log(`[links] supporter entitlement written for ${address}`);
            // Email mode: send the receipt (fire-and-forget by contract).
            maybeSendReceiptEmail(address, session.amount_total ?? 0, session.currency ?? "usd");
          }
        }
        res.json({ received: true });
      })().catch((err) => {
        console.error(`[links] webhook handling failed: ${err instanceof Error ? err.message : err}`);
        if (!res.headersSent) res.status(500).json({ error: "webhook processing failed" });
      });
    },
  );
}
