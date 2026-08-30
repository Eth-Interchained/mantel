/**
 * Analytics live suite — REAL traffic, REAL GROUP BYs.
 *
 * Claims an identity, publishes it, drives actual renderer traffic
 * (views direct/QR/card, vcard download, tracked clicks), then asserts
 * the dashboard numbers land EXACTLY — every one computed by a live
 * NQL GROUP BY inside a running nedbd. Event writes are fire-and-forget
 * by design, so the suite polls briefly for the log to settle.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DB = `links_analytics_${Date.now().toString(36)}`;
delete process.env.LINKS_ADMIN_TOKEN;

const { createApp, ensureDatabase } = await import("../src/server/app");
const { db } = await import("../src/server/db");
const { deriveAccount, generatePhrase, signMessage } = await import("../src/lib/wallet");
const { newBlockId } = await import("../src/lib/identity");

let server: Server;
let base: string;
let session = "";

async function walletLogin(): Promise<string> {
  const phrase = generatePhrase();
  const { address } = await deriveAccount(phrase);
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
  assert.equal(r.status, 200, "wallet login succeeds");
  return ((await r.json()) as { token: string }).token;
}

function authed(token = session): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

before(async () => {
  const reachable = await db.ping();
  assert.ok(reachable, "nedbd is not reachable — start it before running test:api");
  await ensureDatabase();
  server = createApp().listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
  session = await walletLogin();
});

after(async () => {
  server?.close();
  try {
    await db.dropDatabase();
  } catch {
    /* best-effort */
  }
});

let identityId = "";
const blkA = newBlockId();
const blkB = newBlockId();

interface Analytics {
  totals: {
    views: number;
    scans: number;
    taps: number;
    linkClicks: number;
    vcardDownloads: number;
  };
  viewsBySource: Array<{ source: string; count: number }>;
  topLinks: Array<{ blockId: string; label: string; url: string | null; count: number }>;
}

async function fetchAnalytics(token = session): Promise<{ status: number; body: Analytics }> {
  const r = await fetch(`${base}/api/identities/${identityId}/analytics`, {
    headers: authed(token),
  });
  return { status: r.status, body: (await r.json()) as Analytics };
}

test("claim, wire two links, publish", async () => {
  const r = await fetch(`${base}/api/identities`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({ handle: "signal-tester", displayName: "Signal Tester", template: "creator" }),
  });
  assert.equal(r.status, 201, "claim creates (201 — the REST contract)");
  const j = (await r.json()) as { manifest: { identityId: string } };
  identityId = j.manifest.identityId;

  const put = await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: authed(),
    body: JSON.stringify({
      blocks: [
        { id: blkA, type: "link", order: 0, data: { label: "Link A", url: "https://a.example/", icon: "🅰" } },
        { id: blkB, type: "link", order: 1, data: { label: "Link B", url: "https://b.example/", icon: "🅱" } },
      ],
    }),
  });
  assert.equal(put.status, 200, "blocks saved");

  const pub = await fetch(`${base}/api/identities/${identityId}/publish`, {
    method: "POST",
    headers: authed(),
  });
  assert.equal(pub.status, 200, "published");
});

test("real traffic lands as exact GROUP BY numbers", async () => {
  // 2 direct views, 1 QR scan, 1 business-card view.
  assert.equal((await fetch(`${base}/signal-tester`)).status, 200);
  assert.equal((await fetch(`${base}/signal-tester`)).status, 200);
  assert.equal((await fetch(`${base}/signal-tester?src=qr`)).status, 200);
  assert.equal((await fetch(`${base}/signal-tester?format=card`)).status, 200);
  // 1 vcard download; QR bytes are a utility surface — NO event.
  assert.equal((await fetch(`${base}/signal-tester?format=vcard`)).status, 200);
  assert.equal((await fetch(`${base}/signal-tester?format=qr`)).status, 200);
  // Clicks: 2 on A, 1 on B — tracked 302s.
  for (const [blk, to] of [
    [blkA, "https://a.example/"],
    [blkA, "https://a.example/"],
    [blkB, "https://b.example/"],
  ] as const) {
    const r = await fetch(
      `${base}/go/${identityId}/${blk}?to=${encodeURIComponent(to)}`,
      { redirect: "manual" },
    );
    assert.equal(r.status, 302, "click redirects");
  }

  // Event writes are fire-and-forget — poll until the log settles.
  let a: Analytics | null = null;
  for (let i = 0; i < 40; i++) {
    const { status, body } = await fetchAnalytics();
    assert.equal(status, 200, "owner reads analytics");
    if (
      body.totals.views === 4 &&
      body.totals.linkClicks === 3 &&
      body.totals.vcardDownloads === 1
    ) {
      a = body;
      break;
    }
    await new Promise((r_) => setTimeout(r_, 150));
  }
  assert.ok(a, "event log settled to expected totals within the window");

  assert.equal(a.totals.views, 4, "4 profile views (2 direct + 1 qr + 1 card)");
  assert.equal(a.totals.scans, 1, "1 QR scan");
  assert.equal(a.totals.taps, 2, "2 direct taps");
  assert.equal(a.totals.linkClicks, 3, "3 tracked clicks");
  assert.equal(a.totals.vcardDownloads, 1, "1 contact save");

  const card = a.viewsBySource.find((s) => s.source === "card");
  assert.equal(card?.count, 1, "card views grouped by source");

  assert.equal(a.topLinks[0].blockId, blkA, "top link is A");
  assert.equal(a.topLinks[0].count, 2);
  assert.equal(a.topLinks[0].label, "Link A", "label joined from the manifest");
  assert.equal(a.topLinks[0].url, "https://a.example/");
  assert.equal(a.topLinks[1].blockId, blkB);
  assert.equal(a.topLinks[1].count, 1);
});

test("analytics are viewer-gated: cross-tenant 403, anon 401, bad id 400", async () => {
  const stranger = await walletLogin();
  const cross = await fetchAnalytics(stranger);
  assert.equal(cross.status, 403, "another tenant cannot read analytics");

  const anon = await fetch(`${base}/api/identities/${identityId}/analytics`);
  assert.equal(anon.status, 401, "anonymous cannot read analytics");

  const bad = await fetch(`${base}/api/identities/not-an-id/analytics`, {
    headers: authed(),
  });
  assert.equal(bad.status, 400, "malformed ids are rejected before NQL");
});

interface Summary {
  identities: number;
  live: number;
  totals: { views: number; scans: number; linkClicks: number; vcardDownloads: number };
  perIdentity: Array<{
    identityId: string;
    handle: string;
    displayName: string;
    status: string;
    views: number;
    scans: number;
    linkClicks: number;
    vcardDownloads: number;
  }>;
}

test("account summary rolls the portfolio into one call — and only YOUR portfolio", async () => {
  // Anonymous → 401: the strip is for the signed-in.
  const anon = await fetch(`${base}/api/analytics/summary`);
  assert.equal(anon.status, 401, "summary requires a session");

  // The owner: one identity, the exact traffic driven above.
  const r = await fetch(`${base}/api/analytics/summary`, { headers: authed() });
  assert.equal(r.status, 200, "owner reads the rollup");
  const s = (await r.json()) as Summary;
  assert.equal(s.identities, 1, "one identity in the portfolio");
  assert.equal(s.live, 1, "the published identity counts as live");
  assert.equal(s.totals.views, 4, "rollup views match the per-identity dashboard");
  assert.equal(s.totals.scans, 1, "rollup scans match");
  assert.equal(s.totals.linkClicks, 3, "rollup clicks match");
  assert.equal(s.totals.vcardDownloads, 1, "rollup saves match");
  assert.equal(s.perIdentity.length, 1);
  assert.equal(s.perIdentity[0].identityId, identityId, "per-identity row carries the id");
  assert.equal(s.perIdentity[0].handle, "signal-tester");
  assert.equal(s.perIdentity[0].views, 4, "per-identity views ride along");
  assert.equal(s.perIdentity[0].status, "published");

  // A fresh account: zeros and an empty list — NOT someone else's
  // numbers. This is the cross-tenant isolation assertion for the
  // rollup path.
  const empty = await walletLogin();
  const er = await fetch(`${base}/api/analytics/summary`, { headers: authed(empty) });
  assert.equal(er.status, 200, "empty accounts still get a truthful rollup");
  const es = (await er.json()) as Summary;
  assert.equal(es.identities, 0, "no identities visible across tenants");
  assert.equal(es.live, 0);
  assert.equal(es.totals.views, 0, "zero views — not the neighbor's four");
  assert.equal(es.perIdentity.length, 0);
});
