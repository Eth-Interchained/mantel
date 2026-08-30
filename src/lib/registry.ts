/**
 * The NEDB Links framework: three registries, three define APIs.
 *
 * The Extension Promise: if we can build it, you can build it.
 * Every built-in block, template, and renderer in this repo registers
 * through these exact functions — there is no private back door.
 *
 *   defineBlock()    — a block type: schema, capabilities, defaults.
 *   defineTemplate() — a who-are-you vertical that seeds a complete identity.
 *   defineRenderer() — a surface: HTML page, business card, QR payload,
 *                      vCard, JSON, PDF, email signature, whatever's next.
 *
 * Renderers are equal citizens. The HTML profile page enjoys no special
 * treatment — it is registry entry number one, nothing more.
 */

import type { z } from "zod";
import type { Block, Capability, IdentityManifest } from "./identity";

// ── Blocks ───────────────────────────────────────────────────────────────────

export interface BlockDefinition {
  /** Unique block type id: "link", "header", "social", "embed", ... */
  type: string;
  name: string;
  description: string;
  /** Capabilities this block advertises. Renderers reason on these
   *  generically ("give me every printable block") instead of guessing. */
  capabilities: Capability[];
  /** Zod schema validating the block's data payload. */
  schema: z.ZodType<Record<string, unknown>>;
  /** Fresh default payload for the editor's add-block action. */
  defaults: () => Record<string, unknown>;
}

const blocks = new Map<string, BlockDefinition>();

export function defineBlock(def: BlockDefinition): BlockDefinition {
  if (blocks.has(def.type)) {
    throw new Error(`Block type already registered: ${def.type}`);
  }
  blocks.set(def.type, def);
  return def;
}

export function getBlock(type: string): BlockDefinition | undefined {
  return blocks.get(type);
}

export function listBlocks(): BlockDefinition[] {
  return [...blocks.values()];
}

// ── Templates ────────────────────────────────────────────────────────────────

export interface TemplateSeedInput {
  handle: string;
  displayName: string;
}

export interface TemplateDefinition {
  /** Unique template id: "creator", "salon", "restaurant", ... */
  id: string;
  name: string;
  /** Who-are-you vertical shown at onboarding. */
  vertical: string;
  description: string;
  /** Produce the seeded portion of a manifest: blocks, theme, bio, type. */
  seed: (
    input: TemplateSeedInput,
  ) => Pick<IdentityManifest, "blocks" | "identityType"> &
    Partial<Pick<IdentityManifest, "bio" | "theme">>;
}

const templates = new Map<string, TemplateDefinition>();

export function defineTemplate(def: TemplateDefinition): TemplateDefinition {
  if (templates.has(def.id)) {
    throw new Error(`Template already registered: ${def.id}`);
  }
  templates.set(def.id, def);
  return def;
}

export function getTemplate(id: string): TemplateDefinition | undefined {
  return templates.get(id);
}

export function listTemplates(): TemplateDefinition[] {
  return [...templates.values()];
}

// ── Renderers ────────────────────────────────────────────────────────────────

export interface RenderContext {
  /** Absolute origin of this deployment, e.g. https://links.example.com */
  origin: string;
  /** Deployment wordmark for public surfaces (default "NEDB Links"). */
  brand?: string;
  /** Deployment logo/favicon URLs — per-storefront identity on public pages. */
  brandLogo?: string;
  favicon?: string;
  /** Holographic ring stops for giveaway surfaces (validated hex). */
  holoColors?: string[];
  /** Extra renderer-specific options (query params, print hints, ...). */
  options?: Record<string, unknown>;
}

export interface RenderOutput {
  /** MIME type of the body: text/html, image/svg+xml, text/vcard, ... */
  contentType: string;
  body: string | Uint8Array;
  /** Suggested download filename, when the surface is a file. */
  filename?: string;
}

export interface RendererDefinition {
  /** Unique renderer id: "html", "card", "qr", "vcard", "json", ... */
  id: string;
  name: string;
  description: string;
  /** Which capabilities this renderer consumes (documentation + tooling). */
  consumes: Capability[];
  render: (
    manifest: IdentityManifest,
    ctx: RenderContext,
  ) => Promise<RenderOutput> | RenderOutput;
}

const renderers = new Map<string, RendererDefinition>();

export function defineRenderer(def: RendererDefinition): RendererDefinition {
  if (renderers.has(def.id)) {
    throw new Error(`Renderer already registered: ${def.id}`);
  }
  renderers.set(def.id, def);
  return def;
}

export function getRenderer(id: string): RendererDefinition | undefined {
  return renderers.get(id);
}

export function listRenderers(): RendererDefinition[] {
  return [...renderers.values()];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Aggregate the capability set a manifest's blocks advertise. */
export function manifestCapabilities(manifestBlocks: Block[]): Capability[] {
  const caps = new Set<Capability>();
  for (const b of manifestBlocks) {
    const def = blocks.get(b.type);
    if (def) for (const c of def.capabilities) caps.add(c);
  }
  return [...caps];
}
