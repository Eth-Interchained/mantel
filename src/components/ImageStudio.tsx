import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Crosshair, X } from "lucide-react";

import { coverOverflow, layoutContainRect, layoutCoverRect } from "../lib/logoLayout";
import { uploadImageBlob } from "../lib/uploadImage";

/**
 * The Image Studio — LogoStudio's machinery, generalized to any frame
 * (Mark's spec, 7/9: "a proper image studio — crop, move, fill,
 * center, contain, expand").
 *
 *   Fill (cover) — drag to position, zoom to expand, Center resets.
 *   Fit (contain) — letterboxed on a backdrop color.
 *
 * One pure layout function drives the preview AND the canvas bake, so
 * the crop is exactly WYSIWYG at any aspect: share cards (1.91:1),
 * page backgrounds (9:16), whatever comes next.
 */

const SWATCHES = ["#ffffff", "#f7f8fa", "#111827", "#0b0d11", "#0f172a", "#2563eb", "#0e7490", "#db2777", "#f97316", "#22c55e"];

export function ImageStudio({
  file,
  aspect,
  exportWidth,
  title,
  cta = "Use image",
  onDone,
  onClose,
}: {
  file: File;
  /** width / height of the output frame (1.91 share card, 0.5625 background). */
  aspect: number;
  exportWidth: number;
  title: string;
  cta?: string;
  onDone: (url: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const stageW = 300;
  const stageH = Math.round(stageW / aspect);
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  const [fit, setFit] = useState<"fill" | "fit">("fill");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [bg, setBg] = useState<string>("#0b0d11");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const objectUrl = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl]);

  useEffect(() => {
    let alive = true;
    void createImageBitmap(file, { imageOrientation: "from-image" })
      .catch(() => createImageBitmap(file))
      .then((b) => {
        if (alive) setBmp(b);
        else b.close?.();
      })
      .catch(() => setError("couldn't read that image"));
    return () => {
      alive = false;
    };
  }, [file]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (fit !== "fill") return;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { px: e.clientX, py: e.clientY, x: pan.x, y: pan.y };
    },
    [pan, fit],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current || !bmp) return;
      const { ox, oy } = coverOverflow(bmp.width, bmp.height, stageW, stageH, zoom);
      const nx = drag.current.x + (ox ? ((e.clientX - drag.current.px) * 2) / ox : 0);
      const ny = drag.current.y + (oy ? ((e.clientY - drag.current.py) * 2) / oy : 0);
      setPan({ x: Math.min(1, Math.max(-1, nx)), y: Math.min(1, Math.max(-1, ny)) });
    },
    [bmp, zoom, stageW, stageH],
  );
  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  const layout = useCallback(
    (w: number, h: number) =>
      !bmp
        ? null
        : fit === "fill"
          ? layoutCoverRect(bmp.width, bmp.height, w, h, zoom, pan.x, pan.y)
          : layoutContainRect(bmp.width, bmp.height, w, h),
    [bmp, fit, zoom, pan],
  );

  const bake = useCallback(async () => {
    if (!bmp) return;
    setBusy(true);
    setError(null);
    try {
      const outW = exportWidth;
      const outH = Math.round(exportWidth / aspect);
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, outW, outH);
      const l = layout(outW, outH);
      if (!l) throw new Error("image not ready");
      ctx.drawImage(bmp, l.dx, l.dy, l.dw, l.dh);
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode the image"))), "image/webp", 0.88),
      );
      const url = await uploadImageBlob(blob);
      onDone(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setBusy(false);
    }
  }, [bmp, bg, aspect, exportWidth, layout, onDone]);

  const preview = layout(stageW, stageH);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="panel p-5 sm:p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="section-title">{title}</h2>
            <p className="section-desc">
              {fit === "fill" ? "Drag to position · zoom to expand" : "Fit shows the whole image on a backdrop"}
            </p>
          </div>
          <button onClick={onClose} className="icon-btn" title="Cancel">
            <X size={16} />
          </button>
        </div>

        <div className="flex justify-center">
          <div
            className={`relative overflow-hidden rounded-xl border border-ink-700 touch-none select-none ${fit === "fill" ? "cursor-grab active:cursor-grabbing" : ""}`}
            style={{ width: stageW, height: stageH, background: bg }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {bmp && preview && (
              <img
                src={objectUrl}
                alt=""
                draggable={false}
                className="absolute max-w-none pointer-events-none"
                style={{ width: preview.dw, height: preview.dh, left: preview.dx, top: preview.dy }}
              />
            )}
            {!bmp && !error && (
              <p className="absolute inset-0 flex items-center justify-center text-xs text-fg-subtle">loading…</p>
            )}
          </div>
        </div>

        {/* Fill / Fit / Center — the framing controls. */}
        <div className="mt-4 flex items-center gap-2">
          <div className="flex rounded-lg border border-ink-700 overflow-hidden">
            {(["fill", "fit"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setFit(m)}
                className={`px-3 py-1.5 text-xs font-semibold transition ${fit === m ? "bg-accent/15 text-accent-soft" : "text-fg-muted hover:text-fg"}`}
              >
                {m === "fill" ? "Fill" : "Fit"}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setPan({ x: 0, y: 0 });
              setZoom(1);
            }}
            className="chip text-xs font-semibold text-fg-muted hover:text-fg inline-flex items-center gap-1.5"
            title="Center the image"
          >
            <Crosshair size={12} /> Center
          </button>
        </div>

        {fit === "fill" && (
          <div className="mt-3 flex items-center gap-3">
            <span className="label !mb-0 shrink-0">Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-[rgb(var(--accent))]"
            />
          </div>
        )}

        <div className="mt-3">
          <span className="label">Backdrop{fit === "fill" ? " (edges on zoom-out)" : ""}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => setBg(c)}
                title={c}
                className={`w-7 h-7 rounded-full border transition ${bg === c ? "ring-2 ring-accent border-accent/40" : "border-ink-700"}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>

        {error && <p className="mt-3 text-signal-red text-xs">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="btn btn-secondary flex-1 !py-2.5">
            Cancel
          </button>
          <button onClick={() => void bake()} disabled={busy || !bmp} className="btn btn-primary flex-1 !py-2.5">
            {busy ? "Uploading…" : (<><Check size={15} /> {cta}</>)}
          </button>
        </div>
      </div>
    </div>
  );
}
