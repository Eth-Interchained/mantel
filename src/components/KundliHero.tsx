import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Camera, Globe, Mail, Send, ShoppingBag, Video } from "lucide-react";
// lucide-react dropped brand/logo glyphs (trademark reasons) — Camera/Video
// stand in for Instagram/YouTube; every other icon here is a real lucide name.

/**
 * The convergence hero — ported from Sukuna's actual Hero.tsx (real
 * source, not the compiled dist we started from). This is a
 * reproduction of his rig, not a reinterpretation of it: a tall scroll
 * track pins the viewport, a canvas draws the scroll-mapped frame from
 * his real 192-shot sequence, floating chips converge toward center as
 * you scroll, three phase labels hand off in sequence, then his real
 * hero copy resolves below the fold.
 *
 * Two differences from his file, both mechanical, not visual:
 *   - No `motion` dependency: the same scroll→value mapping is done by
 *     hand (rAF + exponential easing) so this doesn't add a new
 *     library to the bundle for one component.
 *   - The 192 source JPEGs (6.8MB) are re-encoded at 780px/q7 (~3MB) —
 *     same sequence, same drawImage-per-frame mechanism, lighter asset.
 *     Desktop only; phones get a plain scroll-scrubbed <video> instead
 *     of decoding 192 images, per Mark's call on mobile weight.
 */

const FRAME_COUNT = 192;
const FRAME_BASE = "/brand/kundli/frames/f-";
const MOBILE_SRC = "/brand/kundli/converge.mp4";
const MOBILE_POSTER = "/brand/kundli/converge-poster.webp";

function wantsMotion(): boolean {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    const c = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (c?.saveData) return false;
    if (c?.effectiveType && /(^|-)(slow-)?2g$|^3g$/.test(c.effectiveType)) return false;
    return true;
  } catch {
    return true;
  }
}

function isMobileEngine(): boolean {
  try {
    return window.matchMedia("(pointer: coarse), (max-width: 767px)").matches;
  } catch {
    return false;
  }
}

interface Chip {
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  color: string;
  startX: number;
  startY: number;
}

const CHIPS: Chip[] = [
  { Icon: Camera, label: "Instagram", color: "#E1306C", startX: -30, startY: -22 },
  { Icon: Video, label: "YouTube", color: "#FF0000", startX: 30, startY: -16 },
  { Icon: ShoppingBag, label: "UPI Pay", color: "#F37A20", startX: -24, startY: -4 },
  { Icon: Mail, label: "Inquiries", color: "#EA4335", startX: 25, startY: 5 },
  { Icon: Send, label: "Telegram", color: "#229ED9", startX: -30, startY: 17 },
  { Icon: Globe, label: "Portfolio", color: "#0066FF", startX: 30, startY: 24 },
];

const PHASES = ["Your Digital Presence", "Scattered Everywhere", "Converging Into One Kundli"];

/** Interpolate `v` linearly across breakpoints, clamped at the ends. */
function interp(v: number, stops: number[], values: number[]): number {
  if (v <= stops[0]) return values[0];
  const last = stops.length - 1;
  if (v >= stops[last]) return values[last];
  for (let i = 0; i < last; i++) {
    if (v >= stops[i] && v <= stops[i + 1]) {
      const t = (v - stops[i]) / (stops[i + 1] - stops[i] || 1);
      return values[i] + (values[i + 1] - values[i]) * t;
    }
  }
  return values[last];
}

export function KundliHero(): React.ReactElement {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const framesRef = useRef<HTMLImageElement[]>([]);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [motion, setMotion] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [ready, setReady] = useState(false);
  const rafRef = useRef(0);
  const progressRef = useRef(0); // eased scroll progress, 0..1
  const targetRef = useRef(0);

  useEffect(() => {
    setMotion(wantsMotion());
    setMobile(isMobileEngine());
  }, []);

  // Preload the frame sequence (desktop only).
  useEffect(() => {
    if (!motion || mobile) return;
    let cancelled = false;
    let firstReady = false;
    for (let i = 1; i <= FRAME_COUNT; i++) {
      const img = new Image();
      img.src = `${FRAME_BASE}${String(i).padStart(3, "0")}.jpg`;
      img.onload = () => {
        if (cancelled) return;
        framesRef.current[i - 1] = img;
        if (!firstReady) {
          firstReady = true;
          setReady(true);
        }
      };
    }
    return () => {
      cancelled = true;
    };
  }, [motion, mobile]);

  const drawFrame = useCallback((progress: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const maxIndex = FRAME_COUNT - 1;
    // The sequence finishes its visual convergence by ~85% scroll —
    // the last stretch is label/CTA handoff, not more frames.
    const adjusted = Math.min(1, progress / 0.85);
    const idx = Math.min(maxIndex, Math.max(0, Math.floor(adjusted * FRAME_COUNT)));
    let img = framesRef.current[idx];
    if (!img || !img.complete || img.naturalWidth === 0) {
      for (let off = 1; off < maxIndex; off++) {
        const a = framesRef.current[idx - off];
        if (a?.complete && a.naturalWidth > 0) {
          img = a;
          break;
        }
        const b = framesRef.current[idx + off];
        if (b?.complete && b.naturalWidth > 0) {
          img = b;
          break;
        }
      }
    }
    if (!img || !img.complete || img.naturalWidth === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const dw = rect.width || window.innerWidth;
    const dh = rect.height || window.innerHeight;
    const tw = Math.round(dw * dpr);
    const th = Math.round(dh * dpr);
    if (canvas.width !== tw || canvas.height !== th) {
      canvas.width = tw;
      canvas.height = th;
    }
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const canvasAspect = dw / dh;
    const imgAspect = img.naturalWidth / img.naturalHeight;
    let drawW = dw;
    let drawH = dh;
    let ox = 0;
    let oy = 0;
    if (canvasAspect > imgAspect) {
      drawH = dw / imgAspect;
      oy = (dh - drawH) / 2;
    } else {
      drawW = dh * imgAspect;
      ox = (dw - drawW) / 2;
    }
    ctx.clearRect(0, 0, dw, dh);
    ctx.drawImage(img, ox, oy, drawW, drawH);
    ctx.restore();
  }, []);

  // Scroll drives everything: the canvas frame (desktop) or video
  // currentTime (mobile), plus the chip/label overlay transforms.
  useEffect(() => {
    if (!motion || !ready) return;
    const track = trackRef.current;
    if (!track) return;
    let alive = true;

    const measure = (): void => {
      const r = track.getBoundingClientRect();
      const span = Math.max(1, r.height - window.innerHeight);
      const p = Math.min(1, Math.max(0, -r.top / span));
      targetRef.current = p;
    };
    const tick = (): void => {
      if (!alive) return;
      const cur = progressRef.current;
      const next = cur + (targetRef.current - cur) * 0.18;
      progressRef.current = Math.abs(next - cur) > 0.0005 ? next : targetRef.current;
      const p = progressRef.current;

      if (mobile) {
        const v = videoRef.current;
        if (v && Number.isFinite(v.duration) && v.duration > 0) {
          try {
            v.currentTime = p * (v.duration - 0.05);
          } catch {
            /* seek refused — poster stands in */
          }
        }
      } else {
        drawFrame(p);
      }

      const overlay = overlayRef.current;
      if (overlay) {
        overlay.style.opacity = String(interp(p, [0, 0.55, 0.65], [1, 1, 0]));
        const chips = overlay.querySelectorAll<HTMLElement>("[data-chip]");
        chips.forEach((el) => {
          const sx = Number(el.dataset.sx);
          const sy = Number(el.dataset.sy);
          const x = interp(p, [0, 0.25, 0.48, 0.7], [sx, sx * 0.78, sx * 0.35, 0]);
          const y = interp(p, [0, 0.25, 0.48, 0.7], [sy, sy * 0.78, sy * 0.35, 0]);
          const scale = interp(p, [0, 0.4, 0.7], [1, 1.05, 0]);
          const blur = interp(p, [0.5, 0.7], [0, 6]);
          el.style.transform = `translate(${x}vw, ${y}vh) scale(${scale})`;
          el.style.filter = `blur(${blur}px)`;
        });
        const phaseWindows = [
          [0, 0.08, 0.16, 0.24],
          [0.24, 0.32, 0.4, 0.48],
          [0.5, 0.58, 0.64, 0.7],
        ];
        overlay.querySelectorAll<HTMLElement>("[data-phase]").forEach((el, i) => {
          const w = phaseWindows[i];
          el.style.opacity = String(interp(p, w, [0, 1, 1, 0]));
        });
        const scrollHint = overlay.querySelector<HTMLElement>("[data-scroll-hint]");
        if (scrollHint) scrollHint.style.opacity = String(interp(p, [0, 0.12], [0.85, 0]));
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [motion, ready, mobile, drawFrame]);

  return (
    <section className="w-full">
      <div ref={trackRef} className="relative" style={{ height: motion ? "300vh" : undefined }}>
        <div
          className="sticky top-0 h-[100dvh] w-full overflow-hidden flex flex-col justify-between"
          style={{ background: "#120F0D" }}
        >
          {motion && !mobile && (
            <canvas
              ref={canvasRef}
              aria-hidden
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
                ready ? "opacity-100" : "opacity-0"
              }`}
            />
          )}
          {motion && mobile && (
            <>
              <img
                src={MOBILE_POSTER}
                alt="Your profiles, payments, portfolio and store converging into one Kundli link"
                className="absolute inset-0 w-full h-full object-cover"
                fetchPriority="high"
                decoding="async"
              />
              <video
                ref={videoRef}
                src={MOBILE_SRC}
                muted
                playsInline
                preload="auto"
                aria-hidden
                onLoadedData={() => setReady(true)}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
                  ready ? "opacity-100" : "opacity-0"
                }`}
              />
            </>
          )}
          {!motion && (
            <img
              src={MOBILE_POSTER}
              alt="Your profiles, payments, portfolio and store converging into one Kundli link"
              className="absolute inset-0 w-full h-full object-cover"
              fetchPriority="high"
              decoding="async"
            />
          )}

          {/* Floating chips + phase labels — converge on scroll. */}
          <div ref={overlayRef} className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
            {CHIPS.map((chip) => (
              <div
                key={chip.label}
                data-chip
                data-sx={chip.startX}
                data-sy={chip.startY}
                className="absolute flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2.5 rounded-full text-[#120F0D] border border-white/90 shadow-xl backdrop-blur-xl shrink-0 whitespace-nowrap select-none"
                style={{ background: "rgba(255,255,255,0.72)" }}
              >
                <span className="p-1 sm:p-1.5 rounded-full flex items-center justify-center shrink-0 bg-black/5">
                  <chip.Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: chip.color }} />
                </span>
                <span className="text-[11px] sm:text-xs md:text-sm font-bold tracking-tight whitespace-nowrap">
                  {chip.label}
                </span>
              </div>
            ))}
            {PHASES.map((label) => (
              <div
                key={label}
                data-phase
                className="absolute top-24 sm:top-28 md:top-32 uppercase tracking-[0.25em] text-white/90 text-xs sm:text-sm font-semibold px-4 py-1.5 rounded-full bg-black/30 backdrop-blur-md border border-white/10"
                style={{ opacity: 0 }}
              >
                {label}
              </div>
            ))}
          </div>

          <div
            className="absolute inset-x-0 bottom-0 h-32 pointer-events-none z-[15]"
            style={{ background: "linear-gradient(to top, rgb(var(--ink-950)), rgb(var(--ink-950) / 0.8), transparent)" }}
          />

          <div
            data-scroll-hint
            className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none z-20"
            style={{ opacity: 0.85 }}
          >
            <span className="text-[11px] font-semibold uppercase tracking-widest text-white/70">Scroll to Explore</span>
            <div className="w-5 h-8 rounded-full border-2 border-white/30 flex items-start justify-center p-1">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" />
            </div>
          </div>
        </div>
      </div>

      {/* Hero copy resolves below the fold — Sukuna's actual lines. */}
      <div className="relative z-20 pt-12 pb-20 sm:pt-20 sm:pb-28 px-4 sm:px-6 flex flex-col items-center justify-center">
        <div className="text-center max-w-3xl mx-auto">
          <p className="kicker">your entire digital identity, mapped</p>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-[1.08] mt-4 mb-4 sm:mb-5 tracking-tight">
            Everything you are.
            <br className="hidden sm:block" /> One link away.
          </h1>
          <p className="text-fg-muted text-sm sm:text-base md:text-lg lg:text-xl mb-8 sm:mb-10 max-w-xl mx-auto font-medium leading-relaxed">
            Bring your social profiles, content, portfolio, digital products, WhatsApp, UPI payments, and audience
            together in one friction-free hub.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 w-full max-w-md mx-auto">
            <a href="#features" className="btn btn-primary w-full sm:w-auto !py-3.5 !px-8 !text-base">
              Create your Kundli <ArrowRight size={16} />
            </a>
            <a href="#features" className="btn btn-secondary w-full sm:w-auto !py-3.5 !px-7 !text-base">
              See how it works
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
