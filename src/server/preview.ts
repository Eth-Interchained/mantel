/**
 * Live preview — the REAL renderer over an UNSAVED manifest.
 *
 * The editor posts its draft here and gets back exactly the HTML the
 * public page will serve. No client-side replica of the renderer, no
 * drift between preview and truth: renderers are pure functions of the
 * manifest, so previewing is just calling one.
 */

import { Router } from "express";
import { z } from "zod";

import { backgroundSchema } from "../lib/background";
import {
  FONT_IDS,
  SCHEMA_VERSION,
  type Block,
  type IdentityManifest,
} from "../lib/identity";
import { manifestCapabilities } from "../lib/registry";
import { renderProfileHtml } from "../lib/renderers/html";
import { requireUser } from "./auth";
import { config } from "./config";
import { wrap } from "./util";

export const preview = Router();

const previewSchema = z.object({
  identityId: z.string().min(1).max(60),
  identityType: z
    .enum(["personal", "business", "organization", "project", "event", "demo"])
    .default("personal"),
  handle: z.string().min(1).max(60),
  displayName: z.string().min(1).max(120),
  bio: z.string().max(600).optional(),
  avatar: z.string().max(200_000).optional(),
  theme: z.string().max(40).optional(),
  themeCustom: z
    .object({
      bg: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      card: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      text: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      sub: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      headingFont: z.enum(FONT_IDS).optional(),
      bodyFont: z.enum(FONT_IDS).optional(),
    })
    .optional(),
  background: backgroundSchema.optional(),
  blocks: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        type: z.string().min(1).max(40),
        order: z.number().int().min(0),
        data: z.record(z.unknown()),
      }),
    )
    .max(200)
    .default([]),
});

/** POST /api/preview — draft manifest in, real profile HTML out. */
preview.post("/", requireUser, wrap(async (req, res) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid manifest" });
    return;
  }
  const d = parsed.data;
  const now = new Date().toISOString();
  const manifest: IdentityManifest = {
    schemaVersion: SCHEMA_VERSION,
    identityId: d.identityId,
    identityType: d.identityType,
    owner: "admin",
    handle: d.handle,
    displayName: d.displayName,
    bio: d.bio,
    avatar: d.avatar,
    theme: d.theme ?? "pro",
    themeCustom: d.themeCustom,
    background: d.background,
    blocks: d.blocks as Block[],
    capabilities: manifestCapabilities(d.blocks as Block[]),
    renderers: [],
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
  const origin =
    config.publicOrigin || `${req.protocol}://${req.get("host") ?? "localhost"}`;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(renderProfileHtml(manifest, { origin, brand: config.brandName, brandLogo: config.brandLogoUrl || undefined, favicon: config.faviconUrl || undefined, holoColors: config.holoColors.length ? config.holoColors : undefined }));
}));
