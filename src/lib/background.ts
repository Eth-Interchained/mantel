/**
 * Page backgrounds — solid colors and gradients, picked, not imagined.
 *
 * The Background section is page CHROME, not a content block: it rides
 * over any theme, swapping the canvas while cards, accents, and type
 * stay put. Midnight behind Signal cards, Forest behind Mach — that's
 * the composition this module makes safe.
 *
 * Storage is the materialized gradient, never just a preset name: old
 * pages render forever even if presets are renamed, and editing a
 * preset's stops simply becomes Custom. The `preset` field is a UI
 * affordance (which card lights up), nothing more.
 *
 * Security: stops and solid colors are hex-validated (#rrggbb ONLY),
 * direction is an enum. User strings never reach CSS — same contract
 * as themeCustom. The zod schema exported here is the single source of
 * truth for both the PUT route and the preview route.
 */

import { z } from "zod";

export const BG_HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const GRADIENT_DIRECTIONS = ["vertical", "horizontal", "diagonal", "radial"] as const;
export type GradientDirection = (typeof GRADIENT_DIRECTIONS)[number];

export const MIN_STOPS = 2;
export const MAX_STOPS = 4;

export interface SolidBackground {
  kind: "solid";
  color: string;
}

export interface GradientBackground {
  kind: "gradient";
  direction: GradientDirection;
  /** 2–4 hex stops, evenly spaced. */
  stops: string[];
  /** Which preset card this came from — informational, for the UI only. */
  preset?: string;
}

export interface ImageBackground {
  kind: "image";
  /** https-only, charset-restricted — the regex IS the CSS-injection
   *  defense (the hex-only lesson, applied to URLs). */
  url: string;
  /** The solid the page "reads as": borders/rings anchor here, page ink
   *  derives from it, and it backs the scrim + the image while loading. */
  anchor: string;
  /** Scrim strength 0–80 (% of anchor laid over the photo) — arbitrary
   *  photos behind text are unreadable without one. Default 35. */
  dim?: number;
}

export type BackgroundConfig = SolidBackground | GradientBackground | ImageBackground;

/** No quotes, parens, backslashes, whitespace, or angle brackets — safe
 *  to interpolate inside url("…") in a style block. */
export const BG_URL_RE = /^https:\/\/[^\s"'()\\<>]{1,480}$/;

/** One schema for every server surface — PUT and preview validate identically. */
export const backgroundSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("solid"),
    color: z.string().regex(BG_HEX_RE, "colors must be #rrggbb"),
  }),
  z.object({
    kind: z.literal("gradient"),
    direction: z.enum(GRADIENT_DIRECTIONS),
    stops: z
      .array(z.string().regex(BG_HEX_RE, "stops must be #rrggbb"))
      .min(MIN_STOPS)
      .max(MAX_STOPS),
    preset: z.string().max(24).optional(),
  }),
  z.object({
    kind: z.literal("image"),
    url: z.string().regex(BG_URL_RE, "image backgrounds must be clean https URLs"),
    anchor: z.string().regex(BG_HEX_RE, "anchor must be #rrggbb"),
    dim: z.number().int().min(0).max(80).optional(),
  }),
]);

// ── Presets — the five cards ─────────────────────────────────────────────────

export interface BackgroundPreset {
  id: string;
  name: string;
  blurb: string;
  direction: GradientDirection;
  stops: string[];
}

export const BG_PRESETS: BackgroundPreset[] = [
  { id: "midnight", name: "Midnight", blurb: "Clean dark blue — Linear/Vercel energy.",
    direction: "vertical", stops: ["#0F172A", "#1E293B"] },
  { id: "sunset",   name: "Sunset",   blurb: "Warm orange into pink — made for creators.",
    direction: "vertical", stops: ["#FF6B6B", "#F97316", "#FBBF24"] },
  { id: "aurora",   name: "Aurora",   blurb: "Blue into teal — fresh and modern.",
    direction: "vertical", stops: ["#2563EB", "#06B6D4", "#10B981"] },
  { id: "lavender", name: "Lavender", blurb: "Purple gradient — creative and vibrant.",
    direction: "vertical", stops: ["#7C3AED", "#A855F7", "#EC4899"] },
  { id: "forest",   name: "Forest",   blurb: "Deep greens — natural and premium.",
    direction: "vertical", stops: ["#14532D", "#166534", "#22C55E"] },
];

/** A preset card, materialized into a storable config. */
export function presetBackground(p: BackgroundPreset): GradientBackground {
  return { kind: "gradient", direction: p.direction, stops: [...p.stops], preset: p.id };
}

// ── CSS ──────────────────────────────────────────────────────────────────────

const DIRECTION_CSS: Record<GradientDirection, string> = {
  vertical: "180deg",
  horizontal: "90deg",
  diagonal: "135deg",
  radial: "", // radial has its own shape below
};

/** The CSS background value. Inputs are hex-validated upstream; this
 *  function still only ever interpolates enum-mapped strings + stops,
 *  normalized to lowercase so rendered CSS is byte-stable. */
export function bgCss(bg: BackgroundConfig): string {
  if (bg.kind === "solid") return bg.color.toLowerCase();
  if (bg.kind === "image") {
    // Scrim over photo over anchor — one background value. The scrim is
    // the readability guarantee (dim% of anchor laid over ANY photo);
    // the anchor backs the stack while the image loads or fails.
    const a = bg.anchor.toLowerCase();
    const dim = Math.max(0, Math.min(80, bg.dim ?? 35));
    const alpha = toHex((dim / 100) * 255);
    return `linear-gradient(${a}${alpha},${a}${alpha}),url("${bg.url}") center/cover no-repeat,${a}`;
  }
  const stops = bg.stops.map((s) => s.toLowerCase()).join(",");
  if (bg.direction === "radial") {
    return `radial-gradient(120% 120% at 50% 0%,${stops})`;
  }
  return `linear-gradient(${DIRECTION_CSS[bg.direction]},${stops})`;
}

// ── Color math — the readability guarantee ───────────────────────────────────

function hexChannels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

/**
 * The solid stand-in for a background — what borders and rings anchor
 * on (the renderer's solidBg contract). For gradients it's the
 * channel-wise mean of the stops: the color the page "reads as".
 */
export function anchorOf(bg: BackgroundConfig): string {
  if (bg.kind === "solid") return bg.color.toLowerCase();
  if (bg.kind === "image") return bg.anchor.toLowerCase();
  const sum = bg.stops.reduce(
    (acc, s) => {
      const [r, g, b] = hexChannels(s);
      return [acc[0] + r, acc[1] + g, acc[2] + b];
    },
    [0, 0, 0],
  );
  const n = bg.stops.length;
  return `#${toHex(sum[0] / n)}${toHex(sum[1] / n)}${toHex(sum[2] / n)}`;
}

/** WCAG relative luminance of a #rrggbb color, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexChannels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Page-level ink for text sitting directly on this background. Picks
 * whichever of near-black / near-white has the higher WCAG contrast
 * ratio — so a pastel gets dark ink and Midnight gets light ink, with
 * no taste involved, only math. Sub ink is the same color at reduced
 * alpha (8-digit hex, house style), which stays harmonious over any
 * gradient where a fixed gray would turn muddy.
 */
export function pageInkOn(hex: string): { text: string; sub: string } {
  const l = relativeLuminance(hex);
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastBlack = (l + 0.05) / 0.05;
  return contrastBlack >= contrastWhite
    ? { text: "#0f172a", sub: "#0f172ab8" }
    : { text: "#f8fafc", sub: "#f8fafccc" };
}
