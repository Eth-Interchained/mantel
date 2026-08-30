import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "@interchained/portal-react";
import {
  AlignLeft,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  Check,
  Copy,
  ExternalLink,
  Gift,
  GripVertical,
  Heading2,
  ImagePlus,
  Images,
  Link2,
  Palette,
  Play,
  Plus,
  Share2,
  ShieldCheck,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

import { AccessPanel } from "../../src/components/AccessPanel";
import { BackgroundPicker } from "../../src/components/BackgroundPicker";
import { Nav } from "../../src/components/Nav";
import { Gate } from "../../src/components/Gate";
import { Footer } from "../../src/components/Footer";
import { PremiumWelcomeModal } from "../../src/components/PremiumModals";
import { SalesPanel } from "../../src/components/SalesPanel";
import "../../src/lib/blocks/builtin";
import "../../src/lib/templates/builtin";
import { ApiError, adminHeaders, fetchPreviewHtml, getJson, postJson, putJson } from "../../src/lib/api";
import type { BackgroundConfig } from "../../src/lib/background";
import { dragTarget, moveItem, siblingShift } from "../../src/lib/dragReorder";
import { requestUpgrade } from "../../src/lib/upgrade";
import { notifyBillingChanged, useBillingStatus } from "../../src/lib/useBillingStatus";
import { BRAND_IDS, SOC_PREFIX, brandGlyph } from "../../src/lib/renderers/social-icons";
import { FONTS, newBlockId, type Block, type FontId, type IdentityManifest, type IdentityType } from "../../src/lib/identity";
import { listBlocks } from "../../src/lib/registry";
import { ImageStudio } from "../../src/components/ImageStudio";
import { LogoStudio } from "../../src/components/LogoStudio";
import { useAppConfig } from "../../src/lib/useAppConfig";
import { THEMES } from "../../src/lib/renderers/html";

export const intent = {
  purpose:
    "Edit an identity: blocks, order, theme, and meta — with a live preview rendered by the exact renderer the public page uses",
  primaryAction: "Save and publish",
  seoKeyword: "identity editor",
};

interface SaveReceipt {
  seq: number;
  head: string;
}

const BLOCK_ICONS: Record<string, LucideIcon> = {
  giveaway: Gift,
  gallery: Images,
  link: Link2,
  header: Heading2,
  text: AlignLeft,
  social: Share2,
  embed: Play,
  surfaces: ExternalLink,
};

/** Block types that need premium — badged in the picker, gated on add
 *  (the save-time server gate remains the backstop). */
const PREMIUM_BLOCKS = new Set(["giveaway", "gallery"]);

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** A human summary line for a block card header. */
function blockSummary(b: Block): string {
  const d = b.data;
  switch (b.type) {
    case "giveaway": {
      if (!str(d.raffleId)) return "saves as a giveaway with a checkable draw";
      const closed = d.closesAt ? Date.now() >= new Date(str(d.closesAt)).getTime() : false;
      return closed ? "closed — draw when ready" : `open until ${new Date(str(d.closesAt)).toLocaleString()}`;
    }
    case "gallery": {
      const n = Array.isArray(d.images) ? d.images.length : 0;
      return n ? `${n} photo${n === 1 ? "" : "s"}` : "add your first photo";
    }
    case "whatsapp":
      return str(d.phone) ? `+${str(d.phone)}` : "add your WhatsApp number";
    case "upi": {
      if (!str(d.vpa)) return "add your UPI ID";
      const amt = Number(d.amount);
      return Number.isFinite(amt) && amt > 0
        ? `${str(d.vpa)} · ₹${amt}`
        : `${str(d.vpa)} · payer chooses`;
    }
    case "booking": {
      const slots = Array.isArray(d.slots) ? d.slots.length : 0;
      if (!str(d.vpa)) return "add your UPI ID to take bookings";
      if (!slots) return "add at least one time slot";
      if (!str(d.deliverable)) return "add the meeting link";
      return `₹${Number(d.price) || 0} · ${slots} slot${slots === 1 ? "" : "s"} offered`;
    }
    case "product": {
      if (!str(d.vpa)) return "add your UPI ID to sell this";
      if (!str(d.deliverable)) return "add the delivery link before you sell";
      return `₹${Number(d.price) || 0} · delivered on your confirmation`;
    }
    case "link":
      return str(d.url) || "no url yet";
    case "header":
    case "text":
      return str(d.text).slice(0, 64) || "empty";
    case "embed":
      return str(d.url) || "no media yet";
    case "surfaces": {
      const on = ["vcard", "qr", "card"].filter((k) => d[k] !== false).length +
        ["md", "json"].filter((k) => d[k] === true).length;
      return `${on} format${on === 1 ? "" : "s"} offered`;
    }
    case "social": {
      const links = Array.isArray(d.links) ? d.links.length : 0;
      return `${links} network${links === 1 ? "" : "s"}`;
    }
    default:
      return b.type;
  }
}

function blockTitle(b: Block, fallback: string): string {
  const d = b.data;
  switch (b.type) {
    case "giveaway":
      return str(d.prize) || fallback;
    case "product":
    case "booking":
      return str(d.title) || fallback;
    case "link":
      return str(d.label) || fallback;
    case "embed":
      return str(d.title) || fallback;
    default:
      return fallback;
  }
}

/**
 * Search & sharing — the premium snippet studio. A Google-style
 * preview and a share-card preview render live from the fields, with
 * automatic fallbacks shown when fields are empty, so owners SEE what
 * "automatic" already gives them before paying to override it.
 */
function SeoPanel({
  manifest,
  walled,
  onChange,
}: {
  manifest: IdentityManifest;
  walled: boolean;
  onChange: (seo: IdentityManifest["seo"]) => void;
}): React.ReactElement {
  const cfg = useAppConfig();
  const uploadsOn = Boolean(cfg?.uploads);
  const [shareFile, setShareFile] = useState<File | null>(null);
  const shareFileRef = useRef<HTMLInputElement | null>(null);
  const seo = manifest.seo ?? {};
  const set = (k: "title" | "description" | "image", v: string): void => {
    if (walled) {
      requestUpgrade("seo");
      return;
    }
    onChange({ ...seo, [k]: v });
  };
  const effTitle = seo.title?.trim() || `${manifest.displayName} (@${manifest.handle})`;
  const effDesc = seo.description?.trim() || manifest.bio || `${manifest.displayName}`;
  const img = typeof seo.image === "string" && /^https:\/\//.test(seo.image) ? seo.image : "";

  return (
    <div className="panel p-5 grid gap-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label flex items-center justify-between">
            <span>Search title</span>
            <span className="text-[10px] text-fg-subtle">{(seo.title ?? "").length}/70</span>
          </label>
          <input
            className="field"
            maxLength={70}
            value={seo.title ?? ""}
            placeholder={`${manifest.displayName} (@${manifest.handle})`}
            onFocus={() => walled && requestUpgrade("seo")}
            readOnly={walled}
            onChange={(e) => set("title", e.target.value)}
          />
        </div>
        <div>
          <label className="label flex items-center justify-between">
            <span>Share image</span>
          </label>
          <div className="flex gap-2">
            <input
              className="field flex-1 min-w-0"
              maxLength={500}
              value={seo.image ?? ""}
              placeholder="https://… — the card in chats & socials"
              onFocus={() => walled && requestUpgrade("seo")}
              readOnly={walled}
              onChange={(e) => set("image", e.target.value)}
            />
            {uploadsOn && (
              <>
                <input
                  ref={shareFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      if (walled) requestUpgrade("seo");
                      else setShareFile(f);
                    }
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={() => (walled ? requestUpgrade("seo") : shareFileRef.current?.click())}
                  className="btn btn-secondary !py-2 shrink-0 inline-flex items-center gap-1.5"
                  title="Upload and frame a share card (1.91:1)"
                >
                  <ImagePlus size={14} /> Upload
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {shareFile && (
        <ImageStudio
          file={shareFile}
          aspect={1.91}
          exportWidth={1200}
          title="Frame your share card"
          cta="Use share image"
          onDone={(url) => {
            setShareFile(null);
            set("image", url);
          }}
          onClose={() => setShareFile(null)}
        />
      )}
      <div>
        <label className="label flex items-center justify-between">
          <span>Search description</span>
          <span className="text-[10px] text-fg-subtle">{(seo.description ?? "").length}/160</span>
        </label>
        <textarea
          className="field min-h-[56px]"
          maxLength={160}
          value={seo.description ?? ""}
          placeholder={manifest.bio || "What should the search snippet say?"}
          onFocus={() => walled && requestUpgrade("seo")}
          readOnly={walled}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>

      {/* The snippet, as Google renders it — fallbacks visible. */}
      <div className="rounded-xl border border-ink-800 bg-ink-850 px-4 py-3">
        <p className="text-[11px] text-fg-subtle mb-1.5 font-semibold uppercase tracking-wider">
          Snippet preview
        </p>
        <p className="text-[13px] text-fg-subtle truncate">
          {typeof window !== "undefined" ? window.location.host : "ourlynx.com"}/{manifest.handle}
        </p>
        <p className="text-[16.5px] leading-snug text-accent-soft font-medium truncate">{effTitle}</p>
        <p className="text-[12.5px] text-fg-muted mt-0.5 line-clamp-2">{effDesc}</p>
      </div>
      {img && (
        <div className="rounded-xl border border-ink-800 overflow-hidden max-w-sm">
          <img src={img} alt="Share card preview" className="w-full aspect-[1.91/1] object-cover" loading="lazy" />
          <p className="px-3.5 py-2 text-[12.5px] font-semibold truncate bg-ink-850">{effTitle}</p>
        </div>
      )}
    </div>
  );
}

// ── Per-type block editors (the built-ins) ───────────────────────────────────

/**
 * The gallery editor — Marisa's unlock: "shouldn't we have some photos
 * to show our work." Upload through the existing pipeline (raw bytes →
 * /api/upload → hosted url) or paste a URL; caption, reorder, remove.
 * Empty galleries save fine and render as nothing — the nudge lives
 * here, not in a save wall.
 */
function GalleryFields({
  block,
  onChange,
}: {
  block: Block;
  onChange: (data: Record<string, unknown>) => void;
}): React.ReactElement {
  const d = block.data;
  const cfg = useAppConfig();
  const uploadsOn = Boolean(cfg?.uploads);
  const images = Array.isArray(d.images)
    ? (d.images as Array<{ url: string; caption?: string }>)
    : [];
  const [urlDraft, setUrlDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const set = (next: Array<{ url: string; caption?: string }>) =>
    onChange({ ...d, images: next.slice(0, 12) });

  const addUrl = () => {
    const u = urlDraft.trim();
    if (!/^https:\/\//.test(u)) {
      setErr("photo URLs must start with https://");
      return;
    }
    setErr(null);
    set([...images, { url: u }]);
    setUrlDraft("");
  };

  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/upload", {
        method: "POST",
        headers: { "content-type": file.type || "image/jpeg", ...adminHeaders() },
        body: file,
      });
      const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!r.ok || !j.url) throw new Error(j.error ?? "upload failed");
      set([...images, { url: j.url }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const move = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= images.length) return;
    const next = [...images];
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };

  return (
    <div className="grid gap-3">
      {images.length > 0 && (
        <div className="grid gap-2">
          {images.map((im, i) => (
            <div key={`${im.url}-${i}`} className="grid grid-cols-[56px_1fr_auto] gap-2.5 items-center">
              <img
                src={im.url}
                alt=""
                className="w-14 h-14 rounded-lg object-cover border border-ink-700"
                loading="lazy"
              />
              <input
                className="field"
                placeholder="Caption (optional)"
                maxLength={120}
                value={im.caption ?? ""}
                onChange={(e) =>
                  set(images.map((x, j) => (j === i ? { ...x, caption: e.target.value || undefined } : x)))
                }
              />
              <div className="flex items-center gap-1">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="icon-btn !w-7 !h-7 disabled:opacity-30" title="Move up">
                  <ArrowUp size={13} />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === images.length - 1} className="icon-btn !w-7 !h-7 disabled:opacity-30" title="Move down">
                  <ArrowDown size={13} />
                </button>
                <button onClick={() => set(images.filter((_, j) => j !== i))} className="icon-btn icon-btn-danger !w-7 !h-7" title="Remove">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {images.length < 12 ? (
        <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2 items-center">
          <input
            className="field"
            placeholder="https://… photo URL"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addUrl();
            }}
          />
          <button onClick={addUrl} className="btn btn-secondary !py-2">
            Add photo
          </button>
          {uploadsOn && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
              <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn btn-secondary !py-2 inline-flex items-center gap-1.5">
                <ImagePlus size={14} /> {busy ? "Uploading…" : "Upload"}
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-fg-subtle">A dozen photos is the gallery's cap — quality over quantity.</p>
      )}
      {err && <p className="text-signal-red text-xs">{err}</p>}
      <p className="text-[11px] text-fg-subtle">
        {images.length === 0
          ? "Add your best work — visitors swipe through it right on your page."
          : `${images.length}/12 · visitors swipe through these on your page.`}
      </p>
    </div>
  );
}

/**
 * The icon picker — tap, don't type. Curated glyphs + emoji that render
 * everywhere the icon travels: the zero-JS public page, the printed
 * business card, vCards. (Line-icon SVGs on public pages would need
 * server-side path inlining — a deliberate later, not a default.)
 * Every glyph the built-in templates seed is included, so seeded
 * blocks show as selected. Stored as the same plain string — zero
 * schema change, zero migration.
 */
const ICON_SET = [
  "▶", "◆", "★", "♥", "✂", "☰", "◷", "➤", "✎", "▤", "◉", "♫", "♪", "☏", "✋", "⌥", "◈", "⬡",
  "🔗", "🌐", "📍", "📅", "🛒", "🛍️", "💈", "💅", "💇", "📸", "🎥", "🎵", "🎤", "🎨",
  "✨", "🔥", "💼", "📖", "☕", "🍔", "🍕", "🧁", "🏋️", "🧘", "🐾", "🎁", "💳", "📞", "✉️", "⭐",
  "👑", "🌸", "🌿", "💎", "🚀", "🏠", "🗓️", "🎓",
];

/** Renders an icon VALUE: a `soc:<brand>` token becomes its inline
 *  brand SVG (exactly what the public renderer does); anything else is
 *  the text glyph itself. */
function IconGlyph({ token, className }: { token: string; className?: string }): React.ReactElement {
  if (token.startsWith(SOC_PREFIX)) {
    const path = brandGlyph(token.slice(SOC_PREFIX.length));
    if (path) {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={className ?? "w-[18px] h-[18px] fill-current inline-block align-[-3px]"}>
          <path d={path} />
        </svg>
      );
    }
    return <span className="text-fg-subtle">?</span>;
  }
  return <>{token}</>;
}

function IconPicker({
  value,
  onPick,
}: {
  value: string;
  onPick: (icon: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="field !w-full text-center text-base leading-none !py-2"
        title={value ? `Icon: ${value} — tap to change` : "Pick an icon"}
      >
        {value ? <IconGlyph token={value} /> : <span className="text-fg-faint text-sm">＋</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 panel p-3 shadow-card-hover">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold">Pick an icon</span>
            <button
              onClick={() => {
                onPick("");
                setOpen(false);
              }}
              className="text-[11px] text-fg-subtle hover:text-signal-red transition"
            >
              none
            </button>
          </div>

          {/* Brands — the same SVGs the public page renders, stored as
              soc:<id> tokens the renderer understands. */}
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-1">Brands</p>
          <div className="grid grid-cols-8 gap-1 mb-2">
            {BRAND_IDS.map((id) => {
              const token = `${SOC_PREFIX}${id}`;
              return (
                <button
                  key={id}
                  onClick={() => {
                    onPick(token);
                    setOpen(false);
                  }}
                  className={`h-8 rounded-lg inline-flex items-center justify-center text-fg-muted hover:text-accent-soft transition hover:bg-ink-850 ${
                    value === token ? "ring-2 ring-accent bg-accent/10 text-accent-soft" : ""
                  }`}
                  title={id}
                  aria-label={id}
                >
                  <IconGlyph token={token} className="w-4 h-4 fill-current" />
                </button>
              );
            })}
          </div>

          <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-1">Glyphs</p>
          <div className="grid grid-cols-8 gap-1">
            {ICON_SET.map((g) => (
              <button
                key={g}
                onClick={() => {
                  onPick(g);
                  setOpen(false);
                }}
                className={`h-8 rounded-lg text-base leading-none transition hover:bg-ink-850 ${
                  value === g ? "ring-2 ring-accent bg-accent/10" : ""
                }`}
                title={g}
              >
                {g}
              </button>
            ))}
          </div>
          <input
            value={value.startsWith(SOC_PREFIX) ? "" : value}
            onChange={(e) => onPick(e.target.value.slice(0, 4))}
            placeholder="or type your own"
            className="field mt-2 !py-1.5 text-center text-sm"
          />
        </div>
      )}
    </div>
  );
}

/** Giveaway block editor — fields + the live raffle console (entries
 *  counter, entry-page link, the draw moment, leads export). */
function GiveawayFields({
  block,
  onChange,
}: {
  block: Block;
  onChange: (data: Record<string, unknown>) => void;
}): React.ReactElement {
  const d = block.data;
  const rid = str(d.raffleId);
  const [info, setInfo] = useState<{ entryCount: number; state: string; winnerTicketIds?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!rid) return;
    try {
      const j = await getJson<{ raffle: { entryCount: number; state: string; winnerTicketIds?: string[] } }>(
        `/api/raffles/${encodeURIComponent(rid)}`,
      );
      setInfo(j.raffle);
    } catch {
      /* console is best-effort */
    }
  }, [rid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const draw = useCallback(async () => {
    if (!rid) return;
    setBusy(true);
    setErr(null);
    try {
      await postJson(`/api/raffles/${encodeURIComponent(rid)}/draw`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "draw failed");
    } finally {
      setBusy(false);
    }
  }, [rid, refresh]);

  const endNow = useCallback(async () => {
    if (!rid) return;
    // A real, irreversible action deserves a real question.
    if (!window.confirm("End this giveaway now? Entries stop immediately and the winner is drawn on the spot. This can't be undone.")) return;
    setBusy(true);
    setErr(null);
    try {
      await postJson(`/api/raffles/${encodeURIComponent(rid)}/end`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "end failed");
    } finally {
      setBusy(false);
    }
  }, [rid, refresh]);

  const downloadLeads = useCallback(async () => {
    if (!rid) return;
    setErr(null);
    try {
      const res = await fetch(`/api/raffles/${encodeURIComponent(rid)}/leads?format=csv`, {
        headers: { ...adminHeaders() },
      });
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${rid}-leads.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "export failed");
    }
  }, [rid]);

  const locked = Boolean(rid); // prize/close are part of the commitment story — locked after mint
  return (
    <div className="grid gap-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Prize</label>
          <input
            className="field"
            value={str(d.prize)}
            disabled={locked}
            placeholder="One free haircut"
            onChange={(e) => onChange({ ...d, prize: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Closes</label>
          <input
            className="field"
            type="datetime-local"
            value={str(d.closesAt).slice(0, 16)}
            disabled={locked}
            onChange={(e) => onChange({ ...d, closesAt: e.target.value })}
          />
        </div>
      </div>
      <div>
        <label className="label">Card tagline (optional — the line under the prize on your page)</label>
        <input
          className="field"
          value={str(d.tagline)}
          maxLength={80}
          placeholder="free to enter"
          onChange={(e) => onChange({ ...d, tagline: e.target.value || undefined })}
        />
      </div>
      <div className="grid sm:grid-cols-[1fr_110px_130px] gap-3">
        <div>
          <label className="label">Description (optional)</label>
          <input
            className="field"
            value={str(d.description)}
            placeholder="What's up for grabs, in one line"
            onChange={(e) => onChange({ ...d, description: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Winners</label>
          <input
            className="field"
            type="number"
            min={1}
            max={20}
            value={Number(d.winners ?? 1)}
            disabled={locked}
            onChange={(e) => onChange({ ...d, winners: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
          />
        </div>
        <div>
          <label className="label">Total spots</label>
          <input
            className="field"
            type="number"
            min={1}
            placeholder="no cap"
            value={d.maxEntries ? Number(d.maxEntries) : ""}
            disabled={locked}
            onChange={(e) => {
              const n = Number(e.target.value);
              onChange({ ...d, maxEntries: n >= 1 ? Math.min(100000, n) : undefined });
            }}
            title="Total entries allowed — 1 makes it a first-come flash drop. One entry per person is separate and always on."
          />
        </div>
      </div>
      <div>
        <label className="label">Rules (optional — shown on the entry page)</label>
        <textarea
          className="field min-h-[64px]"
          value={str(d.rules)}
          disabled={locked}
          placeholder={"One entry per person. Winner announced after the draw.\nPrize ships within 2 weeks. 18+."}
          onChange={(e) => onChange({ ...d, rules: e.target.value || undefined })}
        />
      </div>

      {!rid ? (
        <p className="text-[11px] text-fg-subtle">
          Saving mints this giveaway with a published fairness commitment — prize, close
          time, and winner count lock at that moment so the promise can't move.
        </p>
      ) : (
        <div className="rounded-xl bg-ink-850 border border-ink-800 px-4 py-3 grid gap-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs font-semibold">
              {info ? (
                <>
                  <span className="text-accent-soft">{info.entryCount}</span> verified{" "}
                  {info.entryCount === 1 ? "entry" : "entries"} · {info.state}
                </>
              ) : (
                "loading entries…"
              )}
            </p>
            <div className="flex items-center gap-2">
              <a
                href={`/r/${encodeURIComponent(rid)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold text-accent-soft hover:underline underline-offset-4"
              >
                entry page ↗
              </a>
              <a
                href={`/r/${encodeURIComponent(rid)}/verify`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold text-accent-soft hover:underline underline-offset-4"
              >
                verify ↗
              </a>
              <button onClick={() => void downloadLeads()} className="btn btn-secondary !py-1 !px-2.5 !text-[11px]">
                Leads CSV
              </button>
              {info?.state === "open" && (
                <button onClick={() => void endNow()} disabled={busy} className="btn btn-primary !py-1 !px-3 !text-[11px]" title="Stop entries immediately and draw the winner on the spot">
                  {busy ? "Ending…" : "End & draw now"}
                </button>
              )}
              {info?.state === "closed" && (
                <button onClick={() => void draw()} disabled={busy} className="btn btn-primary !py-1 !px-3 !text-[11px]">
                  {busy ? "Drawing…" : "Draw winners"}
                </button>
              )}
            </div>
          </div>
          {info?.state === "drawn" && (info.winnerTicketIds?.length ?? 0) > 0 && (
            <p className="text-[11px] font-mono text-signal-green">
              won by {info.winnerTicketIds!.join(", ")}
            </p>
          )}
          {err && <p className="text-[11px] text-signal-red">{err}</p>}
        </div>
      )}
    </div>
  );
}

function BlockFields({
  block,
  onChange,
}: {
  block: Block;
  onChange: (data: Record<string, unknown>) => void;
}): React.ReactElement {
  const d = block.data;
  switch (block.type) {
    case "giveaway":
      return <GiveawayFields block={block} onChange={onChange} />;
    case "gallery":
      return <GalleryFields block={block} onChange={onChange} />;
    case "whatsapp": {
      const digits = str(d.phone).replace(/\D/g, "");
      return (
        <div className="grid gap-3">
          <div className="grid sm:grid-cols-[1fr_1fr] gap-3">
            <div>
              <label className="label">WhatsApp number</label>
              <div className="flex items-center gap-2 bg-ink-850 border border-ink-800 rounded-2xl px-3 py-2.5">
                <span className="text-fg-subtle font-mono text-sm shrink-0">+</span>
                <input
                  className="flex-1 min-w-0 bg-transparent outline-none font-mono text-sm text-fg placeholder:text-fg-faint"
                  inputMode="numeric"
                  placeholder="919876543210"
                  value={digits}
                  onChange={(e) => onChange({ ...d, phone: e.target.value.replace(/\D/g, "").slice(0, 15) })}
                />
              </div>
              <p className="text-[11px] text-fg-subtle mt-1.5">
                Country code first, no spaces or +. India is 91.
              </p>
            </div>
            <div>
              <label className="label">Button label</label>
              <input
                className="field"
                placeholder="Chat on WhatsApp"
                value={str(d.label)}
                onChange={(e) => onChange({ ...d, label: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="label">Pre-filled message (optional)</label>
            <input
              className="field"
              placeholder="Hi! I'd like to book a consultation."
              value={str(d.message)}
              onChange={(e) => onChange({ ...d, message: e.target.value.slice(0, 300) })}
            />
            <p className="text-[11px] text-fg-subtle mt-1.5">
              Already typed when the chat opens — it qualifies the lead before they say a word.
            </p>
          </div>
        </div>
      );
    }
    case "booking": {
      const price = Number(d.price);
      const slots = Array.isArray(d.slots) ? (d.slots as unknown[]).map((x) => String(x ?? "")) : [];
      const setSlots = (next: string[]) => onChange({ ...d, slots: next });
      return (
        <div className="grid gap-3">
          <div className="grid sm:grid-cols-[2fr_1fr_1fr] gap-3">
            <div>
              <label className="label">What are you offering?</label>
              <input
                className="field"
                placeholder="1:1 Design Review"
                value={str(d.title)}
                onChange={(e) => onChange({ ...d, title: e.target.value })}
              />
            </div>
            <div>
              <label className="label">How long</label>
              <input
                className="field"
                placeholder="45 mins"
                value={str(d.duration)}
                onChange={(e) => onChange({ ...d, duration: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Price (₹)</label>
              <input
                className="field"
                inputMode="decimal"
                value={Number.isFinite(price) && price > 0 ? String(price) : ""}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/[^\d.]/g, ""));
                  onChange({ ...d, price: Number.isFinite(n) ? n : 0 });
                }}
              />
            </div>
          </div>
          <div>
            <label className="label">One line about it</label>
            <input
              className="field"
              placeholder="Portfolio teardown over a call"
              value={str(d.blurb)}
              onChange={(e) => onChange({ ...d, blurb: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Times you're offering</label>
            <div className="grid gap-2">
              {slots.map((sl, i) => (
                <div key={i} className="grid grid-cols-[1fr_36px] gap-2">
                  <input
                    className="field"
                    placeholder="Mon 25 Aug, 6:00 PM"
                    value={sl}
                    onChange={(e) => setSlots(slots.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  <button
                    onClick={() => setSlots(slots.filter((_, j) => j !== i))}
                    className="icon-btn icon-btn-danger self-center"
                    title="Remove"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setSlots([...slots, ""])}
                className="justify-self-start text-xs font-semibold text-accent-soft hover:underline underline-offset-4"
              >
                + add a time
              </button>
            </div>
            {/* Free text on purpose: parsing dates would mean owning
                timezones and DST, and getting those subtly wrong means
                missing a call someone paid for. */}
            <p className="text-[11px] text-fg-subtle mt-1.5">
              Write them however your clients read them. Each time can be booked once — it disappears
              from your page as soon as someone claims it.
            </p>
          </div>

          <div className="grid sm:grid-cols-[2fr_1fr] gap-3">
            <div>
              <label className="label">Your UPI ID (where the money lands)</label>
              <input
                className="field font-mono"
                placeholder="yourname@okhdfcbank"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={str(d.vpa)}
                onChange={(e) => onChange({ ...d, vpa: e.target.value.trim() })}
              />
            </div>
            <div>
              <label className="label">Payee name</label>
              <input
                className="field"
                placeholder="Your name"
                value={str(d.payeeName)}
                onChange={(e) => onChange({ ...d, payeeName: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="label">Meeting link (https)</label>
            <input
              className="field font-mono"
              placeholder="https://meet.google.com/..."
              value={str(d.deliverable)}
              onChange={(e) => onChange({ ...d, deliverable: e.target.value.trim() })}
            />
            <p className="text-[11px] text-fg-subtle mt-1.5 leading-relaxed">
              <b className="text-fg-muted">Never shown publicly.</b> Sent only after you confirm the
              payment landed in your bank. Money goes straight to your UPI — we&apos;re not in the
              transaction and take no fee.
            </p>
          </div>
        </div>
      );
    }
    case "product": {
      const price = Number(d.price);
      return (
        <div className="grid gap-3">
          <div className="grid sm:grid-cols-[2fr_1fr] gap-3">
            <div>
              <label className="label">What are you selling?</label>
              <input
                className="field"
                placeholder="Freelancer Notion OS"
                value={str(d.title)}
                onChange={(e) => onChange({ ...d, title: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Price (₹)</label>
              <input
                className="field"
                inputMode="decimal"
                value={Number.isFinite(price) && price > 0 ? String(price) : ""}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/[^\d.]/g, ""));
                  onChange({ ...d, price: Number.isFinite(n) ? n : 0 });
                }}
              />
            </div>
          </div>
          <div>
            <label className="label">One line about it</label>
            <input
              className="field"
              placeholder="120+ Figma components, instant download"
              value={str(d.blurb)}
              onChange={(e) => onChange({ ...d, blurb: e.target.value })}
            />
          </div>
          <div className="grid sm:grid-cols-[2fr_1fr] gap-3">
            <div>
              <label className="label">Your UPI ID (where the money lands)</label>
              <input
                className="field font-mono"
                placeholder="yourname@okhdfcbank"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={str(d.vpa)}
                onChange={(e) => onChange({ ...d, vpa: e.target.value.trim() })}
              />
            </div>
            <div>
              <label className="label">Payee name</label>
              <input
                className="field"
                placeholder="Your name"
                value={str(d.payeeName)}
                onChange={(e) => onChange({ ...d, payeeName: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="label">Delivery link (https)</label>
            <input
              className="field font-mono"
              placeholder="https://drive.google.com/..."
              value={str(d.deliverable)}
              onChange={(e) => onChange({ ...d, deliverable: e.target.value.trim() })}
            />
            {/* Say the two things a seller most needs to know, where they
                are deciding — not in a help doc they'll never open. */}
            <p className="text-[11px] text-fg-subtle mt-1.5 leading-relaxed">
              <b className="text-fg-muted">Never shown publicly.</b> A buyer pays your UPI directly,
              sends you their reference number, and you confirm it against your own bank — then we
              email them this link. We&apos;re not in the transaction and take no fee.
            </p>
          </div>
        </div>
      );
    }
    case "upi": {
      const amt = Number(d.amount);
      return (
        <div className="grid gap-3">
          <div className="grid sm:grid-cols-[2fr_1fr] gap-3">
            <div>
              <label className="label">Your UPI ID</label>
              <input
                className="field font-mono"
                placeholder="yourname@okhdfcbank"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={str(d.vpa)}
                onChange={(e) => onChange({ ...d, vpa: e.target.value.trim() })}
              />
            </div>
            <div>
              <label className="label">Payee name</label>
              <input
                className="field"
                placeholder="Your name"
                value={str(d.payeeName)}
                onChange={(e) => onChange({ ...d, payeeName: e.target.value })}
              />
            </div>
          </div>
          <div className="grid sm:grid-cols-[1fr_1fr_1fr] gap-3">
            <div>
              <label className="label">Amount (₹)</label>
              <input
                className="field"
                inputMode="decimal"
                placeholder="0 = they choose"
                value={Number.isFinite(amt) && amt > 0 ? String(amt) : ""}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/[^\d.]/g, ""));
                  onChange({ ...d, amount: Number.isFinite(n) ? n : 0 });
                }}
              />
            </div>
            <div>
              <label className="label">Button label</label>
              <input
                className="field"
                placeholder="Pay with UPI"
                value={str(d.label)}
                onChange={(e) => onChange({ ...d, label: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Note on the payment</label>
              <input
                className="field"
                placeholder="Design consultation"
                value={str(d.note)}
                onChange={(e) => onChange({ ...d, note: e.target.value })}
              />
            </div>
          </div>
          {/* The limit, stated where the decision is made — not buried in
              docs. A UPI intent has no callback, so nothing here can tell
              you the money arrived. Your bank is the receipt. */}
          <p className="text-[11px] text-fg-subtle leading-relaxed">
            Payments go <b className="text-fg-muted">straight to your bank</b> — we&apos;re not in the
            transaction, take no cut, and never hold your money. Because a UPI link has no callback,
            this page can&apos;t confirm a payment landed: check your own UPI app or bank before you
            deliver anything.
          </p>
        </div>
      );
    }
    case "link":
      return (
        <div className="grid sm:grid-cols-[1fr_2fr_72px] gap-3">
          <div>
            <label className="label">Label</label>
            <input className="field" value={str(d.label)} onChange={(e) => onChange({ ...d, label: e.target.value })} />
          </div>
          <div>
            <label className="label">URL</label>
            <input className="field" value={str(d.url)} placeholder="https:// · tel: · mailto:" onChange={(e) => onChange({ ...d, url: e.target.value })} />
          </div>
          <div>
            <label className="label">Icon</label>
            <IconPicker value={str(d.icon)} onPick={(icon) => onChange({ ...d, icon })} />
          </div>
        </div>
      );
    case "header":
      return (
        <div>
          <label className="label">Heading</label>
          <input className="field" value={str(d.text)} onChange={(e) => onChange({ ...d, text: e.target.value })} />
        </div>
      );
    case "text":
      return (
        <div>
          <label className="label">Text</label>
          <textarea className="field min-h-[64px]" value={str(d.text)} onChange={(e) => onChange({ ...d, text: e.target.value })} />
        </div>
      );
    case "embed":
      return (
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Media URL (YouTube, Spotify…)</label>
            <input className="field" value={str(d.url)} onChange={(e) => onChange({ ...d, url: e.target.value })} />
          </div>
          <div>
            <label className="label">Title</label>
            <input className="field" value={str(d.title)} onChange={(e) => onChange({ ...d, title: e.target.value })} />
          </div>
        </div>
      );
    case "social": {
      const links = Array.isArray(d.links) ? (d.links as Array<Record<string, unknown>>) : [];
      const setLinks = (next: Array<Record<string, unknown>>) => onChange({ ...d, links: next });
      return (
        <div className="grid gap-2">
          {links.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_36px] gap-2">
              <input className="field" placeholder="network (instagram…)" value={str(l.network)} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, network: e.target.value } : x)))} />
              <input className="field" placeholder="https://…" value={str(l.url)} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <button onClick={() => setLinks(links.filter((_, j) => j !== i))} className="icon-btn icon-btn-danger self-center" title="Remove">
                <X size={15} />
              </button>
            </div>
          ))}
          <button onClick={() => setLinks([...links, { network: "", url: "https://" }])} className="justify-self-start text-xs font-semibold text-accent-soft hover:underline underline-offset-4">
            + add social link
          </button>
        </div>
      );
    }
    case "surfaces": {
      const FLAGS = [
        ["vcard", "Save contact (vCard)", true],
        ["qr", "QR code", true],
        ["card", "Business card", true],
        ["md", "Markdown (LLM-readable)", false],
        ["json", "JSON", false],
      ] as const;
      return (
        <div className="grid gap-3">
          <div>
            <label className="label">Title (optional)</label>
            <input
              className="field"
              value={str(d.title)}
              placeholder="Save & share"
              onChange={(e) => onChange({ ...d, title: e.target.value })}
            />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {FLAGS.map(([key, label, dflt]) => (
              <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={d[key] === undefined ? dflt : Boolean(d[key])}
                  onChange={(e) => onChange({ ...d, [key]: e.target.checked })}
                  className="accent-[rgb(var(--accent))] w-4 h-4"
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-fg-subtle">
            Chips linking this profile's other formats — visitors save your contact,
            grab the QR, or point an AI at the markdown.
          </p>
        </div>
      );
    }
    default:
      return <p className="text-xs text-fg-subtle font-mono">unknown block type: {block.type}</p>;
  }
}

// ── Theme gallery — actual miniature previews, not pills ─────────────────────

function ThemeMini({ palette }: { palette: { bg: string; card: string; text: string; sub: string; accent: string } }): React.ReactElement {
  return (
    <div className="h-20 flex flex-col items-center justify-center gap-1.5 px-3" style={{ background: palette.bg }}>
      <div className="w-6 h-6 rounded-full border-2 shrink-0" style={{ borderColor: palette.accent, background: palette.card }} />
      <div className="h-1 w-10 rounded-full" style={{ background: palette.text, opacity: 0.85 }} />
      <div className="w-full max-w-[88px] rounded-md px-2 py-1 flex items-center gap-1.5" style={{ background: palette.card }}>
        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: palette.accent }} />
        <div className="h-1 flex-1 rounded-full" style={{ background: palette.sub, opacity: 0.7 }} />
      </div>
    </div>
  );
}

// ── Draft safety net ──────────────────────────────────────────────────────────
// Every edit lands in localStorage on a short fuse. Checkout round-trips,
// tab closes, and crashes can no longer eat work (Marisa lost an editing
// session to the Stripe redirect, 7/8 — never again). Cleared on save.

const DRAFT_PREFIX = "links-draft:";

interface LocalDraft {
  at: string;
  manifest: IdentityManifest;
}

function readDraft(id: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(`${DRAFT_PREFIX}${id}`);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<LocalDraft>;
    if (typeof d.at !== "string" || !d.manifest || d.manifest.identityId !== id) return null;
    return d as LocalDraft;
  } catch {
    return null;
  }
}

function clearDraft(id: string): void {
  try {
    localStorage.removeItem(`${DRAFT_PREFIX}${id}`);
  } catch {
    /* nothing to clear */
  }
}

// ── The editor ────────────────────────────────────────────────────────────────

export default function EditPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const cfg = useAppConfig();
  const uploadsOn = Boolean(cfg?.uploads);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [studioFile, setStudioFile] = useState<File | null>(null);
  const uploading = studioFile !== null;
  const [manifest, setManifest] = useState<IdentityManifest | null>(null);
  /** The caller's actual power on this page — the UI renders EXACTLY
   *  this, never more (a viewer with a Save button is a lie). */
  const [yourRole, setYourRole] = useState<"viewer" | "editor" | "owner">("editor");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [receipt, setReceipt] = useState<SaveReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [addOpen, setAddOpen] = useState(false);
  // The block cap: free pages hold freeBlockLimit blocks (all types).
  // Walls follow the PAGE's entitlement (pagePremium from the manifest
  // GET), not the caller's billing — a free editor on a premium page
  // edits unwalled; a premium editor gets walls on a free page.
  const { status: billing } = useBillingStatus();
  const [pagePremium, setPagePremium] = useState(true);
  const blockCap =
    billing?.limitEnabled && !pagePremium
      ? ((billing as { freeBlockLimit?: number }).freeBlockLimit ?? 3)
      : null;
  const pageWalled = Boolean(billing?.limitEnabled) && !pagePremium;
  /** Hover try-on for backgrounds — previewed, never saved. */
  const [bgHover, setBgHover] = useState<BackgroundConfig | null>(null);
  const previewSeq = useRef(0);
  /** Set when a local draft was auto-restored — the banner's timestamp. */
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  /** Landing back from a mid-edit upgrade (?upgraded=1). */
  const [justUpgraded, setJustUpgraded] = useState(false);

  const blockDefs = useMemo(() => listBlocks(), []);

  const load = useCallback(async () => {
    setError(null);
    setLocked(false);
    try {
      const j = await getJson<{
        manifest: IdentityManifest;
        yourRole?: "viewer" | "editor" | "owner";
        pagePremium?: boolean;
      }>(`/api/identities/${encodeURIComponent(id)}`);
      const role = j.yourRole ?? "editor";
      setYourRole(role);
      setPagePremium(j.pagePremium ?? true);
      const draft = role === "viewer" ? null : readDraft(id);
      if (draft && draft.at > (j.manifest.updatedAt ?? "")) {
        // Newer local work exists — restore the EDITABLE fields onto the
        // server's authoritative shell (handle/status/timestamps stay real).
        setManifest({
          ...j.manifest,
          displayName: draft.manifest.displayName,
          bio: draft.manifest.bio,
          avatar: draft.manifest.avatar,
          theme: draft.manifest.theme,
          themeCustom: draft.manifest.themeCustom,
          background: draft.manifest.background,
          discoverable: draft.manifest.discoverable,
          identityType: draft.manifest.identityType,
          blocks: draft.manifest.blocks,
        });
        setDirty(true);
        setRestoredAt(draft.at);
      } else {
        if (draft) clearDraft(id); // the server moved past it — draft lost
        setManifest(j.manifest);
        setDirty(false);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setLocked(true);
        return;
      }
      setError(err instanceof Error ? err.message : "failed to load identity");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Unsaved-changes guard.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // The draft safety net — dirty work lands in localStorage on a short
  // fuse, so no navigation (Stripe included) can eat an editing session.
  // Viewers don't draft: nothing they touch can ever be saved.
  useEffect(() => {
    if (!manifest || !dirty || yourRole === "viewer") return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          `${DRAFT_PREFIX}${id}`,
          JSON.stringify({ at: new Date().toISOString(), manifest }),
        );
      } catch {
        /* storage unavailable — the Save button still works */
      }
    }, 800);
    return () => clearTimeout(t);
  }, [manifest, dirty, id, yourRole]);

  // Landing back from a mid-edit upgrade: strip the param (refresh must
  // not re-celebrate), refresh billing everywhere (the save that was
  // walled a minute ago now clears), and greet the purchase properly.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("upgraded") !== "1") return;
    window.history.replaceState(null, "", window.location.pathname);
    notifyBillingChanged();
    setJustUpgraded(true);
  }, []);

  // Live preview — debounced round-trip through the REAL renderer.
  // Hovering a background preset swaps it in transiently on a shorter
  // fuse, so "try it on" feels instant without spamming the server.
  useEffect(() => {
    if (!manifest) return;
    const seq = ++previewSeq.current;
    const t = setTimeout(async () => {
      try {
        const html = await fetchPreviewHtml({
          identityId: manifest.identityId,
          identityType: manifest.identityType,
          handle: manifest.handle,
          displayName: manifest.displayName,
          bio: manifest.bio,
          avatar: manifest.avatar,
          theme: manifest.theme,
          themeCustom: manifest.themeCustom,
          background: bgHover ?? manifest.background,
          blocks: manifest.blocks,
        });
        if (seq === previewSeq.current) setPreviewHtml(html);
      } catch {
        /* preview is best-effort; the editor keeps working */
      }
    }, bgHover ? 120 : 350);
    return () => clearTimeout(t);
  }, [manifest, bgHover]);

  const patch = useCallback((p: Partial<IdentityManifest>) => {
    setManifest((m) => (m ? { ...m, ...p } : m));
    setDirty(true);
  }, []);

  const setBlocks = useCallback(
    (blocks: Block[]) => {
      patch({ blocks: blocks.map((b, i) => ({ ...b, order: i })) });
    },
    [patch],
  );

  /** Logo/avatar upload: picking a file opens the studio — position,
   *  zoom, backdrop — then bakes and uploads. */
  const doUpload = useCallback((file: File) => {
    setError(null);
    setStudioFile(file);
  }, []);

  const move = useCallback(
    (index: number, delta: -1 | 1) => {
      if (!manifest) return;
      const next = [...manifest.blocks].sort((a, b) => a.order - b.order);
      const target = index + delta;
      if (target < 0 || target >= next.length) return;
      setBlocks(moveItem(next, index, target));
    },
    [manifest, setBlocks],
  );

  // ── Drag-to-reorder — pointer events, so mouse AND touch both work ─────────
  // (HTML5 drag-and-drop never fires on touch; pointer capture does.)
  // The grip owns the gesture: touch-action none is scoped to it, so the
  // page keeps scrolling everywhere else. Order commits on release; while
  // live, siblings make way visually via pure siblingShift math.
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number } | null>(null);
  const blockListRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    from: number;
    startYDoc: number;
    lastClientY: number;
    tops: number[];
    heights: number[];
    pitch: number;
    pointerId: number;
  } | null>(null);
  const dragRaf = useRef(false);
  const edgeRaf = useRef<number | null>(null);

  const scheduleDragUpdate = useCallback(() => {
    if (dragRaf.current) return;
    dragRaf.current = true;
    requestAnimationFrame(() => {
      dragRaf.current = false;
      const d = dragRef.current;
      if (!d) return;
      const dy = d.lastClientY + window.scrollY - d.startYDoc;
      setDrag({ from: d.from, to: dragTarget(d.from, dy, d.tops, d.heights), dy });
    });
  }, []);

  /** Long lists on phones: dragging near the viewport edge scrolls the
   *  page (touch produces no pointermove while held still, so this runs
   *  its own rAF loop until the pointer leaves the edge zone). */
  const maybeEdgeScroll = useCallback(() => {
    const EDGE = 64;
    const SPEED = 14;
    const step = () => {
      const d = dragRef.current;
      if (!d) {
        edgeRaf.current = null;
        return;
      }
      const y = d.lastClientY;
      let delta = 0;
      if (y < EDGE) delta = -SPEED * (1 - y / EDGE);
      else if (y > window.innerHeight - EDGE) delta = SPEED * (1 - (window.innerHeight - y) / EDGE);
      if (delta !== 0) {
        window.scrollBy(0, delta);
        scheduleDragUpdate();
        edgeRaf.current = requestAnimationFrame(step);
      } else {
        edgeRaf.current = null;
      }
    };
    if (edgeRaf.current === null) edgeRaf.current = requestAnimationFrame(step);
  }, [scheduleDragUpdate]);

  const beginDrag = useCallback((e: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (dragRef.current || !blockListRef.current) return;
    const cards = Array.from(blockListRef.current.querySelectorAll<HTMLElement>("[data-bi]"));
    if (cards.length < 2) return;
    const scrollY = window.scrollY;
    const rects = cards.map((c) => c.getBoundingClientRect());
    const tops = rects.map((r) => r.top + scrollY);
    const heights = rects.map((r) => r.height);
    const gap = tops.length > 1 ? Math.max(0, tops[1] - (tops[0] + heights[0])) : 12;
    dragRef.current = {
      from: index,
      startYDoc: e.clientY + scrollY,
      lastClientY: e.clientY,
      tops,
      heights,
      pitch: heights[index] + gap,
      pointerId: e.pointerId,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: index, to: index, dy: 0 });
  }, []);

  const onDragMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      d.lastClientY = e.clientY;
      scheduleDragUpdate();
      maybeEdgeScroll();
    },
    [scheduleDragUpdate, maybeEdgeScroll],
  );

  const stopDrag = useCallback(() => {
    dragRef.current = null;
    if (edgeRaf.current !== null) {
      cancelAnimationFrame(edgeRaf.current);
      edgeRaf.current = null;
    }
    setDrag(null);
  }, []);

  const onDragEnd = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      // Final target from the release point itself — never a frame stale.
      const dy = e.clientY + window.scrollY - d.startYDoc;
      const to = dragTarget(d.from, dy, d.tops, d.heights);
      const from = d.from;
      stopDrag();
      if (to !== from && manifest) {
        setBlocks(moveItem([...manifest.blocks].sort((a, b) => a.order - b.order), from, to));
      }
    },
    [manifest, setBlocks, stopDrag],
  );

  /** Inline styles while a drag is live: the lifted card rides the
   *  pointer; cards in the from→to window make way. */
  const dragStyle = useCallback(
    (i: number): React.CSSProperties | undefined => {
      if (!drag) return undefined;
      if (i === drag.from) {
        return { transform: `translateY(${drag.dy}px) scale(1.012)`, zIndex: 30, position: "relative" };
      }
      const shift = siblingShift(i, drag.from, drag.to, dragRef.current?.pitch ?? 0);
      return { transform: shift ? `translateY(${shift}px)` : undefined, transition: "transform 160ms ease" };
    },
    [drag],
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (!manifest) return false;
    setBusy("save");
    setError(null);
    try {
      const j = await putJson<{ manifest: IdentityManifest; seq: number; head: string }>(
        `/api/identities/${encodeURIComponent(manifest.identityId)}`,
        {
          displayName: manifest.displayName,
          bio: manifest.bio,
          avatar: manifest.avatar,
          theme: manifest.theme,
          themeCustom: manifest.themeCustom ?? null,
          background: manifest.background ?? null,
          discoverable: manifest.discoverable ?? false,
          identityType: manifest.identityType,
          blocks: manifest.blocks,
          // Trimmed-or-null: all-empty SEO clears back to automatic.
          seo: (() => {
            const s = manifest.seo ?? {};
            const clean = {
              title: s.title?.trim() || undefined,
              description: s.description?.trim() || undefined,
              image: s.image?.trim() || undefined,
            };
            return clean.title || clean.description || clean.image ? clean : null;
          })(),
        },
      );
      setManifest(j.manifest);
      setReceipt({ seq: j.seq, head: j.head });
      setDirty(false);
      clearDraft(id); // saved for real — the safety net stands down
      setRestoredAt(null);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setLocked(true);
      } else if (err instanceof ApiError && err.code === "premium_required") {
        // A premium wall is a doorway, not an error toast.
        const msg = err.message.toLowerCase();
        requestUpgrade(
          msg.includes("giveaway") ? "giveaway"
            : msg.includes("discover") ? "discover"
            : msg.includes("font") ? "font"
            : msg.includes("gallery") ? "gallery"
            : msg.includes("search") ? "seo"
            : msg.includes("block") ? "blocks"
            : "generic",
        );
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "save failed");
      }
      return false;
    } finally {
      setBusy(null);
    }
  }, [manifest, id]);

  const publish = useCallback(async () => {
    if (!manifest) return;
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    setBusy("publish");
    setError(null);
    try {
      const j = await postJson<{ manifest: IdentityManifest; seq: number; head: string }>(
        `/api/identities/${encodeURIComponent(manifest.identityId)}/publish`,
      );
      setManifest(j.manifest);
      setReceipt({ seq: j.seq, head: j.head });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setLocked(true);
      else setError(err instanceof Error ? err.message : "publish failed");
    } finally {
      setBusy(null);
    }
  }, [manifest, dirty, save]);

  // ⌘S / Ctrl+S — the studio reflex. Viewers get the browser default.
  useEffect(() => {
    if (yourRole === "viewer") return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && busy === null) void save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dirty, busy, save, yourRole]);

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
        <main className="max-w-5xl mx-auto px-5 py-16 text-center text-fg-muted">
          {error ? <p className="text-signal-red font-mono text-sm">{error}</p> : <p>Loading…</p>}
        </main>
      </>
    );
  }

  const ordered = [...manifest.blocks].sort((a, b) => a.order - b.order);
  const published = manifest.status === "published";

  return (
    <>
      {/* ONE nav — the editor projects its identity + commands into it. */}
      <Nav
        context={
          <>
            <Link href="/identities" className="icon-btn !w-7 !h-7 shrink-0" title="All identities">
              <ArrowLeft size={15} />
            </Link>
            <h1 className="font-display text-sm font-bold truncate">
              {manifest.displayName}
            </h1>
            <span className="hidden sm:inline font-mono text-[11px] text-accent-soft truncate shrink-0">
              @{manifest.handle}
            </span>
            <span
              className={`chip shrink-0 ${
                published
                  ? "text-signal-green border-signal-green/40 bg-signal-green/10"
                  : "text-signal-amber border-signal-amber/40 bg-signal-amber/10"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${published ? "bg-signal-green" : "bg-signal-amber"} ${dirty ? "animate-pulse" : ""}`} />
              {published ? "Live" : "Draft"}
              {dirty ? " · unsaved" : ""}
            </span>
          </>
        }
        actions={
          <>
            <Link
              href={`/analytics/${encodeURIComponent(manifest.identityId)}`}
              className="icon-btn !w-7 !h-7"
              title="Analytics — views, scans, clicks"
            >
              <BarChart3 size={15} />
            </Link>
            {published && (
              <a
                href={`/${manifest.handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="icon-btn !w-7 !h-7"
                title="View live page"
              >
                <ExternalLink size={15} />
              </a>
            )}
            {yourRole === "viewer" ? (
              <span className="chip text-[11px] font-semibold text-fg-muted" title="Viewers can look at everything but change nothing — ask the owner for editor access">
                viewing
              </span>
            ) : (
              <>
                <button onClick={() => void save()} disabled={busy !== null || !dirty} className="btn btn-secondary !py-1.5 !px-3" title="⌘S">
                  {busy === "save" ? "Saving…" : "Save"}
                </button>
                <button onClick={() => void publish()} disabled={busy !== null} className="btn btn-primary !py-1.5 !px-3">
                  {busy === "publish" ? "Publishing…" : published ? "Republish" : "Publish"}
                  <ArrowUpRight size={14} />
                </button>
              </>
            )}
          </>
        }
      />

      {studioFile && (
        <LogoStudio
          file={studioFile}
          onDone={(url) => {
            patch({ avatar: url });
            setStudioFile(null);
          }}
          onClose={() => setStudioFile(null)}
        />
      )}

      {justUpgraded && <PremiumWelcomeModal onClose={() => setJustUpgraded(false)} />}

      <main className="max-w-7xl mx-auto px-5 py-8">
        {yourRole === "viewer" && (
          <div className="mb-4 panel !border-signal-amber/40 bg-signal-amber/10 px-4 py-3 text-sm">
            <span className="font-semibold text-signal-amber">You're viewing @{manifest.handle}</span>
            <span className="text-fg-muted"> — everything's visible, nothing's editable. Ask the owner for editor access to make changes.</span>
          </div>
        )}
        {restoredAt && (
          <div className="mb-4 panel !border-signal-amber/40 bg-signal-amber/10 px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <span className="font-semibold text-signal-amber">
              Restored unsaved changes from{" "}
              {new Date(restoredAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
            <span className="text-fg-muted">— Save to keep them.</span>
            <button
              onClick={() => {
                clearDraft(id);
                setRestoredAt(null);
                void load();
              }}
              className="ml-auto text-xs font-semibold text-fg-subtle hover:text-signal-red transition"
            >
              Discard restored changes
            </button>
          </div>
        )}
        {/* Engine receipt — provenance made visible, quietly */}
        {receipt && (
          <p className="mb-4 flex items-center gap-1.5 font-mono text-[11px] text-fg-subtle" title={receipt.head}>
            <ShieldCheck size={13} className="text-signal-green shrink-0" />
            saved on the record · receipt {receipt.seq} · {receipt.head.slice(0, 16)}… — every
            version kept, nothing overwritten
          </p>
        )}
        {error && <p className="mb-4 text-signal-red font-mono text-sm">{error}</p>}

        <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_430px] gap-8 items-start">
          {/* ── Left: the editor — a native <fieldset disabled> makes the
              whole column read-only for viewers: every input, button,
              and picker inside goes inert in one move. The fieldset IS
              the grid (NOT display:contents — a contents fieldset does
              not disable descendants in Chromium, a real footgun caught
              live). border/padding/min-width reset to vanish it. ── */}
          <section className="min-w-0">
            <fieldset
              disabled={yourRole === "viewer"}
              className="grid gap-8 min-w-0 border-0 p-0 m-0 disabled:opacity-95"
            >
            {/* Profile */}
            <div>
              <div className="mb-3 px-1">
                <h2 className="section-title">Profile</h2>
                <p className="section-desc">Name, bio, and avatar — the top of your page.</p>
              </div>
              <div className="panel p-5 sm:p-6 grid gap-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Display name</label>
                    <input className="field" value={manifest.displayName} onChange={(e) => patch({ displayName: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Avatar / logo</label>
                    <div className="flex items-center gap-2">
                      {manifest.avatar && /^https?:\/\//i.test(manifest.avatar) && (
                        <img
                          src={manifest.avatar}
                          alt=""
                          className="w-9 h-9 rounded-full object-cover border border-ink-700 shrink-0"
                        />
                      )}
                      <input className="field" value={manifest.avatar ?? ""} placeholder="https://… or upload →" onChange={(e) => patch({ avatar: e.target.value || undefined })} />
                      {uploadsOn && (
                        <>
                          <input
                            ref={fileInput}
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) void doUpload(f);
                            }}
                          />
                          <button
                            onClick={() => fileInput.current?.click()}
                            disabled={uploading}
                            className="btn btn-secondary !py-2 !px-3 shrink-0"
                            title="Upload an image — resized & hosted automatically"
                          >
                            <ImagePlus size={15} className={uploading ? "animate-pulse" : ""} />
                            {uploading ? "Uploading…" : "Upload"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="label">Bio</label>
                  <textarea className="field min-h-[56px]" value={manifest.bio ?? ""} onChange={(e) => patch({ bio: e.target.value || undefined })} />
                </div>
                <div className="sm:max-w-xs">
                  <label className="label">Page type</label>
                  {/* Set by your claim template, editable ever since Discover
                      made it load-bearing — it files you under the right chip
                      and drives ORG on the vCard. */}
                  <select
                    className="field"
                    value={manifest.identityType}
                    onChange={(e) => patch({ identityType: e.target.value as IdentityType })}
                  >
                    {manifest.identityType === "demo" && <option value="demo">Demo</option>}
                    <option value="personal">Person</option>
                    <option value="business">Business</option>
                    <option value="organization">Organization</option>
                    <option value="project">Project</option>
                    <option value="event">Event</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Blocks — each one an elevated card */}
            <div>
              <div className="mb-3 px-1">
                <h2 className="section-title">Blocks</h2>
                <p className="section-desc">Links, headers, embeds — the body of your page, in order.</p>
              </div>
              <div ref={blockListRef} className={`grid gap-3 ${drag ? "select-none" : ""}`}>
                {ordered.map((b, i) => {
                  const def = blockDefs.find((x) => x.type === b.type);
                  const Icon = BLOCK_ICONS[b.type] ?? Link2;
                  return (
                    <div
                      key={b.id}
                      data-bi={i}
                      // min-w-0: grid items default to min-width:auto, so the
                      // nowrap summary URL would set the column's floor and
                      // stretch the whole page on phones. Let the card shrink;
                      // truncate does the rest.
                      className={`panel p-4 sm:p-5 min-w-0 ${drag?.from === i ? "drag-lift" : ""}`}
                      style={dragStyle(i)}
                    >
                      <div className="flex items-center gap-3 mb-4">
                        {ordered.length > 1 && (
                          <button
                            onPointerDown={(e) => beginDrag(e, i)}
                            onPointerMove={onDragMove}
                            onPointerUp={onDragEnd}
                            onPointerCancel={stopDrag}
                            onContextMenu={(e) => e.preventDefault()}
                            className="drag-grip icon-btn shrink-0 -ml-1.5 -mr-1"
                            title="Drag to reorder — the arrows still work too"
                            aria-label="Drag to reorder"
                          >
                            <GripVertical size={15} />
                          </button>
                        )}
                        <span className="w-8 h-8 rounded-[10px] bg-accent/10 text-accent-soft inline-flex items-center justify-center shrink-0">
                          <Icon size={16} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{blockTitle(b, def?.name ?? b.type)}</p>
                          <p className="text-xs text-fg-subtle truncate">{blockSummary(b)}</p>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button onClick={() => move(i, -1)} disabled={i === 0} className="icon-btn" title="Move up">
                            <ArrowUp size={15} />
                          </button>
                          <button onClick={() => move(i, 1)} disabled={i === ordered.length - 1} className="icon-btn" title="Move down">
                            <ArrowDown size={15} />
                          </button>
                          <button
                            onClick={() => {
                              const clone: Block = { ...b, id: newBlockId(), data: JSON.parse(JSON.stringify(b.data)) as Record<string, unknown> };
                              const next = [...ordered];
                              next.splice(i + 1, 0, clone);
                              setBlocks(next);
                            }}
                            className="icon-btn"
                            title="Duplicate"
                          >
                            <Copy size={15} />
                          </button>
                          <button onClick={() => setBlocks(ordered.filter((x) => x.id !== b.id))} className="icon-btn icon-btn-danger" title="Remove block">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                      <BlockFields block={b} onChange={(data) => setBlocks(ordered.map((x) => (x.id === b.id ? { ...x, data } : x)))} />
                    </div>
                  );
                })}

                {/* Add block — at the free cap this button IS the
                    upgrade pitch, not a path to a failing save. */}
                <div className="relative">
                  <button
                    onClick={() => {
                      if (blockCap !== null && ordered.length >= blockCap) {
                        requestUpgrade("blocks");
                        return;
                      }
                      setAddOpen((v) => !v);
                    }}
                    className="w-full rounded-2xl border border-dashed border-ink-700 text-fg-muted font-semibold text-sm py-4 hover:border-accent/50 hover:text-accent-soft transition inline-flex items-center justify-center gap-2"
                  >
                    <Plus size={16} /> Add block
                    {blockCap !== null && (
                      <span className={`chip !text-[10px] ${ordered.length >= blockCap ? "text-signal-amber border-signal-amber/40" : "text-fg-subtle"}`}>
                        {Math.min(ordered.length, blockCap)}/{blockCap} free
                      </span>
                    )}
                  </button>
                  {addOpen && (
                    <div className="absolute z-10 mt-2 w-full panel p-2 grid gap-1 shadow-card-hover">
                      {blockDefs.map((def) => {
                        const Icon = BLOCK_ICONS[def.type] ?? Link2;
                        // Premium blocks: badge in the picker, and the tap
                        // IS the upgrade pitch when the wall applies — a
                        // doorway, never a path to a failing save.
                        const walled = PREMIUM_BLOCKS.has(def.type) && pageWalled;
                        return (
                          <button
                            key={def.type}
                            onClick={() => {
                              if (walled) {
                                setAddOpen(false);
                                requestUpgrade(def.type === "gallery" ? "gallery" : "giveaway");
                                return;
                              }
                              setBlocks([...ordered, { id: newBlockId(), type: def.type, order: ordered.length, data: def.defaults() }]);
                              setAddOpen(false);
                            }}
                            className="flex items-center gap-3 text-left rounded-xl px-3.5 py-2.5 hover:bg-ink-850 transition"
                          >
                            <span className="w-8 h-8 rounded-[10px] bg-accent/10 text-accent-soft inline-flex items-center justify-center shrink-0">
                              <Icon size={16} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold text-sm">{def.name}</span>
                              <span className="block text-xs text-fg-subtle truncate">{def.description}</span>
                            </span>
                            {PREMIUM_BLOCKS.has(def.type) && (
                              <span className={`chip !text-[10px] shrink-0 ${walled ? "text-accent-soft" : "text-fg-subtle"}`}>
                                {walled ? "✨ premium" : "premium ✓"}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sales — only renders once something has actually sold. */}
            <SalesPanel identityId={manifest.identityId} canSettle={yourRole === "owner"} />

            {/* Theme — a gallery, not pills */}
            <div>
              <div className="mb-3 px-1 flex items-end justify-between gap-3">
                <div>
                  <h2 className="section-title">Theme</h2>
                  <p className="section-desc">How your public page looks. The preview is the real renderer.</p>
                </div>
                <button
                  onClick={() => {
                    if (manifest.themeCustom) {
                      patch({ themeCustom: undefined });
                    } else {
                      const base = THEMES[manifest.theme ?? "pro"] ?? THEMES.pro;
                      patch({
                        themeCustom: {
                          bg: base.bg.slice(0, 7),
                          card: base.card.slice(0, 7),
                          text: base.text.slice(0, 7),
                          sub: base.sub.slice(0, 7),
                          accent: base.accent.slice(0, 7),
                        },
                      });
                    }
                  }}
                  className={`btn !py-1.5 !px-3 text-xs shrink-0 ${manifest.themeCustom ? "btn-secondary" : "btn-accent-ghost"}`}
                >
                  {manifest.themeCustom ? (
                    <>
                      <X size={13} /> Reset to theme
                    </>
                  ) : (
                    <>
                      <Palette size={13} /> Customize
                    </>
                  )}
                </button>
              </div>

              {!manifest.themeCustom ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                  {Object.entries(THEMES).map(([key, t]) => {
                    const selected = (manifest.theme ?? "pro") === key;
                    return (
                      <button
                        key={key}
                        onClick={() => patch({ theme: key })}
                        className={`panel panel-lift overflow-hidden text-left ${selected ? "ring-2 ring-accent border-accent/40" : ""}`}
                        title={key}
                      >
                        <ThemeMini palette={t} />
                        <span className="px-3 py-2 flex items-center justify-between">
                          <span className="text-xs font-semibold capitalize">{key}</span>
                          {selected && <Check size={14} className="text-accent-soft shrink-0" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="panel p-5 grid gap-4">
                  <div className="grid grid-cols-5 gap-2">
                    {([
                      ["bg", "page"],
                      ["card", "cards"],
                      ["text", "text"],
                      ["sub", "muted"],
                      ["accent", "accent"],
                    ] as const).map(([key, label]) => (
                      <div key={key} className="text-center">
                        <input
                          type="color"
                          value={manifest.themeCustom?.[key] ?? "#000000"}
                          onChange={(e) =>
                            patch({
                              themeCustom: {
                                ...(manifest.themeCustom as NonNullable<typeof manifest.themeCustom>),
                                [key]: e.target.value,
                              },
                            })
                          }
                          className="h-10 w-full rounded-xl border border-ink-700 bg-ink-850 cursor-pointer"
                          title={label}
                        />
                        <span className="mt-1.5 block text-[10px] font-medium text-fg-subtle">
                          {label}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {([
                      ["headingFont", "Heading font"],
                      ["bodyFont", "Body font"],
                    ] as const).map(([key, label]) => (
                      <div key={key}>
                        <label className="label">{label}</label>
                        {/* The font vault: three free, the rest premium.
                            Preview is free (try before you buy); the SAVE is
                            gated server-side when limits are on. */}
                        <select
                          value={manifest.themeCustom?.[key] ?? "system"}
                          onChange={(e) =>
                            patch({
                              themeCustom: {
                                ...(manifest.themeCustom as NonNullable<typeof manifest.themeCustom>),
                                [key]: e.target.value as FontId,
                              },
                            })
                          }
                          className="field"
                        >
                          <optgroup label="Free">
                            {Object.entries(FONTS)
                              .filter(([, f]) => f.tier === "free")
                              .map(([id, f]) => (
                                <option key={id} value={id}>
                                  {f.label}
                                </option>
                              ))}
                          </optgroup>
                          <optgroup label="Premium ✨">
                            {Object.entries(FONTS)
                              .filter(([, f]) => f.tier === "premium")
                              .map(([id, f]) => (
                                <option key={id} value={id}>
                                  ✨ {f.label}
                                </option>
                              ))}
                          </optgroup>
                        </select>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-fg-subtle">
                    Your page, your colors, your type — the preview is the real
                    renderer, so what you see is exactly what visitors get.
                  </p>
                </div>
              )}
            </div>

            <BackgroundPicker
              value={manifest.background}
              onChange={(bg) => {
                setBgHover(null);
                patch({ background: bg });
              }}
              onHover={setBgHover}
            />

            {/* Search & sharing — premium: own your snippet and share card.
                Only what engines actually read (title/description/og:image);
                empty fields stay automatic, clearing is always free. */}
            <div>
              <div className="mb-3 px-1 flex items-center gap-2">
                <h2 className="section-title">Search &amp; sharing</h2>
                <span className="chip !text-[10px] text-accent-soft">✨ premium</span>
              </div>
              <p className="section-desc mb-3 px-1">
                How your page reads on Google and looks in chat previews. Empty = automatic.
              </p>
              <SeoPanel
                manifest={manifest}
                walled={pageWalled}
                onChange={(seo) => patch({ seo })}
              />
            </div>

            {/* Discover — opt-IN listing. Publishing is not consent; this is. */}
            <div>
              <div className="mb-3 px-1">
                <h2 className="section-title">Discover</h2>
                <p className="section-desc">The public directory — be found, on purpose.</p>
              </div>
              <label className="panel p-5 flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={manifest.discoverable === true}
                  onChange={(e) => patch({ discoverable: e.target.checked })}
                  className="accent-[rgb(var(--accent))] w-4 h-4 mt-0.5 shrink-0"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">Listed in Discover</span>
                  <span className="block text-xs text-fg-muted mt-0.5">
                    Show this page in the public directory once it's published.
                    Publishing alone never lists you — this switch is the consent.
                  </span>
                </span>
              </label>
            </div>

            <AccessPanel
              identityId={manifest.identityId}
              canManage={yourRole === "owner"}
              sharingWalled={pageWalled}
            />
            </fieldset>
          </section>

          {/* ── Right: the hero — a floating device, always alive ─────────── */}
          <aside className="lg:sticky lg:top-16">
            <div className="device max-w-[390px] mx-auto">
              <div className="device-notch" />
              <div className="device-screen">
                <iframe title="Live preview" sandbox="" srcDoc={previewHtml} className="h-[620px]" />
              </div>
            </div>
            <p className="mt-4 text-center text-[11px] text-fg-subtle">
              Live preview — rendered by the exact renderer your visitors get.
            </p>
            {published && (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {([
                  ["Page", `/${manifest.handle}`],
                  ["Card", `/${manifest.handle}?format=card`],
                  ["QR", `/${manifest.handle}?format=qr`],
                  ["vCard", `/${manifest.handle}?format=vcard`],
                ] as const).map(([label, href]) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="chip text-fg-muted hover:text-accent-soft hover:border-accent/40 transition"
                  >
                    {label} <ArrowUpRight size={11} />
                  </a>
                ))}
              </div>
            )}
          </aside>
        </div>
      </main>
      <Footer />
    </>
  );
}
