import React, { useEffect, useState } from "react";

import { getFeed, listFeeds, type FeedDef, type RankedRow } from "../src/lib/api";
import { VerifyFooter } from "../src/lib/VerifyFooter";

export const intent = {
  purpose:
    "Ranked lists per use case and hardware budget — best coder under 20GB, best reasoner that fits 48GB — ranked by real sentiment, transparent math",
  primaryAction: "Pick a feed",
  seoKeyword: "best local LLM for coding reasoning by VRAM",
};

const SENTIMENT_CLASS: Record<string, string> = {
  positive: "text-emerald-400",
  negative: "text-red-400",
  mixed: "text-amber-400",
  neutral: "text-zinc-500",
};

function RankRow({ row, rank }: { row: RankedRow; rank: number }): React.ReactElement {
  return (
    <li className="flex items-baseline gap-3 border-b border-zinc-800 py-3 last:border-0">
      <span className="w-6 shrink-0 text-right font-mono text-sm text-zinc-600">{rank}</span>
      <a
        href={`/m/${encodeURIComponent(row.id)}`}
        className="font-mono text-sm text-cyan-400 hover:underline"
      >
        {row.id}
      </a>
      {row.params ? <span className="font-mono text-xs text-zinc-600">{row.params}</span> : null}
      <span className="font-mono text-[11px] text-emerald-500" title="best fitting quant">
        {row.fitStatus === "tight" ? "tight" : "fits"}
        {row.fitQuant ? ` · ${row.fitQuant}` : ""}
      </span>
      <span className="ml-auto flex items-baseline gap-3 font-mono text-[11px]">
        <span className="flex gap-2">
          {Object.entries(row.sentiment).map(([k, n]) => (
            <span key={k} className={SENTIMENT_CLASS[k] ?? "text-zinc-500"}>
              {k[0]}
              {n}
            </span>
          ))}
        </span>
        <span className="w-14 text-right text-zinc-400" title="evidence-weighted score">
          {row.score.toFixed(2)}
        </span>
      </span>
    </li>
  );
}

export default function Feeds(): React.ReactElement {
  const [menu, setMenu] = useState<FeedDef[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [data, setData] = useState<{
    feed: FeedDef;
    ranked: RankedRow[];
    excludedUnmeasured: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listFeeds()
      .then((r) => {
        if (!alive) return;
        setMenu(r.feeds);
        if (r.feeds[0]) setActive(r.feeds[0].id);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setData(null);
    getFeed(active)
      .then((r) => {
        if (alive) setData(r);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [active]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <a href="/" className="font-mono text-lg text-amber-500">
            ▚
          </a>
          <a href="/" className="font-mono text-lg tracking-tight">
            mantel
          </a>
          <span className="ml-4 font-mono text-xs text-zinc-600">ranked feeds</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Ranked by what runs, and what people report</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
          Each feed lists only models that are <em>proven</em> to fit its VRAM budget, ranked by an
          evidence-weighted sentiment score. Models with no measured VRAM figure can&apos;t be
          proven to fit, so they&apos;re held out — and counted, never hidden.
        </p>

        {error ? (
          <div className="mt-6 rounded border border-red-900/60 bg-red-950/30 p-4">
            <p className="font-mono text-sm text-red-400">could not load feeds</p>
            <p className="mt-1 font-mono text-xs text-red-400/70">{error}</p>
          </div>
        ) : null}

        {menu ? (
          <div className="mt-6 flex flex-wrap gap-2">
            {menu.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setActive(f.id)}
                className={`rounded border px-3 py-1.5 font-mono text-xs ${
                  active === f.id
                    ? "border-cyan-600 bg-cyan-950/40 text-cyan-300"
                    : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        ) : null}

        <section className="mt-8">
          {data === null && !error ? (
            <p className="font-mono text-sm text-zinc-600">ranking…</p>
          ) : data ? (
            <>
              <p className="font-mono text-xs text-zinc-600">
                {data.feed.blurb} · ceiling {data.feed.vramGib} GiB · {data.ranked.length} ranked
                {data.excludedUnmeasured > 0
                  ? ` · ${data.excludedUnmeasured} held out (unmeasured VRAM)`
                  : ""}
              </p>
              {data.ranked.length === 0 ? (
                <p className="mt-4 font-mono text-sm text-zinc-500">
                  nothing proven to fit yet — measured VRAM data is what unlocks this feed
                </p>
              ) : (
                <ul className="mt-3">
                  {data.ranked.map((row, i) => (
                    <RankRow key={row.id} row={row} rank={i + 1} />
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </section>
      </main>
      <VerifyFooter />
    </div>
  );
}
