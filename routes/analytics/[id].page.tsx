import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "@interchained/portal-react";
import {
  ArrowLeft,
  BarChart3,
  Contact,
  ExternalLink,
  Eye,
  Link2,
  MousePointerClick,
  QrCode,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";

import { Nav } from "../../src/components/Nav";
import { Footer } from "../../src/components/Footer";
import { Gate } from "../../src/components/Gate";
import { ApiError, getJson } from "../../src/lib/api";

export const intent = {
  purpose:
    "Per-identity analytics — views, QR scans vs taps, top links, sources. Every number is a live NQL GROUP BY against the events collection",
  primaryAction: "Read the signals",
  seoKeyword: "identity analytics",
};

interface Analytics {
  identityId: string;
  handle: string;
  totals: {
    views: number;
    scans: number;
    taps: number;
    linkClicks: number;
    vcardDownloads: number;
  };
  viewsBySource: Array<{ source: number | string; count: number }>;
  topLinks: Array<{ blockId: string; label: string; url: string | null; count: number }>;
  asOf: string;
}

const SOURCE_LABELS: Record<string, string> = {
  qr: "QR scans",
  direct: "Direct taps",
  card: "Business card",
};

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  hint?: string;
}): React.ReactElement {
  return (
    <div className="panel p-4 sm:p-5">
      <div className="flex items-center gap-2 text-fg-subtle">
        <Icon size={15} className="text-accent-soft" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="font-display text-3xl sm:text-4xl font-bold mt-2 tabular-nums">
        {value.toLocaleString()}
      </p>
      {hint && <p className="text-[11px] text-fg-subtle mt-1">{hint}</p>}
    </div>
  );
}

function Bar({ count, max }: { count: number; max: number }): React.ReactElement {
  const pct = max > 0 ? Math.max(3, Math.round((count / max) * 100)) : 0;
  return (
    <div className="h-2 rounded-full bg-ink-850 overflow-hidden">
      <div
        className="h-full rounded-full bg-accent transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function AnalyticsPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    setError(null);
    setLocked(false);
    try {
      const j = await getJson<Analytics>(`/api/identities/${encodeURIComponent(id)}/analytics`);
      setData(j);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setLocked(true);
        return;
      }
      setError(err instanceof Error ? err.message : "failed to load analytics");
    } finally {
      setBusy(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
    // The dashboard stays alive — the engine is queried fresh every 30s.
    const t = setInterval(() => void load(true), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (locked) {
    return (
      <>
        <Nav />
        <Gate onReady={() => void load()} />
      </>
    );
  }

  if (!data) {
    return (
      <>
        <Nav />
        <main className="max-w-5xl mx-auto px-5 py-16 text-center text-fg-muted">
          {error ? <p className="text-signal-red font-mono text-sm">{error}</p> : <p>Loading…</p>}
        </main>
      </>
    );
  }

  const { totals } = data;
  const empty =
    totals.views + totals.linkClicks + totals.vcardDownloads === 0;
  const maxSource = Math.max(0, ...data.viewsBySource.map((s) => s.count));
  const maxClicks = Math.max(0, ...data.topLinks.map((l) => l.count));

  return (
    <>
      {/* ONE nav — analytics projects its identity + commands into it. */}
      <Nav
        context={
          <>
            <Link href={`/edit/${encodeURIComponent(data.identityId)}`} className="icon-btn !w-7 !h-7 shrink-0" title="Back to editor">
              <ArrowLeft size={15} />
            </Link>
            <h1 className="font-display text-sm font-bold flex items-center gap-2 truncate">
              <BarChart3 size={15} className="text-accent-soft shrink-0" /> Analytics
            </h1>
            <span className="hidden sm:inline font-mono text-[11px] text-accent-soft truncate shrink-0">
              @{data.handle}
            </span>
          </>
        }
        actions={
          <>
            <a
              href={`/${data.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="icon-btn !w-7 !h-7"
              title="Open live page"
            >
              <ExternalLink size={15} />
            </a>
            <button onClick={() => void load()} disabled={busy} className="btn btn-secondary !py-1.5 !px-3">
              <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
              {busy ? "Reading…" : "Refresh"}
            </button>
          </>
        }
      />

      <main className="max-w-5xl mx-auto px-5 py-8">
        {error && <p className="mb-4 text-signal-red font-mono text-sm">{error}</p>}

        {/* ── Totals ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatTile icon={Eye} label="Profile views" value={totals.views} />
          <StatTile icon={QrCode} label="QR scans" value={totals.scans} hint="printed world → this page" />
          <StatTile icon={MousePointerClick} label="Direct taps" value={totals.taps} hint="links & shares" />
          <StatTile icon={Link2} label="Link clicks" value={totals.linkClicks} />
          <StatTile icon={Contact} label="Contacts saved" value={totals.vcardDownloads} />
        </div>

        {empty ? (
          <div className="panel mt-8 p-10 text-center">
            <p className="text-4xl">⬡</p>
            <h2 className="font-display text-xl font-bold mt-3">No signals yet</h2>
            <p className="text-fg-muted text-sm mt-2 max-w-md mx-auto">
              Share your page or print the QR — every scan, tap, and contact save
              lands here, live from the engine's event log.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid lg:grid-cols-2 gap-8 items-start">
            {/* ── Sources ────────────────────────────────────────────────── */}
            <div>
              <div className="mb-3 px-1">
                <h2 className="section-title">Where views come from</h2>
                <p className="section-desc">profile_view events, grouped by source.</p>
              </div>
              <div className="panel p-5 grid gap-4">
                {data.viewsBySource.length === 0 && (
                  <p className="text-sm text-fg-subtle">No views yet.</p>
                )}
                {data.viewsBySource.map((s) => (
                  <div key={String(s.source)}>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-sm font-semibold">
                        {SOURCE_LABELS[String(s.source)] ?? String(s.source)}
                      </span>
                      <span className="font-mono text-xs text-fg-muted tabular-nums">
                        {s.count.toLocaleString()}
                      </span>
                    </div>
                    <Bar count={s.count} max={maxSource} />
                  </div>
                ))}
              </div>
            </div>

            {/* ── Top links ──────────────────────────────────────────────── */}
            <div>
              <div className="mb-3 px-1">
                <h2 className="section-title">Top links</h2>
                <p className="section-desc">link_click events, grouped by block.</p>
              </div>
              <div className="panel p-5 grid gap-4">
                {data.topLinks.length === 0 && (
                  <p className="text-sm text-fg-subtle">No clicks yet.</p>
                )}
                {data.topLinks.map((l, i) => (
                  <div key={l.blockId}>
                    <div className="flex items-baseline justify-between gap-3 mb-1.5 min-w-0">
                      <span className="text-sm font-semibold truncate">
                        <span className="font-mono text-xs text-fg-subtle mr-2">{i + 1}</span>
                        {l.label}
                      </span>
                      <span className="font-mono text-xs text-fg-muted tabular-nums shrink-0">
                        {l.count.toLocaleString()}
                      </span>
                    </div>
                    {l.url && (
                      <p className="text-[11px] text-fg-subtle truncate mb-1.5">{l.url}</p>
                    )}
                    <Bar count={l.count} max={maxClicks} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <p className="mt-10 text-center text-[11px] text-fg-subtle">
          Every number on this page is a live NQL <span className="font-mono">GROUP BY</span> against
          the append-only events collection — nothing precomputed, nothing cached.
          <span className="font-mono"> as of {new Date(data.asOf).toLocaleTimeString()}</span>
        </p>
      </main>
      <Footer />
    </>
  );
}
