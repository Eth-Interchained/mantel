/**
 * Giveaway fairness math — held to the "recompute by hand" standard.
 * Determinism, order-independence, no modulo bias, distinct winners,
 * and tamper detection: change any input, the draw changes.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  commitmentOf,
  computeDraw,
  drawSeed,
  pickWinners,
  sha256Hex,
  ticketMerkleRoot,
  winnerIndex,
} from "../src/lib/raffle";

const TICKETS = ["tkt_c3", "tkt_a1", "tkt_b2", "tkt_e5", "tkt_d4"];

test("commitment binds the secret before the first entry", () => {
  const secret = "aa".repeat(32);
  const c = commitmentOf(secret);
  assert.equal(c, commitmentOf(secret), "deterministic");
  assert.notEqual(c, commitmentOf("bb".repeat(32)), "different secret, different commitment");
  assert.equal(c.length, 64, "sha256 hex");
  assert.equal(c.includes(secret.slice(0, 8)), false, "commitment reveals nothing");
});

test("merkle root is a function of the ticket SET, not arrival order", () => {
  const root = ticketMerkleRoot(TICKETS);
  assert.equal(ticketMerkleRoot([...TICKETS].reverse()), root, "order can't change the root");
  assert.equal(ticketMerkleRoot([...TICKETS].sort()), root, "sorted input agrees");
  assert.notEqual(ticketMerkleRoot(TICKETS.slice(0, 4)), root, "removing a ticket changes the root");
  assert.notEqual(ticketMerkleRoot([...TICKETS, "tkt_f6"]), root, "adding a ticket changes the root");
  // Odd and even layer counts both resolve.
  assert.equal(ticketMerkleRoot(["one"]).length, 64);
  assert.equal(ticketMerkleRoot(["a", "b", "c"]).length, 64);
  assert.equal(ticketMerkleRoot([]).length, 64, "empty set has a defined (distinct) root");
});

test("winnerIndex: deterministic, in range, every index reachable", () => {
  const seed = sha256Hex("fixed");
  assert.equal(winnerIndex(seed, 5), winnerIndex(seed, 5), "same seed, same pick");
  // Every index is reachable across rounds — no dead zones.
  const seen = new Set<number>();
  for (let round = 0; round < 200; round++) seen.add(winnerIndex(seed, 5, round));
  assert.equal(seen.size, 5, "all 5 indices hit across 200 rounds");
  for (const i of seen) assert.ok(i >= 0 && i < 5);
  // Rough uniformity: no index dominates (loose bound, deterministic seed).
  const counts = new Array(7).fill(0);
  for (let round = 0; round < 700; round++) counts[winnerIndex(seed, 7, round)]++;
  for (const c of counts) assert.ok(c > 50 && c < 150, `roughly uniform, got ${c}/100 expected`);
  assert.throws(() => winnerIndex(seed, 0), "zero tickets is an error, not a crash-loop");
});

test("pickWinners: distinct winners, deterministic, clamped to pool", () => {
  const seed = sha256Hex("draw-night");
  const w2 = pickWinners(seed, TICKETS, 2);
  assert.equal(new Set(w2).size, 2, "no double win");
  assert.deepEqual(pickWinners(seed, TICKETS, 2), w2, "reproducible");
  assert.deepEqual(pickWinners(seed, [...TICKETS].reverse(), 2), w2, "entry order irrelevant");
  assert.equal(pickWinners(seed, TICKETS, 99).length, TICKETS.length, "can't draw more winners than tickets");
});

test("computeDraw: the golden recompute — tamper with ANY input, the draw changes", () => {
  const secret = sha256Hex("the-secret");
  const beacon = "00000000000000000012ab34cd56ef78";
  const base = computeDraw(secret, beacon, TICKETS, 1);

  assert.deepEqual(computeDraw(secret, beacon, TICKETS, 1), base, "verify page recomputes identically");
  assert.notDeepEqual(computeDraw(sha256Hex("other-secret"), beacon, TICKETS, 1).winners.concat(computeDraw(sha256Hex("other-secret"), beacon, TICKETS, 1).seed), base.winners.concat(base.seed), "secret swap detected");
  assert.notEqual(computeDraw(secret, "different-beacon", TICKETS, 1).seed, base.seed, "beacon swap changes the seed");
  assert.notEqual(computeDraw(secret, beacon, [...TICKETS, "tkt_stuffed"], 1).merkleRoot, base.merkleRoot, "ballot stuffing changes the root");
  assert.equal(drawSeed(secret, beacon, base.merkleRoot), base.seed, "seed formula is exactly as published");
  assert.ok(TICKETS.includes(base.winners[0]), "the winner actually entered");
});
