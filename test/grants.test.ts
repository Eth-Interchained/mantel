/**
 * RBAC live suite — Mark's 7/9 report ("my viewer is allowed to edit?")
 * pinned forever. The server verdict was: gates hold (the leak was the
 * UI advertising powers it didn't have). This suite asserts the whole
 * server matrix so it can never regress silently, plus yourRole (what
 * the UI renders from) and the grant invite emails.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DB = `links_grants_${Date.now().toString(36)}`;
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
const tokens: Record<string, string> = {};

const EMAILS = {
  owner: "owner@grants.test",
  editor: "editor@grants.test",
  viewer: "viewer@grants.test",
};

async function post(path: string, body: unknown, token = ""): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
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

function authed(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

before(async () => {
  assert.ok(await db.ping(), "nedbd required");
  await ensureDatabase();
  server = createApp().listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
  for (const [role, email] of Object.entries(EMAILS)) tokens[role] = await signup(email);
  const claim = await post(
    "/api/identities",
    { handle: "rbac-test", displayName: "RBAC Test" },
    tokens.owner,
  );
  assert.equal(claim.status, 201);
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

test("owner shares; each grant lands a welcome email naming the role", async () => {
  const before1 = outbox.length;
  const e = await post(
    `/api/identities/${identityId}/grants`,
    { email: EMAILS.editor, role: "editor" },
    tokens.owner,
  );
  assert.equal(e.status, 201);
  const v = await post(
    `/api/identities/${identityId}/grants`,
    { email: EMAILS.viewer, role: "viewer" },
    tokens.owner,
  );
  assert.equal(v.status, 201);

  const invites = outbox.slice(before1).filter((m) => /added to @rbac-test/.test(m.subject));
  assert.equal(invites.length, 2, "both grants mailed a welcome");
  const editorMail = invites.find((m) => m.to === EMAILS.editor);
  const viewerMail = invites.find((m) => m.to === EMAILS.viewer);
  assert.ok(editorMail && /as editor/.test(editorMail.subject), "editor invite names the role");
  assert.ok(viewerMail && /as viewer/.test(viewerMail.subject), "viewer invite names the role");
  assert.match(viewerMail.text, /Welcome to RBAC Test/i, "hey {role}, welcome to {page}");
  assert.match(editorMail.text, /edit the page and publish/i, "the blurb explains the power");
});

test("the matrix: viewer sees, editor edits, only the owner governs", async () => {
  // yourRole tells the UI the truth.
  for (const [role, expected] of [
    ["owner", "owner"],
    ["editor", "editor"],
    ["viewer", "viewer"],
  ] as const) {
    const r = await fetch(`${base}/api/identities/${identityId}`, { headers: authed(tokens[role]) });
    assert.equal(r.status, 200, `${role} can read the manifest`);
    const j = (await r.json()) as { yourRole: string };
    assert.equal(j.yourRole, expected, `yourRole is honest for the ${role}`);
  }

  // VIEWER: reads yes, writes never (Mark's exact report).
  const vPut = await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: authed(tokens.viewer),
    body: JSON.stringify({ displayName: "VIEWER WAS HERE" }),
  });
  assert.equal(vPut.status, 403, "viewer cannot save edits");
  const vPub = await post(`/api/identities/${identityId}/publish`, {}, tokens.viewer);
  assert.equal(vPub.status, 403, "viewer cannot publish");
  const vGrant = await post(
    `/api/identities/${identityId}/grants`,
    { email: "sneak@grants.test", role: "owner" },
    tokens.viewer,
  );
  assert.equal(vGrant.status, 403, "viewer cannot mint owners");

  // EDITOR: edits and publishes, but does not govern access.
  const ePut = await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: authed(tokens.editor),
    body: JSON.stringify({ displayName: "Edited by the editor" }),
  });
  assert.equal(ePut.status, 200, "editor saves");
  const ePub = await post(`/api/identities/${identityId}/publish`, {}, tokens.editor);
  assert.equal(ePub.status, 200, "editor publishes");
  const eGrant = await post(
    `/api/identities/${identityId}/grants`,
    { email: "sneak@grants.test", role: "viewer" },
    tokens.editor,
  );
  assert.equal(eGrant.status, 403, "editor cannot grant");
  const eRevoke = await fetch(`${base}/api/identities/${identityId}/grants/anything`, {
    method: "DELETE",
    headers: authed(tokens.editor),
  });
  assert.equal(eRevoke.status, 403, "editor cannot revoke");

  // The manifest carries only the EDITOR's change.
  const check = await fetch(`${base}/api/identities/${identityId}`, { headers: authed(tokens.owner) });
  const m = ((await check.json()) as { manifest: { displayName: string } }).manifest;
  assert.equal(m.displayName, "Edited by the editor", "viewer's write never landed");

  // Strangers see nothing at all.
  const strangerToken = await signup("stranger@grants.test");
  const sGet = await fetch(`${base}/api/identities/${identityId}`, { headers: authed(strangerToken) });
  assert.equal(sGet.status, 403, "no grant, no manifest");
});
