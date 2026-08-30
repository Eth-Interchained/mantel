/**
 * The five transactional emails — production artifacts, not samples.
 *
 * Design: the Signal register. #F7F8FA canvas, one white 560px card
 * (18px radius, #E5E7EB hairline), one strong blue #2563EB, system
 * font stack. Bulletproof email engineering: tables with
 * role="presentation", inline styles only, padded-cell buttons that
 * survive Outlook, a hidden preheader, and a hand-written plain-text
 * twin for every message — multipart/alternative, never an
 * afterthought.
 *
 * Every template returns a complete OutgoingMail ready for sendMail().
 */

import { config } from "./config";
import type { OutgoingMail } from "./mailer";

const BRAND = config.brandName;
const BRAND_UP = BRAND.toUpperCase();

// ── Shared shell ─────────────────────────────────────────────────────────────

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = "#111827";
const MUTED = "#6B7280";
const FAINT = "#94A3B8";
const BLUE = "#2563EB";
const BORDER = "#E5E7EB";

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Bulletproof CTA — padded table cell + inline-block anchor. */
function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto 8px;">
  <tr><td align="center" bgcolor="${BLUE}" style="border-radius:12px;">
    <a href="${esc(url)}" target="_blank"
       style="display:inline-block;padding:14px 34px;font-family:${FONT};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">
      ${esc(label)}
    </a>
  </td></tr>
</table>`;
}

/** Quiet monospace fallback link under a button. */
function fallbackUrl(url: string): string {
  return `<p style="margin:14px 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${FAINT};text-align:center;word-break:break-all;">
  Button not working? Paste this into your browser:<br/>
  <a href="${esc(url)}" style="color:${BLUE};text-decoration:underline;">${esc(url)}</a>
</p>`;
}

function paragraph(html: string, opts?: { center?: boolean; muted?: boolean }): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.6;color:${opts?.muted ? MUTED : INK};${opts?.center ? "text-align:center;" : ""}">${html}</p>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 14px;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:${INK};text-align:center;">${esc(text)}</h1>`;
}

function divider(): string {
  return `<hr style="border:none;border-top:1px solid ${BORDER};margin:26px 0;"/>`;
}

/**
 * The document. One card on a calm canvas; kicker, content, reasoned
 * footer ("why you got this" is the pro courtesy most products skip).
 */
function shell(opts: {
  preheader: string;
  kicker: string;
  content: string;
  reason: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<title>${esc(BRAND)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F7F8FA;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${esc(opts.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F8FA;">
    <tr><td align="center" style="padding:40px 16px 12px;">
      <p style="margin:0 0 22px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${FAINT};">
        <span style="color:${BLUE};">&#x2B21;</span>&nbsp; ${esc(BRAND_UP)}
      </p>
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#ffffff;border:1px solid ${BORDER};border-radius:18px;">
        <tr><td style="padding:40px 40px 34px;">
          <p style="margin:0 0 8px;font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${BLUE};text-align:center;">${esc(opts.kicker)}</p>
          ${opts.content}
        </td></tr>
      </table>
      <p style="margin:22px 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${FAINT};max-width:560px;">
        ${opts.reason}<br/>
        ${esc(BRAND)} — one handle, every surface. Self-hostable, GPLv3.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── 1 · Verify email ─────────────────────────────────────────────────────────

export function verifyEmail(opts: { to: string; verifyUrl: string }): OutgoingMail {
  const html = shell({
    preheader: "One click and your account is live. Link expires in 30 minutes.",
    kicker: "confirm your email",
    content: [
      heading("You're one click away"),
      paragraph(
        "Confirm this address and your account is live. No newsletters follow — we only ever email you about things <b>you</b> do.",
        { center: true, muted: true },
      ),
      button("Confirm my email", opts.verifyUrl),
      fallbackUrl(opts.verifyUrl),
      divider(),
      paragraph(
        `This link expires in 30 minutes and works once. Didn't create an account? Ignore this email — nothing happens without the click.`,
        { center: true, muted: true },
      ),
    ].join("\n"),
    reason: `You're receiving this because this address was used to sign up at ${esc(BRAND)}.`,
  });
  return {
    to: opts.to,
    subject: `Confirm your email — ${BRAND}`,
    html,
    text: [
      `${BRAND_UP} — CONFIRM YOUR EMAIL`,
      "",
      "You're one click away. Confirm this address and your account is live.",
      "",
      `Confirm: ${opts.verifyUrl}`,
      "",
      "This link expires in 30 minutes and works once.",
      "Didn't create an account? Ignore this email — nothing happens without the click.",
    ].join("\n"),
  };
}

// ── 2 · Welcome ──────────────────────────────────────────────────────────────

export function welcomeEmail(opts: { to: string; claimUrl: string }): OutgoingMail {
  const html = shell({
    preheader: "Your account is live. Claim your handle — it takes about a minute.",
    kicker: "welcome",
    content: [
      heading("You're in."),
      paragraph(
        "One handle gets you <b>every surface</b>: a profile page, a print-true business card, a scan-tracked QR code, and a save-to-contacts vCard — all from one editor, all updating together.",
        { center: true, muted: true },
      ),
      button("Claim your handle", opts.claimUrl),
      divider(),
      paragraph(
        `Three things worth knowing:`,
        { muted: true },
      ),
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td style="padding:4px 0;font-family:${FONT};font-size:14px;line-height:1.6;color:${MUTED};">
          <span style="color:${BLUE};font-weight:700;">1.</span>&nbsp; Your first profile is free, forever — no trial clock.</td></tr>
        <tr><td style="padding:4px 0;font-family:${FONT};font-size:14px;line-height:1.6;color:${MUTED};">
          <span style="color:${BLUE};font-weight:700;">2.</span>&nbsp; Every edit is versioned — your page's history is never lost.</td></tr>
        <tr><td style="padding:4px 0;font-family:${FONT};font-size:14px;line-height:1.6;color:${MUTED};">
          <span style="color:${BLUE};font-weight:700;">3.</span>&nbsp; Print the QR anywhere — if you ever rename, old codes still work.</td></tr>
      </table>`,
    ].join("\n"),
    reason: `You're receiving this one-time welcome because you just verified your ${esc(BRAND)} account.`,
  });
  return {
    to: opts.to,
    subject: "You're in — claim your handle",
    html,
    text: [
      `${BRAND_UP} — WELCOME`,
      "",
      "You're in. One handle gets you every surface: profile page, business card,",
      "scan-tracked QR, and a save-to-contacts vCard — all from one editor.",
      "",
      `Claim your handle: ${opts.claimUrl}`,
      "",
      "Worth knowing:",
      "1. Your first profile is free, forever — no trial clock.",
      "2. Every edit is versioned — your page's history is never lost.",
      "3. Print the QR anywhere — if you ever rename, old codes still work.",
    ].join("\n"),
  };
}

// ── 3 · Password reset ───────────────────────────────────────────────────────

export function resetEmail(opts: { to: string; resetUrl: string }): OutgoingMail {
  const html = shell({
    preheader: `Reset your ${BRAND} password. Link expires in 30 minutes.`,
    kicker: "password reset",
    content: [
      heading("Reset your password"),
      paragraph(
        "Someone (hopefully you) asked to reset the password for this account. One click sets a new one.",
        { center: true, muted: true },
      ),
      button("Choose a new password", opts.resetUrl),
      fallbackUrl(opts.resetUrl),
      divider(),
      paragraph(
        "This link expires in 30 minutes and works once. <b>Didn't ask?</b> Your account is safe — your password only changes if this link is used. You can ignore this email.",
        { center: true, muted: true },
      ),
    ].join("\n"),
    reason: `You're receiving this because a password reset was requested for this address at ${esc(BRAND)}.`,
  });
  return {
    to: opts.to,
    subject: `Reset your password — ${BRAND}`,
    html,
    text: [
      `${BRAND_UP} — PASSWORD RESET`,
      "",
      "Someone (hopefully you) asked to reset the password for this account.",
      "",
      `Choose a new password: ${opts.resetUrl}`,
      "",
      "This link expires in 30 minutes and works once.",
      "Didn't ask? Your account is safe — ignore this email.",
    ].join("\n"),
  };
}

// ── 4 · You're live — the showpiece, QR inlined ──────────────────────────────

export function publishedEmail(opts: {
  to: string;
  handle: string;
  profileUrl: string;
  qrPng: Buffer;
}): OutgoingMail {
  const u = esc(opts.profileUrl);
  const html = shell({
    preheader: `@${opts.handle} is live — your page, business card, QR, and vCard are all up.`,
    kicker: "you're live",
    content: [
      heading(`@${opts.handle} is live`),
      paragraph(
        `Your page is published at<br/><a href="${u}" style="color:${BLUE};font-weight:600;text-decoration:none;word-break:break-all;">${u}</a>`,
        { center: true },
      ),
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:22px auto;">
        <tr><td align="center" style="background-color:#ffffff;border:1px solid ${BORDER};border-radius:14px;padding:14px;">
          <img src="cid:qr@links" width="180" height="180" alt="QR code for @${esc(opts.handle)}" style="display:block;width:180px;height:180px;"/>
        </td></tr>
        <tr><td align="center" style="padding-top:10px;font-family:${FONT};font-size:12px;color:${FAINT};">
          Print-grade. Scans are tracked separately from taps —<br/>and it survives renames, so print with confidence.
        </td></tr>
      </table>`,
      divider(),
      paragraph("One identity, every surface — all live now:", { center: true, muted: true }),
      `<p style="margin:0;font-family:${FONT};font-size:14px;line-height:2;color:${MUTED};text-align:center;">
        <a href="${u}" style="color:${BLUE};text-decoration:none;font-weight:600;">Page</a>
        &nbsp;&middot;&nbsp;
        <a href="${u}?format=card" style="color:${BLUE};text-decoration:none;font-weight:600;">Business card</a>
        &nbsp;&middot;&nbsp;
        <a href="${u}?format=vcard" style="color:${BLUE};text-decoration:none;font-weight:600;">Save contact</a>
        &nbsp;&middot;&nbsp;
        <a href="${u}?format=qr&amp;download=1" style="color:${BLUE};text-decoration:none;font-weight:600;">QR (SVG)</a>
      </p>`,
    ].join("\n"),
    reason: `You're receiving this because you published @${esc(opts.handle)} on ${esc(BRAND)}.`,
  });
  return {
    to: opts.to,
    subject: `@${opts.handle} is live — page, card, and QR`,
    html,
    text: [
      `${BRAND_UP} — @${opts.handle} IS LIVE`,
      "",
      `Your page: ${opts.profileUrl}`,
      "",
      "Every surface is up:",
      `  Page:           ${opts.profileUrl}`,
      `  Business card:  ${opts.profileUrl}?format=card`,
      `  Save contact:   ${opts.profileUrl}?format=vcard`,
      `  QR (SVG):       ${opts.profileUrl}?format=qr&download=1`,
      "",
      "The attached QR is print-grade. Scans are tracked separately from",
      "taps, and the code survives renames — print with confidence.",
    ].join("\n"),
    attachments: [
      {
        filename: `${opts.handle}-qr.png`,
        content: opts.qrPng,
        contentType: "image/png",
        cid: "qr@links",
      },
    ],
  };
}

// ── 5 · Supporter receipt ────────────────────────────────────────────────────

export function receiptEmail(opts: {
  to: string;
  amountCents: number;
  currency: string;
}): OutgoingMail {
  const amount = `$${(opts.amountCents / 100).toFixed(2)} ${opts.currency.toUpperCase()}`;
  const html = shell({
    preheader: `Unlimited profiles, forever. Receipt for your one-time ${amount} contribution.`,
    kicker: "receipt",
    content: [
      heading("Unlimited, forever. Thank you."),
      paragraph(
        "You paid what <b>you</b> thought it was worth — once. Not a subscription. Nothing renews, nothing expires, nobody emails you about a card on file.",
        { center: true, muted: true },
      ),
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:20px auto;">
        <tr><td align="center" style="border:1px solid ${BORDER};border-radius:14px;padding:18px 34px;">
          <p style="margin:0;font-family:${FONT};font-size:13px;color:${FAINT};">one-time contribution</p>
          <p style="margin:4px 0 0;font-family:${FONT};font-size:30px;font-weight:700;letter-spacing:-0.02em;color:${INK};">${esc(amount)}</p>
          <p style="margin:6px 0 0;font-family:${FONT};font-size:13px;color:${MUTED};">unlocked: unlimited profiles, forever</p>
        </td></tr>
      </table>`,
      divider(),
      paragraph(
        "This supports the hosted service. The software itself is GPLv3 and self-hostable — your own instance is unlimited and free, always. Keep this email as your receipt.",
        { center: true, muted: true },
      ),
    ].join("\n"),
    reason: `You're receiving this because you made a one-time contribution on ${esc(BRAND)}.`,
  });
  return {
    to: opts.to,
    subject: `Receipt — unlimited profiles, forever (${amount})`,
    html,
    text: [
      `${BRAND_UP} — RECEIPT`,
      "",
      "Unlimited, forever. Thank you.",
      "",
      `One-time contribution: ${amount}`,
      "Unlocked: unlimited profiles, forever.",
      "",
      "Not a subscription. Nothing renews, nothing expires.",
      "The software is GPLv3 and self-hostable — your own instance is",
      "unlimited and free, always. Keep this email as your receipt.",
    ].join("\n"),
  };
}

// ── 6 · Magic sign-in — the link for this device, the code for another ──────

export function magicLoginEmail(opts: {
  to: string;
  loginUrl: string;
  code: string;
}): OutgoingMail {
  const digits = opts.code
    .split("")
    .map(
      (d) =>
        `<td style="width:44px;height:54px;border:1px solid ${BORDER};border-radius:10px;font-family:${FONT};font-size:26px;font-weight:700;color:${INK};text-align:center;">${esc(d)}</td>`,
    )
    .join(`<td style="width:8px;"></td>`);
  const html = shell({
    preheader: "Tap to sign in, or use the code. Expires in 15 minutes.",
    kicker: "sign in",
    content: [
      heading("Your sign-in link"),
      paragraph(
        "Tap the button on this device — or, if you're signing in somewhere else, type the code instead. Both work once and expire in 15 minutes.",
        { center: true, muted: true },
      ),
      button("Sign me in", opts.loginUrl),
      fallbackUrl(opts.loginUrl),
      divider(),
      paragraph("Signing in on another device? Enter this code:", { center: true, muted: true }),
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:6px auto 2px;"><tr>${digits}</tr></table>`,
      divider(),
      paragraph(
        "Didn't ask to sign in? Ignore this email — nothing happens without the link or the code, and your password is untouched.",
        { center: true, muted: true },
      ),
    ].join("\n"),
    reason: `You're receiving this because a sign-in link was requested for this address at ${esc(BRAND)}.`,
  });
  return {
    to: opts.to,
    subject: `Your sign-in link — ${BRAND}`,
    html,
    text: [
      `${BRAND_UP} — SIGN IN`,
      "",
      `Sign in: ${opts.loginUrl}`,
      "",
      `Or enter this code on the sign-in screen: ${opts.code}`,
      "",
      "Both work once and expire in 15 minutes.",
      "Didn't ask? Ignore this email — your password is untouched.",
    ].join("\n"),
  };
}

// ── 7 · Giveaway: the entry code ─────────────────────────────────────────────

export function giveawayCodeEmail(opts: {
  to: string;
  code: string;
  prize: string;
  handle: string;
}): OutgoingMail {
  const digits = opts.code
    .split("")
    .map(
      (d) =>
        `<td style="width:44px;height:54px;border:1px solid ${BORDER};border-radius:10px;font-family:${FONT};font-size:26px;font-weight:700;color:${INK};text-align:center;">${esc(d)}</td>`,
    )
    .join(`<td style="width:8px;"></td>`);
  const html = shell({
    preheader: `Your entry code for ${opts.prize}. Expires in 30 minutes.`,
    kicker: "confirm your entry",
    content: [
      heading("One code between you and a ticket"),
      paragraph(
        `You're entering <b>${esc(opts.prize)}</b> — a giveaway by @${esc(opts.handle)}. Type this code on the entry page to lock your ticket:`,
        { center: true, muted: true },
      ),
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:14px auto 2px;"><tr>${digits}</tr></table>`,
      divider(),
      paragraph(
        "The code works once and expires in 30 minutes. Didn't enter anything? Ignore this — no ticket exists without the code.",
        { center: true, muted: true },
      ),
    ].join("\n"),
    reason: `You're receiving this because this address was entered in a giveaway on ${esc(BRAND)}.`,
  });
  return {
    to: opts.to,
    subject: `Your entry code — ${opts.prize}`,
    html,
    text: [
      `${BRAND_UP} — CONFIRM YOUR GIVEAWAY ENTRY`,
      "",
      `Giveaway: ${opts.prize} (by @${opts.handle})`,
      `Your code: ${opts.code}`,
      "",
      "Enter it on the giveaway page to lock your ticket.",
      "Works once, expires in 30 minutes. Didn't enter? Ignore this email.",
    ].join("\n"),
  };
}

// ── 8 · Giveaway: ticket confirmed ───────────────────────────────────────────

export function giveawayTicketEmail(opts: {
  to: string;
  name: string;
  ticketId: string;
  prize: string;
  handle: string;
  closesAt: string;
  verifyUrl: string;
}): OutgoingMail {
  const closes = new Date(opts.closesAt).toUTCString();
  const html = shell({
    preheader: `Ticket ${opts.ticketId} — you're in the draw for ${opts.prize}.`,
    kicker: "you're in",
    content: [
      heading("Your ticket is locked"),
      paragraph(
        `${esc(opts.name)}, you're officially in the draw for <b>${esc(opts.prize)}</b> by @${esc(opts.handle)}.`,
        { center: true, muted: true },
      ),
      `<p style="margin:16px 0 4px;text-align:center;"><span style="display:inline-block;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:18px;font-weight:700;color:${INK};border:1px solid ${BORDER};border-radius:12px;padding:12px 22px;">${esc(opts.ticketId)}</span></p>`,
      paragraph(`Entries close ${esc(closes)}.`, { center: true, muted: true }),
      divider(),
      paragraph(
        `This draw is provably fair: the outcome commitment was published before entries opened, and the winner is computed against a public randomness beacon. <a href="${esc(opts.verifyUrl)}" style="color:${BLUE};">Verify the math yourself</a> — your ticket id is your anonymous, public stake.`,
        { center: true, muted: true },
      ),
    ].join("\n"),
    reason: `You're receiving this because you confirmed a giveaway entry on ${esc(BRAND)}.`,
  });
  return {
    to: opts.to,
    subject: `You're in — ticket ${opts.ticketId} for ${opts.prize}`,
    html,
    text: [
      `${BRAND_UP} — TICKET CONFIRMED`,
      "",
      `${opts.name}, you're in the draw for: ${opts.prize} (by @${opts.handle})`,
      `Your ticket: ${opts.ticketId}`,
      `Entries close: ${closes}`,
      "",
      `Provably fair — verify the draw: ${opts.verifyUrl}`,
    ].join("\n"),
  };
}

// ── 9 · Giveaway: the winner ─────────────────────────────────────────────────

export function giveawayWinnerEmail(opts: {
  to: string;
  name: string;
  ticketId: string;
  prize: string;
  handle: string;
  verifyUrl: string;
}): OutgoingMail {
  const html = shell({
    preheader: `Ticket ${opts.ticketId} won ${opts.prize}.`,
    kicker: "you won",
    content: [
      heading("🎉 That's your ticket"),
      paragraph(
        `${esc(opts.name)} — ticket <b style="font-family:'JetBrains Mono',ui-monospace,monospace;">${esc(opts.ticketId)}</b> just won <b>${esc(opts.prize)}</b>, the giveaway by @${esc(opts.handle)}.`,
        { center: true, muted: true },
      ),
      paragraph(
        `@${esc(opts.handle)} has your contact details from your entry and will reach out about claiming the prize.`,
        { center: true, muted: true },
      ),
      divider(),
      paragraph(
        `Don't take our word for it: the draw is publicly verifiable — commitment, beacon, and the exact arithmetic. <a href="${esc(opts.verifyUrl)}" style="color:${BLUE};">Check the math</a>.`,
        { center: true, muted: true },
      ),
    ].join("\n"),
    reason: `You're receiving this because your giveaway ticket won on ${esc(BRAND)}.`,
  });
  return {
    to: opts.to,
    subject: `🎉 You won ${opts.prize}`,
    html,
    text: [
      `${BRAND_UP} — YOU WON`,
      "",
      `${opts.name}, ticket ${opts.ticketId} won: ${opts.prize} (by @${opts.handle})`,
      `The page owner will contact you about claiming it.`,
      "",
      `Verify the draw yourself: ${opts.verifyUrl}`,
    ].join("\n"),
  };
}

// ── 8 · Access invite — shared like a doc, with provenance ───────────────────

const ROLE_BLURB: Record<string, string> = {
  owner: "full control: edit, publish, and manage who has access",
  editor: "you can edit the page and publish changes",
  viewer: "you can see the page, its editor, and its stats",
};

export function grantInviteEmail(opts: {
  to: string;
  role: string;
  displayName: string;
  handle: string;
  editUrl: string;
}): OutgoingMail {
  const roleEsc = esc(opts.role);
  const blurb = ROLE_BLURB[opts.role] ?? "";
  const html = shell({
    preheader: `You've been added to ${opts.displayName} (@${opts.handle}) as ${opts.role}.`,
    kicker: "you're in",
    content: [
      heading(`Welcome to ${esc(opts.displayName)}`),
      paragraph(
        `<b>@${esc(opts.handle)}</b> added you as <b>${roleEsc}</b> — ${esc(blurb)}.`,
        { center: true },
      ),
      button(opts.role === "viewer" ? "Take a look" : "Open the editor", opts.editUrl),
      fallbackUrl(opts.editUrl),
    ].join("\n"),
    reason: `You're receiving this because @${esc(opts.handle)} on ${esc(BRAND)} shared their page with ${esc(opts.to)}.`,
  });
  return {
    to: opts.to,
    subject: `You've been added to @${opts.handle} as ${opts.role}`,
    html,
    text: [
      `${BRAND_UP} — WELCOME TO ${opts.displayName.toUpperCase()}`,
      "",
      `@${opts.handle} added you as ${opts.role} — ${blurb}.`,
      "",
      `Open it: ${opts.editUrl}`,
    ].join("\n"),
  };
}

// ── 11 · Digital product: a buyer says they paid ─────────────────────────────

/**
 * Notifies the SELLER that someone claims to have paid.
 *
 * Deliberately worded as a claim, never a confirmation: on Tier-1 UPI
 * rails nothing has verified this payment, and the seller's own bank app
 * is the only source of truth. An email that said "you've been paid"
 * would be the platform asserting something it cannot know.
 */
export function productClaimEmail(opts: {
  to: string;
  title: string;
  price: number;
  reference: string;
  buyerEmail: string;
  handle: string;
  /** Bookings: the time they picked. Held, not confirmed. */
  slot?: string;
}): OutgoingMail {
  const amount = `₹${opts.price.toFixed(2).replace(/\.00$/, "")}`;
  const html = shell({
    preheader: `${opts.buyerEmail} says they paid ${amount} for ${opts.title}. Check your bank, then release it.`,
    kicker: "someone wants your product",
    content: [
      heading("A buyer says they've paid"),
      paragraph(
        `<b>${esc(opts.buyerEmail)}</b> claims to have sent <b>${esc(amount)}</b> for <b>${esc(opts.title)}</b>.`,
        { center: true },
      ),
      paragraph(
        `UPI reference: <b>${esc(opts.reference)}</b>${opts.slot ? `<br />Slot held: <b>${esc(opts.slot)}</b>` : ""}`,
        { center: true, muted: true },
      ),
      divider(),
      paragraph(
        "Check this reference in your own UPI app or bank statement first. Once you can see the money, confirm it in your editor and we'll email them the download straight away.",
        { center: true, muted: true },
      ),
    ].join("\n"),
    reason: `You're receiving this because you sell a digital product on @${esc(opts.handle)}.`,
  });
  return {
    to: opts.to,
    subject: `${amount} claimed for ${opts.title} — ref ${opts.reference}`,
    html,
    text: [
      `${BRAND_UP} — A BUYER SAYS THEY PAID`,
      "",
      `Product: ${opts.title}`,
      `Amount:  ${amount}`,
      `Ref:     ${opts.reference}`,
      ...(opts.slot ? [`Slot:    ${opts.slot} (held, not yet confirmed)`] : []),
      `Buyer:   ${opts.buyerEmail}`,
      "",
      "Nothing here is verified — check the reference against your own bank,",
      "then confirm in your editor to release the download.",
    ].join("\n"),
  };
}

// ── 12 · Digital product: delivery ───────────────────────────────────────────

export function productDeliveryEmail(opts: {
  to: string;
  title: string;
  deliverable: string;
  handle: string;
  /** Bookings: the confirmed time. Restated so the buyer has it in writing. */
  slot?: string;
}): OutgoingMail {
  const html = shell({
    preheader: opts.slot
      ? `Your booking for ${opts.title} is confirmed — ${opts.slot}.`
      : `Your download for ${opts.title} is ready.`,
    kicker: "payment confirmed",
    content: [
      heading(opts.slot ? "You're booked in" : "Here's your download"),
      paragraph(
        opts.slot
          ? `@${esc(opts.handle)} confirmed your payment for <b>${esc(opts.title)}</b>.<br />Your time: <b>${esc(opts.slot)}</b>`
          : `@${esc(opts.handle)} confirmed your payment for <b>${esc(opts.title)}</b>. It's all yours:`,
        { center: true },
      ),
      button(opts.slot ? "Join the call" : "Get it now", opts.deliverable),
      fallbackUrl(opts.deliverable),
      divider(),
      paragraph(
        "Save this email — it's your copy of the link. Any problem with the file, reply to the seller directly.",
        { center: true, muted: true },
      ),
    ].join("\n"),
    reason: `You're receiving this because you bought ${esc(opts.title)} from @${esc(opts.handle)} on ${esc(BRAND)}.`,
  });
  return {
    to: opts.to,
    subject: opts.slot ? `Booking confirmed — ${opts.title}, ${opts.slot}` : `Your download — ${opts.title}`,
    html,
    text: [
      opts.slot ? `${BRAND_UP} — YOUR BOOKING IS CONFIRMED` : `${BRAND_UP} — YOUR DOWNLOAD IS READY`,
      "",
      `@${opts.handle} confirmed your payment for ${opts.title}.`,
      ...(opts.slot ? [`Your time: ${opts.slot}`] : []),
      "",
      `${opts.slot ? "Join" : "Get it"}: ${opts.deliverable}`,
      "",
      "Save this email — it's your copy of the link.",
    ].join("\n"),
  };
}
