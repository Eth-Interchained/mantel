/**
 * Identity + handle API. Thin routes: validate, then let the engine be
 * the source of truth. Every mutation chains caused_by provenance, so
 * TRACE reconstructs an identity's full edit history and AS OF replays
 * any moment of it.
 */

import { Router } from "express";
import { z } from "zod";

import {
  COLLECTIONS,
  FONT_IDS,
  HEX_COLOR_RE,
  isPremiumFont,
  isValidHandle,
  newIdentityId,
  SCHEMA_VERSION,
  type Block,
  type HandleRecord,
  type IdentityManifest,
} from "../lib/identity";
import { backgroundSchema } from "../lib/background";
import { getBlock, getTemplate, manifestCapabilities } from "../lib/registry";
import "../lib/blocks/builtin";
import "../lib/templates/builtin";
import { maybeSendPublishedEmail } from "./accounts-email";
import { authOf, requireUser, type AuthContext } from "./auth";
import { pageUnlimited, unlimitedStatus } from "./billing";
import { createRaffleForBlock, getRaffle } from "./raffles";
import { canClaimAnother } from "./billing";
import { getGrant, grantsOf, hasRole, writeOwnerGrant } from "./grants";
import { wrap } from "./util";
import { causalParent, db } from "./db";
import { config } from "./config";

export const identities = Router();
export const handles = Router();

// ── Validation ───────────────────────────────────────────────────────────────

const blockSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.string().min(1).max(40),
  order: z.number().int().min(0),
  data: z.record(z.unknown()),
});

const hexColor = z.string().regex(HEX_COLOR_RE, "colors must be #rrggbb");

const manifestPatchSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  bio: z.string().max(600).optional(),
  avatar: z.string().max(200_000).optional(),
  theme: z.string().max(40).optional(),
  themeCustom: z
    .object({
      bg: hexColor,
      card: hexColor,
      text: hexColor,
      sub: hexColor,
      accent: hexColor,
      headingFont: z.enum(FONT_IDS).optional(),
      bodyFont: z.enum(FONT_IDS).optional(),
    })
    .nullish(),
  // Hex-validated stops + enum direction only — user strings never reach CSS.
  background: backgroundSchema.nullish(),
  // Opt-in Discover listing — a boolean, owner-controlled, never implied.
  discoverable: z.boolean().optional(),
  // Custom search & sharing (premium). Length caps are the spam fence:
  // what engines display is all anyone gets to write.
  seo: z
    .object({
      title: z.string().max(70).optional(),
      description: z.string().max(160).optional(),
      image: z
        .string()
        .max(500)
        .regex(/^https:\/\//, "share images must be https URLs")
        .optional()
        .or(z.literal("")),
    })
    .nullish(),
  // Refile the page after claim — Discover made this field load-bearing.
  // Same enum as claim; the editor UI offers the five real ones.
  identityType: z
    .enum(["personal", "business", "organization", "project", "event", "demo"])
    .optional(),
  blocks: z.array(blockSchema).max(200).optional(),
});

/** Validate each block's payload against its registered definition. */
function validateBlocks(blocks: Block[]): string | null {
  for (const b of blocks) {
    const def = getBlock(b.type);
    if (!def) return `unknown block type: ${b.type}`;
    const result = def.schema.safeParse(b.data);
    if (!result.success) {
      return `block ${b.id} (${b.type}): ${result.error.issues[0]?.message ?? "invalid"}`;
    }
  }
  return null;
}

async function getHandleRecord(handle: string): Promise<HandleRecord | null> {
  const doc = await db.get(COLLECTIONS.handles, handle);
  return doc ? (doc as unknown as HandleRecord) : null;
}

export async function resolveHandle(
  handle: string,
): Promise<{ record: HandleRecord; redirected: boolean } | null> {
  const record = await getHandleRecord(handle);
  if (!record) return null;
  if (record.status === "redirect" && record.redirectTo) {
    const target = await getHandleRecord(record.redirectTo);
    if (target) return { record: target, redirected: true };
    return null;
  }
  return { record, redirected: false };
}

export async function getManifest(
  identityId: string,
): Promise<IdentityManifest | null> {
  const doc = await db.get(COLLECTIONS.identities, identityId);
  return doc ? (doc as unknown as IdentityManifest) : null;
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/handles/:handle/availability — the claim experience begins here. */
handles.get("/:handle/availability", wrap(async (req, res) => {
  const handle = String(req.params.handle).toLowerCase();
  if (!isValidHandle(handle)) {
    res.json({ handle, available: false, reason: "invalid" });
    return;
  }
  const existing = await getHandleRecord(handle);
  res.json({ handle, available: !existing });
}));

/** POST /api/identities — claim a handle, seed from a template, own it. */
identities.post("/", requireUser, wrap(async (req, res) => {
  const auth = authOf(res);
  if (!auth) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const body = z
    .object({
      handle: z.string(),
      displayName: z.string().min(1).max(120),
      template: z.string().max(40).optional(),
      identityType: z
        .enum(["personal", "business", "organization", "project", "event", "demo"])
        .optional(),
    })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "invalid body" });
    return;
  }

  const handle = body.data.handle.toLowerCase();
  if (!isValidHandle(handle)) {
    res.status(400).json({ error: "invalid handle" });
    return;
  }
  if (await getHandleRecord(handle)) {
    res.status(409).json({ error: "handle taken" });
    return;
  }

  // The claim gate: free tier is one profile; unlimited via a one-time
  // pay-what-you-want or by holding ITC on the account address.
  const gate = await canClaimAnother(auth);
  if (!gate.ok) {
    if (gate.reason === "premium_limit") {
      res.status(402).json({
        error: `Premium covers ${config.premiumProfileLimit} profiles — need more? Talk to us and we'll sort you out.`,
        code: "premium_limit",
      });
      return;
    }
    res.status(402).json({ error: "free plan includes one profile", code: "upgrade_required" });
    return;
  }

  const identityId = newIdentityId();
  const now = new Date().toISOString();

  const template = body.data.template ? getTemplate(body.data.template) : undefined;
  const seeded = template
    ? template.seed({ handle, displayName: body.data.displayName })
    : { blocks: [] as Block[], identityType: body.data.identityType ?? ("personal" as const) };
  // Free tier + limits on: templates may seed more blocks than the cap
  // allows — slice at claim so the first save doesn't instantly gate.
  if (config.limitEnabled && seeded.blocks.length > config.freeBlockLimit) {
    const status = await unlimitedStatus(auth);
    if (!status.unlimited) {
      seeded.blocks = seeded.blocks
        .slice(0, config.freeBlockLimit)
        .map((b, i) => ({ ...b, order: i }));
    }
  }

  const manifest: IdentityManifest = {
    schemaVersion: SCHEMA_VERSION,
    identityId,
    identityType: seeded.identityType,
    owner: auth.address,
    handle,
    displayName: body.data.displayName,
    bio: seeded.bio,
    template: template?.id,
    theme: seeded.theme ?? "pro",
    blocks: seeded.blocks,
    capabilities: manifestCapabilities(seeded.blocks),
    renderers: [],
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };

  // Claim = write the handle mapping, then the identity, then VERIFY the
  // claim by reading the mapping back. Two concurrent claimers can both
  // pass the availability check; the read-back tells the loser the truth.
  const handleRecord: HandleRecord = {
    handle,
    identityId,
    status: "active",
    claimedAt: now,
  };
  await db.put(COLLECTIONS.handles, handle, handleRecord as unknown as Record<string, unknown>, {
    idem: `claim:${handle}:${identityId}`,
    evidence: `handle claim: ${handle}`,
  });

  const readBack = await getHandleRecord(handle);
  if (!readBack || readBack.identityId !== identityId) {
    res.status(409).json({ error: "handle taken" });
    return;
  }

  const put = await db.put(
    COLLECTIONS.identities,
    identityId,
    manifest as unknown as Record<string, unknown>,
    { evidence: `identity created for handle ${handle}` },
  );

  // Ownership grant — the root of this identity's authority chain.
  await writeOwnerGrant(identityId, auth.address, `claim of ${handle}`);

  // Respond with the manifest THIS server constructed — never the engine's
  // put echo, whose shape can vary across nedbd versions. The API response
  // is our contract. (Found live by Mark: an older daemon's echo lacked
  // identityId/handle, rendering an empty claim card.)
  res.status(201).json({ manifest, seq: put.seq, head: put.head });
}));

/** Every manifest this principal can see, newest first — the operator
 *  sees the whole instance, everyone else their grant set. Shared by
 *  the identities list and the analytics account rollup, so "what's
 *  mine" can never mean two different things. */
export async function listVisibleManifests(auth: AuthContext): Promise<IdentityManifest[]> {
  if (auth.isOperator) {
    const rows = await db.query(
      `FROM ${COLLECTIONS.identities} ORDER BY updatedAt DESC LIMIT 500`,
    );
    return rows as unknown as IdentityManifest[];
  }
  const mine = await grantsOf(auth.address);
  const loaded = await Promise.all(mine.map((g) => getManifest(g.identityId)));
  return loaded
    .filter((m): m is IdentityManifest => m !== null)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** GET /api/identities — every identity this instance owns, newest first.
 *  Summaries only; the editor loads full manifests by id. */
identities.get("/", requireUser, wrap(async (_req, res) => {
  const auth = authOf(res);
  if (!auth) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const manifests = await listVisibleManifests(auth);
  const list = manifests.map((m) => ({
    identityId: m.identityId,
    handle: m.handle,
    displayName: m.displayName,
    identityType: m.identityType,
    template: m.template,
    theme: m.theme,
    status: m.status,
    blockCount: Array.isArray(m.blocks) ? m.blocks.length : 0,
    publishedAt: m.publishedAt,
    updatedAt: m.updatedAt,
  }));
  res.json({ identities: list });
}));

/** GET /api/identities/:id — the manifest, straight from the engine.
 *  Carries yourRole so the editor can render EXACTLY the powers the
 *  caller holds — viewers get a read-only cockpit, not a Save button
 *  that lies (Mark's catch, 7/9). */
identities.get("/:id", requireUser, wrap(async (req, res) => {
  const identityId = String(req.params.id);
  const auth = authOf(res);
  if (!auth || !(await hasRole(identityId, auth, "viewer"))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const manifest = await getManifest(identityId);
  if (!manifest) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const grant = auth.isOperator ? null : await getGrant(identityId, auth.address);
  res.json({
    manifest,
    yourRole: auth.isOperator ? "owner" : (grant?.role ?? "viewer"),
    // Feature walls in the editor follow the PAGE's entitlement, not
    // the caller's — a free editor on a premium page edits unwalled.
    pagePremium: await pageUnlimited(identityId),
  });
}));

/** PUT /api/identities/:id — save the manifest (draft edits).
 *  Full-manifest replacement with caused_by chaining to the prior version. */
identities.put("/:id", requireUser, wrap(async (req, res) => {
  const identityId = String(req.params.id);
  const auth = authOf(res);
  if (!auth || !(await hasRole(identityId, auth, "editor"))) {
    res.status(403).json({ error: "editor role required" });
    return;
  }
  const current = await getManifest(identityId);
  if (!current) {
    res.status(404).json({ error: "not found" });
    return;
  }

  const patch = manifestPatchSchema.safeParse(req.body);
  if (!patch.success) {
    res.status(400).json({ error: patch.error.issues[0]?.message ?? "invalid body" });
    return;
  }

  const blocks = (patch.data.blocks ?? current.blocks) as Block[];
  const blockError = validateBlocks(blocks);
  if (blockError) {
    res.status(400).json({ error: blockError });
    return;
  }

  // ── Premium gates (enforced only when limits are on — dev/self-host
  //    instances run unlimited, same contract as claim limits) ──────────
  const newGiveaways = blocks.filter(
    (b) => b.type === "giveaway" && !(b.data as { raffleId?: string }).raffleId,
  );
  const flippingDiscoverOn = patch.data.discoverable === true && current.discoverable !== true;
  // Galleries are premium (Marisa's unlock, 7/9): gate the block's
  // presence — premium is one-time-forever, so no grandfather cases.
  const hasGallery = blocks.some((b) => b.type === "gallery");
  // Custom search & sharing is premium: gate non-empty CONTENT (clearing
  // fields back to automatic is always free — walls never trap).
  const wantsSeo = Boolean(
    patch.data.seo &&
      Object.values(patch.data.seo).some((v) => typeof v === "string" && v.trim()),
  );
  // The block cap: free pages hold freeBlockLimit blocks TOTAL (all
  // types — Mark's call), no grandfathering. Public pages keep
  // rendering whatever exists; only SAVES gate.
  const overBlockCap = config.limitEnabled && blocks.length > config.freeBlockLimit;
  // Premium fonts: gate only NEW picks — anyone already using a font keeps
  // it (grandfathered), so tier changes never break a published page.
  const wantsPremiumFont = Boolean(
    patch.data.themeCustom &&
      (["headingFont", "bodyFont"] as const).some((k) => {
        const next = patch.data.themeCustom?.[k];
        return next && isPremiumFont(next) && next !== current.themeCustom?.[k];
      }),
  );
  if (newGiveaways.length > 0 || flippingDiscoverOn || wantsPremiumFont || hasGallery || wantsSeo || overBlockCap) {
    // Entitlements attach to the PAGE (its owners), not the actor: a
    // free editor on a premium page uses the page's powers; a premium
    // editor can't smuggle features onto a free page (Mark, 7/9).
    const unlimited = auth.isOperator || (await pageUnlimited(identityId));
    if (!unlimited) {
      res.status(403).json({
        error: newGiveaways.length
          ? "giveaways are a premium feature — upgrade to host one"
          : flippingDiscoverOn
            ? "Discover listing is a premium feature — upgrade to be found"
            : wantsPremiumFont
              ? "that font is a premium unlock — upgrade to use the full vault"
              : hasGallery
                ? "the gallery is a premium unlock — go Premium to show your work"
                : wantsSeo
                  ? "custom search & sharing is a premium unlock — go Premium to own your snippet"
                  : `free pages hold ${config.freeBlockLimit} blocks — go Premium to keep building`,
        code: "premium_required",
      });
      return;
    }
  }

  // ── Giveaway blocks: mint the raffle (and its commitment) on first
  //    save; verify ownership on every save — a raffleId from someone
  //    else's giveaway can't be pasted into your page. ────────────────
  for (const b of blocks) {
    if (b.type !== "giveaway") continue;
    const d = b.data as { raffleId?: string; prize: string; description?: string; closesAt: string; winners?: number };
    if (!d.raffleId) {
      const raffle = await createRaffleForBlock(
        { identityId: current.identityId, handle: current.handle },
        d,
      );
      d.raffleId = raffle.raffleId;
    } else {
      const raffle = await getRaffle(d.raffleId);
      if (!raffle || raffle.identityId !== current.identityId) {
        res.status(400).json({ error: `block ${b.id}: that giveaway belongs to another page` });
        return;
      }
    }
  }

  const next: IdentityManifest = {
    ...current,
    ...patch.data,
    // Explicit null clears the custom palette back to the named theme.
    themeCustom:
      patch.data.themeCustom === null
        ? undefined
        : patch.data.themeCustom ?? current.themeCustom,
    // Same contract for the background: null = back to the theme's canvas.
    background:
      patch.data.background === null
        ? undefined
        : patch.data.background ?? current.background,
    // And for search & sharing: null = back to automatic (displayName/bio).
    seo: patch.data.seo === null ? undefined : patch.data.seo ?? current.seo,
    blocks,
    capabilities: manifestCapabilities(blocks),
    updatedAt: new Date().toISOString(),
  };

  const put = await db.put(
    COLLECTIONS.identities,
    identityId,
    next as unknown as Record<string, unknown>,
    {
      causedBy: causalParent(current as unknown as Record<string, unknown>),
      evidence: "manifest edit",
    },
  );
  res.json({ manifest: next, seq: put.seq, head: put.head });
}));

/** POST /api/identities/:id/publish — flip draft to published.
 *  TRACE from this write walks the exact edits that went into it. */
identities.post("/:id/publish", requireUser, wrap(async (req, res) => {
  const identityId = String(req.params.id);
  const auth = authOf(res);
  if (!auth || !(await hasRole(identityId, auth, "editor"))) {
    res.status(403).json({ error: "editor role required" });
    return;
  }
  const current = await getManifest(identityId);
  if (!current) {
    res.status(404).json({ error: "not found" });
    return;
  }

  const now = new Date().toISOString();
  const next: IdentityManifest = {
    ...current,
    status: "published",
    publishedAt: now,
    updatedAt: now,
  };
  const put = await db.put(
    COLLECTIONS.identities,
    identityId,
    next as unknown as Record<string, unknown>,
    {
      causedBy: causalParent(current as unknown as Record<string, unknown>),
      evidence: `publish: ${current.handle}`,
    },
  );
  // Email mode: "@handle is live" with the print-grade QR inlined.
  // Fire-and-forget by contract — a receipt never blocks a publish.
  maybeSendPublishedEmail(next, auth.address);
  res.json({ manifest: next, seq: put.seq, head: put.head });
}));
