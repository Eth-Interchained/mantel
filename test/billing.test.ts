/**
 * Monetization gate — live against a real nedbd.
 *
 * Free tier: one profile. Second claim → 402. A supporter entitlement
 * (written the way the webhook writes it) unlocks unlimited. The holder
 * door fails CLOSED in this environment (no ElectrumX egress from the
 * sandbox) — which exercises exactly the posture we want: unverifiable
 * never means unlocked, and claims never 500.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DB = `links_billing_${Date.now().toString(36)}`;
delete process.env.LINKS_ADMIN_TOKEN;
delete process.env.STRIPE_SECRET_KEY;
process.env.LINKS_FREE_PROFILE_LIMIT = "1"; // activates limits without Stripe
process.env.LINKS_PREMIUM_CAP_EPOCH = "2020-01-01T00:00:00Z"; // suite entitlements are NOT grandfathered
process.env.ELECTRUMX_HOST = "127.0.0.1"; // unroutable here: fail-closed path
process.env.ELECTRUMX_PORT = "1";

const { createApp, ensureDatabase } = await import("../src/server/app");
const { db } = await import("../src/server/db");
const { deriveAccount, generatePhrase, signMessage } = await import("../src/lib/wallet");

let server: Server;
let base: string;
let token = "";
let address = "";

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

function claimBody(handle: string): string {
  return JSON.stringify({ handle, displayName: "Gate Test", template: "creator" });
}

before(async () => {
  assert.ok(await db.ping(), "nedbd required");
  await ensureDatabase();
  server = createApp().listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
  await login();
});

after(async () => {
  server?.close();
  try {
    await db.dropDatabase();
  } catch {
    /* best-effort */
  }
});

test("first profile is free", async () => {
  const r = await fetch(`${base}/api/identities`, {
    method: "POST",
    headers: authed(),
    body: claimBody("gatefree"),
  });
  assert.equal(r.status, 201);
});

test("second claim hits the 402 gate with upgrade code", async () => {
  const r = await fetch(`${base}/api/identities`, {
    method: "POST",
    headers: authed(),
    body: claimBody("gatesecond"),
  });
  assert.equal(r.status, 402);
  const j = (await r.json()) as { code: string };
  assert.equal(j.code, "upgrade_required");
});

test("billing status reports the gate honestly (holder check fail-closed)", async () => {
  const r = await fetch(`${base}/api/billing/status`, { headers: authed() });
  assert.equal(r.status, 200);
  const s = (await r.json()) as {
    limitEnabled: boolean;
    owned: number;
    unlimited: boolean;
    fiatDoor: boolean;
    holderCheckAvailable: boolean;
    itcThreshold: number;
  };
  assert.equal(s.limitEnabled, true);
  assert.equal(s.owned, 1);
  assert.equal(s.unlimited, false, "unverifiable holder check never unlocks");
  assert.equal(s.holderCheckAvailable, false, "electrum unreachable reported honestly");
  assert.equal(s.fiatDoor, false, "no Stripe key: fiat door closed");
  assert.equal(s.itcThreshold, 100, "Mark's threshold");
});

test("the block cap: templates slice at claim, saves gate at the limit — all blocks, no grandfathering", async () => {
  // The claim above used the creator template, which seeds MORE than
  // the free cap — the claim must have sliced it to freeBlockLimit.
  const list = (await (await fetch(`${base}/api/identities`, { headers: authed() })).json()) as {
    identities: Array<{ identityId: string; handle: string; blockCount: number }>;
  };
  const idn = list.identities.find((i) => i.handle === "gatefree");
  assert.ok(idn, "claimed identity listed");
  assert.ok(idn.blockCount <= 3, `template seed sliced to the cap (got ${idn.blockCount})`);

  const mk = (n) =>
    Array.from({ length: n }, (_, i) => ({
      id: `blk_cap${i}`,
      type: "header",
      order: i,
      data: { text: `Block ${i + 1}` },
    }));

  // Exactly at the cap: fine.
  const ok = await fetch(`${base}/api/identities/${idn.identityId}`, {
    method: "PUT",
    headers: authed(),
    body: JSON.stringify({ blocks: mk(3) }),
  });
  assert.equal(ok.status, 200, "three blocks save free");

  // One over: the wall — and it names the doorway.
  const over = await fetch(`${base}/api/identities/${idn.identityId}`, {
    method: "PUT",
    headers: authed(),
    body: JSON.stringify({ blocks: mk(4) }),
  });
  assert.equal(over.status, 403, "the fourth block gates");
  const j = (await over.json()) as { code?: string; error?: string };
  assert.equal(j.code, "premium_required");
  assert.match(j.error ?? "", /go premium/i);
});

test("gallery blocks gate free saves — the doorway names the wall", async () => {
  // Runs BEFORE the supporter unlock below: this account is still free.
  const list = (await (await fetch(`${base}/api/identities`, { headers: authed() })).json()) as {
    identities: Array<{ identityId: string; handle: string }>;
  };
  const idn = list.identities.find((i) => i.handle === "gatefree");
  assert.ok(idn);
  const r = await fetch(`${base}/api/identities/${idn.identityId}`, {
    method: "PUT",
    headers: authed(),
    body: JSON.stringify({
      blocks: [
        {
          id: "blk_gal1",
          type: "gallery",
          order: 0,
          data: { images: [{ url: "https://cdn.example.com/work1.jpg", caption: "Fresh cut" }] },
        },
      ],
    }),
  });
  assert.equal(r.status, 403, "galleries are premium");
  const j = (await r.json()) as { code?: string; error?: string };
  assert.equal(j.code, "premium_required");
  assert.match(j.error ?? "", /gallery/i, "the message names the gallery wall");
});

test("custom SEO gates free saves; clearing back to automatic never walls", async () => {
  const list = (await (await fetch(`${base}/api/identities`, { headers: authed() })).json()) as {
    identities: Array<{ identityId: string; handle: string }>;
  };
  const idn = list.identities.find((i) => i.handle === "gatefree");
  assert.ok(idn);
  const r = await fetch(`${base}/api/identities/${idn.identityId}`, {
    method: "PUT",
    headers: authed(),
    body: JSON.stringify({ seo: { title: "Best fades in Orlando" } }),
  });
  assert.equal(r.status, 403, "custom seo is premium");
  const j = (await r.json()) as { code?: string; error?: string };
  assert.equal(j.code, "premium_required");
  assert.match(j.error ?? "", /search/i, "the message names the search wall");

  // Clearing is always free — walls never trap.
  const clear = await fetch(`${base}/api/identities/${idn.identityId}`, {
    method: "PUT",
    headers: authed(),
    body: JSON.stringify({ seo: null }),
  });
  assert.equal(clear.status, 200, "seo: null clears without premium");
});

test("checkout without Stripe answers 503, not a crash", async () => {
  const r = await fetch(`${base}/api/billing/checkout`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({ amountCents: 1000 }),
  });
  assert.equal(r.status, 503);
});

test("sharing access is premium — free owners get the doorway, not the form", async () => {
  const list = (await (await fetch(`${base}/api/identities`, { headers: authed() })).json()) as {
    identities: Array<{ identityId: string; handle: string }>;
  };
  const idn = list.identities.find((i) => i.handle === "gatefree");
  assert.ok(idn);
  const other = await deriveAccount(generatePhrase());
  const r = await fetch(`${base}/api/identities/${idn.identityId}/grants`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({ address: other.address, role: "viewer" }),
  });
  assert.equal(r.status, 403, "free pages cannot share access");
  const j = (await r.json()) as { code?: string; error?: string };
  assert.equal(j.code, "premium_required");
  assert.match(j.error ?? "", /sharing/i, "the message names the sharing wall");
});

test("a supporter entitlement unlocks unlimited", async () => {
  // Written exactly the way the webhook writes it.
  await db.put(
    "entitlements",
    address,
    {
      address,
      kind: "supporter",
      amountCents: 500,
      currency: "usd",
      stripeSessionId: "cs_test_direct",
      createdAt: new Date().toISOString(),
    },
    { evidence: "test supporter entitlement" },
  );

  const status = (await (
    await fetch(`${base}/api/billing/status`, { headers: authed() })
  ).json()) as { unlimited: boolean; via: string };
  assert.equal(status.unlimited, true);
  assert.equal(status.via, "supporter");

  const r = await fetch(`${base}/api/identities`, {
    method: "POST",
    headers: authed(),
    body: claimBody("gatesecond"),
  });
  assert.equal(r.status, 201, "supporter claims freely");
});

test("premium lifts the block cap — same page, fourth block welcome", async () => {
  const list = (await (await fetch(`${base}/api/identities`, { headers: authed() })).json()) as {
    identities: Array<{ identityId: string; handle: string }>;
  };
  const idn = list.identities.find((i) => i.handle === "gatefree");
  assert.ok(idn);
  const blocks = Array.from({ length: 6 }, (_, i) => ({
    id: `blk_prem${i}`,
    type: "header",
    order: i,
    data: { text: `Premium block ${i + 1}` },
  }));
  const r = await fetch(`${base}/api/identities/${idn.identityId}`, {
    method: "PUT",
    headers: authed(),
    body: JSON.stringify({ blocks }),
  });
  assert.equal(r.status, 200, "six blocks save fine once premium");
});

test("premium unlocks the gallery — Marisa's showcase saves and renders", async () => {
  const list = (await (await fetch(`${base}/api/identities`, { headers: authed() })).json()) as {
    identities: Array<{ identityId: string; handle: string }>;
  };
  const idn = list.identities.find((i) => i.handle === "gatefree");
  assert.ok(idn);
  const r = await fetch(`${base}/api/identities/${idn.identityId}`, {
    method: "PUT",
    headers: authed(),
    body: JSON.stringify({
      blocks: [
        {
          id: "blk_gal2",
          type: "gallery",
          order: 0,
          data: {
            images: [
              { url: "https://cdn.example.com/work1.jpg", caption: "Balayage" },
              { url: "https://cdn.example.com/work2.jpg" },
            ],
          },
        },
      ],
    }),
  });
  assert.equal(r.status, 200, "gallery saves once premium");

  // And the public page actually shows the work.
  await fetch(`${base}/api/identities/${idn.identityId}/publish`, { method: "POST", headers: authed() });
  const page = await (await fetch(`${base}/gatefree`)).text();
  assert.match(page, /class="gal"/, "gallery strip on the public page");
  assert.match(page, /work1\.jpg/, "the photos render");
  assert.match(page, /Balayage/, "the caption renders");
});

test("safeReturnPath: same-origin paths pass, everything shady falls back", async () => {
  const { safeReturnPath } = await import("../src/server/billing");
  // The legit case this exists for: returning to a mid-edit editor.
  assert.equal(safeReturnPath("/edit/idn_abc123"), "/edit/idn_abc123");
  assert.equal(safeReturnPath("/identities"), "/identities");
  // Queries and hashes are stripped — the server appends its own params.
  assert.equal(safeReturnPath("/edit/idn_x?tab=blocks#top"), "/edit/idn_x");
  // Shady inputs: foreign origins, protocol smuggling, backslashes, junk.
  assert.equal(safeReturnPath("https://evil.example/phish"), "/identities");
  assert.equal(safeReturnPath("//evil.example"), "/identities");
  assert.equal(safeReturnPath("/redirect\\evil"), "/identities");
  assert.equal(safeReturnPath("/x://y"), "/identities");
  assert.equal(safeReturnPath("no-leading-slash"), "/identities");
  assert.equal(safeReturnPath(undefined), "/identities");
  assert.equal(safeReturnPath("/"), "/identities");
  assert.equal(safeReturnPath(`/${"a".repeat(300)}`), "/identities");
});

test("premium profile cap: the third claim meets the ceiling, grandfathers pass", async () => {
  // Suite state: the supporter owns gatefree + gatesecond (2 of 2).
  // premiumProfileLimit defaults to 2; the epoch pinned above makes the
  // suite's entitlement post-epoch — i.e. capped, not grandfathered.
  const { COLLECTIONS } = await import("../src/lib/identity");
  const r = await fetch(`${base}/api/identities`, {
    method: "POST",
    headers: authed(),
    body: claimBody("gatethird"),
  });
  assert.equal(r.status, 402, "third claim hits the premium ceiling");
  const j = (await r.json()) as { error: string; code: string };
  assert.equal(j.code, "premium_limit", "the code names the right wall");
  assert.match(j.error, /talk to us/i, "the copy invites, not scolds");

  // Status is honest about the ceiling.
  const s = (await (
    await fetch(`${base}/api/billing/status`, { headers: authed() })
  ).json()) as { premiumProfileLimit: number; capExempt: boolean; unlimited: boolean };
  assert.equal(s.premiumProfileLimit, 2);
  assert.equal(s.unlimited, true, "still premium — the cap is not a downgrade");
  assert.equal(s.capExempt, false, "post-epoch supporter is capped");

  // Grandfather: age the entitlement to pre-epoch — the old deal holds.
  const ent = (await db.get(COLLECTIONS.entitlements, address)) as Record<string, unknown>;
  await db.put(COLLECTIONS.entitlements, address, {
    ...ent,
    createdAt: "2019-06-01T00:00:00.000Z",
  });
  const g = await fetch(`${base}/api/identities`, {
    method: "POST",
    headers: authed(),
    body: claimBody("gatethird"),
  });
  assert.equal(g.status, 201, "grandfathered supporter keeps the uncapped deal they bought");
  const s2 = (await (
    await fetch(`${base}/api/billing/status`, { headers: authed() })
  ).json()) as { capExempt: boolean };
  assert.equal(s2.capExempt, true, "status reports the exemption");
});

test("premium unlocks custom SEO — the public head carries the owner's words", async () => {
  const list = (await (await fetch(`${base}/api/identities`, { headers: authed() })).json()) as {
    identities: Array<{ identityId: string; handle: string }>;
  };
  const idn = list.identities.find((i) => i.handle === "gatefree");
  assert.ok(idn);
  const r = await fetch(`${base}/api/identities/${idn.identityId}`, {
    method: "PUT",
    headers: authed(),
    body: JSON.stringify({
      seo: {
        title: "Gatefree — the proof page",
        description: "Premium words in the snippet.",
        image: "https://cdn.example.com/share.jpg",
      },
    }),
  });
  assert.equal(r.status, 200, "seo saves once premium");

  await fetch(`${base}/api/identities/${idn.identityId}/publish`, { method: "POST", headers: authed() });
  const page = await (await fetch(`${base}/gatefree`)).text();
  assert.match(page, /<title>Gatefree — the proof page<\/title>/, "custom title on the public head");
  assert.match(page, /og:image" content="https:\/\/cdn\.example\.com\/share\.jpg"/, "share card lands");
  assert.match(page, /summary_large_image/, "large card with an image");
});

test("entitlements follow the PAGE: received ownership is free, free editors wield premium pages", async () => {
  const list = (await (await fetch(`${base}/api/identities`, { headers: authed() })).json()) as {
    identities: Array<{ identityId: string; handle: string }>;
  };
  const idn = list.identities.find((i) => i.handle === "gatefree");
  assert.ok(idn, "premium page present");

  // A second, FREE account.
  const login2 = async () => {
    const phrase = generatePhrase();
    const acct = await deriveAccount(phrase);
    const chal = (await (
      await fetch(`${base}/api/auth/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: acct.address }),
      })
    ).json()) as { challengeId: string; message: string };
    const signature = await signMessage(phrase, chal.message);
    const r = await fetch(`${base}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId: chal.challengeId, address: acct.address, signature }),
    });
    return { token: ((await r.json()) as { token: string }).token, address: acct.address };
  };
  const friend = await login2();
  const authedAs = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });

  // The premium owner hands the friend OWNERSHIP of gatefree.
  const own = await fetch(`${base}/api/identities/${idn.identityId}/grants`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({ address: friend.address, role: "owner" }),
  });
  assert.equal(own.status, 201, "premium pages can share (even ownership)");

  // Received ownership spends NOTHING (Mark's consent catch, 7/9).
  const status = (await (
    await fetch(`${base}/api/billing/status`, { headers: authedAs(friend.token) })
  ).json()) as { owned: number };
  assert.equal(status.owned, 0, "a granted ownership never counts against your limit");

  // The friend still claims their own first page freely.
  const claim = await fetch(`${base}/api/identities`, {
    method: "POST",
    headers: authedAs(friend.token),
    body: JSON.stringify({ handle: "friendsown", displayName: "Friend" }),
  });
  assert.equal(claim.status, 201, "the free allowance was untouched");
  const friendPageId = ((await claim.json()) as { manifest: { identityId: string } }).manifest.identityId;

  // FREE actor on the PREMIUM page: the page's powers apply — a gallery saves.
  const gal = await fetch(`${base}/api/identities/${idn.identityId}`, {
    method: "PUT",
    headers: authedAs(friend.token),
    body: JSON.stringify({
      blocks: [
        { id: "blk_pageprem", type: "gallery", order: 0, data: { images: [{ url: "https://cdn.example.com/team.jpg" }] } },
      ],
    }),
  });
  assert.equal(gal.status, 200, "free editor/owner on a premium page uses the PAGE's premium");

  // The SAME free account on their OWN free page: walls apply.
  const galOwn = await fetch(`${base}/api/identities/${friendPageId}`, {
    method: "PUT",
    headers: authedAs(friend.token),
    body: JSON.stringify({
      blocks: [
        { id: "blk_freeown", type: "gallery", order: 0, data: { images: [{ url: "https://cdn.example.com/nope.jpg" }] } },
      ],
    }),
  });
  assert.equal(galOwn.status, 403, "the same account's free page keeps its walls");

  // And the free friend cannot share their own free page.
  const share = await fetch(`${base}/api/identities/${friendPageId}/grants`, {
    method: "POST",
    headers: authedAs(friend.token),
    body: JSON.stringify({ address: address, role: "viewer" }),
  });
  assert.equal(share.status, 403, "sharing stays premium for the friend's own page");
});
