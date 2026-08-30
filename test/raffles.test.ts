/**
 * Giveaway live suite — the full game against a REAL nedbd: mint with
 * commitment, enter with verified email, scarcity cap, close by clock,
 * draw against the beacon, recompute the draw independently, and prove
 * PII never leaks while leads flow to the owner.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DB = `links_raffle_${Date.now().toString(36)}`;
process.env.LINKS_AUTH_MODE = "email";
process.env.LINKS_MAIL_TEST = "1";
process.env.PUBLIC_ORIGIN = "http://links.test";
delete process.env.LINKS_ADMIN_TOKEN;
delete process.env.ITC_RPC_URL; // beacon exercises the engine-head fallback

const { createApp, ensureDatabase } = await import("../src/server/app");
const { db } = await import("../src/server/db");
const { outbox } = await import("../src/server/mailer");
const { commitmentOf, computeDraw } = await import("../src/lib/raffle");

let server: Server;
let base: string;
let session = "";
let identityId = "";
let raffleId = "";

function post(path: string, body?: unknown, token?: string): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
}

function lastMailTo(email: string): string {
  const m = [...outbox].reverse().find((x) => x.to === email);
  assert.ok(m, `outbox has mail for ${email}`);
  return m.text;
}

function codeFor(email: string): string {
  const m = lastMailTo(email).match(/code: (\d{6})/i) ?? lastMailTo(email).match(/(\d{6})/);
  assert.ok(m, "6-digit code in the mail");
  return m[1];
}

before(async () => {
  await ensureDatabase();
  server = createApp().listen(0);
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  // Owner: signup → verify → claim.
  await post("/api/auth/signup", { email: "owner@probe.test", password: "probe-pass-123" });
  const tok = lastMailTo("owner@probe.test").match(/token=(tok_[a-f0-9]+)/);
  assert.ok(tok);
  const v = (await (await post("/api/auth/verify-email", { token: tok[1] })).json()) as { token: string };
  session = v.token;
  const claim = (await (await post("/api/identities", { handle: "rafflehost", displayName: "Raffle Host" }, session)).json()) as {
    manifest: { identityId: string };
  };
  identityId = claim.manifest.identityId;
});

after(() => {
  server?.close();
});

test("mint: saving a giveaway block publishes the commitment before any entry", async () => {
  const closesAt = new Date(Date.now() + 2500).toISOString();
  const put = await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${session}` },
    body: JSON.stringify({
      blocks: [
        {
          id: "blk_gv1",
          type: "giveaway",
          order: 0,
          data: {
            prize: "One free haircut",
            description: "Marisa's chair, your hair",
            closesAt,
            winners: 1,
            maxEntries: 2,
            rules: "One entry per person. 18+.",
          },
        },
      ],
    }),
  });
  assert.equal(put.status, 200);
  const j = (await put.json()) as { manifest: { blocks: Array<{ data: { raffleId?: string } }> } };
  raffleId = j.manifest.blocks[0].data.raffleId ?? "";
  assert.match(raffleId, /^rfl_[a-f0-9]{20}$/, "server minted the raffle and linked the block");

  const pub = (await (await fetch(`${base}/api/raffles/${raffleId}`)).json()) as {
    raffle: Record<string, unknown>;
  };
  assert.equal(String(pub.raffle.commitment).length, 64, "commitment published at mint");
  assert.equal("secret" in pub.raffle, false, "secret NEVER public before draw");
  assert.equal("revealedSecret" in pub.raffle, false, "no reveal before draw");
  assert.equal(pub.raffle.state, "open");
  assert.equal(pub.raffle.maxEntries, 2);

  // Publish so the world can see it.
  const publish = await post(`/api/identities/${identityId}/publish`, undefined, session);
  assert.equal(publish.status, 200);
  const page = await (await fetch(`${base}/rafflehost`)).text();
  assert.ok(page.includes("One free haircut"), "giveaway card on the profile");
  assert.ok(page.includes("gvw"), "holographic card class present");
});

test("enter: verified email → ticket; duplicates and overflow bounce", async () => {
  // Entrant one.
  const e1 = await post(`/api/raffles/${raffleId}/enter`, { name: "Ana", phone: "+1 407 555 0001", email: "ana@probe.test" });
  assert.equal(e1.status, 200);
  const p1 = ((await e1.json()) as { pendingId: string }).pendingId;
  const c1 = await post(`/api/raffles/${raffleId}/confirm`, { pendingId: p1, code: codeFor("ana@probe.test") });
  assert.equal(c1.status, 201);
  const t1 = ((await c1.json()) as { ticketId: string }).ticketId;
  assert.match(t1, /^tkt_[a-f0-9]{16}$/);
  assert.ok(lastMailTo("ana@probe.test").includes(t1), "ticket email carries the ticket id");

  // Same email again: warm no-op.
  const dup = (await (await post(`/api/raffles/${raffleId}/enter`, { name: "Ana", phone: "+1 407 555 0001", email: "ana@probe.test" })).json()) as { already?: boolean };
  assert.equal(dup.already, true, "one entry per verified email");

  // Entrant two fills the cap.
  const e2 = await post(`/api/raffles/${raffleId}/enter`, { name: "Ben", phone: "+1 407 555 0002", email: "ben@probe.test" });
  const p2 = ((await e2.json()) as { pendingId: string }).pendingId;
  const c2 = await post(`/api/raffles/${raffleId}/confirm`, { pendingId: p2, code: codeFor("ben@probe.test") });
  assert.equal(c2.status, 201);

  // Entrant three: all spots taken.
  const e3 = await post(`/api/raffles/${raffleId}/enter`, { name: "Cy", phone: "+1 407 555 0003", email: "cy@probe.test" });
  assert.equal(e3.status, 409, "maxEntries enforced at enter");

  // The public entry page shows the game: rules + spots.
  const page = await (await fetch(`${base}/r/${raffleId}`)).text();
  assert.ok(page.includes("One entry per person. 18+."), "rules rendered");
  assert.ok(page.includes("spots taken") || page.includes("All spots are taken"), "scarcity surfaced");
  assert.equal(page.includes("ana@probe.test"), false, "PII never on a public page");
});

test("draw: closes by clock, settles against the beacon, recomputes exactly", async () => {
  // Too early: the draw refuses while open.
  const early = await post(`/api/raffles/${raffleId}/draw`, undefined, session);
  assert.equal(early.status, 409, "no drawing while entries are open");

  await new Promise((r) => setTimeout(r, 2700)); // let the clock pass closesAt

  const lateEnter = await post(`/api/raffles/${raffleId}/enter`, { name: "Late", phone: "+1 407 555 0009", email: "late@probe.test" });
  assert.equal(lateEnter.status, 409, "entries after close bounce");

  // A stranger can't draw.
  const stranger = await post(`/api/raffles/${raffleId}/draw`);
  assert.equal(stranger.status, 401);

  const draw = await post(`/api/raffles/${raffleId}/draw`, undefined, session);
  assert.equal(draw.status, 200);
  const d = ((await draw.json()) as { raffle: Record<string, unknown> }).raffle;
  assert.equal(d.state, "drawn");
  assert.equal(d.beaconKind, "engine-head", "no ITC RPC in tests → labeled fallback");
  const winners = d.winnerTicketIds as string[];
  assert.equal(winners.length, 1);

  // Independent recompute — the provably-fair claim, exercised.
  assert.equal(commitmentOf(String(d.revealedSecret)), d.commitment, "revealed secret matches the pre-entry commitment");
  const entries = (await (await fetch(`${base}/api/raffles/${raffleId}/leads`, { headers: { authorization: `Bearer ${session}` } })).json()) as {
    leads: Array<{ ticketId: string; winner: boolean }>;
  };
  const tickets = entries.leads.map((l) => l.ticketId);
  const re = computeDraw(String(d.revealedSecret), String(d.beaconValue), tickets, 1);
  assert.deepEqual(re.winners, winners, "independent recompute lands on the same winner");
  assert.equal(re.merkleRoot, d.merkleRoot, "entry-set root agrees");

  // Idempotent: drawing again returns the same result.
  const again = (await (await post(`/api/raffles/${raffleId}/draw`, undefined, session)).json()) as { already?: boolean };
  assert.equal(again.already, true);

  // The verify page recomputes live and says so.
  const verify = await (await fetch(`${base}/r/${raffleId}/verify`)).text();
  assert.ok(verify.includes("recompute matches the recorded draw"), "verify page green");
  assert.ok(verify.includes(winners[0]), "winning ticket displayed");
  assert.equal(verify.includes("@probe.test"), false, "no PII on the verify page");

  // Winner got the email.
  const winnerLead = entries.leads.find((l) => l.winner);
  assert.ok(winnerLead, "leads mark the winner");
});

test("leads: the owner's payoff — gated, complete, exportable", async () => {
  const noAuth = await fetch(`${base}/api/raffles/${raffleId}/leads`);
  assert.equal(noAuth.status, 401, "leads are owner-only");

  const csv = await fetch(`${base}/api/raffles/${raffleId}/leads?format=csv`, {
    headers: { authorization: `Bearer ${session}` },
  });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
  const body = await csv.text();
  assert.ok(body.startsWith("name,email,phone,ticket,entered_at,winner"), "CSV header row");
  assert.ok(body.includes("ana@probe.test") && body.includes("ben@probe.test"), "both verified leads present");
  assert.ok(body.includes('"yes"'), "winner flagged in the export");
});

// ── The zero-JS path — a REAL <form method="post"> body ─────────────────────
//
// Every test above talks JSON, which is what fetch() sends but NOT what
// a browser sends from an actual <form> on /r/:id — that's
// application/x-www-form-urlencoded. This gap is exactly how the entry
// form shipped broken end-to-end: express only had express.json()
// mounted, so req.body was {} for every real visitor no matter what
// they typed, surfacing as "Something's missing" / zod's "Required".

function formPost(path: string, fields: Record<string, string>): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

test("the zero-JS entry form: real url-encoded POSTs, not JSON — this is what a browser actually sends", async () => {
  // A second giveaway — the first is already drawn and closed above.
  const closesAt = new Date(Date.now() + 60_000).toISOString();
  const put = await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${session}` },
    body: JSON.stringify({
      blocks: [
        { id: "blk_gv2", type: "giveaway", order: 0, data: { prize: "Form POST test", closesAt, winners: 1 } },
      ],
    }),
  });
  assert.equal(put.status, 200);
  const j = (await put.json()) as { manifest: { blocks: Array<{ data: { raffleId?: string } }> } };
  const rid = j.manifest.blocks[0].data.raffleId ?? "";
  assert.match(rid, /^rfl_[a-f0-9]{20}$/);

  const entryPage = await (await fetch(`${base}/r/${rid}`)).text();
  assert.ok(entryPage.includes("color-scheme: dark"), "the readability fix: dark scheme declared, not left to browser default");
  assert.ok(entryPage.includes(":-webkit-autofill"), "the readability fix: autofilled name/phone/email get an explicit override, not the browser's forced light chrome");

  // The actual regression: submit the form the way a BROWSER submits
  // it. Before the express.urlencoded() fix, this landed as "Something's
  // missing" / "Required" no matter what was typed — req.body was {}.
  const enterHtml = await (
    await formPost(`/r/${rid}/enter`, { name: "Dana Real", phone: "+1 407 555 0099", email: "dana@probe.test" })
  ).text();
  assert.equal(enterHtml.includes("Something&#39;s missing") || enterHtml.includes("Something's missing"), false, "the entry the visitor typed must be READ — not reported missing");
  assert.ok(enterHtml.includes("Check your inbox") || enterHtml.includes("check your inbox"), "real submission reaches the code-sent step");

  const code = codeFor("dana@probe.test");
  const pendingMatch = lastMailTo("dana@probe.test"); // sanity: mail actually fired for this entry
  assert.ok(pendingMatch.length > 0);

  // Pull the pendingId the same way a browser would have it: from the
  // hidden field the server just rendered.
  const pendingIdMatch = enterHtml.match(/name="pendingId" value="([^"]+)"/);
  assert.ok(pendingIdMatch, "confirm form carries the pending id");

  const confirmHtml = await (
    await formPost(`/r/${rid}/confirm`, { pendingId: pendingIdMatch![1], code })
  ).text();
  assert.ok(confirmHtml.includes("You're in"), "real form-encoded confirm actually redeems a ticket");
  const ticketMatch = confirmHtml.match(/class="win mono">(tkt_[a-f0-9]+)</);
  assert.ok(ticketMatch, "a real ticket id renders back to the browser");

  // And it's really persisted — the owner's leads reflect the same entry.
  const leads = (await (await fetch(`${base}/api/raffles/${rid}/leads`, { headers: { authorization: `Bearer ${session}` } })).json()) as {
    leads: Array<{ email: string; ticketId: string }>;
  };
  assert.ok(leads.leads.some((l) => l.email === "dana@probe.test" && l.ticketId === ticketMatch![1]), "the form-submitted entry is the SAME record the owner sees");
});

// ── End-at-will + auto-draw: nothing stays unresolved ────────────────────────

test("end & draw now: the owner stops entries at will and the winner settles in the same motion", async () => {
  const closesAt = new Date(Date.now() + 3600_000).toISOString(); // an hour away
  const put = await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${session}` },
    body: JSON.stringify({
      blocks: [
        { id: "blk_gv3", type: "giveaway", order: 0, data: { prize: "End-at-will prize", closesAt, winners: 1 } },
      ],
    }),
  });
  assert.equal(put.status, 200);
  const rid = ((await put.json()) as { manifest: { blocks: Array<{ data: { raffleId?: string } }> } })
    .manifest.blocks[0].data.raffleId ?? "";

  // One verified entrant.
  const e = await post(`/api/raffles/${rid}/enter`, { name: "Willa", phone: "+1 407 555 0200", email: "willa@probe.test" });
  const pendingId = ((await e.json()) as { pendingId: string }).pendingId;
  const c = await post(`/api/raffles/${rid}/confirm`, { pendingId, code: codeFor("willa@probe.test") });
  assert.equal(c.status, 201);

  // A stranger can't end it.
  const stranger = await post(`/api/raffles/${rid}/end`);
  assert.equal(stranger.status, 401);

  // The owner ends it — an HOUR early — and the draw settles instantly.
  const end = await post(`/api/raffles/${rid}/end`, undefined, session);
  assert.equal(end.status, 200);
  const ended = ((await end.json()) as { raffle: Record<string, unknown>; drew: boolean });
  assert.equal(ended.drew, true, "ending open entries draws in the same motion");
  assert.equal(ended.raffle.state, "drawn");
  assert.ok(ended.raffle.closedEarlyAt, "the early end is recorded");
  assert.equal((ended.raffle.winnerTicketIds as string[]).length, 1);

  // The winner email fired automatically — no extra clicks anywhere.
  const mail = lastMailTo("willa@probe.test");
  assert.ok(mail.includes("won"), "winner notified in the same motion");

  // The verify page labels the early end honestly.
  const verify = await (await fetch(`${base}/r/${rid}/verify`)).text();
  assert.ok(verify.includes("ended early by the owner"), "early end disclosed on the public record");
  assert.ok(verify.includes("recompute matches the recorded draw"), "and the math still checks");
});

test("lazy auto-draw: a closed giveaway settles itself on the first view — no clicks, winner emailed", async () => {
  const closesAt = new Date(Date.now() + 2000).toISOString(); // closes in 2s
  const put = await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${session}` },
    body: JSON.stringify({
      blocks: [
        { id: "blk_gv4", type: "giveaway", order: 0, data: { prize: "Auto-draw prize", closesAt, winners: 1 } },
      ],
    }),
  });
  assert.equal(put.status, 200);
  const rid = ((await put.json()) as { manifest: { blocks: Array<{ data: { raffleId?: string } }> } })
    .manifest.blocks[0].data.raffleId ?? "";

  const e = await post(`/api/raffles/${rid}/enter`, { name: "Otto", phone: "+1 407 555 0300", email: "otto@probe.test" });
  const pendingId = ((await e.json()) as { pendingId: string }).pendingId;
  const c = await post(`/api/raffles/${rid}/confirm`, { pendingId, code: codeFor("otto@probe.test") });
  assert.equal(c.status, 201);

  await new Promise((r) => setTimeout(r, 2400)); // let it close by clock

  // NOBODY clicks anything. A plain public page view settles the draw.
  const page = await (await fetch(`${base}/r/${rid}`)).text();
  assert.ok(page.includes("Winning ticket"), "the first view after close settles the draw");

  const j = (await (await fetch(`${base}/api/raffles/${rid}`)).json()) as { raffle: { state: string } };
  assert.equal(j.raffle.state, "drawn");

  const mail = lastMailTo("otto@probe.test");
  assert.ok(mail.includes("won"), "winner emailed automatically, zero human clicks");
});

test("/fair speaks plain words; the tech keeps its receipts one tap deeper", async () => {
  const r = await fetch(`${base}/fair`);
  assert.equal(r.status, 200, "the fairness tour is public");
  const html = await r.text();
  assert.match(html, /pick a friend/i, "leads with the human promise");
  assert.match(html, /sha256/, "the skeptic section keeps the real protocol");

  // The per-raffle surfaces: no compliance poetry, human framing, and
  // the verify page opens with plain words before the math.
  const entry = await (await fetch(`${base}/r/${raffleId}`)).text();
  assert.equal(/provably fair/i.test(entry), false, "entry page dropped the whitepaper voice");
  const verify = await (await fetch(`${base}/r/${raffleId}/verify`)).text();
  assert.match(verify, /plain-words version/i, "verify page links the tour");
  assert.match(verify, /Check this draw/, "verify page leads human");
});
