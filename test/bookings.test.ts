/**
 * Paid 1:1 bookings — live, against the REAL server and nedbd.
 *
 * Bookings reuse the product loop, so the interesting surface is the one
 * genuinely new invariant: EXCLUSIVITY. A slot can be sold once. Getting
 * that wrong means a seller is paid twice to be in one place at one time,
 * and has to disappoint someone who did nothing wrong.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";

process.env.NEDB_DB = `links_book_${Date.now().toString(36)}`;
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
const BLOCK = "blk_book_1";
const SELLER = "seller@book.test";
const MEET = "https://meet.example.com/private-room";
const SLOT_A = "Mon 25 Aug, 6:00 PM";
const SLOT_B = "Tue 26 Aug, 11:00 AM";

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
async function formPost(path: string, fields: Record<string, string>): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}
async function setSlots(slots: string[]): Promise<void> {
  const cur = (await (await fetch(`${base}/api/identities/${identityId}`, { headers: authed(token) })).json()) as {
    manifest: Record<string, unknown>;
  };
  cur.manifest.blocks = [
    {
      id: BLOCK,
      type: "booking",
      order: 0,
      data: {
        title: "1:1 Design Review",
        blurb: "Portfolio teardown",
        price: 1499,
        duration: "45 mins",
        vpa: "seller@okaxis",
        payeeName: "Book Seller",
        slots,
        deliverable: MEET,
      },
    },
  ];
  const r = await fetch(`${base}/api/identities/${identityId}`, {
    method: "PUT",
    headers: authed(token),
    body: JSON.stringify(cur.manifest),
  });
  assert.equal(r.status, 200, "booking block passes server-side schema validation");
  await post(`/api/identities/${identityId}/publish`, {}, token);
}

before(async () => {
  assert.ok(await db.ping(), "nedbd required");
  await ensureDatabase();
  server = createApp().listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
  await post("/api/auth/signup", { email: SELLER, password: "hunter2hunter2" });
  const mail = outbox.filter((m) => m.to === SELLER).at(-1);
  const vt = /token=([a-zA-Z0-9_-]+)/.exec(mail?.text ?? "")?.[1];
  token = ((await (await post("/api/auth/verify-email", { token: vt })).json()) as { token: string }).token;
  const claim = await post("/api/identities", { handle: "book-test", displayName: "Book Seller" }, token);
  identityId = ((await claim.json()) as { manifest: { identityId: string } }).manifest.identityId;
  await setSlots([SLOT_A, SLOT_B]);
});

after(async () => {
  server?.close();
  try {
    await db.dropDatabase();
  } catch {
    /* best-effort */
  }
});

test("the booking page offers every open slot and never leaks the meeting link", async () => {
  const html = await (await fetch(`${base}/buy/${identityId}/${BLOCK}`)).text();
  assert.ok(html.includes(SLOT_A) && html.includes(SLOT_B), "both times are offered");
  assert.ok(html.includes('name="slot"'), "the slot is a real form field");
  assert.ok(html.includes("am=1499.00"), "the UPI intent carries the price");
  assert.equal(html.includes(MEET), false, "the meeting link is not on the buy page");
  assert.equal(/<script/i.test(html), false, "zero-JS");

  // The radios must be INSIDE the form, or picking a time submits nothing.
  const formStart = html.indexOf("<form");
  const formEnd = html.indexOf("</form>");
  assert.ok(formStart >= 0 && formEnd > formStart, "there is a form");
  assert.ok(
    html.slice(formStart, formEnd).includes('name="slot"'),
    "slot radios are inside the form, not decorative",
  );
});

test("a slot can be sold exactly once", async () => {
  const first = await formPost(`/buy/${identityId}/${BLOCK}`, {
    slot: SLOT_A,
    reference: "800000000001",
    email: "first@book.test",
  });
  assert.match(await first.text(), /held|sent/i, "the first buyer gets the slot");

  // Second buyer, same slot, different (valid, unused) reference.
  const second = await formPost(`/buy/${identityId}/${BLOCK}`, {
    slot: SLOT_A,
    reference: "800000000002",
    email: "second@book.test",
  });
  assert.match(await second.text(), /just taken|was just taken/i, "the second is refused");

  const rows = (await (
    await fetch(`${base}/api/identities/${identityId}/purchases`, { headers: authed(token) })
  ).json()) as { purchases: Array<{ slot?: string }> };
  assert.equal(rows.purchases.filter((p) => p.slot === SLOT_A).length, 1, "exactly one claim holds it");
});

test("a taken slot disappears from the page; the rest stay bookable", async () => {
  const html = await (await fetch(`${base}/buy/${identityId}/${BLOCK}`)).text();
  assert.equal(html.includes(SLOT_A), false, "the sold time is gone");
  assert.ok(html.includes(SLOT_B), "the free time remains");
});

test("a slot that was never offered cannot be invented by a hand-crafted POST", async () => {
  const r = await formPost(`/buy/${identityId}/${BLOCK}`, {
    slot: "Sun 3am — whenever I feel like it",
    reference: "800000000003",
    email: "sneaky@book.test",
  });
  assert.match(await r.text(), /just taken|pick a time/i, "refused");
  const rows = (await (
    await fetch(`${base}/api/identities/${identityId}/purchases`, { headers: authed(token) })
  ).json()) as { purchases: Array<{ slot?: string }> };
  assert.equal(rows.purchases.some((p) => p.slot?.includes("whenever")), false, "nothing was recorded");
});

test("confirming a booking sends the meeting link and names the time", async () => {
  const list = (await (
    await fetch(`${base}/api/identities/${identityId}/purchases`, { headers: authed(token) })
  ).json()) as { purchases: Array<{ purchaseId: string; slot?: string; status: string }> };
  const row = list.purchases.find((p) => p.slot === SLOT_A && p.status === "claimed");
  assert.ok(row, "the held claim is pending");

  const before = outbox.length;
  const r = await post(`/api/identities/${identityId}/purchases/${row.purchaseId}/confirm`, {}, token);
  assert.equal(r.status, 200);

  const mail = outbox.slice(before).find((m) => m.to === "first@book.test");
  assert.ok(mail, "the buyer is emailed");
  assert.ok(mail.text.includes(MEET), "with the real meeting link");
  assert.ok(mail.text.includes(SLOT_A), "and the confirmed time in writing");
  assert.match(mail.subject, /booking confirmed/i, "the subject says it's a booking");
});

test("rejecting a booking frees the slot for someone else", async () => {
  await formPost(`/buy/${identityId}/${BLOCK}`, {
    slot: SLOT_B,
    reference: "800000000004",
    email: "flake@book.test",
  });
  let html = await (await fetch(`${base}/buy/${identityId}/${BLOCK}`)).text();
  assert.equal(html.includes(SLOT_B), false, "held while pending");

  const list = (await (
    await fetch(`${base}/api/identities/${identityId}/purchases`, { headers: authed(token) })
  ).json()) as { purchases: Array<{ purchaseId: string; slot?: string; status: string }> };
  const row = list.purchases.find((p) => p.slot === SLOT_B && p.status === "claimed");
  assert.ok(row);
  await post(`/api/identities/${identityId}/purchases/${row.purchaseId}/reject`, {}, token);

  // This is the reversibility that justifies holding on claim: a no-show
  // never permanently burns a sellable hour.
  html = await (await fetch(`${base}/buy/${identityId}/${BLOCK}`)).text();
  assert.ok(html.includes(SLOT_B), "rejecting returns the time to the page");
});

test("when everything is booked, the page says so instead of taking money", async () => {
  await formPost(`/buy/${identityId}/${BLOCK}`, {
    slot: SLOT_B,
    reference: "800000000005",
    email: "last@book.test",
  });
  const html = await (await fetch(`${base}/buy/${identityId}/${BLOCK}`)).text();
  assert.match(html, /fully booked/i, "the buy page refuses rather than dead-ends");
  // Test the actual affordance, not the substring: pageShell's own CSS
  // comments legitimately mention payment links, and matching prose
  // instead of markup is how a green test starts meaning nothing.
  assert.equal(/href="upi:/.test(html), false, "and offers no way to pay for nothing");

  // KNOWN LIMIT, asserted so it stays deliberate: the profile card is
  // still shown. The HTML renderer is synchronous and pure over the
  // manifest — it cannot know which slots have sold without a DB query,
  // and making the hot render path DB-aware to hide one card is a bad
  // trade. The buy page is the backstop, and it refuses cleanly above.
  // If bookings ever get a real calendar, revisit this together.
  const profile = await (await fetch(`${base}/book-test`)).text();
  assert.ok(profile.includes("1:1 Design Review"), "the card still shows — the buy page is the backstop");
});
