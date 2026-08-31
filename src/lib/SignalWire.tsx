/**
 * The signal wire — the homepage's rotating strip of the latest real voices.
 *
 * One signal at a time, advancing every few seconds with a fade. Hover (or
 * keyboard focus) pauses it — a ticker you cannot stop is hostile to anyone
 * who reads slower than the timer. Every frame links to the model page; the
 * source name links to the original post.
 *
 * Data comes from /api/signals/latest at mount and refreshes on an interval.
 * A fetch failure keeps the last good list and says so in the corner, rather
 * than blanking the strip — an empty wire reads as "nobody talks about local
 * models", which is worse than stale.
 */

import React, { useEffect, useRef, useState } from "react";

import type { SignalRow } from "./api";

const ROTATE_MS = 4000;
const REFRESH_MS = 60_000;

const SENTIMENT_DOT: Record<string, string> = {
  positive: "bg-emerald-400",
  negative: "bg-red-400",
  mixed: "bg-amber-400",
  neutral: "bg-zinc-500",
};

const SOURCE_LABEL: Record<string, string> = {
  x: "X",
  bluesky: "Bluesky",
  reddit: "Reddit",
  hn: "HN",
  hf: "HF",
  github: "GitHub",
};

async function fetchLatest(): Promise<SignalRow[]> {
  const r = await fetch("/api/signals/latest?limit=30", {
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(`/api/signals/latest → ${r.status}`);
  const j = (await r.json()) as { signals: SignalRow[] };
  return j.signals;
}

export function SignalWire(): React.ReactElement | null {
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [idx, setIdx] = useState(0);
  const [stale, setStale] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Load + periodic refresh.
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchLatest()
        .then((rows) => {
          if (!alive) return;
          setSignals(rows);
          setStale(false);
        })
        .catch((err: unknown) => {
          if (!alive) return;
          // Keep the last good list; mark it stale and say why in the console.
          console.warn(
            `[mantel] signal wire refresh failed (${err instanceof Error ? err.message : String(err)}) — showing the last good list.`,
          );
          setStale(true);
        });
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Rotation.
  useEffect(() => {
    if (signals.length < 2) return;
    const t = setInterval(() => {
      if (!pausedRef.current) setIdx((i) => (i + 1) % signals.length);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [signals.length]);

  if (signals.length === 0) return null;

  const s = signals[idx % signals.length];

  return (
    <div
      className="border-b border-zinc-800 bg-zinc-900/40"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-2 font-mono text-xs">
        <span className="flex shrink-0 items-center gap-1.5 text-zinc-600">
          <span className={`h-1.5 w-1.5 rounded-full ${SENTIMENT_DOT[s.sentiment] ?? "bg-zinc-500"}`} />
          wire
        </span>

        {/* key={} remounts the frame so the fade replays per signal. */}
        <div key={s._id} className="wire-frame flex min-w-0 flex-1 items-baseline gap-2">
          <a
            href={`/m/${encodeURIComponent(s.modelRef)}`}
            className="shrink-0 text-cyan-400 hover:underline"
          >
            {s.modelRef}
          </a>
          <span className="truncate text-zinc-400">“{s.excerpt}”</span>
          <a
            href={s.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-zinc-600 hover:text-zinc-400 hover:underline"
          >
            {s.authorHandle ? `${s.authorHandle} · ` : ""}
            {SOURCE_LABEL[s.source] ?? s.source} ↗
          </a>
        </div>

        <span className="shrink-0 text-zinc-700">
          {stale ? "stale · " : ""}
          {(idx % signals.length) + 1}/{signals.length}
        </span>
      </div>
    </div>
  );
}
