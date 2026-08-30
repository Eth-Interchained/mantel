/**
 * The mail path — Mail-in-a-Box friendly SMTP via nodemailer.
 *
 * MIAB serves standard submission: port 587 STARTTLS (default here) or
 * 465 implicit TLS (SMTP_SECURE=1), auth = the full mailbox address.
 * Every message is multipart/alternative — hand-built HTML plus a real
 * plain-text part, never an afterthought.
 *
 * Tests set LINKS_MAIL_TEST=1: nothing leaves the process; messages
 * land in `outbox` for assertion. Email mode without SMTP config fails
 * loudly at boot (see validateConfig) — verify/reset ARE the account
 * system, a dead mail path is a dead product.
 */

import nodemailer, { type Transporter } from "nodemailer";

import { config } from "./config";

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
    cid?: string;
  }>;
}

/** Captured messages under LINKS_MAIL_TEST=1 — newest last. */
export const outbox: OutgoingMail[] = [];

const testMode = process.env.LINKS_MAIL_TEST === "1";

let transporter: Transporter | null = null;

function transport(): Transporter | null {
  if (testMode) return null;
  if (transporter) return transporter;
  if (!config.smtpHost) return null;
  transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth:
      config.smtpUser && config.smtpPass
        ? { user: config.smtpUser, pass: config.smtpPass }
        : undefined,
  });
  return transporter;
}

/**
 * Send one message. Throws on transport failure — callers on critical
 * paths (signup verify) surface the error; callers on receipt paths
 * catch and log, because a receipt must never block the action.
 */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  if (testMode) {
    outbox.push(mail);
    return;
  }
  const t = transport();
  if (!t) {
    throw new Error("mail transport is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS)");
  }
  await t.sendMail({
    from: config.mailFrom,
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    attachments: mail.attachments,
  });
}
