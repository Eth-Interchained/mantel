/**
 * Feed scoring suite — the ranking math, pure and pinned.
 *
 * The score must reward evidence, not just ratio: one glowing post cannot
 * outrank a real track record. These tests hold that property, which is the
 * whole reason the feed is trustworthy.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { scoreFrom } from "../src/server/feeds";

test("more positive evidence scores higher than a single positive", () => {
  const one = scoreFrom({ positive: 1 });
  const many = scoreFrom({ positive: 20 });
  assert.ok(many.score > one.score, "20 positives beat 1 positive");
  // 1/(1+4)=0.2 ; 20/(20+4)=0.8333
  assert.equal(one.score, 0.2);
  assert.equal(many.score, 0.8333);
});

test("a lone glowing review cannot top a large mostly-positive body", () => {
  const lone = scoreFrom({ positive: 1 }); // 0.2
  const track = scoreFrom({ positive: 18, negative: 2, mixed: 1 }); // (18-2-0.25)/21
  assert.ok(track.score > lone.score, "evidence wins over a single 5-star");
});

test("negatives pull the score down and can go negative", () => {
  const bad = scoreFrom({ negative: 10, positive: 1 });
  assert.ok(bad.score < 0, "a mostly-negative model scores below zero");
});

test("neutral signals count as evidence volume but not sentiment", () => {
  const s = scoreFrom({ positive: 4, neutral: 100 });
  // weighted 4, total 104 -> 4/108, heavily damped by the neutral volume.
  assert.ok(s.score < 0.05, "a wall of neutral drags the score toward zero");
  assert.equal(s.total, 104);
});

test("mixed is a light penalty, lighter than a negative", () => {
  const withMixed = scoreFrom({ positive: 5, mixed: 5 });
  const withNeg = scoreFrom({ positive: 5, negative: 5 });
  assert.ok(withMixed.score > withNeg.score, "mixed hurts less than negative");
});

test("an empty tally scores zero, not NaN", () => {
  const s = scoreFrom({});
  assert.equal(s.score, 0);
  assert.equal(s.total, 0);
});

test("total counts every signal regardless of sentiment", () => {
  const s = scoreFrom({ positive: 3, negative: 2, mixed: 1, neutral: 4 });
  assert.equal(s.total, 10);
});
