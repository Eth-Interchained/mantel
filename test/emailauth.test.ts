/**
 * Email-mode live suite — the ne-db.com product against a REAL nedbd.
 *
 * Boots the app with LINKS_AUTH_MODE=email and LINKS_MAIL_TEST=1 (mail
 * lands in the in-process outbox instead of a wire), then walks every
 * account flow end-to-end: signup → verify → claim → publish (with the
 * QR-bearing "you're live" email) → forgot → reset → session
 * revocation. Also proves the product split: wallet endpoints DO NOT
 * EXIST here.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DB = `links_email_${Date.now().toString(36)}`;
process.env.LINKS_AUTH_MODE = "email";
process.env.LINKS_MAIL_TEST = "1";
process.env.PUBLIC_ORIGIN = "http://links.test";
process.env.LINKS_BRAND_NAME = "ne-db";
process.env.LINKS_DEFAULT_THEME = "v3";
delete process.env.LINKS_ADMIN_TOKEN;

const { createApp, ensureDatabase } = await import("../src/server/app");
const { db } = await import("../src/server/db");
const { outbox } = await import("../src/server/mailer");
const { emailPrincipal, hashPassword, verifyPassword } = await import(
  "../src/server/accounts-email"
);

let server: Server;
let base: string;

const EMAIL = "marisa@example.com";
const PASSWORD = "correct-horse-battery";
const PASSWORD2 = "staple-battery-horse!";

function post(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function tokenFrom(text: string): string {
  const m = text.match(/token=(tok_[a-f0-9]+)/);
  assert.ok(m, "mail contains a token link");
  return m[1];
}

before(async () => {
  const reachable = await db.ping();
  assert.ok(reachable, "nedbd is not reachable — start it before running test:api");
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

test("scrypt: hash/verify round trip, wrong password rejected, params recorded", async () => {
  const h = await hashPassword("s3cret-enough");
  assert.ok(h.startsWith("scrypt$16384$8$1$"), "parameters recorded in the hash");
  assert.equal(await verifyPassword("s3cret-enough", h), true);
  assert.equal(await verifyPassword("not-it", h), false);
  assert.equal(await verifyPassword("s3cret-enough", "garbage"), false);
});

test("the product split is real: email mode has no wallet endpoints", async () => {
  const cfg = (await (await fetch(`${base}/api/config`)).json()) as {
    authMode: string;
    brandName: string;
    defaultTheme: string;
  };
  assert.equal(cfg.authMode, "email");
  assert.equal(cfg.brandName, "ne-db", "the deployment wordmark rides /api/config");
  assert.equal(cfg.defaultTheme, "v3", "…and so does the default theme");
  const chal = await post("/api/auth/challenge", { address: "itc1qwhatever" });
  assert.equal(chal.status, 404, "wallet challenge does not exist on this product");
});

let sessionToken = "";
let principal = "";
let identityId = "";

test("signup: validation, verify mail, login gated until confirmed", async () => {
  const weak = await post("/api/auth/signup", { email: EMAIL, password: "short" });
  assert.equal(weak.status, 400, "weak passwords rejected");

  const n = outbox.length;
  const r = await post("/api/auth/signup", { email: EMAIL, password: PASSWORD });
  assert.equal(r.status, 201, "signup accepted");
  assert.equal(outbox.length, n + 1, "exactly one mail sent");
  const mail = outbox[n];
  assert.equal(mail.to, EMAIL);
  assert.match(mail.subject, /Confirm your email — ne-db/, "emails wear the deployment brand");
  assert.ok(mail.html.includes("/verify?token="), "html carries the verify link");
  assert.ok(mail.text.includes("/verify?token="), "plain-text twin carries it too");

  const early = await post("/api/auth/login", { email: EMAIL, password: PASSWORD });
  assert.equal(early.status, 403, "login refuses unverified accounts");
  const j = (await early.json()) as { needsVerify?: boolean };
  assert.equal(j.needsVerify, true);
});

test("verify-email: single-use token, welcome mail, signed straight in", async () => {
  const verifyTok = tokenFrom(outbox[outbox.length - 1].text);
  const n = outbox.length;

  const r = await post("/api/auth/verify-email", { token: verifyTok });
  assert.equal(r.status, 200, "verification succeeds");
  const j = (await r.json()) as { token: string; address: string; email: string };
  assert.ok(j.token.length >= 32, "session issued immediately");
  assert.equal(j.address, emailPrincipal(EMAIL), "principal is the eml_ hash");
  assert.ok(j.address.startsWith("eml_"));
  assert.equal(j.email, EMAIL);
  sessionToken = j.token;
  principal = j.address;

  assert.equal(outbox.length, n + 1, "welcome mail sent");
  assert.match(outbox[n].subject, /You're in/);

  const reuse = await post("/api/auth/verify-email", { token: verifyTok });
  assert.equal(reuse.status, 401, "verify tokens are single-use");
});

test("claim + publish ride eml_ principals; 'you're live' mail carries the QR", async () => {
  const claim = await post("/api/identities", {
    handle: "marisa-mail",
    displayName: "Marisa",
    template: "creator",
  }, sessionToken);
  assert.equal(claim.status, 201, "claim works with an email session");
  identityId = ((await claim.json()) as { manifest: { identityId: string } }).manifest.identityId;

  const n = outbox.length;
  const pub = await post(`/api/identities/${identityId}/publish`, {}, sessionToken);
  assert.equal(pub.status, 200, "publish succeeds");

  // The published mail is fire-and-forget — give it a beat to land.
  for (let i = 0; i < 40 && outbox.length === n; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(outbox.length, n + 1, "published mail sent");
  const mail = outbox[n];
  assert.match(mail.subject, /@marisa-mail is live/);
  assert.ok(mail.html.includes("cid:qr@links"), "QR referenced inline");
  assert.equal(mail.attachments?.length, 1, "QR attached");
  const qr = mail.attachments![0];
  assert.equal(qr.cid, "qr@links");
  assert.equal(qr.filename, "marisa-mail-qr.png");
  // PNG magic bytes — it's a real image, not a placeholder.
  assert.deepEqual([...qr.content.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

  // The public page wears the deployment brand too.
  const page = await (await fetch(`${base}/marisa-mail`)).text();
  assert.ok(page.includes("published with ne-db"), "public footer carries the brand");
});

test("login: verified accounts in, wrong credentials out (same error shape)", async () => {
  const good = await post("/api/auth/login", { email: EMAIL, password: PASSWORD });
  assert.equal(good.status, 200);

  const badPw = await post("/api/auth/login", { email: EMAIL, password: "wrong-wrong-wrong" });
  assert.equal(badPw.status, 401);
  const badUser = await post("/api/auth/login", { email: "ghost@example.com", password: "whatever-12" });
  assert.equal(badUser.status, 401);
  const a = (await badPw.json()) as { error: string };
  const b = (await badUser.json()) as { error: string };
  assert.equal(a.error, b.error, "unknown email and wrong password are indistinguishable");
});

test("forgot: enumeration-safe; reset rotates the password and revokes sessions", async () => {
  const n = outbox.length;
  const ghost = await post("/api/auth/forgot", { email: "ghost@example.com" });
  assert.equal(ghost.status, 200, "unknown email still 200");
  assert.equal(outbox.length, n, "…and sends nothing");

  const real = await post("/api/auth/forgot", { email: EMAIL });
  assert.equal(real.status, 200);
  assert.equal(outbox.length, n + 1, "reset mail sent for the real account");
  assert.match(outbox[n].subject, /Reset your password/);
  const resetTok = tokenFrom(outbox[n].text);

  const weak = await post("/api/auth/reset", { token: resetTok, password: "short" });
  assert.equal(weak.status, 400, "weak replacement rejected (token NOT burned by validation)");

  const r = await post("/api/auth/reset", { token: resetTok, password: PASSWORD2 });
  assert.equal(r.status, 200, "reset succeeds");

  // The pre-reset session is dead.
  const stale = await fetch(`${base}/api/identities`, {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  assert.equal(stale.status, 401, "old sessions revoked on reset");

  const oldPw = await post("/api/auth/login", { email: EMAIL, password: PASSWORD });
  assert.equal(oldPw.status, 401, "old password dead");
  const newPw = await post("/api/auth/login", { email: EMAIL, password: PASSWORD2 });
  assert.equal(newPw.status, 200, "new password lives");

  const reuse = await post("/api/auth/reset", { token: resetTok, password: "another-try-9" });
  assert.equal(reuse.status, 401, "reset tokens are single-use");
});

test("duplicates and resends behave", async () => {
  const dup = await post("/api/auth/signup", { email: EMAIL, password: "whatever-123" });
  assert.equal(dup.status, 409, "verified accounts cannot be re-signed-up");

  const n = outbox.length;
  const resend = await post("/api/auth/resend-verify", { email: EMAIL });
  assert.equal(resend.status, 200);
  assert.equal(outbox.length, n, "verified accounts get no verify resend");
});

test("grants ride emails in email mode — like sharing a doc, with provenance", async () => {
  // A collaborator who hasn't even signed up yet can be granted —
  // the principal is deterministic from the email.
  const COLLAB = "stylist@example.com";
  const owner = await post("/api/auth/login", { email: EMAIL, password: PASSWORD2 });
  const ownerTok = ((await owner.json()) as { token: string }).token;

  const byAddress = await post(
    `/api/identities/${identityId}/grants`,
    { address: "itc1qwhatever", role: "editor" },
    ownerTok,
  );
  assert.equal(byAddress.status, 400, "email mode does not grant by address");

  const r = await post(
    `/api/identities/${identityId}/grants`,
    { email: COLLAB, role: "editor" },
    ownerTok,
  );
  assert.equal(r.status, 201, "grant by email lands");
  const g = ((await r.json()) as { grant: { address: string; email?: string } }).grant;
  assert.equal(g.address, emailPrincipal(COLLAB), "principal derived server-side");
  assert.equal(g.email, COLLAB, "human-readable email stored for display");

  // The collaborator signs up, verifies, and the pre-provisioned grant works.
  const n = outbox.length;
  await post("/api/auth/signup", { email: COLLAB, password: "collab-pass-1" });
  const vTok = tokenFrom(outbox[n].text);
  const v = await post("/api/auth/verify-email", { token: vTok });
  const collabSession = ((await v.json()) as { token: string }).token;

  const put = await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${collabSession}` },
    body: JSON.stringify({ bio: "styled by the collaborator" }),
  });
  assert.equal(put.status, 200, "editor-by-email can edit — RBAC never learned a new trick");
});

test("the email landing routes are reserved — never claimable as handles", async () => {
  for (const h of ["verify", "reset"]) {
    const r = await fetch(`${base}/api/handles/${h}/availability`);
    const j = (await r.json()) as { available: boolean };
    assert.equal(j.available, false, `'${h}' is not claimable`);
  }
});

test("magic sign-in: one email, redeemable by code OR link, single-use, no enumeration", async () => {
  // Unknown email: 200, silence.
  const n0 = outbox.length;
  const ghost = await post("/api/auth/magic", { email: "ghost@example.com" });
  assert.equal(ghost.status, 200);
  assert.equal(outbox.length, n0, "no mail for unknown accounts");

  // Real account: the email carries a /magic link AND a 6-digit code.
  const n = outbox.length;
  const r = await post("/api/auth/magic", { email: EMAIL });
  assert.equal(r.status, 200);
  assert.equal(outbox.length, n + 1, "magic mail sent");
  const mail = outbox[n];
  assert.match(mail.subject, /Your sign-in link/);
  const link = mail.text.match(/\/magic\?token=(tok_[a-f0-9]+)/);
  assert.ok(link, "mail carries the link token");
  const codeMatch = mail.text.match(/code on the sign-in screen: (\d{6})/);
  assert.ok(codeMatch, "mail carries the 6-digit code");

  // Wrong code: 401 without burning the token.
  const bad = await post("/api/auth/magic-redeem", { email: EMAIL, code: "000000" });
  assert.equal(bad.status, 401, "wrong code bounces");

  // Redeem by CODE → session works.
  const byCode = await post("/api/auth/magic-redeem", { email: EMAIL, code: codeMatch![1] });
  assert.equal(byCode.status, 200, "code signs in");
  const sj = (await byCode.json()) as { token: string; email: string };
  assert.equal(sj.email, EMAIL);
  const me = await fetch(`${base}/api/identities`, {
    headers: { authorization: `Bearer ${sj.token}` },
  });
  assert.equal(me.status, 200, "magic session is a real session");

  // Single-use: the link token died with the code redemption.
  const byLink = await post("/api/auth/magic-redeem", { token: link![1] });
  assert.equal(byLink.status, 401, "one redemption burns both paths");

  // Fresh request → redeem by LINK this time.
  const n2 = outbox.length;
  await post("/api/auth/magic", { email: EMAIL });
  const link2 = outbox[n2].text.match(/\/magic\?token=(tok_[a-f0-9]+)/);
  const byLink2 = await post("/api/auth/magic-redeem", { token: link2![1] });
  assert.equal(byLink2.status, 200, "link signs in");
});
