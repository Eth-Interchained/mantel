import React, { useCallback, useEffect, useState } from "react";
import { Link } from "@interchained/portal-react";
import { Contact, Eye, MousePointerClick, QrCode } from "lucide-react";

import { getJson, getToken, onSessionChanged } from "../lib/api";
import { fmtCount } from "../lib/format";

/**
 * The signed-in strip — THE nav's one earned second row. It pays rent
 * three ways:
 *
 *   1. Signed-in only. Visitors and readers never see it, so public
 *      pages keep the single 48px bar they've always had.
 *   2. Ducks on scroll-down, returns on scroll-up — reading content
 *      costs zero height (Mark's spec: "logged in only, on scroll hide").
 *   3. Every number is live from the engine — one portfolio rollup
 *      (/api/analytics/summary), the same numbers the dashboard reads.
 *
 * Mobile also gets sign-out here (the main bar hides the account chip
 * below md), so login/logout is a visible phase on every screen size.
 */

export interface AccountSummary {
  identities: number;
  live: number;
  totals: {
    views: number;
    scans: number;
    linkClicks: number;
    vcardDownloads: number;
  };
  perIdentity: Array<{
    identityId: string;
    handle: string;
    displayName: string;
    status: "draft" | "published";
    views: number;
    scans: number;
    linkClicks: number;
    vcardDownloads: number;
  }>;
  asOf: string;
}

/** Duck on scroll-down, return on scroll-up — a small deadband keeps
 *  trackpad jitter from flickering the strip. */
function useScrollDuck(): boolean {
  const [ducked, setDucked] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let ticking = false;
    const onScroll = (): void => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const d = y - last;
        if (Math.abs(d) > 6) {
          setDucked(d > 0 && y > 64);
          last = y;
        }
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return ducked;
}

export function SubNav(): React.ReactElement | null {
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const ducked = useScrollDuck();

  const load = useCallback(() => {
    const has = Boolean(getToken());
    setSignedIn(has);
    if (!has) {
      setSummary(null);
      return;
    }
    getJson<AccountSummary>("/api/analytics/summary")
      .then(setSummary)
      .catch(() => setSummary(null)); // engine hiccup or 401 — no strip, no drama
  }, []);

  useEffect(() => {
    load();
    return onSessionChanged(load);
  }, [load]);

  if (!signedIn || !summary) return null;

  const top = summary.perIdentity[0] ?? null;
  const stat = "inline-flex items-center gap-1.5 shrink-0";
  const num = "font-display font-bold text-fg";
  const label = "text-fg-subtle hidden sm:inline";

  return (
    <div
      className="overflow-hidden transition-[max-height] duration-200 ease-out border-t border-ink-800/60"
      style={{ maxHeight: ducked ? 0 : 40 }}
      aria-hidden={ducked}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-5 h-10 flex items-center gap-3 text-xs text-fg-muted">
        {summary.identities === 0 ? (
          <Link href="/" className="font-semibold text-accent-soft hover:text-accent transition truncate">
            Your handle is waiting — claim it and the numbers start here →
          </Link>
        ) : (
          <div className="flex items-center gap-4 overflow-x-auto no-scrollbar min-w-0">
            <span className={stat} title="Profile views, all time">
              <Eye size={13} className="text-accent-soft" aria-hidden />
              <span className={num}>{fmtCount(summary.totals.views)}</span>
              <span className={label}>views</span>
            </span>
            <span className={stat} title="QR scans">
              <QrCode size={13} className="text-accent-soft" aria-hidden />
              <span className={num}>{fmtCount(summary.totals.scans)}</span>
              <span className={label}>scans</span>
            </span>
            <span className={stat} title="Link clicks">
              <MousePointerClick size={13} className="text-accent-soft" aria-hidden />
              <span className={num}>{fmtCount(summary.totals.linkClicks)}</span>
              <span className={label}>clicks</span>
            </span>
            <span className={stat} title="Contact saves">
              <Contact size={13} className="text-accent-soft" aria-hidden />
              <span className={num}>{fmtCount(summary.totals.vcardDownloads)}</span>
              <span className={label}>saves</span>
            </span>
            <span className={stat} title="Published pages">
              <span
                className={`w-1.5 h-1.5 rounded-full ${summary.live > 0 ? "bg-signal-green" : "bg-signal-amber"}`}
                aria-hidden
              />
              <span className={num}>{summary.live}</span>
              <span className={label}>live</span>
            </span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-3 shrink-0">
          {top && (
            <Link
              href={`/analytics/${encodeURIComponent(top.identityId)}`}
              className="font-semibold text-accent-soft hover:text-accent transition"
              title={`Full analytics for @${top.handle}`}
            >
              Full stats →
            </Link>
          )}
          {/* Sign-out lived here briefly as a mobile stopgap (the bar
              hid the account chip below md); the NavMenu hamburger is
              its proper home on every viewport now. */}
        </div>
      </div>
    </div>
  );
}
