/**
 * Built-in block types.
 *
 * These register through the same defineBlock() API any third-party
 * developer uses — the Extension Promise, kept from commit one.
 */

import { z } from "zod";
import { isStorableUrl } from "../identity";
import { defineBlock } from "../registry";

/** Real URL or a placeholder — drafts save freely; renderers skip unfilled. */
const storableUrl = z
  .string()
  .max(2048)
  .refine(isStorableUrl, "Invalid url");

export const linkBlock = defineBlock({
  type: "link",
  name: "Link",
  description: "A destination: URL, label, optional icon. The atom of Links.",
  capabilities: ["shareable", "qr", "searchable", "exportable", "schedulable", "seo"],
  schema: z.object({
    label: z.string().min(1).max(120),
    url: storableUrl,
    icon: z.string().max(64).optional(),
  }),
  defaults: () => ({ label: "New link", url: "https://", icon: "" }),
});

export const headerBlock = defineBlock({
  type: "header",
  name: "Header",
  description: "A section heading that groups the blocks beneath it.",
  capabilities: ["printable", "searchable", "seo"],
  schema: z.object({
    text: z.string().min(1).max(120),
  }),
  defaults: () => ({ text: "Section" }),
});

export const socialBlock = defineBlock({
  type: "social",
  name: "Social row",
  description: "Icon row of social destinations rendered compactly.",
  capabilities: ["shareable", "printable", "exportable", "seo"],
  schema: z.object({
    links: z
      .array(
        z.object({
          network: z.string().min(1).max(40),
          url: storableUrl,
        }),
      )
      .max(20),
  }),
  defaults: () => ({ links: [] }),
});

export const embedBlock = defineBlock({
  type: "embed",
  name: "Embed",
  description: "Embedded media by URL — YouTube, Spotify, and friends.",
  capabilities: ["embeddable", "interactive"],
  schema: z.object({
    url: storableUrl,
    title: z.string().max(120).optional(),
  }),
  defaults: () => ({ url: "https://", title: "" }),
});

export const textBlock = defineBlock({
  type: "text",
  name: "Text",
  description: "A paragraph: bio detail, hours, announcement, fine print.",
  capabilities: ["printable", "searchable", "exportable", "seo"],
  schema: z.object({
    text: z.string().min(1).max(2000),
  }),
  defaults: () => ({ text: "" }),
});

export const surfacesBlock = defineBlock({
  type: "surfaces",
  name: "Save & share",
  description: "Your profile in every format — vCard, QR, business card, and machine surfaces.",
  capabilities: ["shareable", "exportable", "printable"],
  schema: z.object({
    title: z.string().max(80).optional(),
    // The human trio defaults ON (undefined = on); the machine surfaces
    // default OFF (must be explicitly true) — see the renderer.
    vcard: z.boolean().optional(),
    qr: z.boolean().optional(),
    card: z.boolean().optional(),
    md: z.boolean().optional(),
    json: z.boolean().optional(),
  }),
  defaults: () => ({ title: "", vcard: true, qr: true, card: true, md: false, json: false }),
});

/**
 * India rail #1 — WhatsApp.
 *
 * Stored as PARTS (digits + message), never as a URL: the renderer builds
 * the wa.me link itself, so no free-text string ever lands in an href.
 * A pre-filled message is the whole point — "Hi, I want to book a design
 * consultation" qualifies the lead before the chat even opens.
 */
export const whatsappBlock = defineBlock({
  type: "whatsapp",
  name: "WhatsApp",
  description: "One tap opens a WhatsApp chat with you — with your message already typed.",
  capabilities: ["shareable", "searchable", "seo"],
  schema: z.object({
    /** E.164 digits WITHOUT the +: country code first (91… for India).
     *  Stored bare because wa.me wants it bare; validated as digits only
     *  so nothing but a phone number can reach the link builder. */
    phone: z.string().regex(/^$|^[1-9]\d{7,14}$/, "digits only, country code first (e.g. 919876543210)"),
    label: z.string().max(60).optional(),
    /** Pre-filled first message. Encoded by the renderer, never raw. */
    message: z.string().max(300).optional(),
  }),
  defaults: () => ({ phone: "", label: "Chat on WhatsApp", message: "" }),
});

/**
 * India rail #2 — UPI, paid straight to the creator's own bank.
 *
 * Mark's call, 2026-08-21: we are NEVER the intermediary. No merchant of
 * record, no gateway, no cut, no custody. This block is a direct
 * payer→payee UPI intent built from the creator's own VPA, so the money
 * moves bank-to-bank and Interchained never touches it. That is also why
 * there is nothing secret to store here: a VPA is public by design.
 *
 * The honest limit, stated plainly because the UI must not imply
 * otherwise: a UPI intent link has NO callback. Nothing tells this server
 * whether the payment happened. So this block COLLECTS; it cannot confirm,
 * cannot auto-deliver, and must never render a "paid" state.
 */
export const upiBlock = defineBlock({
  type: "upi",
  name: "UPI payment",
  description: "Take UPI payments straight to your bank — no gateway, no middleman, no fees from us.",
  capabilities: ["shareable", "printable", "qr", "seo"],
  schema: z.object({
    /** The creator's own VPA (name@bank). Public by design — not a secret. */
    vpa: z
      .string()
      .max(120)
      .regex(/^$|^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.]{1,30}$/, "looks like name@bank"),
    /** Payee name shown in the payer's UPI app. */
    payeeName: z.string().max(60).optional(),
    label: z.string().max(60).optional(),
    /** Fixed amount in rupees; omit/0 = payer chooses. Two decimals max. */
    amount: z.number().min(0).max(100000).optional(),
    /** Transaction note the payer sees. */
    note: z.string().max(80).optional(),
  }),
  defaults: () => ({ vpa: "", payeeName: "", label: "Pay with UPI", amount: 0, note: "" }),
});

/**
 * India rail #3 — a digital product sold on Tier-1 UPI rails.
 *
 * The honest loop, and the reason it looks like this: a UPI intent has no
 * callback, so nothing can auto-confirm a payment. Rather than fake it or
 * force every seller through a payment gateway, the buyer pays directly,
 * submits their UPI reference number, and the SELLER confirms from their
 * own bank app — then delivery fires. Slower than a gateway by one human
 * step, but it needs no KYC, no merchant account, and takes no fee, which
 * is what makes "your money, straight to your bank" literally true.
 *
 * `deliverable` is never rendered on the public page. It is released by
 * email only after the seller confirms the payment landed.
 */
export const productBlock = defineBlock({
  type: "product",
  name: "Digital product",
  description: "Sell a file or link for UPI — you confirm the payment, we deliver it.",
  capabilities: ["shareable", "searchable", "seo"],
  schema: z.object({
    title: z.string().min(1).max(120),
    blurb: z.string().max(300).optional(),
    /** Price in rupees. Fixed — "pay what you want" muddies confirmation. */
    price: z.number().min(1).max(100000),
    /** Where the money goes: the seller's own VPA. Same rules as the UPI block. */
    vpa: z
      .string()
      .max(120)
      .regex(/^$|^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.]{1,30}$/, "looks like name@bank"),
    payeeName: z.string().max(60).optional(),
    /** Released to the buyer ONLY after the seller confirms. https only —
     *  it travels in an email, and we don't mail people insecure links. */
    deliverable: z
      .string()
      .max(500)
      .regex(/^$|^https:\/\//, "the delivery link must be https")
      .optional(),
  }),
  defaults: () => ({ title: "", blurb: "", price: 499, vpa: "", payeeName: "", deliverable: "" }),
});

/**
 * India rail #4 — a paid 1:1 booking, on the same Tier-1 rails.
 *
 * A booking is a product with a time attached, so it deliberately reuses
 * the product machinery (claim → seller confirms against their bank →
 * delivery) rather than growing a parallel one. The only genuinely new
 * rule is exclusivity: a slot can be taken exactly once.
 *
 * Slots are plain strings the seller types ("Mon 25 Aug, 6:00 PM"), not
 * parsed datetimes. That is a deliberate limit, not laziness — parsing
 * would mean owning timezones, DST, and a calendar sync we don't have,
 * and getting any of those subtly wrong means a creator misses a call
 * they were paid for. A string the seller wrote is a string the buyer
 * reads back unchanged.
 */
export const bookingBlock = defineBlock({
  type: "booking",
  name: "Paid booking",
  description: "Sell 1:1 time — the buyer picks a slot, you confirm, we send the meeting link.",
  capabilities: ["shareable", "searchable", "schedulable", "seo"],
  schema: z.object({
    title: z.string().min(1).max(120),
    blurb: z.string().max(300).optional(),
    price: z.number().min(1).max(100000),
    vpa: z
      .string()
      .max(120)
      .regex(/^$|^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.]{1,30}$/, "looks like name@bank"),
    payeeName: z.string().max(60).optional(),
    /** e.g. "45 mins · Google Meet" — shown, never parsed. */
    duration: z.string().max(60).optional(),
    /** Offered times, in the seller's own words. Empty = nothing bookable. */
    slots: z.array(z.string().trim().min(1).max(80)).max(30),
    /** The meeting link, released only after the seller confirms payment. */
    deliverable: z
      .string()
      .max(500)
      .regex(/^$|^https:\/\//, "the meeting link must be https")
      .optional(),
  }),
  defaults: () => ({
    title: "",
    blurb: "",
    price: 1499,
    vpa: "",
    payeeName: "",
    duration: "45 mins",
    slots: [],
    deliverable: "",
  }),
});

export const galleryBlock = defineBlock({
  type: "gallery",
  name: "Gallery",
  description: "Show your work — a swipeable photo gallery. Premium.",
  capabilities: ["seo"],
  schema: z.object({
    /** Up to a dozen photos; empty galleries save fine and render as
     *  nothing (the "add at least one" nudge is editor UX, not a save
     *  wall — a half-built page must always be saveable). */
    images: z
      .array(
        z.object({
          /** https only — the public page never embeds insecure content. */
          url: z.string().max(500).regex(/^https:\/\//, "gallery images must be https URLs"),
          caption: z.string().max(120).optional(),
        }),
      )
      .max(12),
  }),
  defaults: () => ({ images: [] }),
});

export const giveawayBlock = defineBlock({
  type: "giveaway",
  name: "Giveaway",
  description: "Host a giveaway people can trust — entrants become verified leads.",
  capabilities: ["shareable", "interactive", "seo"],
  schema: z.object({
    /** Server-assigned on first save — links the block to its raffle doc. */
    raffleId: z.string().max(40).optional(),
    prize: z.string().min(1).max(120),
    /** The line under the prize on the profile card — the owner's voice
     *  ("Win a free blowout on me 💇"). Defaults to "free to enter". */
    tagline: z.string().max(80).optional(),
    description: z.string().max(600).optional(),
    image: z.string().max(200_000).optional(),
    /** ISO datetime — entries stop here; validated server-side per entry. */
    closesAt: z.string().max(40),
    winners: z.number().int().min(1).max(20).default(1),
    /** The owner's rules — the fine print, rendered on the entry page. */
    rules: z.string().max(1200).optional(),
    /** Scarcity cap — TOTAL spots; entries stop early when they fill.
     *  min 1: "first verified entry wins" is a legit flash-drop. The
     *  one-entry-per-PERSON rule is separate and always on. */
    maxEntries: z.number().int().min(1).max(100000).optional(),
  }),
  defaults: () => ({
    prize: "",
    description: "",
    image: "",
    closesAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 16),
    winners: 1,
  }),
});
