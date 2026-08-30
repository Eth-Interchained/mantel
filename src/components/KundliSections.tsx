import React, { useState } from "react";
import {
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Globe,
  HelpCircle,
  IndianRupee,
  Layers,
  Link as LinkIcon,
  Mail,
  Minus,
  MoveUp,
  MousePointerClick,
  Palette,
  Plus,
  QrCode,
  Send,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  TrendingUp,
  Users,
  Video,
  Zap,
} from "lucide-react";

/**
 * Sukuna's real marketing sections, ported from his actual source
 * (kundli.zip, TSX components, not the compiled dist we started from).
 * Same copy, same structure, same interaction patterns — translated to
 * our token classes (`panel`, `.kicker`, `.btn`, `--ink-*`/`--fg-*`)
 * instead of his Tailwind `@theme` names, and with two honesty edits:
 *   - Every mock-interactive demo here (the buy button, the AI prompt
 *     picker, the link re-ranker) is *exactly as mock* in his source —
 *     none of it called a real API there either. We keep that behavior,
 *     we don't fake new capability.
 *   - Pricing is pay-once (Mark's call), not his ₹119/mo subscription —
 *     everything else in that section mirrors his layout.
 * lucide-react here dropped brand glyphs; Camera/Video stand in for
 * Instagram/YouTube, same substitution as the hero.
 */

// ── The Problem ─────────────────────────────────────────────────────
export function TheProblem(): React.ReactElement {
  const [tab, setTab] = useState<"scattered" | "unified">("unified");
  const nodes = [
    { Icon: Camera, color: "#E1306C", label: "Instagram Feed", stat: "Bio link lost" },
    { Icon: Video, color: "#FF0000", label: "YouTube Channel", stat: "Drop-offs" },
    { Icon: ShoppingBag, color: "#F37A20", label: "UPI Digital Shop", stat: "Direct sales" },
    { Icon: Send, color: "#229ED9", label: "Telegram Hub", stat: "1-click join" },
    { Icon: Globe, color: "#0066FF", label: "Portfolio Site", stat: "Case studies" },
    { Icon: Mail, color: "#EA4335", label: "Brand Inquiries", stat: "Instant pitch" },
  ];

  return (
    <section id="features" className="py-20 sm:py-28 px-4 sm:px-6 relative overflow-hidden">
      <div className="max-w-4xl mx-auto flex flex-col items-center text-center relative z-10">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-ink-900 border border-ink-800 text-xs font-bold uppercase tracking-[0.15em] text-fg-subtle mb-5 shadow-xs">
          <Layers className="w-3.5 h-3.5 text-fg" />
          The Modern Problem
        </div>
        <h2 className="font-display text-3xl sm:text-5xl md:text-6xl mb-4 tracking-tight max-w-2xl">
          Your digital presence is scattered across 10 different apps.
        </h2>
        <p className="text-sm sm:text-lg text-fg-muted max-w-xl font-medium mb-10 leading-relaxed">
          Followers get lost, buyers drop off, and potential brand clients struggle to find your latest work. Kundli
          gathers your universe into one high-converting hub.
        </p>

        <div className="flex bg-ink-900 p-1 rounded-full border border-ink-800 shadow-xs mb-10 text-xs font-bold">
          <button
            onClick={() => setTab("scattered")}
            className={`px-4 py-2 rounded-full transition-all ${
              tab === "scattered" ? "bg-black/10 text-fg shadow-xs" : "text-fg-subtle hover:text-fg"
            }`}
          >
            Scattered Links (Before)
          </button>
          <button
            onClick={() => setTab("unified")}
            className={`px-4 py-2 rounded-full transition-all ${
              tab === "unified" ? "bg-fg text-white shadow-md" : "text-fg-subtle hover:text-fg"
            }`}
          >
            Kundli Hub (After)
          </button>
        </div>

        <div className="w-full max-w-2xl panel p-5 sm:p-8 !rounded-[32px] sm:!rounded-[36px] relative">
          {tab === "unified" ? (
            <div className="flex flex-col items-center">
              <div className="w-full max-w-xs bg-ink-900 rounded-2xl p-3.5 border border-ink-800 shadow-sm mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3 text-left">
                  <span className="w-10 h-10 rounded-xl bg-accent/10 text-accent-soft inline-flex items-center justify-center font-display text-lg shrink-0">
                    K
                  </span>
                  <div>
                    <div className="font-display text-base font-bold">kundli/yourname</div>
                    <div className="text-[10px] text-signal-green font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-signal-green animate-pulse" />
                      100% Unified Presence
                    </div>
                  </div>
                </div>
                <Sparkles className="w-4 h-4 text-fg" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3 w-full">
                {nodes.map((n) => (
                  <div
                    key={n.label}
                    className="p-3 bg-ink-900 rounded-xl border border-ink-800 flex items-center gap-2.5 text-left shadow-xs"
                  >
                    <div className="bg-fg/5 p-1.5 rounded-lg shrink-0">
                      <n.Icon className="w-3.5 h-3.5" style={{ color: n.color }} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate">{n.label}</div>
                      <div className="text-[10px] text-fg-subtle font-medium truncate">{n.stat}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-4 flex flex-col items-center">
              <div className="text-xs font-bold text-signal-red bg-signal-red/10 px-3 py-1 rounded-full border border-signal-red/20 mb-5">
                High bounce rate: visitors leave before finding your offerings
              </div>
              <div className="flex flex-wrap justify-center gap-2.5 w-full opacity-70">
                {nodes.map((n) => (
                  <div
                    key={n.label}
                    className="px-3 py-2 bg-ink-900/60 rounded-xl border border-dashed border-signal-red/30 flex items-center gap-2 text-xs font-semibold text-fg-muted"
                  >
                    <n.Icon className="w-3.5 h-3.5" style={{ color: n.color }} />
                    <span>{n.label}</span>
                    <span className="text-[10px] text-signal-red font-bold ml-1">Disconnected</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-6 pt-4 border-t border-ink-800 flex items-center justify-between text-xs font-semibold text-fg-subtle">
            <span>Seamless single-view ecosystem</span>
            <a href="#pricing" className="text-fg font-bold hover:underline inline-flex items-center gap-1">
              Unify now <ArrowRight className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── More than a link (interactive profile mockup) ───────────────────
export function MoreThanALink(): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"all" | "products" | "services">("all");
  return (
    <section className="py-20 sm:py-28 px-4 sm:px-6 relative overflow-hidden">
      <div className="max-w-7xl mx-auto flex flex-col items-center relative z-10">
        <div className="text-center mb-14 sm:mb-20 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-ink-850 border border-ink-800 text-xs font-bold uppercase tracking-[0.15em] text-fg-subtle mb-4 shadow-xs">
            <Sparkles className="w-3.5 h-3.5 text-fg" />
            Next-Gen Profile
          </div>
          <h2 className="font-display text-3xl sm:text-5xl md:text-6xl mb-4 sm:mb-6 tracking-tight">
            A simple list of links isn't enough anymore.
          </h2>
          <p className="text-base sm:text-xl text-fg-muted max-w-2xl mx-auto font-medium leading-relaxed">
            Your audience expects an interactive experience. Kundli turns your bio into a high-speed, mobile
            storefront and personal mini-website.
          </p>
        </div>

        <div className="w-full max-w-md mx-auto panel !rounded-[40px] p-2.5 sm:p-3 relative">
          <div className="bg-ink-850 rounded-[34px] overflow-hidden relative border border-ink-800 shadow-inner">
            <div className="h-32 sm:h-36 bg-gradient-to-r from-ink-850 via-ink-800 to-ink-700 relative">
              <div className="absolute top-4 right-4 flex items-center gap-2">
                <button
                  onClick={() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="px-3 py-1.5 rounded-full bg-ink-900/80 backdrop-blur-md text-[11px] font-bold border border-ink-700 flex items-center gap-1.5 shadow-xs"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-signal-green" /> Copied!
                    </>
                  ) : (
                    <>
                      <ExternalLink className="w-3 h-3" /> Share
                    </>
                  )}
                </button>
              </div>
              <div className="absolute -bottom-10 left-6">
                <div className="w-20 h-20 rounded-full border-4 border-ink-850 shadow-md overflow-hidden bg-gradient-to-br from-fg-muted to-fg flex items-center justify-center text-white font-display text-2xl font-bold">
                  AS
                </div>
              </div>
            </div>
            <div className="px-5 sm:px-6 pt-12 pb-6 flex flex-col gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold">Aisha Sharma</h3>
                  <span className="w-4 h-4 rounded-full bg-fg text-white text-[9px] flex items-center justify-center">
                    ✓
                  </span>
                </div>
                <p className="text-xs font-semibold text-fg-subtle">yourdomain.com/aisha</p>
                <p className="text-xs sm:text-sm text-fg-muted mt-2 font-medium leading-normal">
                  Independent Brand & Product Designer based in Bengaluru. Helping tech founders launch iconic
                  brands.
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href="#features"
                  className="flex-1 py-2.5 px-4 rounded-xl bg-ink-900 border border-ink-800 flex items-center justify-center gap-2 text-xs font-bold hover:bg-ink-850 transition-colors shadow-xs"
                >
                  <span className="w-4 h-4 rounded-full bg-[#25D366]/15 text-[#25D366] inline-flex items-center justify-center">
                    W
                  </span>
                  Chat on WhatsApp
                </a>
                <a
                  href="#features"
                  className="w-10 h-10 rounded-xl bg-ink-900 border border-ink-800 flex items-center justify-center hover:bg-ink-850 transition-colors shadow-xs"
                >
                  <Camera className="w-4 h-4" style={{ color: "#E1306C" }} />
                </a>
              </div>
              <div className="flex gap-1.5 p-1 bg-ink-900/70 rounded-xl border border-ink-800 text-[11px] font-bold">
                {(["all", "products", "services"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setTab(k)}
                    className={`flex-1 py-1.5 rounded-lg transition-all capitalize ${
                      tab === k ? "bg-fg text-white shadow-xs" : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    {k === "all" ? "All Items" : k === "products" ? "Digital Kits" : "Bookings"}
                  </button>
                ))}
              </div>
              <div className="space-y-2.5">
                {(tab === "all" || tab === "services") && (
                  <div className="p-3.5 bg-ink-900 rounded-2xl flex items-center justify-between border border-ink-800 shadow-xs">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                        <Calendar className="w-5 h-5 text-blue-500" />
                      </div>
                      <div>
                        <div className="text-xs sm:text-sm font-bold">1:1 Design Review</div>
                        <div className="text-[11px] text-fg-subtle font-medium">45 mins · video call</div>
                      </div>
                    </div>
                    <div className="px-3 py-1 bg-ink-850 rounded-full text-xs font-bold border border-ink-800">
                      ₹1,499
                    </div>
                  </div>
                )}
                {(tab === "all" || tab === "products") && (
                  <div className="p-3.5 bg-ink-900 rounded-2xl flex items-center justify-between border border-ink-800 shadow-xs">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                        <ShoppingBag className="w-5 h-5 text-accent-soft" />
                      </div>
                      <div>
                        <div className="text-xs sm:text-sm font-bold">Design System UI Kit</div>
                        <div className="text-[11px] text-fg-subtle font-medium">Figma file · 120+ components</div>
                      </div>
                    </div>
                    <div className="px-3 py-1 bg-ink-850 rounded-full text-xs font-bold border border-ink-800">
                      ₹699
                    </div>
                  </div>
                )}
                {(tab === "all" || tab === "services") && (
                  <div className="p-3.5 bg-ink-900 rounded-2xl flex items-center justify-between border border-ink-800 shadow-xs">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                        <LinkIcon className="w-5 h-5 text-purple-500" />
                      </div>
                      <div>
                        <div className="text-xs sm:text-sm font-bold">Featured Case Studies</div>
                        <div className="text-[11px] text-fg-subtle font-medium">Recent product work</div>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-fg-subtle" />
                  </div>
                )}
              </div>
              <div className="text-center pt-2">
                <span className="text-[10px] font-bold tracking-widest uppercase text-fg-subtle">
                  Powered by Kundli
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Built for India ──────────────────────────────────────────────────
export function IndiaFirst(): React.ReactElement {
  const [copiedUPI, setCopiedUPI] = useState(false);
  const features = [
    {
      Icon: () => (
        <span className="w-7 h-7 rounded-md bg-[#25D366]/15 text-[#25D366] inline-flex items-center justify-center font-bold">
          W
        </span>
      ),
      badge: "Live today",
      live: true,
      title: "1-Tap WhatsApp",
      desc: "Turn visitors into direct conversations instantly. No forms, no friction — and the first message is already typed.",
      preview: (
        <div className="mt-4 p-3.5 bg-ink-900 rounded-2xl border border-ink-800 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#25D366]/15 flex items-center justify-center text-[#25D366] font-bold text-sm">
              W
            </div>
            <div>
              <div className="text-xs font-bold">"Hey Aisha, loved your work!"</div>
              <div className="text-[10px] text-fg-subtle">Pre-filled message template</div>
            </div>
          </div>
          <span className="px-2.5 py-1 bg-[#25D366] text-white text-[10px] font-bold rounded-lg shadow-xs">Send</span>
        </div>
      ),
    },
    {
      Icon: () => <IndianRupee className="w-7 h-7 text-accent-soft" />,
      badge: "Live today",
      live: true,
      title: "Seamless UPI Payments",
      desc: "Paid straight to your bank from GPay, PhonePe, Paytm or CRED. Your UPI ID, your money — no gateway, no middleman, and we never take a cut.",
      preview: (
        <div className="mt-4 p-3.5 bg-ink-900 rounded-2xl border border-ink-800 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <div className="px-2 py-1 bg-accent/10 text-accent-soft text-xs font-bold rounded-md">UPI</div>
            <span className="text-xs font-bold">aisha@okhdfcbank</span>
          </div>
          <button
            onClick={() => {
              setCopiedUPI(true);
              setTimeout(() => setCopiedUPI(false), 2000);
            }}
            className="px-2.5 py-1 bg-fg text-white text-[10px] font-bold rounded-lg"
          >
            {copiedUPI ? "Copied" : "Copy"}
          </button>
        </div>
      ),
    },
    {
      Icon: () => <QrCode className="w-7 h-7 text-fg" />,
      badge: "Live today",
      live: true,
      title: "Customizable QR Codes",
      desc: "Print your Kundli QR on business cards, packaging, merch, or display at events for instant scans.",
      preview: (
        <div className="mt-4 p-3.5 bg-ink-900 rounded-2xl border border-ink-800 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-fg text-white rounded-lg flex items-center justify-center font-mono text-xs font-bold">
              QR
            </div>
            <span className="text-xs font-bold">Vector SVG & PNG ready</span>
          </div>
          <span className="text-[10px] font-bold text-fg-muted uppercase bg-black/5 px-2 py-1 rounded-md">
            Download
          </span>
        </div>
      ),
    },
    {
      Icon: () => <Smartphone className="w-7 h-7 text-blue-500" />,
      badge: "Live today",
      live: true,
      title: "Sub-Second Mobile Speeds",
      desc: "Engineered for Indian mobile networks — visitors get plain HTML, not an app, so pages open fast on any 4G phone.",
      preview: (
        <div className="mt-4 p-3.5 bg-ink-900 rounded-2xl border border-ink-800 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2 text-xs font-bold text-signal-green">
            <ShieldCheck className="w-4 h-4" /> No client JS on public pages
          </div>
        </div>
      ),
    },
  ];

  return (
    <section className="py-20 sm:py-28 px-4 sm:px-6 relative overflow-hidden">
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="text-center mb-16 sm:mb-20 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-ink-900 border border-ink-800 text-xs font-bold uppercase tracking-[0.15em] text-fg-subtle mb-4 shadow-xs">
            <Sparkles className="w-3.5 h-3.5 text-fg" />
            Built In India, For India
          </div>
          <h2 className="font-display text-3xl sm:text-5xl md:text-6xl mb-4 sm:mb-6 tracking-tight">
            Designed for how India actually connects.
          </h2>
          <p className="text-base sm:text-xl text-fg-muted font-medium leading-relaxed">
            Global link trees weren't built for WhatsApp and UPI. Kundli is deeply crafted around the habits of
            Indian audiences and creators.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
          {features.map((f) => (
            <div key={f.title} className="panel p-6 sm:p-8 !rounded-[32px] sm:!rounded-[36px] flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-6">
                  <div className="p-3 bg-ink-900 rounded-2xl border border-ink-800 shadow-xs">
                    <f.Icon />
                  </div>
                  <span
                    className={`text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full border ${
                      f.live
                        ? "text-signal-green bg-signal-green/10 border-signal-green/25"
                        : "text-fg-subtle bg-ink-850 border-ink-800"
                    }`}
                  >
                    {f.badge}
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-display font-bold mb-3">{f.title}</h3>
                <p className="text-sm sm:text-base text-fg-muted font-medium leading-relaxed">{f.desc}</p>
              </div>
              <div className={`pt-2 ${f.live ? "" : "opacity-60"}`}>{f.preview}</div>
            </div>
          ))}
        </div>
        <p className="text-center text-[11px] text-fg-subtle mt-8 max-w-xl mx-auto leading-relaxed">
          All four are live today. UPI pays you directly — because a UPI link has no callback, your
          bank is the receipt, not us.
        </p>
      </div>
    </section>
  );
}

// ── Creator commerce ──────────────────────────────────────────────────
export function CreatorCommerce(): React.ReactElement {
  const [loading, setLoading] = useState(false);
  const [purchased, setPurchased] = useState(false);
  const simulate = (): void => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setPurchased(true);
      setTimeout(() => setPurchased(false), 4500);
    }, 1200);
  };
  return (
    <section className="py-20 sm:py-28 px-4 sm:px-6 bg-ink-850 relative overflow-hidden">
      <div className="max-w-6xl mx-auto flex flex-col lg:flex-row items-center gap-12 lg:gap-16 relative z-10">
        <div className="flex-1 text-center lg:text-left">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-ink-900 border border-ink-800 text-xs font-bold uppercase tracking-[0.15em] text-fg-subtle mb-6 shadow-xs">
            <Zap className="w-3.5 h-3.5 text-accent-soft" />
            Direct Monetization
          </div>
          <h2 className="font-display text-3xl sm:text-5xl md:text-6xl mb-4 sm:mb-6 tracking-tight">
            Turn attention into instant income.
          </h2>
          <p className="text-base sm:text-xl text-fg-muted font-medium mb-8 sm:mb-10 max-w-lg mx-auto lg:mx-0 leading-relaxed">
            Sell digital templates, courses, consultations, presets, and audio samples directly on your profile with
            zero-friction UPI checkout.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
            <a href="#pricing" className="btn btn-primary !py-3.5 !px-8 !text-base">
              Start selling with Kundli <ArrowRight size={16} />
            </a>
          </div>
          <div className="mt-8 flex items-center justify-center lg:justify-start gap-6 text-xs font-bold text-fg-subtle">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-signal-green" /> Direct bank deposits
            </span>
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-accent-soft" /> 0% hidden fees
            </span>
          </div>
        </div>
        <div className="flex-1 w-full max-w-md relative">
          <div className="panel !rounded-[36px] p-6 sm:p-8 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 bg-accent/10 rounded-2xl flex items-center justify-center border border-accent/20">
                  <ShoppingBag className="w-6 h-6 text-accent-soft" />
                </div>
                <div>
                  <h4 className="font-bold text-base sm:text-lg">Freelancer Notion OS</h4>
                  <p className="text-xs text-fg-subtle font-medium">Digital Product · Instant Download</p>
                </div>
              </div>
              <span className="px-2.5 py-1 bg-signal-green/10 text-signal-green text-[10px] font-bold uppercase rounded-full">
                Instant UPI
              </span>
            </div>
            <div className="p-4 bg-ink-900 rounded-2xl border border-ink-800 flex items-center justify-between shadow-xs">
              <div>
                <span className="text-xs text-fg-subtle line-through block">₹1,299</span>
                <span className="font-display text-3xl font-bold">₹499</span>
              </div>
              <button
                onClick={simulate}
                disabled={loading || purchased}
                className="px-6 py-2.5 bg-fg text-white rounded-xl text-xs sm:text-sm font-bold shadow-md flex items-center gap-2"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : purchased ? (
                  <>
                    <Check className="w-4 h-4 text-signal-green" /> Paid!
                  </>
                ) : (
                  <>
                    Buy with UPI <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
            {purchased && (
              <div className="p-3.5 bg-signal-green/10 border border-signal-green/25 rounded-2xl flex items-center gap-3 text-xs text-fg font-semibold">
                <div className="w-8 h-8 rounded-full bg-signal-green text-white flex items-center justify-center shrink-0">
                  <Download className="w-4 h-4" />
                </div>
                <div>
                  <div>Payment verified via UPI!</div>
                  <div className="text-[11px] text-fg-muted font-normal">
                    Download link sent to customer email & WhatsApp.
                  </div>
                </div>
              </div>
            )}
            <div className="pt-3 border-t border-ink-800 flex items-center justify-between text-xs font-semibold text-fg-muted">
              <div className="flex items-center gap-1.5">
                <IndianRupee className="w-4 h-4 text-accent-soft" />
                <span>Supports GPay, PhonePe, Paytm</span>
              </div>
              <span className="text-[11px] text-fg-subtle">Instant 1-click</span>
            </div>
          </div>
        </div>
      </div>
      <p className="text-center text-[11px] text-fg-subtle mt-10 relative z-10">
        UPI payments are live today — this demo is an illustration of the storefront. Digital-product
        delivery and paid bookings are shipping next.
      </p>
    </section>
  );
}

// ── Lead capture (mock, exactly as mock in the source — no real send) ─
export function LeadCapture(): React.ReactElement {
  const [submitted, setSubmitted] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  return (
    <section className="py-20 sm:py-28 px-4 sm:px-6 relative overflow-hidden" style={{ background: "#120F0D", color: "#fff" }}>
      <div className="max-w-4xl mx-auto rounded-[36px] sm:rounded-[44px] p-8 sm:p-14 md:p-16 border border-white/15 text-center relative z-10 shadow-2xl" style={{ background: "rgba(255,255,255,0.04)" }}>
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/20 text-xs font-bold uppercase tracking-[0.15em] text-white/80 mb-6 backdrop-blur-md">
          <BookOpen className="w-3.5 h-3.5" />
          Free Playbook
        </div>
        <h2 className="font-display text-2xl sm:text-4xl md:text-5xl text-white mb-4 tracking-tight">
          The 2026 India Creator Playbook.
        </h2>
        <p className="text-sm sm:text-lg text-white/80 font-medium mb-10 sm:mb-12 max-w-lg mx-auto leading-relaxed">
          How top Indian creators, designers, and educators are turning bio links into six-figure monthly businesses.
        </p>
        {!submitted ? (
          <form
            className="flex flex-col sm:flex-row gap-3 sm:gap-4 max-w-2xl mx-auto"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim() || !contact.trim()) return;
              setSubmitted(true);
            }}
          >
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="flex-1 bg-white/10 border border-white/20 rounded-2xl px-5 sm:px-6 py-3.5 sm:py-4 focus:outline-none focus:border-white/60 text-white placeholder-white/50 text-sm font-medium"
            />
            <input
              type="text"
              placeholder="Email or WhatsApp number"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              required
              className="flex-1 bg-white/10 border border-white/20 rounded-2xl px-5 sm:px-6 py-3.5 sm:py-4 focus:outline-none focus:border-white/60 text-white placeholder-white/50 text-sm font-medium"
            />
            <button
              type="submit"
              className="bg-white text-black px-7 sm:px-8 py-3.5 sm:py-4 rounded-2xl font-bold text-sm sm:text-base flex items-center justify-center gap-2 whitespace-nowrap shadow-lg shrink-0"
            >
              Get free guide <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : (
          <div className="p-6 bg-white/10 border border-white/20 rounded-2xl max-w-md mx-auto text-center">
            <CheckCircle2 className="w-10 h-10 text-signal-green mx-auto mb-3" />
            <h4 className="text-lg font-bold text-white mb-1">Playbook sent!</h4>
            <p className="text-xs text-white/80">Check your inbox and WhatsApp for your copy.</p>
          </div>
        )}
        <div className="mt-8 sm:mt-10 flex flex-wrap items-center justify-center gap-6 text-[11px] font-semibold text-white/60 uppercase tracking-widest">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-signal-green animate-pulse" /> Instant delivery
          </span>
          <span>·</span>
          <span>No spam</span>
        </div>
      </div>
    </section>
  );
}

// ── Analytics (mock numbers — his source, same honesty) ───────────────
export function KundliAnalytics(): React.ReactElement {
  const [tf, setTf] = useState<"7d" | "30d" | "all">("30d");
  const metrics = [
    {
      id: "views",
      Icon: Users,
      color: "text-blue-500",
      label: "Unique profile views",
      value: tf === "7d" ? "3,480" : tf === "30d" ? "18,420" : "142,800",
      change: "+24.6%",
      bars: [40, 65, 55, 80, 75, 90, 100],
    },
    {
      id: "clicks",
      Icon: MousePointerClick,
      color: "text-purple-500",
      label: "Total link clicks",
      value: tf === "7d" ? "1,120" : tf === "30d" ? "5,890" : "48,200",
      change: "+18.2%",
      bars: [30, 45, 60, 50, 70, 85, 95],
    },
    {
      id: "revenue",
      Icon: IndianRupee,
      color: "text-accent-soft",
      label: "Gross INR revenue",
      value: tf === "7d" ? "₹14,200" : tf === "30d" ? "₹68,450" : "₹4,82,000",
      change: "+32.4%",
      bars: [20, 50, 40, 65, 80, 85, 100],
    },
    {
      id: "conversion",
      Icon: TrendingUp,
      color: "text-signal-green",
      label: "Click-to-action rate",
      value: "31.8%",
      change: "+4.1%",
      bars: [50, 55, 60, 65, 70, 75, 80],
    },
  ];
  return (
    <section className="py-20 sm:py-28 px-4 sm:px-6 relative overflow-hidden">
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-14 sm:mb-16 gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-ink-850 border border-ink-800 text-xs font-bold uppercase tracking-[0.15em] text-fg-subtle mb-4 shadow-xs">
              <BarChart3 className="w-3.5 h-3.5 text-fg" />
              Real-Time Intelligence
            </div>
            <h2 className="font-display text-3xl sm:text-5xl md:text-6xl mb-3 tracking-tight">
              Know exactly what resonates.
            </h2>
            <p className="text-base sm:text-xl text-fg-muted font-medium max-w-xl leading-relaxed">
              Understand which links drive revenue, which social channels convert best, and where your audience
              comes from.
            </p>
          </div>
          <div className="flex items-center p-1 bg-ink-850 rounded-2xl border border-ink-800 text-xs font-bold self-start md:self-auto">
            {(["7d", "30d", "all"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setTf(k)}
                className={`px-4 py-2 rounded-xl transition-all ${
                  tf === k ? "bg-fg text-white shadow-xs" : "text-fg-muted hover:text-fg"
                }`}
              >
                {k === "7d" ? "Last 7 days" : k === "30d" ? "Last 30 days" : "All time"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6">
          {metrics.map((m) => (
            <div key={m.id} className="panel p-6 sm:p-7 !rounded-[28px] sm:!rounded-[32px] flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-ink-900 border border-ink-800 flex items-center justify-center shadow-xs">
                    <m.Icon className={`w-5 h-5 ${m.color}`} />
                  </div>
                  <div className="flex items-center gap-1 text-xs font-bold text-signal-green bg-signal-green/10 px-2.5 py-1 rounded-full border border-signal-green/20">
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    {m.change}
                  </div>
                </div>
                <div className="text-2xl sm:text-3xl font-display font-bold tracking-tight">{m.value}</div>
                <div className="text-xs sm:text-sm font-semibold text-fg-muted mt-1">{m.label}</div>
              </div>
              <div className="mt-6 pt-4 border-t border-ink-800">
                <div className="flex items-end gap-1.5 h-10">
                  {m.bars.map((h, i) => (
                    <div key={i} className="flex-1 bg-fg/10 rounded-t-sm" style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── AI bio generator + smart link ranking (mock demos) ────────────────
export function AIAndSmartLinks(): React.ReactElement {
  const [selected, setSelected] = useState(0);
  const [links, setLinks] = useState([
    { id: "1", title: "Design portfolio & case studies", clicks: "2,480 clicks", boost: "+42%" },
    { id: "2", title: "1-on-1 consultation booking", clicks: "1,890 clicks", boost: "+28%" },
    { id: "3", title: "WhatsApp direct chat", clicks: "3,120 clicks", boost: "+64%" },
  ]);
  const prompts = [
    { text: "Freelance UI/UX designer from Kolkata", theme: "Warm Minimalist", modules: "Portfolio, Figma Kits, Bookings" },
    { text: "Tech educator & YouTuber in Hyderabad", theme: "Cyber Clean", modules: "Course, Discord, Mentorship" },
    { text: "Indie coffee brand & roastery in Coorg", theme: "Organic Earth", modules: "Shop Beans, Locations, Menu" },
  ];
  const promote = (idx: number): void => {
    if (idx === 0) return;
    const next = [...links];
    const [item] = next.splice(idx, 1);
    next.unshift(item);
    setLinks(next);
  };
  return (
    <section className="py-20 sm:py-28 px-4 sm:px-6 relative overflow-hidden">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 relative z-10">
        <div className="panel p-8 sm:p-10 !rounded-[36px] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-6">
              <div className="w-12 h-12 rounded-2xl bg-ink-850 border border-ink-800 flex items-center justify-center shadow-xs">
                <Sparkles className="w-6 h-6 text-fg" />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-fg-subtle px-3 py-1 bg-ink-900 rounded-full border border-ink-800">
                AI Engine
              </span>
            </div>
            <h2 className="font-display text-2xl sm:text-3xl mb-3 font-bold">
              Let Kundli build your page in 5 seconds.
            </h2>
            <p className="text-sm sm:text-base text-fg-muted font-medium mb-8 leading-relaxed">
              Describe your craft in a few words. Our AI creates your custom bio, color palette, typography pairing,
              and profile cards instantly.
            </p>
          </div>
          <div className="w-full bg-ink-900 p-5 rounded-2xl border border-ink-800 shadow-xs">
            <div className="text-xs font-bold text-fg-subtle uppercase tracking-wider mb-2.5">
              Try sample creator prompts:
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              {prompts.map((p, i) => (
                <button
                  key={p.text}
                  onClick={() => setSelected(i)}
                  className={`text-xs px-3 py-1.5 rounded-xl font-medium transition-all text-left ${
                    selected === i ? "bg-fg text-white shadow-xs" : "bg-ink-850 text-fg-muted hover:bg-black/5"
                  }`}
                >
                  {p.text}
                </button>
              ))}
            </div>
            <div className="p-3.5 bg-ink-850 rounded-xl border border-ink-800 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span>Theme: {prompts[selected].theme}</span>
                <span className="text-signal-green flex items-center gap-1 text-[11px]">
                  <Check className="w-3 h-3" /> Ready
                </span>
              </div>
              <div className="text-xs text-fg-muted font-medium">
                Auto-configured modules: <span className="font-semibold text-fg">{prompts[selected].modules}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="panel p-8 sm:p-10 !rounded-[36px] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-6">
              <div className="w-12 h-12 rounded-2xl bg-ink-850 border border-ink-800 flex items-center justify-center shadow-xs">
                <ArrowDownUp className="w-6 h-6 text-fg" />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-fg-subtle px-3 py-1 bg-ink-900 rounded-full border border-ink-800">
                Self-Optimizing
              </span>
            </div>
            <h2 className="font-display text-2xl sm:text-3xl mb-3 font-bold">Autonomous link ranking.</h2>
            <p className="text-sm sm:text-base text-fg-muted font-medium mb-8 leading-relaxed">
              Kundli analyzes visitor intent and intelligently surfaces high-converting links to the top of your list
              so you never leave money on the table.
            </p>
          </div>
          <div className="w-full space-y-2.5">
            {links.map((link, idx) => (
              <div key={link.id} className="p-3.5 sm:p-4 bg-ink-900 rounded-2xl flex items-center justify-between border border-ink-800 shadow-xs">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono font-bold text-fg-subtle w-4">#{idx + 1}</span>
                  <div>
                    <div className="text-xs sm:text-sm font-bold">{link.title}</div>
                    <div className="text-[11px] text-fg-subtle">{link.clicks}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-signal-green bg-signal-green/10 px-2 py-0.5 rounded-md">
                    {link.boost}
                  </span>
                  {idx > 0 && (
                    <button
                      onClick={() => promote(idx)}
                      title="Move to top"
                      className="p-1.5 rounded-lg bg-ink-850 hover:bg-black/10 transition-colors"
                    >
                      <MoveUp className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Templates carousel ─────────────────────────────────────────────────
export function KundliTemplates(): React.ReactElement {
  const [cat, setCat] = useState("all");
  const categories = [
    { id: "all", label: "All Templates" },
    { id: "creator", label: "Content Creators" },
    { id: "design", label: "Designers & Devs" },
    { id: "commerce", label: "Shops & Brands" },
    { id: "expert", label: "Coaches & Mentors" },
  ];
  const templates = [
    { name: "Warm Ivory Studio", category: "design", badge: "Editor Choice", bg: "#FAF5F0", fg: "#120F0D", desc: "Editorial typography with warm cream gradients" },
    { name: "Midnight Luxe", category: "creator", badge: "Trending", bg: "#14110F", fg: "#FAF5F0", desc: "Dark luxury glassmorphism for tech founders" },
    { name: "Earthy Roastery", category: "commerce", badge: "UPI Ready", bg: "#EFE8E1", fg: "#1E1916", desc: "Organic textures for artisans and indie shops" },
    { name: "Nordic Crystal", category: "design", badge: "Minimal", bg: "#FFFFFF", fg: "#120F0D", desc: "High contrast clean grid for portfolio showcases" },
    { name: "Bengaluru Silicon", category: "expert", badge: "High Convert", bg: "#F2ECE6", fg: "#120F0D", desc: "WhatsApp and calendar booking focused layout" },
  ];
  const filtered = cat === "all" ? templates : templates.filter((t) => t.category === cat);
  return (
    <section id="templates" className="py-20 sm:py-28 px-4 sm:px-6 overflow-hidden relative">
      <div className="max-w-7xl mx-auto mb-12 sm:mb-16">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
          <div>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-ink-850 border border-ink-800 text-xs font-bold uppercase tracking-[0.15em] text-fg-subtle mb-4 shadow-xs">
              <Palette className="w-3.5 h-3.5 text-fg" />
              Bespoke Presets
            </div>
            <h2 className="font-display text-3xl sm:text-5xl md:text-6xl mb-3 tracking-tight">
              Crafted templates. Zero coding.
            </h2>
            <p className="text-base sm:text-xl text-fg-muted font-medium max-w-xl leading-relaxed">
              Start with high-converting responsive layouts created by India's top brand designers.
            </p>
          </div>
          <div className="flex items-center gap-3 self-start md:self-auto">
            <button className="w-11 h-11 rounded-full bg-ink-900 border border-ink-800 flex items-center justify-center hover:bg-ink-850 transition-colors shadow-xs" aria-label="Scroll left">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button className="w-11 h-11 rounded-full bg-ink-900 border border-ink-800 flex items-center justify-center hover:bg-ink-850 transition-colors shadow-xs" aria-label="Scroll right">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                cat === c.id ? "bg-fg text-white shadow-xs" : "bg-ink-850 text-fg-muted hover:bg-ink-800 border border-ink-800"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-6 overflow-x-auto pb-10 px-4 sm:px-6 -mx-4 sm:-mx-6 md:px-0 md:mx-auto max-w-7xl snap-x snap-mandatory">
        {filtered.map((t, i) => (
          <div
            key={t.name}
            className="shrink-0 w-[270px] sm:w-[310px] aspect-[9/16] rounded-[36px] p-6 snap-center relative flex flex-col justify-between shadow-lg border border-ink-800 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 cursor-pointer"
            style={{ background: t.bg, color: t.fg }}
          >
            <div className="flex justify-between items-center">
              <span className="text-[11px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-full bg-black/10">
                {t.badge}
              </span>
              <span className="text-xs font-mono font-semibold opacity-60">#0{i + 1}</span>
            </div>
            <div className="my-auto text-center">
              <div className="w-16 h-16 rounded-full bg-current opacity-20 mx-auto mb-4 border border-current/20" />
              <div className="w-3/4 h-3.5 rounded-full bg-current opacity-25 mx-auto mb-2" />
              <div className="w-1/2 h-2.5 rounded-full bg-current opacity-15 mx-auto mb-6" />
              <div className="space-y-2.5">
                {["Featured Project", "WhatsApp Inquiries", "UPI Instant Pay"].map((s) => (
                  <div key={s} className="w-full h-10 rounded-xl bg-current opacity-10 flex items-center justify-center text-[10px] font-bold uppercase tracking-wider">
                    {s}
                  </div>
                ))}
              </div>
            </div>
            <div className="pt-3 border-t border-current/10">
              <h4 className="text-base font-bold">{t.name}</h4>
              <p className="text-xs opacity-75 font-medium mt-0.5">{t.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Social proof marquee ───────────────────────────────────────────────
export function SocialProof(): React.ReactElement {
  const row1 = ["Designers", "Founders", "YouTubers", "Educators", "Developers", "Architects", "Writers", "Podcasters"];
  const row2 = ["Artists", "Consultants", "Photographers", "Indie Makers", "Musicians", "Coaches", "Freelancers", "Agencies"];
  return (
    <section className="py-16 sm:py-20 px-4 sm:px-6 bg-ink-850 border-y border-ink-800 overflow-hidden">
      <div className="max-w-7xl mx-auto flex flex-col items-center">
        <div className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-ink-900/70 border border-ink-800 text-[11px] font-bold uppercase tracking-[0.2em] text-fg-subtle mb-8 sm:mb-10 shadow-xs">
          <Sparkles className="w-3 h-3 text-fg" />
          The Digital Identity Engine For India's Next Generation
        </div>
        <div className="w-full relative flex items-center overflow-hidden h-12 sm:h-16 mb-2 kundli-marquee-mask">
          <div className="flex whitespace-nowrap gap-8 sm:gap-12 animate-[kundli-marquee_25s_linear_infinite]">
            {[...row1, ...row1, ...row1].map((c, i) => (
              <div key={i} className="font-display text-2xl sm:text-4xl md:text-5xl text-fg/30 italic px-3 flex items-center gap-4">
                <span>{c}</span>
                <span className="text-sm font-sans font-light opacity-40">✦</span>
              </div>
            ))}
          </div>
        </div>
        <div className="w-full relative flex items-center overflow-hidden h-12 sm:h-16 kundli-marquee-mask">
          <div className="flex whitespace-nowrap gap-8 sm:gap-12 animate-[kundli-marquee-rev_28s_linear_infinite]">
            {[...row2, ...row2, ...row2].map((c, i) => (
              <div key={i} className="font-display text-2xl sm:text-4xl md:text-5xl text-fg/25 italic px-3 flex items-center gap-4">
                <span>{c}</span>
                <span className="text-sm font-sans font-light opacity-40">✦</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── FAQ ─────────────────────────────────────────────────────────────────
interface FaqItem {
  category: string;
  q: string;
  a: string;
}

export function KundliFAQ({ brand, freeBlocks }: { brand: string; freeBlocks: number }): React.ReactElement {
  const [open, setOpen] = useState<number | null>(0);
  const [filter, setFilter] = useState("All");
  const faqs: FaqItem[] = [
    {
      category: "Product",
      q: `What is ${brand}?`,
      a: `${brand} is your digital identity mapped into one single, fast-loading link — your social presence, portfolio, galleries, giveaways, 1-tap WhatsApp, UPI payments, a print-grade QR code and live stats, all on one page.`,
    },
    {
      category: "Product",
      q: "How is it different from a traditional link-in-bio tool?",
      a: "Traditional link trees are flat lists of generic buttons. This is a personal mini-website: galleries, giveaways people can verify, a print-grade QR, save-my-contact, and a public page that loads instantly because visitors get plain HTML, not an app.",
    },
    {
      category: "Legacy & Migration",
      q: "What existing OurLynx features are included?",
      a: "This is the same engine as OurLynx, restyled for India. Every trusted feature — unlimited links, analytics, theming, QR codes — is included with a complete visual upgrade.",
    },
    {
      category: "Legacy & Migration",
      q: "Can I migrate an existing OurLynx profile?",
      a: "Yes — it's the same engine underneath. Your links, themes and stats come with you.",
    },
    {
      category: "India & Payments",
      q: "How does the WhatsApp button work?",
      a: "Add your number and the message you want visitors to send — \"Hi, I'd like to book a consultation\" — and one tap opens WhatsApp with it already typed. You get a qualified lead instead of a cold \"hey\", and the tap shows up in your stats like any other link.",
    },
    {
      category: "India & Payments",
      q: "How do UPI payments work — and what do you take?",
      a: "You add your own UPI ID. The button opens the payer's UPI app (GPay, PhonePe, Paytm, CRED) pointed straight at your address, so the money moves bank to bank. We are not in the transaction: no gateway, no merchant account, no custody, and we take nothing. One honest limit — a UPI link has no callback, so this page can never know a payment landed. Check your own UPI app or bank before you deliver anything; we will never show you a fake receipt.",
    },
    {
      category: "Pricing",
      q: "Is it really free?",
      a: `Yes. Your first page is free forever — ${freeBlocks} blocks, every theme, the QR code and live stats. Premium is one payment, whatever it's worth to you — never a subscription.`,
    },
  ];
  const categories = ["All", "Product", "India & Payments", "Pricing", "Legacy & Migration"];
  const filtered = filter === "All" ? faqs : faqs.filter((f) => f.category === filter);
  return (
    <section className="py-20 sm:py-28 px-4 sm:px-6 relative overflow-hidden">
      <div className="max-w-3xl mx-auto relative z-10">
        <div className="text-center mb-12 sm:mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-ink-900 border border-ink-800 text-xs font-bold uppercase tracking-[0.15em] text-fg-subtle mb-4 shadow-xs">
            <HelpCircle className="w-3.5 h-3.5 text-fg" />
            Frequently Asked Questions
          </div>
          <h2 className="font-display text-3xl sm:text-5xl md:text-6xl mb-4 tracking-tight">Got questions?</h2>
          <p className="text-base sm:text-xl text-fg-muted font-medium">
            Everything you need to know about setting up your {brand}.
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 mb-10 overflow-x-auto pb-2">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                filter === c ? "bg-fg text-white shadow-xs" : "bg-ink-850 text-fg-muted hover:text-fg border border-ink-800"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="space-y-3.5">
          {filtered.map((faq, i) => {
            const isOpen = open === i;
            return (
              <div key={faq.q} className="panel !rounded-2xl sm:!rounded-3xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between p-5 sm:p-6 text-left"
                  onClick={() => setOpen(isOpen ? null : i)}
                >
                  <span className="text-base sm:text-lg font-bold pr-4">{faq.q}</span>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${isOpen ? "bg-fg text-white" : "bg-ink-850 text-fg-muted"}`}>
                    {isOpen ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  </div>
                </button>
                {isOpen && (
                  <p className="px-5 sm:px-6 pb-6 text-sm sm:text-base text-fg-muted font-medium leading-relaxed border-t border-ink-800 pt-4">
                    {faq.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Final CTA (wired to the real claim input, not a router mock) ──────
export function KundliFinalCTA({
  brand,
  handle,
  onHandleChange,
  onSubmit,
}: {
  brand: string;
  handle: string;
  onHandleChange: (v: string) => void;
  onSubmit: () => void;
}): React.ReactElement {
  return (
    <section className="py-24 sm:py-32 px-4 sm:px-6 relative flex items-center justify-center min-h-[60vh] overflow-hidden">
      <div className="relative z-10 text-center flex flex-col items-center max-w-4xl mx-auto">
        <div className="panel px-6 py-2.5 !rounded-2xl flex items-center gap-3 mb-8 sm:mb-12">
          <span className="w-7 h-7 rounded-lg bg-accent/10 text-accent-soft inline-flex items-center justify-center font-display text-sm font-bold">
            K
          </span>
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-fg-subtle">Digital Identity Mapped</span>
        </div>
        <h2 className="font-display text-4xl sm:text-6xl md:text-7xl mb-4 sm:mb-6 tracking-tight max-w-3xl leading-[1.08]">
          Make your corner of the internet iconic.
        </h2>
        <p className="text-base sm:text-2xl text-fg-muted font-medium mb-10 sm:mb-12 max-w-xl leading-relaxed">
          One single link. Infinite possibilities. Claim your unique handle before it's taken.
        </p>
        <form
          className="w-full max-w-md panel p-2.5 !rounded-full flex flex-col sm:flex-row items-center gap-2 mb-6"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div className="flex items-center pl-4 w-full sm:w-auto flex-1">
            <span className="text-xs sm:text-sm font-semibold text-fg-subtle select-none">{brand.toLowerCase()}/</span>
            <input
              type="text"
              placeholder="yourname"
              value={handle}
              onChange={(e) => onHandleChange(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
              className="w-full bg-transparent px-2 py-2 text-xs sm:text-sm font-bold focus:outline-none placeholder-fg-faint"
            />
          </div>
          <button type="submit" className="btn btn-primary w-full sm:w-auto !rounded-full !py-3.5 !px-7 shrink-0">
            Claim my handle <ArrowRight className="w-4 h-4" />
          </button>
        </form>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs font-semibold text-fg-subtle">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-signal-green" /> Free to claim
          </span>
          <span>·</span>
          <span>No credit card required</span>
          <span>·</span>
          <span>Takes 60 seconds</span>
        </div>
      </div>
    </section>
  );
}
