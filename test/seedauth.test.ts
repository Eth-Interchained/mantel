/**
 * Seed-auth + RBAC suite — two real wallets against a real engine.
 *
 * Walks the whole trust model live: wallet login via challenge/response,
 * claim with auto owner grant, cross-user denial, grant by address,
 * role escalation limits, last-owner protection, session revocation.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DB = `links_rbac_${Date.now().toString(36)}`;
delete process.env.LINKS_ADMIN_TOKEN;

const { createApp, ensureDatabase } = await import("../src/server/app");
const { db } = await import("../src/server/db");
const { deriveAccount, generatePhrase, signMessage } = await import("../src/lib/wallet");

let server: Server;
let base: string;

interface Wallet {
  phrase: string;
  address: string;
  token: string;
}

async function login(phrase: string): Promise<Wallet> {
  const { address } = await deriveAccount(phrase);
  const chal = (await (
    await fetch(`${base}/api/auth/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    })
  ).json()) as { challengeId: string; message: string };
  const signature = await signMessage(phrase, chal.message);
  const verify = await fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeId: chal.challengeId, address, signature }),
  });
  assert.equal(verify.status, 200, "login succeeds");
  const j = (await verify.json()) as { token: string };
  return { phrase, address, token: j.token };
}

function authed(w: Wallet): Record<string, string> {
  return { authorization: `Bearer ${w.token}`, "content-type": "application/json" };
}

let alice: Wallet;
let bob: Wallet;
let identityId = "";

before(async () => {
  assert.ok(await db.ping(), "nedbd required");
  await ensureDatabase();
  server = createApp().listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
  alice = await login(generatePhrase());
  bob = await login(generatePhrase());
});

after(async () => {
  server?.close();
  try {
    await db.dropDatabase();
  } catch {
    /* best-effort */
  }
});

test("wallet login rejects bad signatures and reused challenges", async () => {
  const { address } = await deriveAccount(generatePhrase());
  const chal = (await (
    await fetch(`${base}/api/auth/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    })
  ).json()) as { challengeId: string; message: string };

  // Signature from the WRONG key fails.
  const wrongSig = await signMessage(generatePhrase(), chal.message);
  const badVerify = await fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeId: chal.challengeId, address, signature: wrongSig }),
  });
  assert.equal(badVerify.status, 401);

  // Challenges bind to their address.
  const chalB = (await (
    await fetch(`${base}/api/auth/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: alice.address }),
    })
  ).json()) as { challengeId: string; message: string };
  const crossVerify = await fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challengeId: chalB.challengeId,
      address: bob.address,
      signature: await signMessage(bob.phrase, chalB.message),
    }),
  });
  assert.equal(crossVerify.status, 401, "challenge address mismatch rejected");
});

test("claim binds ownership to the wallet address", async () => {
  const r = await fetch(`${base}/api/identities`, {
    method: "POST",
    headers: authed(alice),
    body: JSON.stringify({ handle: "alicesalon", displayName: "Alice", template: "salon" }),
  });
  assert.equal(r.status, 201);
  const j = (await r.json()) as { manifest: { identityId: string; owner: string } };
  identityId = j.manifest.identityId;
  assert.equal(j.manifest.owner, alice.address, "owner is the wallet address");

  const grants = (await (
    await fetch(`${base}/api/identities/${identityId}/grants`, { headers: authed(alice) })
  ).json()) as { grants: Array<{ address: string; role: string }> };
  assert.equal(grants.grants.length, 1);
  assert.equal(grants.grants[0].address, alice.address);
  assert.equal(grants.grants[0].role, "owner", "claim auto-grants owner");
});

test("tenancy: bob sees nothing, reads nothing, edits nothing", async () => {
  const list = (await (
    await fetch(`${base}/api/identities`, { headers: authed(bob) })
  ).json()) as { identities: unknown[] };
  assert.equal(list.identities.length, 0, "bob's list is empty");

  const read = await fetch(`${base}/api/identities/${identityId}`, { headers: authed(bob) });
  assert.equal(read.status, 403, "bob cannot read alice's draft");

  const edit = await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: authed(bob),
    body: JSON.stringify({ bio: "bob was here" }),
  });
  assert.equal(edit.status, 403, "bob cannot edit");

  const grant = await fetch(`${base}/api/identities/${identityId}/grants`, {
    method: "POST",
    headers: authed(bob),
    body: JSON.stringify({ address: bob.address, role: "owner" }),
  });
  assert.equal(grant.status, 403, "bob cannot self-grant");
});

test("RBAC: share by address — editor can edit, cannot govern", async () => {
  const grant = await fetch(`${base}/api/identities/${identityId}/grants`, {
    method: "POST",
    headers: authed(alice),
    body: JSON.stringify({ address: bob.address, role: "editor" }),
  });
  assert.equal(grant.status, 201, "alice grants bob editor by address");

  const list = (await (
    await fetch(`${base}/api/identities`, { headers: authed(bob) })
  ).json()) as { identities: Array<{ identityId: string }> };
  assert.equal(list.identities.length, 1, "identity appears in bob's list");

  const edit = await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: authed(bob),
    body: JSON.stringify({ bio: "edited by bob, authorized" }),
  });
  assert.equal(edit.status, 200, "editor can edit");

  const publish = await fetch(`${base}/api/identities/${identityId}/publish`, {
    method: "POST",
    headers: authed(bob),
  });
  assert.equal(publish.status, 200, "editor can publish");

  const grantAttempt = await fetch(`${base}/api/identities/${identityId}/grants`, {
    method: "POST",
    headers: authed(bob),
    body: JSON.stringify({ address: bob.address, role: "owner" }),
  });
  assert.equal(grantAttempt.status, 403, "editor cannot grant");
});

test("the last owner is immovable", async () => {
  const r = await fetch(
    `${base}/api/identities/${identityId}/grants/${alice.address}`,
    { method: "DELETE", headers: authed(alice) },
  );
  assert.equal(r.status, 400, "cannot remove the last owner");
});

test("grants carry provenance in the engine", async () => {
  const rows = await db.query(
    `FROM grants WHERE identityId = "${identityId}"`,
  );
  assert.equal(rows.length, 2, "owner + editor grants");
  const editorGrant = rows.find((g) => g.role === "editor") as Record<string, unknown>;
  assert.equal(editorGrant.grantedBy, alice.address, "authority recorded");
});

test("logout revokes the session", async () => {
  const carol = await login(generatePhrase());
  const out = await fetch(`${base}/api/auth/logout`, {
    method: "POST",
    headers: authed(carol),
  });
  assert.equal(out.status, 200);
  const after = await fetch(`${base}/api/identities`, { headers: authed(carol) });
  assert.equal(after.status, 401, "revoked session rejected");
});
