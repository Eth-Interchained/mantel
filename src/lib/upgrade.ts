/**
 * The upgrade summons — a zero-plumbing event bus. Any surface that
 * hits a premium wall calls requestUpgrade(reason); the ONE global
 * UpgradeModal (mounted in Nav, so it exists on every page) answers.
 * No context providers, no prop drilling — a wall anywhere becomes a
 * doorway everywhere.
 */

export type UpgradeReason =
  | "giveaway"
  | "discover"
  | "font"
  | "blocks"
  | "gallery"
  | "qr"
  | "seo"
  | "access"
  | "limit"
  | "generic";

const EVENT = "links:upgrade";

export function requestUpgrade(reason: UpgradeReason = "generic"): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { reason } }));
}

export function onUpgradeRequest(cb: (reason: UpgradeReason) => void): () => void {
  const handler = (e: Event) => cb(((e as CustomEvent).detail?.reason ?? "generic") as UpgradeReason);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
