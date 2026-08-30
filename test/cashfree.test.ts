/**
 * Cashfree adapter suite — the signature boundary.
 *
 * This is the code that decides whether a stranger's HTTP request is
 * allowed to release a paid product for free. Every assertion here is a
 * lock. If one goes red, the fix is the adapter, never the test.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";

import {
  MAX_SIGNATURE_AGE_MS,
  cashfreeBase,
  parseCashfreeEvent,
  verifyCashfreeWebhook,
} from "../src/server/cashfree";

const SECRET = "whsec_cashfree_test_9fQ2mLp";
const NOW = 1_760_000_000_000; // fixed clock so freshness is deterministic
const TS = String(Math.floor(NOW / 1000));

function sign(body: string, ts = TS, secret = SECRET): string {
  return createHmac("sha256", secret).update(`${ts}${body}`).digest("base64");
}

const BODY = JSON.stringify({
  type: "PAYMENT_SUCCESS_WEBHOOK",
  data: {
    order: { order_id: "pur_abc123", order_amount: 499 },
    payment: { payment_status: "SUCCESS", payment_amount: 499 },
  },
});

test("cashfree: a correctly signed, fresh callback verifies", () => {
  const v = verifyCashfreeWebhook({
    rawBody: BODY,
    timestamp: TS,
    signature: sign(BODY),
    webhookSecret: SECRET,
    now: NOW,
  });
  assert.equal(v.ok, true, v.reason);
});

test("cashfree: the signature covers the timestamp AND the body", () => {
  // Signed with the right secret but a different timestamp than the one
  // presented — this is exactly what a replay with a refreshed header
  // looks like, and it must not pass.
  const otherTs = String(Math.floor(NOW / 1000) - 30);
  assert.equal(
    verifyCashfreeWebhook({
      rawBody: BODY,
      timestamp: TS,
      signature: sign(BODY, otherTs),
      webhookSecret: SECRET,
      now: NOW,
    }).ok,
    false,
    "timestamp is inside the signed payload",
  );

  // Body tampered after signing: amount inflated, everything else intact.
  const tampered = BODY.replace('"payment_amount":499', '"payment_amount":1');
  assert.equal(
    verifyCashfreeWebhook({
      rawBody: tampered,
      timestamp: TS,
      signature: sign(BODY),
      webhookSecret: SECRET,
      now: NOW,
    }).ok,
    false,
    "a modified body invalidates the signature",
  );
});

test("cashfree: a stale callback is refused even when correctly signed", () => {
  const oldTs = String(Math.floor((NOW - MAX_SIGNATURE_AGE_MS - 1000) / 1000));
  const v = verifyCashfreeWebhook({
    rawBody: BODY,
    timestamp: oldTs,
    signature: sign(BODY, oldTs),
    webhookSecret: SECRET,
    now: NOW,
  });
  assert.equal(v.ok, false, "expired signatures don't work forever");
  assert.match(v.reason ?? "", /stale/);

  // Clock skew in the honest direction is tolerated.
  const skew = String(Math.floor((NOW + 60_000) / 1000));
  assert.equal(
    verifyCashfreeWebhook({
      rawBody: BODY,
      timestamp: skew,
      signature: sign(BODY, skew),
      webhookSecret: SECRET,
      now: NOW,
    }).ok,
    true,
    "a minute of skew is not an attack",
  );
});

test("cashfree: verification fails CLOSED on anything missing or malformed", () => {
  const base = { rawBody: BODY, timestamp: TS, signature: sign(BODY), webhookSecret: SECRET, now: NOW };
  const cases: Array<[string, Record<string, unknown>]> = [
    ["no secret configured", { webhookSecret: "" }],
    ["no signature header", { signature: "" }],
    ["no timestamp header", { timestamp: "" }],
    ["empty body", { rawBody: "" }],
    ["non-numeric timestamp", { timestamp: "not-a-number", signature: sign(BODY, "not-a-number") }],
    ["another account's secret", { signature: sign(BODY, TS, "whsec_someone_else") }],
    ["garbage signature", { signature: "!!!!" }],
  ];
  for (const [label, patch] of cases) {
    assert.equal(verifyCashfreeWebhook({ ...base, ...patch } as typeof base).ok, false, label);
  }
});

test("cashfree: only an explicit SUCCESS on a payment event counts as paid", () => {
  const ev = parseCashfreeEvent(BODY);
  assert.ok(ev);
  assert.equal(ev.paid, true);
  assert.equal(ev.orderId, "pur_abc123");
  assert.equal(ev.amount, 499);

  // Everything else is not a payment. Delivering on an optimistic read of
  // a status we didn't recognise is how you give away product for free.
  const notPaid = [
    { type: "PAYMENT_FAILED_WEBHOOK", status: "FAILED" },
    { type: "PAYMENT_USER_DROPPED_WEBHOOK", status: "USER_DROPPED" },
    { type: "PAYMENT_SUCCESS_WEBHOOK", status: "PENDING" },
    { type: "SOME_FUTURE_EVENT", status: "SUCCESS" },
    { type: "", status: "SUCCESS" },
  ];
  for (const c of notPaid) {
    const body = JSON.stringify({
      type: c.type,
      data: {
        order: { order_id: "pur_x", order_amount: 1 },
        payment: { payment_status: c.status, payment_amount: 1 },
      },
    });
    assert.equal(parseCashfreeEvent(body)?.paid, false, `${c.type}/${c.status} is not paid`);
  }
});

test("cashfree: unreadable payloads parse to null rather than a half-event", () => {
  for (const junk of ["", "not json", "{}", '{"type":"PAYMENT_SUCCESS_WEBHOOK"}', "[]"]) {
    assert.equal(parseCashfreeEvent(junk), null, `rejected: ${junk || "(empty)"}`);
  }
});

test("cashfree: TEST credentials route to sandbox, live keys to live", () => {
  assert.ok(cashfreeBase("TEST1234567890").includes("sandbox"), "test keys hit sandbox");
  assert.ok(!cashfreeBase("CF1234567890").includes("sandbox"), "live keys hit live");
});
