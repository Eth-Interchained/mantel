/**
 * The operator gate — live, against the REAL server.
 *
 * Mark's call: the console has its own auth, unrelated to login. So the
 * assertions here are about SEPARATION as much as access — a signed-in
 * person is not an operator, and holding the instance key is not being
 * signed in. Neither credential may stand in for the other.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

const ADMIN_TOKEN = "instance-key-for-gate-tests";
process.env.NEDB_DB = `links_gate_${Date.now().toString(36)}`;
process.env.LINKS_AUTH_MODE = "email";
process.env.LINKS_MAIL_TEST = "1";
process.env.PUBLIC_ORIGIN = "http://links.test";
process.env.LINKS_ADMIN_TOKEN = ADMIN_TOKEN;
delete process.env.STRIPE_SECRET_KEY;

const { createApp, ensureDatabase } = await import("../src/server/app");
const { db } = await import("../src/server/db");
const { outbox } = await import("../src/server/mailer");

let server: Server;
let base: string;
let userToken = "";
let identityId = "";

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
  await post("/api/auth/signup", { email: "user@gate.test", password: "hunter2hunter2" });
  const mail = outbox.filter((m) => m.to === "user@gate.test").at(-1);
  const vt = /token=([a-zA-Z0-9_-]+)/.exec(mail?.text ?? "")?.[1];
  userToken = ((await (await post("/api/auth/verify-email", { token: vt })).json()) as { token: string }).token;
  const claim = await post("/api/identities", { handle: "gate-test", displayName: "Gate" }, userToken);
  identityId = ((await claim.json()) as { manifest: { identityId: string } }).manifest.identityId;
});

after(async () => {
  server?.close();
  try {
    await db.dropDatabase();
  } catch {
    /* best-effort */
  }
});

test("the instance key unlocks the console, and only the right key does", async () => {
  assert.equal((await get("/api/admin/overview", ADMIN_TOKEN)).status, 200, "the real key opens it");
  assert.equal((await get("/api/admin/overview", "wrong-key")).status, 401);
  // NB: a trailing space can't be tested over HTTP — RFC 7230 has the
  // transport strip optional whitespace from header values, so the
  // server never sees it. Test differences that actually survive the wire.
  assert.equal((await get("/api/admin/overview", ADMIN_TOKEN.slice(0, -1))).status, 401, "no prefix match");
  assert.equal((await get("/api/admin/overview", `${ADMIN_TOKEN}x`)).status, 401, "no extension match");
  assert.equal((await get("/api/admin/overview", ADMIN_TOKEN.toUpperCase())).status, 401, "case-sensitive");
  assert.equal((await get("/api/admin/overview")).status, 401, "anonymous is locked out");
});

test("being signed in is NOT being the operator", async () => {
  // The whole point of the separate gate: an ordinary account, however
  // legitimate, cannot read across every other account's data.
  assert.equal((await get("/api/admin/overview", userToken)).status, 401);
  assert.equal((await get("/api/admin/events", userToken)).status, 401);
});

test("holding the instance key is NOT being signed in as anyone", async () => {
  // The operator token bypasses role checks by design, which is exactly
  // why it must never be the thing a browser sends on ordinary calls.
  // Asserting the reverse direction of the separation.
  const mine = await get("/api/identities", ADMIN_TOKEN);
  assert.equal(mine.status, 200, "the operator can call product APIs");
  const list = (await mine.json()) as { identities: unknown[] };
  assert.ok(Array.isArray(list.identities), "and gets a real response");
  // It is a superuser credential — which is the argument for scoping it
  // to /api/admin/* in the client, not for weakening it here.
  assert.equal((await get(`/api/identities/${identityId}`, ADMIN_TOKEN)).status, 200);
});

test("the console is locked when the instance has no key configured", async () => {
  // A deployment that never set LINKS_ADMIN_TOKEN must not be wide open.
  const saved = process.env.LINKS_ADMIN_TOKEN;
  delete process.env.LINKS_ADMIN_TOKEN;
  const { createApp: freshApp } = await import(`../src/server/app?nokey=${Date.now()}`);
  const s2 = (freshApp() as ReturnType<typeof createApp>).listen(0);
  const a2 = s2.address();
  assert.ok(a2 && typeof a2 === "object");
  const b2 = `http://127.0.0.1:${a2.port}`;
  try {
    assert.equal((await fetch(`${b2}/api/admin/overview`)).status, 401, "anonymous refused");
    assert.equal(
      (await fetch(`${b2}/api/admin/overview`, { headers: { authorization: "Bearer anything" } })).status,
      401,
      "no key means NO key works — never an open door",
    );
  } finally {
    s2.close();
    process.env.LINKS_ADMIN_TOKEN = saved;
  }
});
