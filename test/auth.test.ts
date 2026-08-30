/**
 * Auth suite — token-gated instance behavior.
 *
 * Runs in its own process (node --test per-file isolation) so it can set
 * LINKS_ADMIN_TOKEN before the config module loads. Requires nedbd.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DB = `links_auth_${Date.now().toString(36)}`;
process.env.LINKS_ADMIN_TOKEN = "test-token-xyz";

const { createApp, ensureDatabase } = await import("../src/server/app");
const { db } = await import("../src/server/db");

let server: Server;
let base: string;

before(async () => {
  assert.ok(await db.ping(), "nedbd required for auth tests");
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

test("writes are rejected without the admin token", async () => {
  const r = await fetch(`${base}/api/identities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "lockedout", displayName: "Nope" }),
  });
  assert.equal(r.status, 401);

  const list = await fetch(`${base}/api/identities`);
  assert.equal(list.status, 401, "list is gated too");

  const preview = await fetch(`${base}/api/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identityId: "x", handle: "x", displayName: "x" }),
  });
  assert.equal(preview.status, 401, "preview is gated too");
});

test("writes succeed with the admin token; public reads stay open", async () => {
  const r = await fetch(`${base}/api/identities`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-token-xyz",
    },
    body: JSON.stringify({ handle: "authorized", displayName: "Authorized", template: "creator" }),
  });
  assert.equal(r.status, 201);
  const j = (await r.json()) as { manifest: { identityId: string } };

  const pub = await fetch(`${base}/api/identities/${j.manifest.identityId}/publish`, {
    method: "POST",
    headers: { authorization: "Bearer test-token-xyz" },
  });
  assert.equal(pub.status, 200);

  // Public surfaces need no token — identity is meant to be shared.
  const html = await fetch(`${base}/authorized`);
  assert.equal(html.status, 200);
  const availability = await fetch(`${base}/api/handles/anything/availability`);
  assert.equal(availability.status, 200, "availability stays public for the claim flow");
});
