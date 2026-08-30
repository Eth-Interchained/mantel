import React from "react";
import { Link } from "@interchained/portal-react";

import { Nav } from "../src/components/Nav";
import { Footer } from "../src/components/Footer";
import { useAppConfig } from "../src/lib/useAppConfig";

export const intent = {
  purpose:
    "The terms, in plain words — the free/premium deal, and why handles are licenses that can be revoked for abuse",
  primaryAction: "Read the terms",
  seoKeyword: "terms",
};

/**
 * Terms that a human can actually read. The load-bearing clause is
 * "handles are licenses, not property" — the backstop behind the
 * premium profile cap (economics stop casual squatting; this stops
 * the determined kind). Written the night the cap shipped, so the
 * paid promise and the enforced gate say the same thing.
 */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      <div className="mt-3 grid gap-3 text-sm text-fg-muted leading-relaxed">{children}</div>
    </section>
  );
}

export default function TermsPage(): React.ReactElement {
  const cfg = useAppConfig();
  const brand = cfg?.brandName ?? "NEDB Links";

  return (
    <>
      <Nav />
      <main className="max-w-2xl mx-auto px-5 py-12">
        <p className="kicker">the fine print, unfined</p>
        <h1 className="font-display text-3xl font-bold mt-2">Terms of use</h1>
        <p className="text-fg-muted text-sm mt-2">
          Short on purpose. If anything here surprises you, we consider that a bug —{" "}
          <span className="text-fg">tell us</span>.
        </p>

        <Section title="The deal">
          <p>
            <b className="text-fg">Free, forever:</b> one profile with your handle, a full page of
            blocks, every theme, a print-grade QR code, save-my-contact, and live stats. A complete
            thing — not a crippled demo.
          </p>
          <p>
            <b className="text-fg">Premium, pay once:</b> whatever it's worth to you (there's a
            small floor), one time, never monthly. It adds more profiles, unlimited blocks, photo
            galleries, the QR studio, custom search &amp; sharing, team access, giveaways, a listing in
            Discover, and the font vault. Anyone who bought Premium before the current profile
            allowance existed keeps the deal they bought — we don't rewrite paid promises.
          </p>
          <p>Need more profiles than Premium includes? Talk to us — real projects get sorted.</p>
        </Section>

        <Section title="Handles are licenses, not property">
          <p>
            Claiming a handle gives you a license to use it here — it doesn't make it yours the way
            your name is yours. We keep the namespace honest for real people, which means we can
            reclaim a handle when it's being abused:
          </p>
          <ul className="list-disc pl-5 grid gap-1.5">
            <li>
              <b className="text-fg">Impersonation or trademark abuse</b> — pretending to be someone
              you're not, or camping a brand you have no claim to.
            </li>
            <li>
              <b className="text-fg">Squatting at scale</b> — parking, hoarding, or reselling
              handles rather than using them.
            </li>
            <li>
              <b className="text-fg">Long-dead pages</b> — unpublished and untouched for a year or
              more (we'll try to reach you first where we can).
            </li>
          </ul>
          <p>
            Payments unlock features; they don't buy immunity from any of this. If you believe a
            handle is impersonating you or infringing your mark, contact us and we'll look at it
            like humans.
          </p>
        </Section>

        <Section title="Your content">
          <p>
            Your pages are yours. Don't publish anything illegal, deceptive, or designed to harm
            people, and don't use giveaways to mislead entrants — the draw mechanics are public and
            verifiable by design, and we keep them that way.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            When these terms change, the change is dated and the meaningful ones get called out —
            and anything you already paid for keeps working the way it was sold to you.
          </p>
          <p className="text-fg-subtle text-xs">
            {brand} · last updated July 8, 2026
          </p>
        </Section>

        <p className="mt-10 text-sm">
          <Link href="/" className="text-accent-soft font-semibold hover:underline underline-offset-4">
            ← Back to {brand}
          </Link>
        </p>
      </main>
      <Footer />
    </>
  );
}
