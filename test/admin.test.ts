/**
 * Operator console — live, against the REAL server and nedbd.
 *
 * Two things under test:
 *   1. The GATE. This is the only surface that reads across every user's
 *      data, so "a signed-in ordinary user cannot open it" is the
 *      assertion that matters most in this file.
 *   2. The NUMBERS. They come from the append-only event log, and the
 *      commerce ones must stay honestly named — money that reached a
 *      creator's own bank is not our revenue.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

const ADMIN_TOKEN = "operator-token-for-tests";
process.env.NEDB_DB = `links_admin_${Date.now().toString(36)}`;
process.env.LINKS_AUTH_MODE = "email";
process.env.LINKS_MAIL_TEST = "1";
process.env.PUBLIC_ORIGIN = "http://links.test";
process.env.LINKS_ADMIN_TOKEN = ADMIN_TOKEN;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.LINKS_FREE_PROFILE_LIMIT;

const { createApp, ensureDatabase } = await import("../src/server/app");
const { db } = await import("../src/server/db");
const { outbox } = await import("../src/server/mailer");

let server: Server;
let base: string;
let identityId = "";
let userToken = "";
const BLOCK = "blk_admin_1";
const SELLER = "seller@admin.test";
const DELIVERABLE = "https://cdn.example.com/private/admin-kit.zip";

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
async function get(path: string, t = ""): Promise<Response> {
  return fetch(`${base}${path}`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
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
  userToken = ((await (await post("/api/auth/verify-email", { token: vt })).json()) as { token: string }).token;

  const claim = await post("/api/identities", { handle: "admin-test", displayName: "Admin Test" }, userToken);
  identityId = ((await claim.json()) as { manifest: { identityId: string } }).manifest.identityId;

  const cur = (await (await get(`/api/identities/${identityId}`, userToken)).json()) as {
    manifest: Record<string, unknown>;
  };
  cur.manifest.blocks = [
    {
      id: BLOCK,
      type: "product",
      order: 0,
      data: { title: "Admin Kit", price: 250, vpa: "seller@okaxis", deliverable: DELIVERABLE },
    },
  ];
  await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: authed(userToken),
    body: JSON.stringify(cur.manifest),
  });
  await post(`/api/identities/${identityId}/publish`, {}, userToken);

  // Real traffic and a real sale, so the console has something true to count.
  await get(`/admin-test`);
  await get(`/admin-test`);
  await fetch(`${base}/buy/${identityId}/${BLOCK}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ reference: "700000000001", email: "buyer@admin.test" }).toString(),
  });
  const list = (await (await get(`/api/identities/${identityId}/purchases`, userToken)).json()) as {
    purchases: Array<{ purchaseId: string }>;
  };
  await post(`/api/identities/${identityId}/purchases/${list.purchases[0].purchaseId}/confirm`, {}, userToken);
  // Events are fire-and-forget; give the writes a moment to land.
  await new Promise((r) => setTimeout(r, 600));
});

after(async () => {
  server?.close();
  try {
    await db.dropDatabase();
  } catch {
    /* best-effort */
  }
});

test("the console is operator-only — an ordinary signed-in user cannot open it", async () => {
  for (const path of ["/api/admin/overview", "/api/admin/events"]) {
    assert.equal((await get(path)).status, 401, `${path} refuses anonymous`);
    // The important one: a perfectly valid user session is NOT enough.
    // This endpoint reads across every account on the instance.
    assert.equal((await get(path, userToken)).status, 401, `${path} refuses a normal user`);
    assert.equal((await get(path, "not-the-token")).status, 401, `${path} refuses a wrong token`);
    assert.equal((await get(path, ADMIN_TOKEN)).status, 200, `${path} admits the operator`);
  }
});

test("overview counts the instance from the real event log", async () => {
  const o = (await (await get("/api/admin/overview", ADMIN_TOKEN)).json()) as Record<string, any>;
  assert.equal(o.totals.identities, 1);
  assert.equal(o.totals.published, 1);
  assert.ok(o.totals.accounts >= 1, "accounts are counted");
  assert.ok(o.traffic.views >= 2, `profile views were logged (got ${o.traffic.views})`);
  assert.equal(o.instance.authMode, "email");
  assert.equal(o.topPages[0].handle, "admin-test");
  assert.equal(o.topPages[0].views, o.traffic.views, "the busiest page carries the views");
});

test("commerce numbers are real, and named so they can't be misread as ours", async () => {
  const o = (await (await get("/api/admin/overview", ADMIN_TOKEN)).json()) as Record<string, any>;
  assert.equal(o.commerce.delivered, 1, "the confirmed sale is counted");
  assert.equal(o.commerce.claimed, 0);
  assert.equal(o.commerce.creatorEarnings, 250, "the amount reached the creator");

  // The money moved bank-to-bank; we are not the merchant. If a future
  // refactor renames this to `revenue`, that is a claim about the
  // business that isn't true, and this assertion is the tripwire.
  assert.equal("revenue" in o.commerce, false, "there is no field called revenue");
  assert.ok("creatorEarnings" in o.commerce, "earnings are attributed to the creator");
});

test("commerce events actually reach the log — the gap that made sales invisible", async () => {
  const { events } = (await (await get("/api/admin/events?limit=200", ADMIN_TOKEN)).json()) as {
    events: Array<{ kind?: string; amount?: number }>;
  };
  const kinds = new Set(events.map((e) => e.kind));
  assert.ok(kinds.has("profile_view"), "views are logged");
  // Purchases emitted nothing at all until this PR, so every dashboard
  // read zero sales no matter how many there were.
  assert.ok(kinds.has("purchase_claimed"), "a claim is logged");
  assert.ok(kinds.has("purchase_delivered"), "a delivery is logged");
  const delivered = events.find((e) => e.kind === "purchase_delivered");
  assert.equal(delivered?.amount, 250, "the event carries the amount");
});

test("the feed is newest-first and respects its limit", async () => {
  const { events } = (await (await get("/api/admin/events?limit=3", ADMIN_TOKEN)).json()) as {
    events: Array<{ ts?: string }>;
  };
  assert.ok(events.length <= 3, "the limit is honoured");
  const stamps = events.map((e) => String(e.ts));
  assert.deepEqual(stamps, [...stamps].sort().reverse(), "newest first");

  // A caller asking for a million rows gets a sane page, not the engine.
  const huge = (await (await get("/api/admin/events?limit=999999", ADMIN_TOKEN)).json()) as {
    events: unknown[];
  };
  assert.ok(huge.events.length <= 500, "the limit is clamped");
});
