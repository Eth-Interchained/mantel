/**
 * Client-side fit badge.
 *
 * Mirrors the server's fit verdict for the list view, where badging 200 rows
 * against a typed VRAM figure over the network would be absurd. The SERVER
 * remains authoritative — the model page fetches /api/fit and shows its
 * reasons. This is the cheap preview, and it obeys the same rule:
 *
 *   NO minVramGib  →  "unknown". Never an estimate from file size.
 *
 * The threshold and the reserve are kept identical to src/server/fit.ts. If
 * they drift, the badge and the detail page disagree — so both are named
 * constants here rather than inline numbers.
 */

export type ClientFitStatus = "fits" | "tight" | "too-big" | "unknown";

const TIGHT_THRESHOLD = 0.9;
/** Flat reserve for a visitor-supplied figure; matches customProfile(). */
const CUSTOM_RESERVE_GIB = 1;

export interface BadgeResult {
  status: ClientFitStatus;
  /** The quant that earned the verdict, when one did. */
  quant: string | null;
  /** Quants with no measured VRAM figure — surfaced next to the badge. */
  unmeasured: number;
  className: string;
  /** Hover text. Always states the basis, never just the verdict. */
  title: string;
}

const RANK: Record<ClientFitStatus, number> = {
  fits: 3,
  tight: 2,
  "too-big": 1,
  unknown: 0,
};

const CLASS: Record<ClientFitStatus, string> = {
  fits: "bg-emerald-950 text-emerald-400 border border-emerald-900",
  tight: "bg-amber-950 text-amber-400 border border-amber-900",
  "too-big": "bg-red-950 text-red-400 border border-red-900",
  unknown: "bg-zinc-900 text-zinc-500 border border-zinc-800",
};

export function fitBadge(
  quants: { name: string; fileGib: number; minVramGib: number | null }[],
  vramGib: number | null,
): BadgeResult {
  const unmeasured = quants.filter(
    (q) => q.minVramGib === null || q.minVramGib === undefined,
  ).length;

  if (vramGib === null) {
    // No VRAM entered: show a real fact (the weights range) instead of an
    // "unmeasured" placeholder that reads as a broken site.
    return {
      status: "unknown",
      quant: null,
      unmeasured,
      className: CLASS.unknown,
      title: "Enter your VRAM to see whether this fits.",
    };
  }
  if (quants.length === 0) {
    return {
      status: "unknown",
      quant: null,
      unmeasured: 0,
      className: CLASS.unknown,
      title: "No quantization data for this model yet.",
    };
  }

  const available = vramGib - CUSTOM_RESERVE_GIB;
  let best: ClientFitStatus = "unknown";
  let bestQuant: string | null = null;

  for (const q of quants) {
    // The rule this file exists to hold: unmeasured stays unmeasured.
    if (q.minVramGib === null || q.minVramGib === undefined) continue;
    let status: ClientFitStatus;
    if (q.minVramGib > available) status = "too-big";
    else if (q.minVramGib / available > TIGHT_THRESHOLD) status = "tight";
    else status = "fits";

    if (RANK[status] > RANK[best]) {
      best = status;
      bestQuant = q.name;
    }
  }

  const title =
    best === "unknown"
      ? `No measured VRAM requirement for any of the ${quants.length} quant(s). ` +
        `File size is not a substitute, so we report nothing.`
      : `Best verdict from ${bestQuant} against ${available} GiB usable ` +
        `(${vramGib} GiB minus a ${CUSTOM_RESERVE_GIB} GiB reserve).` +
        (unmeasured > 0 ? ` ${unmeasured} quant(s) unmeasured.` : "");

  return { status: best, quant: bestQuant, unmeasured, className: CLASS[best], title };
}
