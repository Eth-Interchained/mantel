/**
 * Giveaway fairness — the math that makes "provably fair" a checkable
 * claim instead of a vibe. Server-side only (node:crypto).
 *
 * The protocol:
 *   1. CREATE  — server generates secret S, publishes commit = sha256(S)
 *                as a hash-chained engine write. The commitment exists
 *                before the first entry, timestamped by seq.
 *   2. ENTER   — confirmed entries append to raffle_entries; each gets
 *                a random public ticket id. PII never leaves the server;
 *                tickets are the public face.
 *   3. CLOSE   — entries stop at closesAt (validated, not flipped).
 *   4. DRAW    — seed = sha256(S ‖ beacon ‖ merkle(sorted tickets)).
 *                The beacon is an ITC block hash from AFTER close —
 *                public randomness nobody (including us) controlled at
 *                commit time. Winners by rejection sampling: no modulo
 *                bias, however many tickets there are.
 *   5. VERIFY  — S is revealed; anyone recomputes every step by hand.
 *
 * Every function here is deterministic and pure so the verify page,
 * the draw endpoint, and the tests can never disagree.
 */

import { createHash } from "node:crypto";

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The published commitment for a secret. */
export function commitmentOf(secretHex: string): string {
  return sha256Hex(`nedb-links-giveaway-v1:${secretHex}`);
}

/**
 * Merkle root over ticket ids. Tickets are SORTED first so the root is
 * a function of the SET — the order entries landed can't change it.
 * Odd layers carry the last node up unpaired (documented, verifiable).
 */
export function ticketMerkleRoot(ticketIds: readonly string[]): string {
  if (ticketIds.length === 0) return sha256Hex("nedb-links-giveaway-v1:empty");
  let layer = [...ticketIds].sort().map((t) => sha256Hex(`leaf:${t}`));
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(i + 1 < layer.length ? sha256Hex(`node:${layer[i]}:${layer[i + 1]}`) : layer[i]);
    }
    layer = next;
  }
  return layer[0];
}

/** The draw seed: secret ‖ beacon ‖ entry-set root, all committed. */
export function drawSeed(secretHex: string, beacon: string, merkleRoot: string): string {
  return sha256Hex(`draw:${secretHex}:${beacon}:${merkleRoot}`);
}

/**
 * Uniform index in [0, n) from a seed — rejection sampling over 64-bit
 * draws, so no modulo bias at any n. Deterministic: the counter walks
 * until a draw lands under the largest multiple of n that fits.
 */
export function winnerIndex(seedHex: string, n: number, round = 0): number {
  if (n <= 0) throw new Error("no tickets to draw from");
  const limit = (2n ** 64n / BigInt(n)) * BigInt(n); // rejection threshold
  for (let counter = 0; ; counter++) {
    const h = sha256Hex(`pick:${seedHex}:${round}:${counter}`);
    const v = BigInt(`0x${h.slice(0, 16)}`); // first 8 bytes as uint64
    if (v < limit) return Number(v % BigInt(n));
  }
}

/**
 * Draw `count` DISTINCT winners: each round removes the picked ticket
 * from the pool, so one person can't win twice with one ticket.
 */
export function pickWinners(
  seedHex: string,
  ticketIds: readonly string[],
  count: number,
): string[] {
  const pool = [...ticketIds].sort();
  const winners: string[] = [];
  const rounds = Math.min(count, pool.length);
  for (let round = 0; round < rounds; round++) {
    const idx = winnerIndex(seedHex, pool.length, round);
    winners.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return winners;
}

/** The whole draw, one call — what the endpoint runs and the verify
 *  page re-runs. If these ever disagree, the math was tampered with. */
export function computeDraw(
  secretHex: string,
  beacon: string,
  ticketIds: readonly string[],
  winnerCount: number,
): { merkleRoot: string; seed: string; winners: string[] } {
  const merkleRoot = ticketMerkleRoot(ticketIds);
  const seed = drawSeed(secretHex, beacon, merkleRoot);
  return { merkleRoot, seed, winners: pickWinners(seed, ticketIds, winnerCount) };
}
