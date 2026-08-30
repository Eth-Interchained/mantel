import React, { useCallback, useEffect, useState } from "react";
import { Link } from "@interchained/portal-react";
import {
  Activity,
  BadgeCheck,
  BarChart3,
  Eye,
  IndianRupee,
  MousePointerClick,
  LogOut,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Nav } from "../src/components/Nav";
import { Footer } from "../src/components/Footer";
import { ApiError, getOperatorJson, getOperatorToken, setOperatorToken } from "../src/lib/api";
import { OperatorGate } from "../src/components/OperatorGate";

export const intent = {
  purpose:
    "Operator console — instance-wide metrics, commerce and the live event feed. Operator token only; every number is a live NQL aggregation over the append-only event log",
  primaryAction: "Read the instance",
  seoKeyword: "operator console",
};

interface Overview {
  instance: {
    brand: string;
    brandKey: string;
    currency: string;
    authMode: string;
    vaultReady: boolean;
    fiatDoor: boolean;
    limitEnabled: boolean;
  };
  totals: { accounts: number; identities: number; published: number; drafts: number };
  traffic: { views: number; linkClicks: number; vcardDownloads: number };
  commerce: {
    claimed: number;
    delivered: number;
    rejected: number;
    bookings: number;
    creatorEarnings: number;
    claimedValue: number;
  };
  topPages: Array<{
    identityId: string;
    handle: string;
    displayName: string;
    status: string;
    views: number;
  }>;
  truncated: { identities: boolean; purchases: boolean; events: boolean };
}

interface FeedEvent {
  kind?: string;
  identityId?: string;
  amount?: number;
  source?: string;
  ts?: string;
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
}): React.ReactElement {
  return (
    <div className="panel p-5">
      <span className="w-9 h-9 rounded-xl bg-accent/10 text-accent-soft inline-flex items-center justify-center">
        <Icon size={16} />
      </span>
      <p className="font-display text-3xl mt-3 tabular-nums">{value}</p>
      <p className="text-sm text-fg-muted mt-0.5">{label}</p>
      {hint && <p className="text-[11px] text-fg-subtle mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  );
}

export default function AdminPage(): React.ReactElement {
  const [data, setData] = useState<Overview | null>(null);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // null = haven't checked yet; false = show the gate. Kept distinct so
  // the gate doesn't flash before the first request resolves.
  const [unlocked, setUnlocked] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [o, e] = await Promise.all([
        getOperatorJson<Overview>("/api/admin/overview"),
        getOperatorJson<{ events: FeedEvent[] }>("/api/admin/events?limit=60"),
      ]);
      setData(o);
      setFeed(e.events ?? []);
      setUnlocked(true);
    } catch (err) {
      // A 401 is not an error to report — it just means "locked", which
      // is the resting state for almost everyone who lands here. Show
      // the gate instead of a scary banner with nothing to act on.
      if (err instanceof ApiError && err.status === 401) {
        setUnlocked(false);
        // A stored key that stopped working (rotated env, wrong
        // instance) must not linger and fail every load.
        if (getOperatorToken()) setOperatorToken("");
      } else {
        setUnlocked(true);
        setError(err instanceof Error ? err.message : "couldn't load the console");
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (n: number): string =>
    `${data?.instance.currency === "INR" ? "₹" : "$"}${n.toLocaleString()}`;

  return (
    <>
      <Nav />
      <main className="w-full max-w-5xl mx-auto px-5 py-10">
        {unlocked === true && (
        <div className="flex items-end justify-between gap-3 mb-6">
          <div>
            <p className="kicker">operator console</p>
            <h1 className="font-display text-3xl sm:text-4xl mt-1">
              {data?.instance.brand ?? "Instance"} at a glance
            </h1>
            <p className="text-fg-muted text-sm mt-1.5">
              Every number is queried live from the event log when this page loads — no
              counters, no cache, so nothing here can drift. The trade is cost: it scans on
              each visit, and very large instances will read a capped sample.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void load()} disabled={busy} className="icon-btn" title="Refresh">
              <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
            </button>
            <button
              onClick={() => {
                setOperatorToken("");
                setData(null);
                setFeed([]);
                setUnlocked(false);
              }}
              className="icon-btn"
              title="Lock the console"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
        )}

        {unlocked === false && <OperatorGate onUnlocked={() => void load()} />}

        {error && (
          <div className="panel !border-signal-amber/40 bg-signal-amber/10 px-4 py-3 text-sm">{error}</div>
        )}

        {data && (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat icon={Users} label="Accounts" value={data.totals.accounts} />
              <Stat
                icon={BadgeCheck}
                label="Pages"
                value={data.totals.identities}
                hint={`${data.totals.published} published · ${data.totals.drafts} draft`}
              />
              <Stat icon={Eye} label="Profile views" value={data.traffic.views} />
              <Stat icon={MousePointerClick} label="Link clicks" value={data.traffic.linkClicks} />
            </div>

            <h2 className="section-title mt-10 mb-3 px-1">Commerce</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat
                icon={ShoppingBag}
                label="Delivered"
                value={data.commerce.delivered}
                hint={`${data.commerce.bookings} of all sales are bookings`}
              />
              <Stat
                icon={Activity}
                label="Awaiting the seller"
                value={data.commerce.claimed}
                hint={`${data.commerce.rejected} rejected`}
              />
              {/* The wording here is load-bearing. This money never touched
                  us — naming it "revenue" on an operator dashboard is how a
                  false story about the business starts. */}
              <Stat
                icon={IndianRupee}
                label="Paid to creators"
                value={money(data.commerce.creatorEarnings)}
                hint="Straight to their own banks. We are not the merchant and take no cut — this is not our revenue."
              />
              <Stat
                icon={BarChart3}
                label="Claimed, unverified"
                value={money(data.commerce.claimedValue)}
                hint="What buyers say they sent. Nothing has confirmed it."
              />
            </div>

            <div className="panel p-5 mt-4 grid sm:grid-cols-3 gap-3 text-sm">
              {[
                ["Auth mode", data.instance.authMode],
                ["Storefront", data.instance.brandKey],
                ["Currency", data.instance.currency],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-[11px] uppercase tracking-wider text-fg-subtle">{k}</p>
                  <p className="font-semibold mt-0.5">{v}</p>
                </div>
              ))}
              <div className="sm:col-span-3 flex flex-wrap gap-2 pt-2 border-t border-ink-800">
                {[
                  ["Secret vault", data.instance.vaultReady],
                  ["Card door", data.instance.fiatDoor],
                  ["Limits on", data.instance.limitEnabled],
                ].map(([k, on]) => (
                  <span
                    key={String(k)}
                    className={`chip !text-[11px] ${on ? "text-signal-green" : "text-fg-subtle"}`}
                  >
                    <ShieldCheck size={12} /> {String(k)}: {on ? "yes" : "no"}
                  </span>
                ))}
              </div>
            </div>

            <h2 className="section-title mt-10 mb-3 px-1">Busiest pages</h2>
            <div className="panel p-2">
              {data.topPages.length ? (
                data.topPages.map((p) => (
                  <Link
                    key={p.identityId}
                    href={`/analytics/${p.identityId}`}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl hover:bg-ink-850 transition-colors"
                  >
                    <span className="min-w-0">
                      <span className="font-semibold text-sm">@{p.handle}</span>
                      <span className="text-fg-subtle text-xs ml-2">{p.displayName}</span>
                    </span>
                    <span className="flex items-center gap-3 shrink-0">
                      {p.status !== "published" && (
                        <span className="chip !text-[10px] text-fg-subtle">draft</span>
                      )}
                      <span className="tabular-nums text-sm font-semibold">{p.views}</span>
                    </span>
                  </Link>
                ))
              ) : (
                <p className="text-sm text-fg-muted p-3">No pages yet.</p>
              )}
            </div>

            <h2 className="section-title mt-10 mb-3 px-1">Recent activity</h2>
            <div className="panel p-2">
              {feed.length ? (
                feed.map((e, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-xs border-b border-ink-800 last:border-0"
                  >
                    <span className="font-mono text-fg-muted shrink-0">
                      {String(e.ts ?? "").replace("T", " ").slice(0, 19)}
                    </span>
                    <span className="font-semibold truncate flex-1">{e.kind}</span>
                    {typeof e.amount === "number" && (
                      <span className="tabular-nums text-accent-soft shrink-0">{money(e.amount)}</span>
                    )}
                    <span className="text-fg-subtle shrink-0">{e.source ?? ""}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-fg-muted p-3">Nothing logged yet.</p>
              )}
            </div>

            {(data.truncated.events || data.truncated.purchases || data.truncated.identities) && (
              // Say it out loud rather than quietly showing a floor as if
              // it were a total.
              <p className="text-[11px] text-signal-amber mt-4">
                A scan hit its cap — the numbers above are a floor, not a total.
              </p>
            )}
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
