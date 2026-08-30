import React, { useCallback, useEffect, useState } from "react";
import { Link } from "@interchained/portal-react";
import { Eye, Globe, MousePointerClick, QrCode } from "lucide-react";

import { Nav } from "../src/components/Nav";
import { Footer } from "../src/components/Footer";
import { Gate } from "../src/components/Gate";
import { PremiumWelcomeModal } from "../src/components/PremiumModals";
import type { AccountSummary } from "../src/components/SubNav";
import { ApiError, getAddress, getEmail, getJson } from "../src/lib/api";
import { fmtCount } from "../src/lib/format";
import { notifyBillingChanged } from "../src/lib/useBillingStatus";
import { daypartGreeting, greetingName } from "../src/lib/welcome";

export const intent = {
  purpose:
    "Manage every identity this owner holds — personal, business, brand, event — each with its own handle and surfaces",
  primaryAction: "Open an identity in the editor",
  seoKeyword: "identity manager",
};

interface IdentitySummary {
  identityId: string;
  handle: string;
  displayName: string;
  identityType: string;
  template?: string;
  theme?: string;
  status: "draft" | "published";
  blockCount: number;
  publishedAt?: string;
  updatedAt: string;
}

/** One number, one label — the dashboard's at-a-glance row. */
function StatPanel({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Eye;
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="panel px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-fg-subtle font-semibold">
        <Icon size={12} className="text-accent-soft" aria-hidden />
        {label}
      </div>
      <div className="font-display text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

export default function IdentitiesPage(): React.ReactElement {
  const [identities, setIdentities] = useState<IdentitySummary[] | null>(null);
  const [summary, setSummary] = useState<AccountSummary | "failed" | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [justUpgraded, setJustUpgraded] = useState(false);

  // The payoff moment for a real Stripe checkout: success_url lands
  // here with ?upgraded=1. Strip it immediately (a refresh or back-nav
  // must never re-trigger the celebration), tell every mounted
  // useBillingStatus() to refetch (the Nav badge flips with zero
  // reload), and show the welcome — a real purchase deserves a real
  // moment, not silence.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("upgraded") !== "1") return;
    window.history.replaceState(null, "", window.location.pathname);
    notifyBillingChanged();
    setJustUpgraded(true);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setLocked(false);
    setName(greetingName(getEmail(), getAddress()));
    try {
      const j = await getJson<{ identities: IdentitySummary[] }>("/api/identities");
      setIdentities(j.identities);
      // The numbers ride a second call, never blocking the list — an
      // engine hiccup costs the stats row, not the page.
      getJson<AccountSummary>("/api/analytics/summary")
        .then(setSummary)
        .catch(() => setSummary("failed"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setLocked(true);
        return;
      }
      setError(err instanceof Error ? err.message : "failed to load");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (locked) {
    return (
      <>
        <Nav />
        <Gate onReady={() => void load()} />
      </>
    );
  }

  return (
    <>
      <Nav />
      {justUpgraded && <PremiumWelcomeModal onClose={() => setJustUpgraded(false)} />}
      <main className="max-w-5xl mx-auto px-5 py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="kicker">your studio</p>
            <h1 className="font-display text-3xl font-bold mt-1.5">
              {name ? `${daypartGreeting()}, ${name}` : "Welcome back"}{" "}
              <span aria-hidden>👋</span>
            </h1>
            <p className="text-fg-muted text-sm mt-1">
              One owner, many identities — each with its own handle and every surface.
            </p>
          </div>
          <Link href="/" className="btn btn-primary">
            + Claim a handle
          </Link>
        </header>

        {identities && identities.length > 0 && summary !== "failed" && (
          <section
            className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3"
            aria-label="Your numbers, all time"
          >
            {summary ? (
              <>
                <StatPanel icon={Eye} label="Profile views" value={fmtCount(summary.totals.views)} />
                <StatPanel icon={QrCode} label="QR scans" value={fmtCount(summary.totals.scans)} />
                <StatPanel icon={MousePointerClick} label="Link clicks" value={fmtCount(summary.totals.linkClicks)} />
                <StatPanel icon={Globe} label="Pages live" value={`${summary.live}/${summary.identities}`} />
              </>
            ) : (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="panel px-4 py-3.5 animate-pulse" aria-hidden>
                  <div className="h-3 w-16 bg-ink-800 rounded" />
                  <div className="h-7 w-12 bg-ink-800 rounded mt-2" />
                </div>
              ))
            )}
          </section>
        )}

        {error && (
          <p className="mt-8 text-signal-red font-mono text-sm">{error}</p>
        )}

        {identities && identities.length === 0 && (
          <div className="mt-16 text-center text-fg-muted">
            <p className="text-4xl">⬡</p>
            <p className="mt-3 font-semibold text-fg-muted">No identities yet</p>
            <p className="text-sm mt-1">Claim a handle to publish your first one.</p>
          </div>
        )}

        <div className="mt-8 grid gap-3">
          {identities?.map((idn) => {
            const stats =
              summary && summary !== "failed"
                ? summary.perIdentity.find((p) => p.identityId === idn.identityId)
                : undefined;
            return (
            <Link
              key={idn.identityId}
              href={`/edit/${idn.identityId}`}
              className="group panel panel-lift grid sm:grid-cols-[1fr_auto] gap-3 items-center px-5 py-4 hover:border-accent/40"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="font-bold text-lg truncate">{idn.displayName}</span>
                  <span
                    className={`chip ${
                      idn.status === "published"
                        ? "text-signal-green border-signal-green/40 bg-signal-green/10"
                        : "text-signal-amber border-signal-amber/40 bg-signal-amber/10"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${idn.status === "published" ? "bg-signal-green" : "bg-signal-amber"}`} />
                    {idn.status === "published" ? "Live" : "Draft"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
                  <span className="font-mono text-accent-soft">@{idn.handle}</span>
                  <span>{idn.identityType}</span>
                  {idn.template && <span>template: {idn.template}</span>}
                  <span>
                    {idn.blockCount} block{idn.blockCount === 1 ? "" : "s"}
                  </span>
                  {stats && (
                    <span className="inline-flex items-center gap-2.5 text-fg-subtle" title="Views · link clicks, all time">
                      <span className="inline-flex items-center gap-1">
                        <Eye size={12} aria-hidden /> {fmtCount(stats.views)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MousePointerClick size={12} aria-hidden /> {fmtCount(stats.linkClicks)}
                      </span>
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span
                  role="link"
                  tabIndex={0}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = `/analytics/${encodeURIComponent(idn.identityId)}`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") window.location.href = `/analytics/${encodeURIComponent(idn.identityId)}`;
                  }}
                  className="btn btn-ghost !py-1.5 !px-3"
                  title="Analytics"
                >
                  Stats
                </span>
                <span
                  role="link"
                  tabIndex={0}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = `/qr/${encodeURIComponent(idn.identityId)}`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") window.location.href = `/qr/${encodeURIComponent(idn.identityId)}`;
                  }}
                  className="btn btn-ghost !py-1.5 !px-3"
                  title="QR Studio — branded codes, per-link codes, print flyers"
                >
                  QR
                </span>
                {idn.status === "published" && (
                  <a
                    href={`/${idn.handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="btn btn-secondary !py-1.5 !px-3"
                  >
                    View ↗
                  </a>
                )}
                <span className="btn btn-accent-ghost !py-1.5 !px-3 group-hover:bg-accent/10">
                  Edit
                </span>
              </div>
            </Link>
            );
          })}
        </div>
      </main>
      <Footer />
    </>
  );
}
