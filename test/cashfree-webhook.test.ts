/**
 * Cashfree webhook — live, against the REAL server and nedbd.
 *
 * The unit suite proves the signature math. This proves the ENDPOINT:
 * that a forged callback cannot release a paid product, that a real one
 * can, and that a provider retrying doesn't deliver twice.
 *
 * The assertion that matters most is "a forged callback delivers
 * nothing". If it ever goes red, someone can take our sellers' products
 * for free.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHmac, randomBytes } from "node:crypto";
import type { Server } from "node:http";

process.env.NEDB_DB = `links_cfhook_${Date.now().toString(36)}`;
process.env.LINKS_AUTH_MODE = "email";
process.env.LINKS_MAIL_TEST = "1";
process.env.PUBLIC_ORIGIN = "http://links.test";
process.env.LINKS_SECRET_KEY = randomBytes(32).toString("base64");
delete process.env.LINKS_ADMIN_TOKEN;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.LINKS_FREE_PROFILE_LIMIT;

const { createApp, ensureDatabase } = await import("../src/server/app");
const { db } = await import("../src/server/db");
const { outbox } = await import("../src/server/mailer");

let server: Server;
let base: string;
let identityId = "";
let token = "";
const BLOCK = "blk_cf_1";
const SELLER = "seller@cf.test";
const BUYER = "buyer@cf.test";
const DELIVERABLE = "https://cdn.example.com/private/cf-kit.zip";
const WEBHOOK_SECRET = "whsec_cf_live_7Kd2mQp";

function authed(t: string): Record<string, string> {
  return { authorization: `Bearer ${t}`, "content-type": "application/json" };
}
async function post(path: string, body: unknown, t = ""): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(body),
  });
}

/** POST a webhook exactly as Cashfree would, signed with `secret`. */
async function hook(
  body: string,
  opts: { secret?: string; ts?: string; sig?: string; path?: string } = {},
): Promise<Response> {
  const ts = opts.ts ?? String(Math.floor(Date.now() / 1000));
  const sig =
    opts.sig ?? createHmac("sha256", opts.secret ?? WEBHOOK_SECRET).update(`${ts}${body}`).digest("base64");
  return fetch(`${base}${opts.path ?? `/api/cashfree/${identityId}/webhook`}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-timestamp": ts,
      "x-webhook-signature": sig,
    },
    body,
  });
}

function successBody(orderId: string, amount = 499): string {
  return JSON.stringify({
    type: "PAYMENT_SUCCESS_WEBHOOK",
    data: {
      order: { order_id: orderId, order_amount: amount },
      payment: { payment_status: "SUCCESS", payment_amount: amount },
    },
  });
}

/** Create a pending claim and return its purchase id (= the order id). */
async function newClaim(reference: string): Promise<string> {
  await fetch(`${base}/buy/${identityId}/${BLOCK}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ reference, email: BUYER }).toString(),
  });
  const list = (await (
    await fetch(`${base}/api/identities/${identityId}/purchases`, { headers: authed(token) })
  ).json()) as { purchases: Array<{ purchaseId: string; reference: string }> };
  const row = list.purchases.find((p) => p.reference === reference);
  assert.ok(row, "claim was created");
  return row.purchaseId;
}

before(async () => {
  assert.ok(await db.ping(), "nedbd required");
  await ensureDatabase();
  server = createApp().listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;

  await post("/api/auth/signup", { email: SELLER, password: "hunter2hunter2" });
  const mail = outbox.filter((m) => m.to === SELLER).at(-1);
  const vt = /token=([a-zA-Z0-9_-]+)/.exec(mail?.text ?? "")?.[1];
  token = ((await (await post("/api/auth/verify-email", { token: vt })).json()) as { token: string }).token;

  const claim = await post("/api/identities", { handle: "cf-test", displayName: "CF Seller" }, token);
  identityId = ((await claim.json()) as { manifest: { identityId: string } }).manifest.identityId;

  const cur = (await (await fetch(`${base}/api/identities/${identityId}`, { headers: authed(token) })).json()) as {
    manifest: Record<string, unknown>;
  };
  cur.manifest.blocks = [
    {
      id: BLOCK,
      type: "product",
      order: 0,
      data: { title: "CF Kit", price: 499, vpa: "seller@okaxis", deliverable: DELIVERABLE },
    },
  ];
  await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: authed(token),
    body: JSON.stringify(cur.manifest),
  });
  await post(`/api/identities/${identityId}/publish`, {}, token);

  // The seller connects their OWN Cashfree account.
  const wired = await fetch(`${base}/api/identities/${identityId}/payments`, {
    method: "PUT",
    headers: authed(token),
    body: JSON.stringify({
      provider: "cashfree",
      keyId: "TESTclientid123456",
      keySecret: "cfsk_test_secret_value",
      webhookSecret: WEBHOOK_SECRET,
    }),
  });
  assert.equal(wired.status, 200, "creator's Cashfree credentials are sealed");
});

after(async () => {
  server?.close();
  try {
    await db.dropDatabase();
  } catch {
    /* best-effort */
  }
});

test("a forged callback delivers NOTHING", async () => {
  const pid = await newClaim("900000000001");
  const body = successBody(pid);
  const before = outbox.length;

  const attempts: Array<[string, Response]> = [
    ["wrong secret", await hook(body, { secret: "whsec_attacker" })],
    ["no signature", await hook(body, { sig: "" })],
    ["garbage signature", await hook(body, { sig: "AAAA" })],
    ["stale timestamp", await hook(body, { ts: String(Math.floor(Date.now() / 1000) - 3600) })],
    [
      "body swapped after signing",
      await fetch(`${base}/api/cashfree/${identityId}/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-timestamp": String(Math.floor(Date.now() / 1000)),
          "x-webhook-signature": createHmac("sha256", WEBHOOK_SECRET)
            .update(`${Math.floor(Date.now() / 1000)}${successBody("some-other-order")}`)
            .digest("base64"),
        },
        body,
      }),
    ],
  ];
  for (const [label, res] of attempts) {
    assert.equal(res.status, 400, `${label} → 400`);
  }

  assert.equal(outbox.length, before, "not one delivery email was sent");
  const rows = (await (
    await fetch(`${base}/api/identities/${identityId}/purchases`, { headers: authed(token) })
  ).json()) as { purchases: Array<{ purchaseId: string; status: string }> };
  assert.equal(
    rows.purchases.find((p) => p.purchaseId === pid)?.status,
    "claimed",
    "the purchase is untouched",
  );
});

test("one creator's secret cannot validate another creator's callback", async () => {
  // A second seller with their own, different webhook secret.
  await post("/api/auth/signup", { email: "other@cf.test", password: "hunter2hunter2" });
  const m = outbox.filter((x) => x.to === "other@cf.test").at(-1);
  const vt = /token=([a-zA-Z0-9_-]+)/.exec(m?.text ?? "")?.[1];
  const otherToken = ((await (await post("/api/auth/verify-email", { token: vt })).json()) as { token: string })
    .token;
  const c = await post("/api/identities", { handle: "cf-other", displayName: "Other" }, otherToken);
  const otherId = ((await c.json()) as { manifest: { identityId: string } }).manifest.identityId;
  await fetch(`${base}/api/identities/${otherId}/payments`, {
    method: "PUT",
    headers: authed(otherToken),
    body: JSON.stringify({
      provider: "cashfree",
      keyId: "TESTotherclientid",
      keySecret: "cfsk_other_secret",
      webhookSecret: "whsec_completely_different",
    }),
  });

  const pid = await newClaim("900000000002");
  // Correctly signed for OUR seller — but posted at the OTHER seller's URL.
  const res = await hook(successBody(pid), { path: `/api/cashfree/${otherId}/webhook` });
  assert.equal(res.status, 400, "refused at the wrong creator's endpoint");
});

test("a callback for an identity with no Cashfree wired is a 404, not a crash", async () => {
  const res = await hook(successBody("pur_whatever"), {
    path: `/api/cashfree/idn_0000000000000000dead/webhook`,
  });
  assert.equal(res.status, 404);
});

test("a verified success delivers, once, and a retry does not deliver twice", async () => {
  const pid = await newClaim("900000000003");
  const before = outbox.length;

  const first = await hook(successBody(pid));
  assert.equal(first.status, 200);
  assert.equal(((await first.json()) as { delivered?: string }).delivered, pid, "delivered");

  const mail = outbox.slice(before).find((m) => m.to === BUYER);
  assert.ok(mail, "the buyer got their file");
  assert.ok(mail.text.includes(DELIVERABLE), "with the real link");

  // Providers retry. A second delivery email for one purchase is a bug
  // the buyer sees, so the endpoint must be idempotent.
  const afterFirst = outbox.length;
  const retry = await hook(successBody(pid));
  assert.equal(retry.status, 200, "a retry is acknowledged, not errored");
  assert.match(String(((await retry.json()) as { ignored?: string }).ignored), /already/);
  assert.equal(outbox.length, afterFirst, "no second delivery email");
});

test("non-success events are acknowledged but deliver nothing", async () => {
  const pid = await newClaim("900000000004");
  const before = outbox.length;
  for (const [type, status] of [
    ["PAYMENT_FAILED_WEBHOOK", "FAILED"],
    ["PAYMENT_USER_DROPPED_WEBHOOK", "USER_DROPPED"],
    ["PAYMENT_SUCCESS_WEBHOOK", "PENDING"],
  ]) {
    const body = JSON.stringify({
      type,
      data: {
        order: { order_id: pid, order_amount: 499 },
        payment: { payment_status: status, payment_amount: 499 },
      },
    });
    const res = await hook(body);
    // 200 so the provider stops retrying something we're deliberately
    // ignoring — but nothing ships.
    assert.equal(res.status, 200, `${type}/${status} acknowledged`);
  }
  assert.equal(outbox.length, before, "no deliveries from failed or pending payments");
  const rows = (await (
    await fetch(`${base}/api/identities/${identityId}/purchases`, { headers: authed(token) })
  ).json()) as { purchases: Array<{ purchaseId: string; status: string }> };
  assert.equal(rows.purchases.find((p) => p.purchaseId === pid)?.status, "claimed", "still pending");
});

test("a verified callback for an order that isn't ours is ignored safely", async () => {
  const res = await hook(successBody("pur_does_not_exist"));
  assert.equal(res.status, 200);
  assert.match(String(((await res.json()) as { ignored?: string }).ignored), /unknown order/);
});
