/**
 * Tier-1 digital product sales — live, against the REAL server and nedbd.
 *
 * The promise under test: a buyer can pay a seller directly by UPI and
 * get their file, with this platform never touching the money and never
 * claiming to know something it can't. So the assertions split in two:
 *
 *   1. The loop works — claim, confirm, deliver.
 *   2. The loop never lies — nothing says "paid" before a human with a
 *      bank app said so, and the deliverable cannot leak before then.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DB = `links_purch_${Date.now().toString(36)}`;
process.env.LINKS_AUTH_MODE = "email";
process.env.LINKS_MAIL_TEST = "1";
process.env.PUBLIC_ORIGIN = "http://links.test";
delete process.env.LINKS_ADMIN_TOKEN;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.LINKS_FREE_PROFILE_LIMIT;

const { createApp, ensureDatabase } = await import("../src/server/app");
const { db } = await import("../src/server/db");
const { outbox } = await import("../src/server/mailer");

let server: Server;
let base: string;
let identityId = "";
let blockId = "blk_prod_1";
const tokens: Record<string, string> = {};

const SELLER = "seller@purch.test";
const EDITOR = "editor@purch.test";
const BUYER = "buyer@purch.test";
const DELIVERABLE = "https://cdn.example.com/secret-download/notion-os.zip";
const REF = "412345678901";

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

/** The zero-JS form path: urlencoded, exactly like a real browser sends. */
async function formPost(path: string, fields: Record<string, string>): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
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
  tokens.seller = await signup(SELLER);
  tokens.editor = await signup(EDITOR);

  const claim = await post("/api/identities", { handle: "shop-test", displayName: "Shop Test" }, tokens.seller);
  assert.equal(claim.status, 201);
  identityId = ((await claim.json()) as { manifest: { identityId: string } }).manifest.identityId;
  await post(`/api/identities/${identityId}/grants`, { email: EDITOR, role: "editor" }, tokens.seller);

  const cur = await (await fetch(`${base}/api/identities/${identityId}`, { headers: authed(tokens.seller) })).json();
  const manifest = (cur as { manifest: Record<string, unknown> }).manifest;
  manifest.blocks = [
    {
      id: blockId,
      type: "product",
      order: 0,
      data: {
        title: "Freelancer Notion OS",
        blurb: "120+ components",
        price: 499,
        vpa: "seller@okhdfcbank",
        payeeName: "Shop Test",
        deliverable: DELIVERABLE,
      },
    },
  ];
  const put = await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: authed(tokens.seller),
    body: JSON.stringify(manifest),
  });
  assert.equal(put.status, 200, "product block passes server-side schema validation");
  await post(`/api/identities/${identityId}/publish`, {}, tokens.seller);
});

after(async () => {
  server?.close();
  try {
    await db.dropDatabase();
  } catch {
    /* best-effort */
  }
});

test("the public page links to the buy flow and never exposes the deliverable", async () => {
  const html = await (await fetch(`${base}/shop-test`)).text();
  assert.ok(html.includes(`/buy/${identityId}/${blockId}`), "product card links to the buy page");
  assert.ok(html.includes("Freelancer Notion OS"), "title renders");
  assert.ok(html.includes("₹499"), "price renders");
  // The whole point of manual settle: the file must not be reachable
  // from the public page, or nobody would ever need to pay.
  assert.equal(html.includes(DELIVERABLE), false, "the deliverable is NOT on the public page");
  assert.equal(html.includes("secret-download"), false, "not even the path leaks");
});

test("the buy page pays the seller directly and asks for the reference", async () => {
  const html = await (await fetch(`${base}/buy/${identityId}/${blockId}`)).text();
  assert.ok(html.includes("upi://pay?pa=seller%40okhdfcbank"), "pays the seller's own VPA");
  assert.ok(html.includes("am=499.00"), "for the listed amount");
  assert.ok(html.includes('name="reference"'), "asks for the UPI reference");
  assert.ok(html.includes('name="email"'), "asks where to deliver");
  assert.equal(html.includes(DELIVERABLE), false, "still no deliverable before paying");
  assert.equal(/<script/i.test(html), false, "zero-JS: no script tags on the buy page");
  assert.ok(/takes no fee|not part of the transaction/i.test(html), "states we are not the intermediary");
});

test("a claim is recorded as a CLAIM, and notifies the seller without asserting payment", async () => {
  const before = outbox.length;
  const r = await formPost(`/buy/${identityId}/${blockId}`, { reference: REF, email: BUYER });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes(REF), "the buyer sees their reference echoed back");
  assert.equal(html.includes(DELIVERABLE), false, "claiming does NOT deliver");

  const notice = outbox.slice(before).find((m) => m.to === SELLER);
  assert.ok(notice, "the seller is told there's something to check");
  assert.ok(notice.subject.includes(REF), "the reference is in the subject so they can search their bank");
  assert.match(notice.text, /claims|says they paid/i, "worded as a claim");
  assert.equal(
    /\byou (have been|'ve been|were) paid\b/i.test(notice.text),
    false,
    "never asserts the money arrived",
  );
  assert.equal(notice.text.includes(DELIVERABLE), false, "the seller notice carries no delivery link");

  const list = await (await fetch(`${base}/api/identities/${identityId}/purchases`, { headers: authed(tokens.seller) })).json();
  const rows = (list as { purchases: Array<Record<string, unknown>> }).purchases;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "claimed", "status is claimed, not paid");
  assert.equal(rows[0].buyerEmail, BUYER);
});

test("the same UPI reference cannot be claimed twice", async () => {
  const r = await formPost(`/buy/${identityId}/${blockId}`, { reference: REF, email: "someone-else@purch.test" });
  const html = await r.text();
  assert.match(html, /already/i, "duplicate reference is refused");
  const list = await (await fetch(`${base}/api/identities/${identityId}/purchases`, { headers: authed(tokens.seller) })).json();
  assert.equal((list as { purchases: unknown[] }).purchases.length, 1, "no second row was created");
});

test("garbage claims are refused before they reach the seller", async () => {
  const before = outbox.length;
  const bad = await formPost(`/buy/${identityId}/${blockId}`, { reference: "!!!", email: BUYER });
  assert.match(await bad.text(), /doesn't look like|missing/i);
  const noEmail = await formPost(`/buy/${identityId}/${blockId}`, { reference: "999888777666", email: "nope" });
  assert.match(await noEmail.text(), /missing|email/i);
  assert.equal(outbox.length, before, "no seller notices sent for invalid claims");
});

test("only the owner settles — and confirming delivers the file", async () => {
  const list = await (await fetch(`${base}/api/identities/${identityId}/purchases`, { headers: authed(tokens.seller) })).json();
  const pid = (list as { purchases: Array<{ purchaseId: string }> }).purchases[0].purchaseId;

  const byEditor = await post(`/api/identities/${identityId}/purchases/${pid}/confirm`, {}, tokens.editor);
  assert.equal(byEditor.status, 403, "an editor cannot release someone else's product");
  const anon = await post(`/api/identities/${identityId}/purchases/${pid}/confirm`, {});
  assert.equal(anon.status, 401, "anonymous cannot release it");

  const before = outbox.length;
  const ok = await post(`/api/identities/${identityId}/purchases/${pid}/confirm`, {}, tokens.seller);
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { purchase: { status: string } }).purchase.status, "delivered");

  const delivery = outbox.slice(before).find((m) => m.to === BUYER);
  assert.ok(delivery, "the buyer gets their delivery email");
  assert.ok(delivery.text.includes(DELIVERABLE), "and it carries the actual link");

  // Settling twice would double-deliver; the state machine forbids it.
  const again = await post(`/api/identities/${identityId}/purchases/${pid}/confirm`, {}, tokens.seller);
  assert.equal(again.status, 409, "a settled purchase cannot be settled again");
});

test("a seller can reject a bogus claim, and rejecting delivers nothing", async () => {
  await formPost(`/buy/${identityId}/${blockId}`, { reference: "111222333444", email: "liar@purch.test" });
  const list = await (await fetch(`${base}/api/identities/${identityId}/purchases`, { headers: authed(tokens.seller) })).json();
  const row = (list as { purchases: Array<{ purchaseId: string; status: string }> }).purchases.find(
    (p) => p.status === "claimed",
  );
  assert.ok(row, "the new claim is pending");

  const before = outbox.length;
  const r = await post(`/api/identities/${identityId}/purchases/${row.purchaseId}/reject`, {}, tokens.seller);
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { purchase: { status: string } }).purchase.status, "rejected");
  const leaked = outbox.slice(before).some((m) => m.text.includes(DELIVERABLE));
  assert.equal(leaked, false, "rejecting sends no delivery link to anyone");
});

test("a product with no delivery link refuses to confirm rather than deliver nothing", async () => {
  const cur = await (await fetch(`${base}/api/identities/${identityId}`, { headers: authed(tokens.seller) })).json();
  const manifest = (cur as { manifest: Record<string, unknown> }).manifest;
  (manifest.blocks as Array<Record<string, unknown>>)[0].data = {
    title: "Unfinished product",
    price: 199,
    vpa: "seller@okhdfcbank",
    deliverable: "",
  };
  await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: authed(tokens.seller),
    body: JSON.stringify(manifest),
  });

  await formPost(`/buy/${identityId}/${blockId}`, { reference: "555666777888", email: BUYER });
  const list = await (await fetch(`${base}/api/identities/${identityId}/purchases`, { headers: authed(tokens.seller) })).json();
  const row = (list as { purchases: Array<{ purchaseId: string; status: string }> }).purchases.find(
    (p) => p.status === "claimed",
  );
  assert.ok(row);
  const r = await post(`/api/identities/${identityId}/purchases/${row.purchaseId}/confirm`, {}, tokens.seller);
  assert.equal(r.status, 400, "confirming without a deliverable is refused");
  assert.equal(((await r.json()) as { code: string }).code, "no_deliverable");

  // Critically: the claim stays actionable so the seller can fix the
  // block and deliver, rather than a buyer's payment vanishing.
  const after = await (await fetch(`${base}/api/identities/${identityId}/purchases`, { headers: authed(tokens.seller) })).json();
  const still = (after as { purchases: Array<{ purchaseId: string; status: string }> }).purchases.find(
    (p) => p.purchaseId === row.purchaseId,
  );
  assert.equal(still?.status, "claimed", "the claim survives the failed confirm");
});
