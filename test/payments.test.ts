/**
 * Tier-2 payment credentials — live suite against the REAL server and a
 * REAL nedbd.
 *
 * The thing under test is a promise: a creator hands us their payment
 * provider's secret so purchases can auto-deliver, and in exchange we
 * (a) never let that secret back out over the wire, (b) never store it
 * readable, and (c) never become the merchant in their transaction.
 *
 * The single most important assertion in this file is
 * "the secret NEVER comes back over the wire" — if that ever goes red,
 * stop and fix the server, never the test.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";

process.env.NEDB_DB = `links_pay_${Date.now().toString(36)}`;
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
const { unsealPsp } = await import("../src/server/payments");

let server: Server;
let base: string;
let identityId = "";
const tokens: Record<string, string> = {};

const EMAILS = {
  owner: "owner@pay.test",
  editor: "editor@pay.test",
  viewer: "viewer@pay.test",
  stranger: "stranger@pay.test",
};

// The actual secrets under test. Distinctive so a leak anywhere in a
// response body is unmistakable rather than a coincidence.
const KEY_SECRET = "rzp_test_SECRET_bH7xQ2mLp9Zk";
const WEBHOOK_SECRET = "whsec_TESTHOOK_4Rt8yNvC1sQe";

function authed(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function post(path: string, body: unknown, token = ""): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function signup(email: string): Promise<string> {
  await post("/api/auth/signup", { email, password: "hunter2hunter2" });
  const mail = outbox.filter((m) => m.to === email).at(-1);
  const token = /token=([a-zA-Z0-9_-]+)/.exec(mail?.text ?? "")?.[1];
  assert.ok(token, `verify token for ${email}`);
  const r = await post("/api/auth/verify-email", { token });
  return ((await r.json()) as { token: string }).token;
}

before(async () => {
  assert.ok(await db.ping(), "nedbd required");
  await ensureDatabase();
  server = createApp().listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
  for (const [role, email] of Object.entries(EMAILS)) tokens[role] = await signup(email);
  const claim = await post("/api/identities", { handle: "pay-test", displayName: "Pay Test" }, tokens.owner);
  assert.equal(claim.status, 201);
  identityId = ((await claim.json()) as { manifest: { identityId: string } }).manifest.identityId;
  for (const [role, email] of [["editor", EMAILS.editor], ["viewer", EMAILS.viewer]] as const) {
    const r = await post(`/api/identities/${identityId}/grants`, { email, role }, tokens.owner);
    assert.equal(r.status, 201, `granted ${role}`);
  }
});

after(async () => {
  server?.close();
  try {
    await db.dropDatabase();
  } catch {
    /* best-effort */
  }
});

test("owner installs their own provider keys; the response carries hints, not secrets", async () => {
  const r = await fetch(`${base}/api/identities/${identityId}/payments`, {
    method: "PUT",
    headers: authed(tokens.owner),
    body: JSON.stringify({
      provider: "razorpay",
      keyId: "rzp_test_PUBLICKEYID",
      keySecret: KEY_SECRET,
      webhookSecret: WEBHOOK_SECRET,
    }),
  });
  assert.equal(r.status, 200);
  const body = (await r.json()) as Record<string, unknown>;
  assert.equal(body.configured, true);
  assert.equal(body.provider, "razorpay");
  assert.equal(body.keyId, "rzp_test_PUBLICKEYID", "the key ID is semi-public and shown");
  assert.equal(body.webhookConfigured, true);
  assert.equal(body.keySecretHint, "•••• p9Zk", "only the last four are echoed");
  assert.equal(body.webhookSecretHint, "•••• 1sQe");
});

test("the secret NEVER comes back over the wire — on any route, in any shape", async () => {
  // Every surface a signed-in owner can reach that could plausibly carry
  // the credential. If a future refactor widens a projection, this catches it.
  const routes = [
    `/api/identities/${identityId}/payments`,
    `/api/identities/${identityId}`,
    `/api/identities`,
    `/api/identities/${identityId}/grants`,
  ];
  for (const path of routes) {
    const r = await fetch(`${base}${path}`, { headers: authed(tokens.owner) });
    const text = await r.text();
    assert.equal(text.includes(KEY_SECRET), false, `key secret leaked via ${path}`);
    assert.equal(text.includes(WEBHOOK_SECRET), false, `webhook secret leaked via ${path}`);
    // The sealed blob shouldn't travel either — it is not a secret a
    // client has any use for, and shipping it invites offline attack.
    assert.equal(/"keySecretSealed"/.test(text), false, `sealed blob leaked via ${path}`);
  }

  // And the public page — the surface with no auth at all.
  const pub = await fetch(`${base}/pay-test`);
  const html = await pub.text();
  assert.equal(html.includes(KEY_SECRET), false, "key secret leaked onto the public profile");
  assert.equal(html.includes(WEBHOOK_SECRET), false, "webhook secret leaked onto the public profile");
});

test("what lands in the engine is sealed, not readable", async () => {
  const raw = JSON.stringify(await db.get("payments", `psp:${identityId}`));
  assert.equal(raw.includes(KEY_SECRET), false, "plaintext key secret is not in storage");
  assert.equal(raw.includes(WEBHOOK_SECRET), false, "plaintext webhook secret is not in storage");
  assert.ok(raw.includes("v1."), "the stored value is a sealed blob");

  // The evidence line is a permanent, replayable engine record — it must
  // say THAT keys were installed, never any part of them.
  assert.equal(raw.includes(KEY_SECRET.slice(0, 12)), false, "not even a prefix survives");
});

test("the server can still use the keys it sealed — the round trip actually works", async () => {
  const opened = await unsealPsp(identityId);
  assert.ok(opened, "server-side unseal succeeds");
  assert.equal(opened.keySecret, KEY_SECRET, "the exact secret comes back inside the server");
  assert.equal(opened.webhookSecret, WEBHOOK_SECRET);
  assert.equal(opened.provider, "razorpay");

  // Sealed to THIS identity: another page cannot borrow the credential
  // even through the server-side path.
  const other = await unsealPsp("idn_someone_else");
  assert.equal(other, null, "no credential for an identity that has none");
});

test("RBAC: only the owner writes; editors read status; viewers and strangers get nothing", async () => {
  const put = (token: string) =>
    fetch(`${base}/api/identities/${identityId}/payments`, {
      method: "PUT",
      headers: authed(token),
      body: JSON.stringify({ provider: "razorpay", keyId: "rzp_hijack_key", keySecret: "hijacked-secret-x" }),
    });

  assert.equal((await put(tokens.editor)).status, 403, "editor cannot install keys");
  assert.equal((await put(tokens.viewer)).status, 403, "viewer cannot install keys");
  assert.equal((await put(tokens.stranger)).status, 403, "a stranger cannot install keys");

  const get = (token: string) =>
    fetch(`${base}/api/identities/${identityId}/payments`, { headers: authed(token) });
  assert.equal((await get(tokens.owner)).status, 200, "owner reads status");
  assert.equal((await get(tokens.editor)).status, 200, "editor reads status");
  assert.equal((await get(tokens.viewer)).status, 403, "viewer cannot see which account is wired");
  assert.equal((await get(tokens.stranger)).status, 403, "a stranger cannot see it either");
  assert.equal((await fetch(`${base}/api/identities/${identityId}/payments`)).status, 401, "anonymous is refused");

  // The hijack attempts must not have overwritten anything.
  const still = await unsealPsp(identityId);
  assert.equal(still?.keySecret, KEY_SECRET, "the owner's secret survived every unauthorized write");

  const del = await fetch(`${base}/api/identities/${identityId}/payments`, {
    method: "DELETE",
    headers: authed(tokens.editor),
  });
  assert.equal(del.status, 403, "editor cannot disconnect the owner's account");
});

test("bad input is refused rather than half-stored", async () => {
  const bad = (body: unknown) =>
    fetch(`${base}/api/identities/${identityId}/payments`, {
      method: "PUT",
      headers: authed(tokens.owner),
      body: JSON.stringify(body),
    });
  assert.equal((await bad({ provider: "totally-made-up", keyId: "abcdef", keySecret: "12345678" })).status, 400);
  assert.equal((await bad({ provider: "razorpay", keyId: "x", keySecret: "12345678" })).status, 400, "key id too short");
  assert.equal((await bad({ provider: "razorpay", keyId: "abcdef", keySecret: "  " })).status, 400, "blank secret refused");
  assert.equal((await bad({ provider: "razorpay", keyId: "abcdef" })).status, 400, "missing secret refused");

  const intact = await unsealPsp(identityId);
  assert.equal(intact?.keySecret, KEY_SECRET, "nothing was clobbered by the rejected writes");
});

test("the owner can disconnect, and disconnection is total", async () => {
  const r = await fetch(`${base}/api/identities/${identityId}/payments`, {
    method: "DELETE",
    headers: authed(tokens.owner),
  });
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { configured: boolean }).configured, false);

  assert.equal(await unsealPsp(identityId), null, "the credential is gone server-side too");
  const after = await fetch(`${base}/api/identities/${identityId}/payments`, { headers: authed(tokens.owner) });
  assert.equal(((await after.json()) as { configured: boolean }).configured, false);
});
