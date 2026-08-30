/**
 * UPI QR — live, against the REAL server and nedbd.
 *
 * WHY THIS SUITE EXISTS
 * Mark clicked "Pay with UPI" on a desktop and got offered WhatsApp. The
 * href was perfect; `upi://` is simply a mobile-only scheme with no
 * desktop handler, and WhatsApp Pay is a real registered UPI app so the
 * OS was right to suggest it. Every test I had asserted the link's SHAPE
 * and none could assert it DOES anything — a headless browser never
 * resolves a custom scheme.
 *
 * So these tests assert the thing that generalises: for any payable
 * block there is at least one way to pay that does not depend on the
 * visitor's OS knowing what `upi:` means.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DB = `links_upiqr_${Date.now().toString(36)}`;
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
let token = "";
const VPA = "aisha@okhdfcbank";

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

before(async () => {
  assert.ok(await db.ping(), "nedbd required");
  await ensureDatabase();
  server = createApp().listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
  await post("/api/auth/signup", { email: "seller@qr.test", password: "hunter2hunter2" });
  const mail = outbox.filter((m) => m.to === "seller@qr.test").at(-1);
  const vt = /token=([a-zA-Z0-9_-]+)/.exec(mail?.text ?? "")?.[1];
  token = ((await (await post("/api/auth/verify-email", { token: vt })).json()) as { token: string }).token;
  const claim = await post("/api/identities", { handle: "qr-test", displayName: "QR Test" }, token);
  identityId = ((await claim.json()) as { manifest: { identityId: string } }).manifest.identityId;

  const cur = (await (await fetch(`${base}/api/identities/${identityId}`, { headers: authed(token) })).json()) as {
    manifest: Record<string, unknown>;
  };
  cur.manifest.blocks = [
    { id: "blk_upi", type: "upi", order: 0, data: { vpa: VPA, payeeName: "Aisha", amount: 499, label: "Pay" } },
    {
      id: "blk_prod",
      type: "product",
      order: 1,
      data: { title: "Kit", price: 349, vpa: VPA, deliverable: "https://cdn.example.com/k.zip" },
    },
    { id: "blk_text", type: "text", order: 2, data: { text: "not payable" } },
  ];
  await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: authed(token),
    body: JSON.stringify(cur.manifest),
  });
  await post(`/api/identities/${identityId}/publish`, {}, token);
});

after(async () => {
  server?.close();
  try {
    await db.dropDatabase();
  } catch {
    /* best-effort */
  }
});

test("every payable surface offers a way to pay that is NOT the upi: scheme", async () => {
  // This is the regression guard for the whole bug class. A page whose
  // only affordance is `upi://` is broken on every desktop on earth.
  const surfaces = [
    ["profile", await (await fetch(`${base}/qr-test`)).text()],
    ["buy page", await (await fetch(`${base}/buy/${identityId}/blk_prod`)).text()],
  ] as const;
  for (const [name, html] of surfaces) {
    assert.ok(html.includes("upi://pay?"), `${name} still offers the mobile intent`);
    assert.ok(/\/upi\/idn_[a-f0-9]+\/blk_\w+\.svg/.test(html), `${name} offers a scannable QR`);
    assert.ok(html.includes(VPA), `${name} prints the VPA for manual entry`);
  }
});

test("the QR endpoint serves a real SVG for each payable block type", async () => {
  for (const blockId of ["blk_upi", "blk_prod"]) {
    const res = await fetch(`${base}/upi/${identityId}/${blockId}.svg`);
    assert.equal(res.status, 200, `${blockId} renders`);
    assert.match(res.headers.get("content-type") ?? "", /image\/svg/);
    const svg = await res.text();
    assert.ok(svg.startsWith("<?xml") || svg.startsWith("<svg"), "it is really an SVG");
    assert.ok(svg.includes("<path") || svg.includes("<rect"), "with actual QR geometry");
  }
});

test("the endpoint is not a general QR generator", async () => {
  // It resolves a real block and encodes what that block would have
  // linked to. Nothing caller-supplied reaches the encoder, so there is
  // no way to mint a QR pointing at someone else's VPA.
  assert.equal((await fetch(`${base}/upi/${identityId}/blk_text.svg`)).status, 404, "non-payable block");
  assert.equal((await fetch(`${base}/upi/${identityId}/blk_nope.svg`)).status, 404, "unknown block");
  assert.equal(
    (await fetch(`${base}/upi/idn_0000000000000000dead/blk_upi.svg`)).status,
    404,
    "unknown identity",
  );
  assert.equal((await fetch(`${base}/upi/not-an-id/blk_upi.svg`)).status, 404, "malformed identity");
});

test("a block with no valid VPA yields no QR rather than a broken one", async () => {
  const cur = (await (await fetch(`${base}/api/identities/${identityId}`, { headers: authed(token) })).json()) as {
    manifest: Record<string, unknown>;
  };
  (cur.manifest.blocks as Array<Record<string, unknown>>).push({
    id: "blk_empty",
    type: "upi",
    order: 3,
    data: { vpa: "", label: "Pay" },
  });
  await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: authed(token),
    body: JSON.stringify(cur.manifest),
  });
  await post(`/api/identities/${identityId}/publish`, {}, token);
  // A QR encoding a malformed intent would send money nowhere, or worse,
  // somewhere. Better to render nothing at all.
  assert.equal((await fetch(`${base}/upi/${identityId}/blk_empty.svg`)).status, 404);
});

test("the scan-to-pay disclosure stays zero-JS", async () => {
  const html = await (await fetch(`${base}/qr-test`)).text();
  assert.equal(/<script/i.test(html), false, "no script reached the public page");
  // <details> is the whole mechanism — collapsible with no JS at all.
  assert.ok(html.includes("<details"), "the QR is behind a native disclosure");
  assert.ok(html.includes('loading="lazy"'), "and it doesn't cost a request until opened");
});
