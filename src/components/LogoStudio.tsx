import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

import { clampPan, layoutCover } from "../lib/logoLayout";
import { uploadImageBlob } from "../lib/uploadImage";

/**
 * The logo studio — position, zoom, and a backdrop.
 *
 * Transparent PNGs need a background to sit on; off-center logos need
 * a nudge. The circular stage previews EXACTLY what bakes: one shared
 * layout function drives both the preview transform and the 512×512
 * canvas export. Transparent backdrop exports PNG (alpha kept);
 * a color backdrop exports WebP.
 */

const STAGE = 240;
const EXPORT = 512;

const SWATCHES = [
  "transparent",
  "#ffffff", "#f7f8fa", "#111827", "#0b0d11",
  "#2563eb", "#0e7490", "#db2777", "#f97316", "#22c55e", "#8b5cf6",
];

export function LogoStudio({
  file,
  onDone,
  onClose,
}: {
  file: File;
  onDone: (url: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [bg, setBg] = useState<string>("#ffffff");
  const [custom, setCustom] = useState("#ffffff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

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
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { px: e.clientX, py: e.clientY, x: pan.x, y: pan.y };
    },
    [pan],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current) return;
      const dx = (e.clientX - drag.current.px) / STAGE;
      const dy = (e.clientY - drag.current.py) / STAGE;
      setPan({
        x: clampPan(drag.current.x + dx, zoom),
        y: clampPan(drag.current.y + dy, zoom),
      });
    },
    [zoom],
  );
  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  const bake = useCallback(async () => {
    if (!bmp) return;
    setBusy(true);
    setError(null);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = EXPORT;
      canvas.height = EXPORT;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      if (bg !== "transparent") {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, EXPORT, EXPORT);
      }
      const l = layoutCover(bmp.width, bmp.height, EXPORT, zoom, pan.x, pan.y);
      ctx.drawImage(bmp, l.dx, l.dy, l.dw, l.dh);
      const type = bg === "transparent" ? "image/png" : "image/webp";
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("could not encode the image"))),
          type,
          0.9,
        ),
      );
      const url = await uploadImageBlob(blob);
      onDone(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setBusy(false);
    }
  }, [bmp, bg, zoom, pan, onDone]);

  const preview = bmp ? layoutCover(bmp.width, bmp.height, STAGE, zoom, pan.x, pan.y) : null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="panel p-5 sm:p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="section-title">Frame your logo</h2>
            <p className="section-desc">Drag to position · pinch the slider to zoom</p>
          </div>
          <button onClick={onClose} className="icon-btn" title="Cancel">
            <X size={16} />
          </button>
        </div>

        {/* The stage — circular, exactly what the avatar will show. */}
        <div className="flex justify-center">
          <div
            className="relative rounded-full overflow-hidden border border-ink-700 cursor-grab active:cursor-grabbing touch-none select-none"
            style={{
              width: STAGE,
              height: STAGE,
              background:
                bg === "transparent"
                  ? "repeating-conic-gradient(rgb(var(--ink-800)) 0% 25%, rgb(var(--ink-850)) 0% 50%) 0 0 / 20px 20px"
                  : bg,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {bmp && preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={URL.createObjectURL(file)}
                alt=""
                draggable={false}
                className="absolute max-w-none pointer-events-none"
                style={{ width: preview.dw, height: preview.dh, left: preview.dx, top: preview.dy }}
              />
            )}
            {!bmp && !error && (
              <p className="absolute inset-0 flex items-center justify-center text-xs text-fg-subtle">
                loading…
              </p>
            )}
          </div>
        </div>

        {/* Zoom */}
        <div className="mt-4 flex items-center gap-3">
          <span className="label !mb-0 shrink-0">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => {
              const z = Number(e.target.value);
              setZoom(z);
              setPan((p) => ({ x: clampPan(p.x, z), y: clampPan(p.y, z) }));
            }}
            className="w-full accent-[rgb(var(--accent))]"
          />
        </div>

        {/* Backdrop — transparent logos need a floor to stand on. */}
        <div className="mt-3">
          <span className="label">Background</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => setBg(c)}
                title={c}
                className={`w-7 h-7 rounded-full border transition ${
                  bg === c ? "ring-2 ring-accent border-accent/40" : "border-ink-700"
                }`}
                style={
                  c === "transparent"
                    ? { background: "repeating-conic-gradient(#9994 0% 25%, transparent 0% 50%) 0 0 / 10px 10px" }
                    : { background: c }
                }
              />
            ))}
            <input
              type="color"
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                setBg(e.target.value);
              }}
              title="Custom color"
              className={`w-7 h-7 rounded-full border cursor-pointer ${
                bg === custom && !SWATCHES.includes(bg) ? "ring-2 ring-accent border-accent/40" : "border-ink-700"
              }`}
            />
          </div>
        </div>

        {error && <p className="mt-3 text-signal-red text-xs">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="btn btn-secondary flex-1 !py-2.5">
            Cancel
          </button>
          <button onClick={() => void bake()} disabled={busy || !bmp} className="btn btn-primary flex-1 !py-2.5">
            {busy ? "Uploading…" : (<><Check size={15} /> Use logo</>)}
          </button>
        </div>
      </div>
    </div>
  );
}
