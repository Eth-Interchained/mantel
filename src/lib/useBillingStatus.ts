import { useCallback, useEffect, useState } from "react";

import { getJson, getToken, onSessionChanged } from "./api";

/**
 * The one billing-status contract — Nav's badge, the upgrade modal,
 * and the post-checkout welcome all read the SAME shape from the SAME
 * endpoint, so "premium" never means something different in two places.
 */
export interface BillingStatus {
  limitEnabled: boolean;
  freeLimit: number;
  /** Premium profile ceiling (0 = uncapped instance policy). */
  premiumProfileLimit: number;
  /** True when THIS account has no ceiling (operator, holder,
   *  unlimited instance, or grandfathered supporter). */
  capExempt: boolean;
  owned: number;
  unlimited: boolean;
  via: "operator" | "supporter" | "holder" | "unlimited-instance" | "none" | string;
  itcThreshold: number;
  itcBalance: number | null;
  holderCheckAvailable: boolean;
  fiatDoor: boolean;
  pwywMinCents: number;
  address: string | null;
}

const EVENT = "links:billing-changed";

/**
 * Fire after anything that might have moved someone's premium status —
 * landing back from a successful Stripe checkout, an ITC balance
 * re-check that crossed the threshold. Every mounted useBillingStatus()
 * refetches, so the Nav badge flips live with zero page reload.
 */
export function notifyBillingChanged(): void {
  window.dispatchEvent(new Event(EVENT));
}

/** Human words for `via` — this is what makes premium feel EARNED,
 *  not just flipped. Named after what the member actually did. */
export function billingViaLabel(via: string): string {
  switch (via) {
    case "operator":
      return "you operate this instance";
    case "supporter":
      return "one-time support — thank you";
    case "holder":
      return "holding ITC on your account";
    case "unlimited-instance":
      return "this instance runs unlimited for everyone";
    default:
      return "unlimited";
  }
}

export function useBillingStatus(): {
  status: BillingStatus | null;
  loading: boolean;
  refresh: () => void;
} {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!getToken()) {
      setStatus(null);
      return;
    }
    setLoading(true);
    getJson<BillingStatus>("/api/billing/status")
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh); // token changed in another tab
    const offSession = onSessionChanged(refresh); // sign-in/out in THIS tab
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
      offSession();
    };
  }, [refresh]);

  return { status, loading, refresh };
}
