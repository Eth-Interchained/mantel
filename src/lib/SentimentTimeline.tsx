/**
 * Sentiment-over-time — the shareable curve.
 *
 * A stacked monthly bar chart drawn in plain SVG (no chart library, no new
 * dependency, and it themes cleanly with the rest of the dark UI). Each bar is
 * one month; segments are positive / mixed / neutral / negative. Hovering a bar
 * shows that month's exact counts. The whole point of the surface is that the
 * shape is honest: bar height is signal VOLUME, so a month with one glowing
 * post looks small next to a month with forty mixed ones.
 *
 * Data comes from /api/models/:id/timeline. An empty timeline renders nothing
 * (the model page already says "no signals yet"); a fetch failure logs and
 * renders nothing rather than a broken axis.
 */

import React, { useEffect, useState } from "react";

import { getTimeline, type TimelineBucket } from "./api";

const SEG: { key: keyof TimelineBucket; label: string; fill: string }[] = [
  { key: "positive", label: "positive", fill: "#34d399" },
  { key: "mixed", label: "mixed", fill: "#fbbf24" },
  { key: "neutral", label: "neutral", fill: "#71717a" },
  { key: "negative", label: "negative", fill: "#f87171" },
];

const W = 640;
const H = 140;
const PAD = { top: 8, right: 8, bottom: 22, left: 8 };

export function SentimentTimeline({ modelRef }: { modelRef: string }): React.ReactElement | null {
  const [buckets, setBuckets] = useState<TimelineBucket[] | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    getTimeline(modelRef)
      .then((r) => {
        if (alive) setBuckets(r.timeline);
      })
      .catch((err: unknown) => {
        // No chart beats a broken axis; say why in the console.
        console.warn(
          `[mantel] sentiment timeline failed for ${modelRef} ` +
            `(${err instanceof Error ? err.message : String(err)})`,
        );
        if (alive) setBuckets([]);
      });
    return () => {
      alive = false;
    };
  }, [modelRef]);

  if (!buckets || buckets.length === 0) return null;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const maxTotal = Math.max(...buckets.map((b) => b.total), 1);
  // Bars fill the width, with a small gap. One month = one column.
  const step = plotW / buckets.length;
  const barW = Math.max(2, Math.min(40, step * 0.7));

  const active = hover !== null ? buckets[hover] : null;

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono text-xs uppercase tracking-wider text-zinc-500">
          sentiment over time
        </h3>
        <span className="font-mono text-[11px] text-zinc-600">
          {active
            ? `${active.period} · ${active.total} signal${active.total === 1 ? "" : "s"}`
            : `${buckets.length} month${buckets.length === 1 ? "" : "s"} · bar height = volume`}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 w-full"
        role="img"
        aria-label={`Sentiment over time for ${modelRef}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {buckets.map((b, i) => {
          const x = PAD.left + i * step + (step - barW) / 2;
          let y = PAD.top + plotH;
          const colH = (b.total / maxTotal) * plotH;
          const segs = SEG.map((s) => {
            const v = b[s.key] as number;
            if (v <= 0) return null;
            const h = (v / b.total) * colH;
            y -= h;
            return <rect key={s.key} x={x} y={y} width={barW} height={h} fill={s.fill} />;
          });
          return (
            <g
              key={b.period}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            >
              {/* Full-height hit target so thin bars are still hoverable. */}
              <rect
                x={PAD.left + i * step}
                y={PAD.top}
                width={step}
                height={plotH}
                fill="transparent"
              />
              {segs}
              {/* x label every ~ceil(n/8) months to avoid crowding. */}
              {i % Math.ceil(buckets.length / 8) === 0 ? (
                <text
                  x={x + barW / 2}
                  y={H - 6}
                  textAnchor="middle"
                  className="fill-zinc-600"
                  style={{ fontSize: 9, fontFamily: "monospace" }}
                >
                  {b.period.slice(2)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px]">
        {SEG.map((s) => (
          <span key={s.key} className="flex items-center gap-1 text-zinc-500">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.fill }} />
            {s.label}
          </span>
        ))}
        <a
          href={`/api/models/${encodeURIComponent(modelRef)}/timeline`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-zinc-600 underline-offset-4 hover:text-zinc-400 hover:underline"
          title="The raw monthly buckets — every point is reconstructable from the signals behind it"
        >
          data ↗
        </a>
      </div>
    </div>
  );
}
