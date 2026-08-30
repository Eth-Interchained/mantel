/**
 * Stripe webhook — REAL signature math, offline.
 *
 * stripe.webhooks.generateTestHeaderString computes a genuine HMAC
 * signature with our webhook secret; constructEvent verifies it the
 * same way production does. No network, no mocks of our own code.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DB = `links_webhook_${Date.now().toString(36)}`;
delete process.env.LINKS_ADMIN_TOKEN;
process.env.STRIPE_SECRET_KEY = "sk_test_offline_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_offline_secret";

const { createApp, ensureDatabase } = await import("../src/server/app");
const { db } = await import("../src/server/db");
const Stripe = (await import("stripe")).default;

let server: Server;
let base: string;

before(async () => {
  assert.ok(await db.ping(), "nedbd required");
  await ensureDatabase();
  server = createApp().listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  server?.close();
  try {
    await db.dropDatabase();
  } catch {
    /* best-effort */
  }
});

const TEST_ADDRESS = "itc1qcr8te4kr609gcawutmrza0j4xv80jy8zw9vpf3";

function eventPayload(): string {
  return JSON.stringify({
    id: "evt_test_1",
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_webhook_1",
        object: "checkout.session",
        amount_total: 1500,
        currency: "usd",
        metadata: { address: TEST_ADDRESS },
      },
    },
  });
}

test("a correctly signed webhook writes the entitlement", async () => {
  const payload = eventPayload();
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET as string,
  });
  const r = await fetch(`${base}/api/billing/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body: payload,
  });
  assert.equal(r.status, 200);

  const doc = await db.get("entitlements", TEST_ADDRESS);
  assert.ok(doc, "entitlement written");
  assert.equal(doc?.kind, "supporter");
  assert.equal(doc?.amountCents, 1500);
  assert.equal(doc?.stripeSessionId, "cs_test_webhook_1");
});

test("a tampered webhook is rejected and writes nothing", async () => {
  const payload = eventPayload();
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: "whsec_WRONG_secret",
  });
  const r = await fetch(`${base}/api/billing/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body: payload.replace("1500", "999999"),
  });
  assert.equal(r.status, 400, "bad signature rejected");
});
