/**
 * "Will it run on my box?" — the fit verdict.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: mantel never invents a VRAM number.
 *
 * A fit answer is only as good as its inputs, and the input that matters
 * (minVramGib per quant) is frequently unknown. Every other model directory
 * papers over that with a formula and presents the output as fact. mantel
 * returns "unknown" instead, and the UI says so. An honest gap beats a
 * confident guess, because a wrong "fits" costs someone a 20-minute download
 * and a crash.
 *
 * Where a number IS present it comes from measurement or from hearth's
 * admission planner — the same code that decides what actually loads on a real
 * GPU. Extracting that planner into a shared library is the next step; until
 * that lands, this module computes nothing on its own. It compares.
 */

export type FitStatus = "fits" | "tight" | "too-big" | "unknown";

export interface HardwareProfile {
  /** Stable key: "rtx-3090", "a6000-48", "m2-max-64". */
  id: string;
  label: string;
  /** Usable VRAM/unified memory in GiB. */
  vramGib: number;
  /**
   * What the OS, display, and other resident processes take before a model
   * loads. Real headroom is vramGib - reservedGib.
   */
  reservedGib: number;
}

/**
 * Reference profiles. `reservedGib` values are deliberately conservative
 * round numbers, and are labeled as reserve rather than measured overhead —
 * they are a stated policy ("assume ~1GiB is gone on a dedicated card"), not a
 * benchmark result dressed up as one.
 */
export const PROFILES: HardwareProfile[] = [
  { id: "rtx-3060-12", label: "RTX 3060 12GB", vramGib: 12, reservedGib: 1 },
  { id: "rtx-3090", label: "RTX 3090 24GB", vramGib: 24, reservedGib: 1 },
  { id: "rtx-4090", label: "RTX 4090 24GB", vramGib: 24, reservedGib: 1 },
  { id: "a6000-48", label: "RTX A6000 48GB", vramGib: 48, reservedGib: 2 },
  { id: "m2-max-64", label: "Mac M2 Max 64GB", vramGib: 64, reservedGib: 8 },
  { id: "m3-ultra-192", label: "Mac M3 Ultra 192GB", vramGib: 192, reservedGib: 12 },
];

export interface QuantFit {
  quant: string;
  fileGib: number;
  minVramGib: number | null;
  status: FitStatus;
  /** Headroom left after loading, in GiB. Null when status is unknown. */
  headroomGib: number | null;
  /** Why this verdict — shown in the UI, never a bare badge. */
  reason: string;
}

/** A quant needing more than this share of available memory is "tight". */
const TIGHT_THRESHOLD = 0.9;

/**
 * Verdict for one quant against one profile.
 *
 * Returns "unknown" whenever minVramGib is absent. It does NOT fall back to
 * fileGib as a proxy: weights-on-disk systematically understates load
 * footprint (KV cache, context, runtime overhead), so that substitution would
 * produce optimistic "fits" verdicts — the exact failure this module exists to
 * prevent.
 */
export function fitQuant(
  quant: { name: string; fileGib: number; minVramGib: number | null },
  profile: HardwareProfile,
): QuantFit {
  const available = profile.vramGib - profile.reservedGib;

  if (quant.minVramGib === null || quant.minVramGib === undefined) {
    return {
      quant: quant.name,
      fileGib: quant.fileGib,
      minVramGib: null,
      status: "unknown",
      headroomGib: null,
      reason:
        `No measured VRAM requirement for ${quant.name}. The ${quant.fileGib} GiB ` +
        `file size is NOT a substitute — runtime footprint exceeds weight size by ` +
        `an amount that depends on context and KV cache, so we report unknown ` +
        `rather than guess.`,
    };
  }

  const headroom = Number((available - quant.minVramGib).toFixed(2));

  if (quant.minVramGib > available) {
    return {
      quant: quant.name,
      fileGib: quant.fileGib,
      minVramGib: quant.minVramGib,
      status: "too-big",
      headroomGib: headroom,
      reason:
        `Needs ${quant.minVramGib} GiB; ${profile.label} has ~${available} GiB ` +
        `available after a ${profile.reservedGib} GiB reserve. Short by ` +
        `${Math.abs(headroom)} GiB.`,
    };
  }

  if (quant.minVramGib / available > TIGHT_THRESHOLD) {
    return {
      quant: quant.name,
      fileGib: quant.fileGib,
      minVramGib: quant.minVramGib,
      status: "tight",
      headroomGib: headroom,
      reason:
        `Loads with only ${headroom} GiB spare on ${profile.label}. Expect ` +
        `trouble at longer contexts, and no room for a second model.`,
    };
  }

  return {
    quant: quant.name,
    fileGib: quant.fileGib,
    minVramGib: quant.minVramGib,
    status: "fits",
    headroomGib: headroom,
    reason: `Loads on ${profile.label} with ${headroom} GiB to spare.`,
  };
}

export interface ModelFit {
  profile: HardwareProfile;
  quants: QuantFit[];
  /** Best verdict across quants — what the badge shows. */
  best: FitStatus;
  /** The quant that earned the badge, when one did. */
  bestQuant: string | null;
  /** How many quants we simply do not have data for. Surfaced, never hidden. */
  unmeasured: number;
}

const RANK: Record<FitStatus, number> = { fits: 3, tight: 2, "too-big": 1, unknown: 0 };

/**
 * Fit report for a model on one profile.
 *
 * `best` is the strongest verdict any quant achieved. When every quant is
 * unmeasured, best is "unknown" — the report never rounds a pile of unknowns
 * up into a reassuring badge.
 */
export function fitModel(
  quants: { name: string; fileGib: number; minVramGib: number | null }[],
  profile: HardwareProfile,
): ModelFit {
  const results = quants.map((q) => fitQuant(q, profile));
  let best: FitStatus = "unknown";
  let bestQuant: string | null = null;
  for (const r of results) {
    if (RANK[r.status] > RANK[best]) {
      best = r.status;
      bestQuant = r.status === "unknown" ? null : r.quant;
    }
  }
  return {
    profile,
    quants: results,
    best,
    bestQuant,
    unmeasured: results.filter((r) => r.status === "unknown").length,
  };
}

/** Fit across every reference profile — the model page's sidebar table. */
export function fitAcrossProfiles(
  quants: { name: string; fileGib: number; minVramGib: number | null }[],
): ModelFit[] {
  return PROFILES.map((p) => fitModel(quants, p));
}

export function profileById(id: string): HardwareProfile | null {
  return PROFILES.find((p) => p.id === id) ?? null;
}

/** Ad-hoc profile from a user-supplied VRAM figure ("I have 20GB"). */
export function customProfile(vramGib: number): HardwareProfile | null {
  if (!Number.isFinite(vramGib) || vramGib <= 0 || vramGib > 4096) return null;
  return {
    id: `custom-${vramGib}`,
    label: `${vramGib} GiB`,
    vramGib,
    // A flat 1 GiB reserve, stated rather than tuned — we know nothing about
    // this machine beyond the number the visitor typed.
    reservedGib: 1,
  };
}
