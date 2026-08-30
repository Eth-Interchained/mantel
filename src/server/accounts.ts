/**
 * Wallet auth — challenge/response with signed messages.
 *
 *   POST /api/auth/challenge { address }        → { challengeId, nonce, message }
 *   POST /api/auth/verify    { challengeId, address, signature }
 *                                               → { token, address, expiresAt }
 *
 * The client signs exactly the returned `message` (built by
 * buildAuthMessage — human-readable, wallets should show what they
 * sign). Challenges are single-use and expire in five minutes; session
 * tokens live thirty days and are stored HASHED. Both live as engine
 * documents — even authentication carries provenance here.
 */

import { Router } from "express";
import { z } from "zod";

import {
  COLLECTIONS,
  type ChallengeRecord,
} from "../lib/identity";
import {
  buildAuthMessage,
  isItcAddress,
  randomHex32,
  sha256Hex,
  verifyMessage,
} from "../lib/wallet";
import { issueSession } from "./auth";
import { db } from "./db";
import { wrap } from "./util";

export const accounts = Router();

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** POST /api/auth/challenge — start a login. */
accounts.post("/challenge", wrap(async (req, res) => {
  const body = z.object({ address: z.string() }).safeParse(req.body);
  if (!body.success || !isItcAddress(body.data.address)) {
    res.status(400).json({ error: "valid itc1 address required" });
    return;
  }
  const now = Date.now();
  const challenge: ChallengeRecord = {
    challengeId: `chal_${randomHex32().slice(0, 20)}`,
    address: body.data.address,
    nonce: randomHex32(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CHALLENGE_TTL_MS).toISOString(),
  };
  await db.put(
    COLLECTIONS.challenges,
    challenge.challengeId,
    challenge as unknown as Record<string, unknown>,
    { evidence: `auth challenge for ${body.data.address}` },
  );
  res.json({
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    message: buildAuthMessage(challenge.challengeId, challenge.nonce),
    expiresAt: challenge.expiresAt,
  });
}));

/** POST /api/auth/verify — finish a login with a signed message. */
accounts.post("/verify", wrap(async (req, res) => {
  const body = z
    .object({
      challengeId: z.string().min(1).max(60),
      address: z.string(),
      signature: z.string().min(1).max(200),
    })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const { challengeId, address, signature } = body.data;

  const doc = await db.get(COLLECTIONS.challenges, challengeId);
  const challenge = doc as unknown as ChallengeRecord | null;
  if (!challenge) {
    res.status(401).json({ error: "unknown or used challenge" });
    return;
  }
  if (challenge.address !== address) {
    res.status(401).json({ error: "challenge address mismatch" });
    return;
  }
  if (new Date(challenge.expiresAt).getTime() < Date.now()) {
    res.status(401).json({ error: "challenge expired" });
    return;
  }

  const message = buildAuthMessage(challenge.challengeId, challenge.nonce);
  if (!verifyMessage(address, message, signature)) {
    res.status(401).json({ error: "signature verification failed" });
    return;
  }

  // Single-use: tombstone the challenge (history preserved in the DAG).
  await db.delete(COLLECTIONS.challenges, challengeId);

  const session = await issueSession(address);
  res.json({ token: session.token, address, expiresAt: session.expiresAt });
}));

/** POST /api/auth/logout — revoke the presented session. */
accounts.post("/logout", wrap(async (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    await db.delete(COLLECTIONS.sessions, sha256Hex(token)).catch(() => false);
  }
  res.json({ ok: true });
}));
