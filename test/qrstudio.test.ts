/**
 * QR Studio live suite — free keeps the promised default, premium buys
 * the studio, and nothing unscannable ever ships.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DB = `links_qr_${Date.now().toString(36)}`;
delete process.env.LINKS_ADMIN_TOKEN;
delete process.env.STRIPE_SECRET_KEY;
process.env.LINKS_FREE_PROFILE_LIMIT = "1"; // limits ON, no Stripe needed
process.env.LINKS_PREMIUM_CAP_EPOCH = "2020-01-01T00:00:00Z";
process.env.ELECTRUMX_HOST = "127.0.0.1"; // unroutable: holder door fails closed
process.env.ELECTRUMX_PORT = "1";

const { createApp, ensureDatabase } = await import("../src/server/app");
const { qrScannable } = await import("../src/server/qrstudio");
const { db } = await import("../src/server/db");
const { deriveAccount, generatePhrase, signMessage } = await import("../src/lib/wallet");

let server: Server;
let base: string;
let token = "";
let address = "";
let identityId = "";

async function login(): Promise<void> {
  const phrase = generatePhrase();
  const acct = await deriveAccount(phrase);
  address = acct.address;
  const chal = (await (
    await fetch(`${base}/api/auth/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    })
  ).json()) as { challengeId: string; message: string };
  const signature = await signMessage(phrase, chal.message);
  const r = await fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeId: chal.challengeId, address, signature }),
  });
  token = ((await r.json()) as { token: string }).token;
}

function authed(): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

function qr(params: Record<string, string> = {}): string {
  const p = new URLSearchParams(params).toString();
  return `${base}/api/identities/${identityId}/qr${p ? `?${p}` : ""}`;
}

before(async () => {
  assert.ok(await db.ping(), "nedbd is not reachable");
  await ensureDatabase();
  server = createApp().listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
  await login();
  const claim = await fetch(`${base}/api/identities`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({ handle: "qrtest", displayName: "QR Test" }),
  });
  assert.equal(claim.status, 201);
  identityId = ((await claim.json()) as { manifest: { identityId: string } }).manifest.identityId;
  const put = await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: authed(),
    body: JSON.stringify({
      blocks: [
        { id: "blk_qr1", type: "link", order: 0, data: { label: "Book Now", url: "https://book.example.com/" } },
        { id: "blk_qr2", type: "header", order: 1, data: { text: "Hours" } },
      ],
    }),
  });
  assert.equal(put.status, 200, "two blocks save under the free cap");
});

after(async () => {
  server?.close();
  try {
    await db.dropDatabase();
  } catch {
    /* best-effort */
  }
});

test("qrScannable: contrast AND polarity — dark on light or it doesn't ship", () => {
  assert.equal(qrScannable("#0f172a", "#ffffff"), true, "classic passes");
  assert.equal(qrScannable("#701a30", "#fdf2f4"), true, "wine preset passes");
  assert.equal(qrScannable("#ffffff", "#0f172a"), false, "inverted polarity refused");
  assert.equal(qrScannable("#fbd8e2", "#f6c1d0"), false, "pink-on-pink refused (the Marisa test)");
});

test("free tier keeps the promised default; the studio gates", async () => {
  // Default profile PNG — free, as the ledger promised.
  const png = await fetch(qr(), { headers: authed() });
  assert.equal(png.status, 200);
  assert.match(png.headers.get("content-type") ?? "", /image\/png/);

  // Default profile SVG — parity with the public ?format=qr surface.
  const svg = await fetch(qr({ format: "svg" }), { headers: authed() });
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get("content-type") ?? "", /svg/);

  // Custom colors — premium.
  const styled = await fetch(qr({ fg: "#701a30", bg: "#fdf2f4" }), { headers: authed() });
  assert.equal(styled.status, 403, "styling is premium");
  assert.equal(((await styled.json()) as { code: string }).code, "premium_required");

  // Per-block codes — premium.
  const blk = await fetch(qr({ target: "blk_qr1" }), { headers: authed() });
  assert.equal(blk.status, 403, "per-link codes are premium");

  // The flyer — premium (owner check, headerless surface).
  await fetch(`${base}/api/identities/${identityId}/publish`, { method: "POST", headers: authed() });
  const flyer = await fetch(`${base}/qr/flyer/${identityId}`);
  assert.equal(flyer.status, 403, "flyers are premium");
});

test("bad colors are refused with friendly words, before any premium check", async () => {
  const junk = await fetch(qr({ fg: "not-a-color" }), { headers: authed() });
  assert.equal(junk.status, 400);
  const dim = await fetch(qr({ fg: "#fbd8e2", bg: "#f6c1d0" }), { headers: authed() });
  assert.equal(dim.status, 400, "unscannable pairs never ship");
  assert.match(((await dim.json()) as { error: string }).error, /won't scan/i);
});

test("premium unlocks the studio: styles, per-link codes, the flyer", async () => {
  // Entitlement written the way the webhook writes it (post-epoch:
  // capped for claims, but premium for features — the distinction).
  await db.put(
    "entitlements",
    address,
    {
      address,
      kind: "supporter",
      amountCents: 500,
      currency: "usd",
      stripeSessionId: "cs_test_qr",
      createdAt: new Date().toISOString(),
    },
    { evidence: "test supporter entitlement" },
  );

  const styled = await fetch(qr({ fg: "#701a30", bg: "#fdf2f4" }), { headers: authed() });
  assert.equal(styled.status, 200, "styled codes render once premium");

  const blk = await fetch(qr({ target: "blk_qr1", format: "svg", download: "1" }), { headers: authed() });
  assert.equal(blk.status, 200, "per-link SVG renders once premium");
  assert.match(blk.headers.get("content-type") ?? "", /svg/);
  assert.match(
    blk.headers.get("content-disposition") ?? "",
    /qrtest-book-now-qr\.svg/,
    "download filename carries the block label slug",
  );

  const missing = await fetch(qr({ target: "blk_nope" }), { headers: authed() });
  assert.equal(missing.status, 404, "unknown blocks 404");
  const unlinkable = await fetch(qr({ target: "blk_qr2" }), { headers: authed() });
  assert.equal(unlinkable.status, 400, "blocks without URLs are named as such");

  const flyer = await fetch(`${base}/qr/flyer/${identityId}?fg=%23701a30&bg=%23fdf2f4`);
  assert.equal(flyer.status, 200, "the flyer prints once the owner is premium");
  const html = await flyer.text();
  assert.match(html, /@qrtest/, "flyer carries the handle");
  assert.match(html, /<svg/, "flyer embeds the code inline");
  assert.match(html, /Scan to see everything/, "flyer speaks human");
});
