/**
 * The giveaway visual language — ONE palette source for every surface
 * (the profile-page card in html.ts, the /r entry/confirm/drawn pages
 * in raffles.ts). Before this, the ring, the button, and the scarcity
 * bar each hardcoded their OWN gradient — three uncoordinated color
 * stories on one page, which read as a five-hue circus wheel spinning
 * against two other rainbows. Pop art commits to a tight, bold,
 * curated palette; it doesn't sweep the whole hue wheel.
 *
 * Deployment brand colors (LINKS_HOLO_COLORS) override this when
 * configured — OurLynx's cyan/violet ramp is already tight and bold
 * and needs no rescue. This default is what ships unbranded.
 */

const DEFAULT_STOPS = ["#ec4899", "#fbbf24", "#3b82f6"]; // hot pink · gold · electric blue

/** The raw palette — 2-4 stops, brand-overridden or the pop-art default. */
export function giveawayStops(brandColors?: string[]): string[] {
  return brandColors && brandColors.length >= 2 ? brandColors : DEFAULT_STOPS;
}

/** Closed-loop stops for a conic-gradient ring (last stop repeats the first). */
export function conicStops(brandColors?: string[]): string {
  const c = giveawayStops(brandColors);
  return [...c, c[0]].join(", ");
}

/** Open stops for a linear-gradient (button, scarcity bar) — no repeat. */
export function linearStops(brandColors?: string[]): string {
  return giveawayStops(brandColors).join(", ");
}
