import { useCallback, useEffect, useRef, useState } from "react";

import { adminHeaders } from "./api";
import { isValidHandle } from "./identity";

/**
 * The claim flow — one implementation, many storefronts.
 *
 * Every deployment sells with its own wireframe (the default claim-first
 * homepage, iKundli's India storefront, whatever lands next), but the
 * ACT of claiming must be identical everywhere: same availability
 * debounce, same 401 → gate, same 402 → upgrade, same publish. Extracted
 * from index.page.tsx when the second storefront arrived, so a fix here
 * fixes every brand at once.
 */

export type Availability = "idle" | "checking" | "available" | "taken" | "invalid";

export interface ClaimFlow {
  handle: string;
  setHandle: (h: string) => void;
  /** Lowercased, trimmed — what actually gets claimed. */
  normalized: string;
  availability: Availability;
  displayName: string;
  setDisplayName: (n: string) => void;
  template: string;
  setTemplate: (t: string) => void;
  busy: boolean;
  error: string | null;
  /** Set when the claim needs an account — render your gate. */
  locked: boolean;
  setLocked: (v: boolean) => void;
  /** Set when the free profile is used up — render the upgrade card. */
  needsUpgrade: boolean;
  setNeedsUpgrade: (v: boolean) => void;
  claimed: { identityId: string; handle: string } | null;
  published: boolean;
  claim: () => Promise<void>;
  publish: () => Promise<void>;
}

export function useClaimFlow(defaultTemplate = "creator"): ClaimFlow {
  const [handle, setHandle] = useState("");
  const [availability, setAvailability] = useState<Availability>("idle");
  const [displayName, setDisplayName] = useState("");
  const [template, setTemplate] = useState<string>(defaultTemplate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<{ identityId: string; handle: string } | null>(null);
  const [published, setPublished] = useState(false);
  const [locked, setLocked] = useState(false);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const normalized = handle.toLowerCase().trim();

  // Live availability — the claim experience begins here.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!normalized) {
      setAvailability("idle");
      return;
    }
    if (!isValidHandle(normalized)) {
      setAvailability("invalid");
      return;
    }
    setAvailability("checking");
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/handles/${encodeURIComponent(normalized)}/availability`);
        const j = (await r.json()) as { available: boolean };
        setAvailability(j.available ? "available" : "taken");
      } catch {
        setAvailability("idle");
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [normalized]);

  const claim = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/identities", {
        method: "POST",
        headers: { "content-type": "application/json", ...adminHeaders() },
        body: JSON.stringify({
          handle: normalized,
          displayName: displayName || normalized,
          template,
        }),
      });
      if (r.status === 401) {
        setLocked(true);
        return;
      }
      if (r.status === 402) {
        // Free profile used — show the two-door upgrade.
        setNeedsUpgrade(true);
        return;
      }
      const j = (await r.json()) as {
        manifest?: { identityId: string; handle: string };
        error?: string;
      };
      if (!r.ok || !j.manifest) {
        setError(j.error ?? `claim failed (${r.status})`);
        return;
      }
      setClaimed({ identityId: j.manifest.identityId, handle: j.manifest.handle });
    } catch (err) {
      setError(err instanceof Error ? err.message : "claim failed");
    } finally {
      setBusy(false);
    }
  }, [normalized, displayName, template]);

  const publish = useCallback(async () => {
    if (!claimed) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/identities/${encodeURIComponent(claimed.identityId)}/publish`, {
        method: "POST",
        headers: adminHeaders(),
      });
      if (r.status === 401) {
        setLocked(true);
        return;
      }
      if (!r.ok) {
        const j = (await r.json()) as { error?: string };
        setError(j.error ?? `publish failed (${r.status})`);
        return;
      }
      setPublished(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "publish failed");
    } finally {
      setBusy(false);
    }
  }, [claimed]);

  return {
    handle,
    setHandle,
    normalized,
    availability,
    displayName,
    setDisplayName,
    template,
    setTemplate,
    busy,
    error,
    locked,
    setLocked,
    needsUpgrade,
    setNeedsUpgrade,
    claimed,
    published,
    claim,
    publish,
  };
}
