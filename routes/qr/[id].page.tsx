import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "@interchained/portal-react";
import { ArrowLeft, Download, Printer, QrCode } from "lucide-react";

import { Nav } from "../../src/components/Nav";
import { Footer } from "../../src/components/Footer";
import { Gate } from "../../src/components/Gate";
import { ApiError, adminHeaders, getJson } from "../../src/lib/api";
import { requestUpgrade } from "../../src/lib/upgrade";
import { useBillingStatus } from "../../src/lib/useBillingStatus";
import type { Block, IdentityManifest } from "../../src/lib/identity";

export const intent = {
  purpose:
    "The QR studio — branded profile and per-link QR codes with print-ready downloads and flyers",
  primaryAction: "Download a QR code",
  seoKeyword: "qr codes",
};

/**
 * The QR Studio — Mark's morning idea #2 (7/9): the physical-world
 * counter, branded. Free keeps the default profile QR it was promised;
 * premium unlocks colors, per-link codes (click-tracked via /go with
 * src=qr, so every sticker reports back), SVG + print-size PNGs, and
 * the print flyer.
 *
 * Previews and downloads fetch with the bearer header and travel as
 * blobs — the API is auth-gated, and <img src> can't send tokens.
 */

const PRESETS: Array<{ name: string; fg: string; bg: string }> = [
  { name: "Classic", fg: "#0f172a", bg: "#ffffff" },
  { name: "Soft", fg: "#1e293b", bg: "#f8fafc" },
  { name: "Espresso", fg: "#3f2d23", bg: "#f6efe7" },
  { name: "Forest", fg: "#14532d", bg: "#f0fdf4" },
  { name: "Wine", fg: "#701a30", bg: "#fdf2f4" },
  { name: "Midnight", fg: "#0b1120", bg: "#e2e8f0" },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const chan = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
}

/** Mirrors the server's rule: real contrast, dark-on-light polarity. */
function scannable(fg: string, bg: string): boolean {
  if (!HEX.test(fg) || !HEX.test(bg)) return false;
  const lf = luminance(fg);
  const lb = luminance(bg);
  return (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05) >= 3 && lf < lb;
}

export default function QrStudioPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const { status: billing } = useBillingStatus();
  const [manifest, setManifest] = useState<IdentityManifest | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<string>("profile");
  const [fg, setFg] = useState(PRESETS[0].fg);
  const [bg, setBg] = useState(PRESETS[0].bg);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const previewSeq = useRef(0);

  const walled = Boolean(billing && billing.limitEnabled && !billing.unlimited);
  const styled = fg.toLowerCase() !== PRESETS[0].fg || bg.toLowerCase() !== PRESETS[0].bg;
  const colorsOk = scannable(fg, bg);

  const load = useCallback(async () => {
    setError(null);
    setLocked(false);
    try {
      const j = await getJson<{ manifest: IdentityManifest }>(
        `/api/identities/${encodeURIComponent(id)}`,
      );
      setManifest(j.manifest);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setLocked(true);
        return;
      }
      setError(err instanceof Error ? err.message : "failed to load");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const linkBlocks = useMemo(
    () =>
      (manifest?.blocks ?? [])
        .filter((b: Block) => {
          const u = (b.data as Record<string, unknown>).url;
          return b.type === "link" && typeof u === "string" && /^(https?:|mailto:|tel:)/i.test(u);
        })
        .sort((a, b) => a.order - b.order),
    [manifest],
  );

  const qrUrl = useCallback(
    (opts: { format?: "png" | "svg"; size?: number; download?: boolean } = {}) => {
      const p = new URLSearchParams();
      if (target !== "profile") p.set("target", target);
      if (opts.format) p.set("format", opts.format);
      if (opts.size) p.set("size", String(opts.size));
      if (fg.toLowerCase() !== PRESETS[0].fg) p.set("fg", fg);
      if (bg.toLowerCase() !== PRESETS[0].bg) p.set("bg", bg);
      if (opts.download) p.set("download", "1");
      const qs = p.toString();
      return `/api/identities/${encodeURIComponent(id)}/qr${qs ? `?${qs}` : ""}`;
    },
    [id, target, fg, bg],
  );

  // Live preview — bearer-authenticated fetch → object URL.
  useEffect(() => {
    if (!manifest || !colorsOk) return;
    const seq = ++previewSeq.current;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(qrUrl({ format: "png", size: 512 }), { headers: adminHeaders() });
        if (!r.ok) {
          if (r.status === 403 && seq === previewSeq.current) requestUpgrade("qr");
          return;
        }
        const blob = await r.blob();
        if (seq === previewSeq.current) {
          setPreview((old) => {
            if (old) URL.revokeObjectURL(old);
            return URL.createObjectURL(blob);
          });
        }
      } catch {
        /* preview is best-effort */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [manifest, qrUrl, colorsOk]);

  const download = useCallback(
    async (format: "png" | "svg", size?: number) => {
      if (walled && (styled || target !== "profile")) {
        requestUpgrade("qr");
        return;
      }
      setBusy(true);
      try {
        const r = await fetch(qrUrl({ format, size, download: true }), { headers: adminHeaders() });
        if (r.status === 403) {
          requestUpgrade("qr");
          return;
        }
        if (!r.ok) throw new Error(`download failed (${r.status})`);
        const blob = await r.blob();
        const cd = r.headers.get("content-disposition") ?? "";
        const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? `qr.${format}`;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (err) {
        setError(err instanceof Error ? err.message : "download failed");
      } finally {
        setBusy(false);
      }
    },
    [qrUrl, walled, styled, target],
  );

  if (locked) {
    return (
      <>
        <Nav />
        <Gate onReady={() => void load()} />
      </>
    );
  }
  if (!manifest) {
    return (
      <>
        <Nav />
        <main className="max-w-4xl mx-auto px-5 py-16 text-center text-fg-muted">
          {error ? <p className="text-signal-red font-mono text-sm">{error}</p> : <p>Loading…</p>}
        </main>
      </>
    );
  }

  const premiumChip = (on: boolean) =>
    on ? <span className="chip !text-[10px] text-accent-soft shrink-0">✨ premium</span> : null;

  return (
    <>
      <Nav
        context={
          <>
            <Link href="/identities" className="icon-btn !w-7 !h-7 shrink-0" title="All identities">
              <ArrowLeft size={15} />
            </Link>
            <h1 className="font-display text-sm font-bold truncate inline-flex items-center gap-2">
              <QrCode size={15} className="text-accent-soft" /> QR Studio
            </h1>
            <span className="hidden sm:inline font-mono text-[11px] text-accent-soft truncate shrink-0">
              @{manifest.handle}
            </span>
          </>
        }
        actions={
          <Link href={`/edit/${encodeURIComponent(manifest.identityId)}`} className="btn btn-secondary !py-1.5 !px-3">
            Edit page
          </Link>
        }
      />
      <main className="max-w-5xl mx-auto px-5 py-8">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-8 items-start">
          <section className="grid gap-6">
            <div>
              <h2 className="section-title">What should it open?</h2>
              <p className="section-desc">
                Per-link codes are click-tracked — every sticker reports which counter it works from.
              </p>
              <div className="mt-3 grid gap-2">
                <button
                  onClick={() => setTarget("profile")}
                  className={`panel px-4 py-3 text-left flex items-center gap-3 ${target === "profile" ? "!border-accent/60" : "hover:border-accent/30"}`}
                >
                  <span className="font-semibold text-sm flex-1">Your page — @{manifest.handle}</span>
                  <span className="chip !text-[10px] text-fg-subtle">free</span>
                </button>
                {linkBlocks.map((b) => {
                  const d = b.data as Record<string, unknown>;
                  return (
                    <button
                      key={b.id}
                      onClick={() => {
                        if (walled) {
                          requestUpgrade("qr");
                          return;
                        }
                        setTarget(b.id);
                      }}
                      className={`panel px-4 py-3 text-left flex items-center gap-3 ${target === b.id ? "!border-accent/60" : "hover:border-accent/30"}`}
                    >
                      <span className="font-semibold text-sm flex-1 truncate">
                        {typeof d.label === "string" && d.label ? d.label : "(untitled link)"}
                      </span>
                      {premiumChip(true)}
                    </button>
                  );
                })}
                {linkBlocks.length === 0 && (
                  <p className="text-xs text-fg-subtle">
                    Add link blocks to your page to mint per-link codes.
                  </p>
                )}
              </div>
            </div>

            <div>
              <h2 className="section-title inline-flex items-center gap-2">
                Style {premiumChip(true)}
              </h2>
              <p className="section-desc">
                Brand the code — colors are checked so it always scans.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => {
                      if (walled && p.name !== "Classic") {
                        requestUpgrade("qr");
                        return;
                      }
                      setFg(p.fg);
                      setBg(p.bg);
                    }}
                    className={`chip !px-3 !py-2 text-xs font-semibold inline-flex items-center gap-2 ${fg === p.fg && bg === p.bg ? "!border-accent/60 text-fg" : "text-fg-muted hover:border-accent/40"}`}
                  >
                    <span
                      className="w-4 h-4 rounded-full border border-ink-700"
                      style={{ background: `linear-gradient(135deg, ${p.fg} 50%, ${p.bg} 50%)` }}
                    />
                    {p.name}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 max-w-xs">
                <div>
                  <label className="label">Code</label>
                  <input
                    className="field font-mono"
                    value={fg}
                    maxLength={7}
                    onChange={(e) => {
                      if (walled) {
                        requestUpgrade("qr");
                        return;
                      }
                      setFg(e.target.value);
                    }}
                  />
                </div>
                <div>
                  <label className="label">Background</label>
                  <input
                    className="field font-mono"
                    value={bg}
                    maxLength={7}
                    onChange={(e) => {
                      if (walled) {
                        requestUpgrade("qr");
                        return;
                      }
                      setBg(e.target.value);
                    }}
                  />
                </div>
              </div>
              {!colorsOk && (
                <p className="mt-2 text-xs text-signal-amber">
                  Those colors won't scan — keep the code clearly darker than its background.
                </p>
              )}
            </div>
          </section>

          <aside className="panel p-6 grid gap-4 justify-items-center lg:sticky lg:top-24">
            <div
              className="rounded-2xl p-4 border border-ink-800"
              style={{ background: colorsOk ? bg : undefined }}
            >
              {preview && colorsOk ? (
                <img src={preview} alt="QR preview" className="w-56 h-56" />
              ) : (
                <div className="w-56 h-56 grid place-items-center text-fg-subtle text-xs">
                  {colorsOk ? "rendering…" : "fix the colors to preview"}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 w-full">
              <button onClick={() => void download("png", 1024)} disabled={busy || !colorsOk} className="btn btn-primary !py-2.5 inline-flex items-center justify-center gap-1.5">
                <Download size={14} /> PNG 1024
              </button>
              <button onClick={() => void download("png", 4096)} disabled={busy || !colorsOk} className="btn btn-secondary !py-2.5">
                PNG 4096
              </button>
              <button
                onClick={() => void download("svg")}
                disabled={busy || !colorsOk}
                className="btn btn-secondary !py-2.5 inline-flex items-center justify-center gap-1.5"
              >
                <Download size={14} /> SVG
              </button>
              <button
                onClick={() => {
                  if (walled) {
                    requestUpgrade("qr");
                    return;
                  }
                  const p = new URLSearchParams();
                  if (fg.toLowerCase() !== PRESETS[0].fg) p.set("fg", fg);
                  if (bg.toLowerCase() !== PRESETS[0].bg) p.set("bg", bg);
                  window.open(`/qr/flyer/${encodeURIComponent(manifest.identityId)}${p.toString() ? `?${p}` : ""}`, "_blank", "noopener");
                }}
                className="btn btn-secondary !py-2.5 inline-flex items-center justify-center gap-1.5"
              >
                <Printer size={14} /> Flyer {walled ? "✨" : ""}
              </button>
            </div>
            <p className="text-[11px] text-fg-subtle text-center">
              1024 for cards and stickers · 4096 for posters · SVG scales to anything ·
              the flyer prints straight from the browser.
            </p>
            {error && <p className="text-signal-red text-xs">{error}</p>}
          </aside>
        </div>
      </main>
      <Footer />
    </>
  );
}
