/**
 * RBAC, blockchain-simple: access is shared by address.
 *
 * A grant is a document (id `${identityId}:${address}`) whose caused_by
 * chains to the GRANTER's own grant — TRACE walks the authority chain:
 * who granted whom, caused by whose authority, back to the claim. Access
 * control with cryptographic provenance.
 *
 *   GET    /api/identities/:id/grants            (viewer+)
 *   POST   /api/identities/:id/grants            (owner)   { address, role }
 *   DELETE /api/identities/:id/grants/:address   (owner; last owner is immovable)
 */

import { Router } from "express";
import { z } from "zod";

import {
  COLLECTIONS,
  roleRank,
  ROLES,
  type GrantRecord,
  type Role,
} from "../lib/identity";
import { isItcAddress } from "../lib/wallet";
import { emailPrincipal, normalizeEmail } from "./accounts-email";
import { authOf, requireUser, type AuthContext } from "./auth";
import { pageUnlimited } from "./billing";
import { config } from "./config";
import { causalParent, db } from "./db";
import { grantInviteEmail } from "./emails";
import { sendMail } from "./mailer";
import { wrap } from "./util";

export const grants = Router({ mergeParams: true });

export function grantId(identityId: string, address: string): string {
  return `${identityId}:${address}`;
}

export async function getGrant(
  identityId: string,
  address: string,
): Promise<(GrantRecord & Record<string, unknown>) | null> {
  const doc = await db.get(COLLECTIONS.grants, grantId(identityId, address));
  return (doc as (GrantRecord & Record<string, unknown>) | null) ?? null;
}

export async function grantsFor(identityId: string): Promise<GrantRecord[]> {
  const rows = await db.query(
    `FROM ${COLLECTIONS.grants} WHERE identityId = "${identityId}" LIMIT 500`,
  );
  return rows as unknown as GrantRecord[];
}

export async function grantsOf(address: string): Promise<GrantRecord[]> {
  const rows = await db.query(
    `FROM ${COLLECTIONS.grants} WHERE address = "${address}" LIMIT 500`,
  );
  return rows as unknown as GrantRecord[];
}

/** Does the caller hold at least `min` on this identity? Operator bypasses. */
export async function hasRole(
  identityId: string,
  auth: AuthContext,
  min: Role,
): Promise<boolean> {
  if (auth.isOperator) return true;
  const grant = await getGrant(identityId, auth.address);
  if (!grant) return false;
  return roleRank(grant.role) >= roleRank(min);
}

/** Write the initial owner grant at claim time. */
export async function writeOwnerGrant(
  identityId: string,
  address: string,
  evidence: string,
): Promise<void> {
  const record: GrantRecord = {
    identityId,
    address,
    role: "owner",
    grantedBy: address,
    createdAt: new Date().toISOString(),
  };
  await db.put(
    COLLECTIONS.grants,
    grantId(identityId, address),
    record as unknown as Record<string, unknown>,
    { evidence },
  );
}

// ── Routes (mounted at /api/identities/:id/grants) ──────────────────────────

grants.get("/", requireUser, wrap(async (req, res) => {
  const identityId = String((req.params as Record<string, string>).id);
  const auth = authOf(res);
  if (!auth || !(await hasRole(identityId, auth, "viewer"))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  res.json({ grants: await grantsFor(identityId) });
}));

grants.post("/", requireUser, wrap(async (req, res) => {
  const identityId = String((req.params as Record<string, string>).id);
  const auth = authOf(res);
  if (!auth || !(await hasRole(identityId, auth, "owner"))) {
    res.status(403).json({ error: "owner role required" });
    return;
  }
  // Sharing access is a premium feature OF THE PAGE (Mark, 7/9).
  // Being shared-to costs nothing; revoking is always free — walls
  // never trap people in a shared state.
  if (config.limitEnabled && !auth.isOperator && !(await pageUnlimited(identityId))) {
    res.status(403).json({
      error: "sharing access is a premium unlock — go Premium to invite your team",
      code: "premium_required",
    });
    return;
  }
  // The share handle matches the product: wallet mode grants by itc1…
  // address; email mode grants by email (like sharing a doc). Both
  // resolve to an opaque principal — RBAC below is identical.
  const body = z
    .object({
      address: z.string().optional(),
      email: z.string().trim().toLowerCase().email().max(254).optional(),
      role: z.enum(ROLES),
    })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "valid share target and role required" });
    return;
  }
  let grantee: string;
  let granteeEmail: string | undefined;
  if (config.authMode === "email") {
    if (!body.data.email) {
      res.status(400).json({ error: "an email address to share with is required" });
      return;
    }
    granteeEmail = normalizeEmail(body.data.email);
    grantee = emailPrincipal(granteeEmail);
  } else {
    if (!body.data.address || !isItcAddress(body.data.address)) {
      res.status(400).json({ error: "valid itc1 address and role required" });
      return;
    }
    grantee = body.data.address;
  }

  // Authority chain: the new grant is CAUSED BY the granter's grant.
  const granterGrant = auth.isOperator
    ? null
    : await getGrant(identityId, auth.address);

  const record: GrantRecord = {
    identityId,
    address: grantee,
    role: body.data.role,
    grantedBy: auth.address,
    createdAt: new Date().toISOString(),
    ...(granteeEmail ? { email: granteeEmail } : {}),
  };
  const put = await db.put(
    COLLECTIONS.grants,
    grantId(identityId, grantee),
    record as unknown as Record<string, unknown>,
    {
      causedBy: causalParent(granterGrant),
      evidence: `grant ${body.data.role} by ${auth.address}`,
    },
  );

  // "Hey {role}, welcome to {page}" — the share lands in their inbox
  // (Mark's ask, 7/9). Fire-and-forget by contract: mail trouble never
  // breaks a grant. Direct doc read, not getManifest — grants.ts can't
  // import identities.ts (it imports us).
  if (granteeEmail) {
    const m = (await db.get(COLLECTIONS.identities, identityId)) as {
      displayName?: string;
      handle?: string;
    } | null;
    sendMail(
      grantInviteEmail({
        to: granteeEmail,
        role: body.data.role,
        displayName: m?.displayName || "a page",
        handle: m?.handle || "",
        editUrl: `${config.publicOrigin || ""}/edit/${identityId}`,
      }),
    ).catch(() => undefined);
  }

  res.status(201).json({ grant: record, seq: put.seq, head: put.head });
}));

grants.delete("/:address", requireUser, wrap(async (req, res) => {
  const identityId = String((req.params as Record<string, string>).id);
  const address = String(req.params.address);
  const auth = authOf(res);
  if (!auth || !(await hasRole(identityId, auth, "owner"))) {
    res.status(403).json({ error: "owner role required" });
    return;
  }

  const target = await getGrant(identityId, address);
  if (!target) {
    res.status(404).json({ error: "no such grant" });
    return;
  }
  if (target.role === "owner") {
    const owners = (await grantsFor(identityId)).filter((g) => g.role === "owner");
    if (owners.length <= 1) {
      res.status(400).json({ error: "cannot remove the last owner" });
      return;
    }
  }
  await db.delete(COLLECTIONS.grants, grantId(identityId, address));
  res.json({ ok: true });
}));
