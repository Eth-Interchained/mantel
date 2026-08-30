import React, { useEffect, useRef, useState } from "react";
import { Link } from "@interchained/portal-react";
import { BarChart3, Compass, Crown, LogOut, Menu, Plus, X } from "lucide-react";

import { signOut } from "../lib/api";

/**
 * "Everything else" — the signed-in hamburger.
 *
 * Signing in makes the nav QUIETER: the Claim hero (marketing chrome)
 * retires, and the member's occasional actions live one tap away in
 * here — on every viewport, which finally gives phones a way to reach
 * Identities and Discover at all.
 *
 * Anchored absolutely inside the sticky nav (its containing block), so
 * the backdrop-blur containing-block trap that forces modals to portal
 * doesn't apply — this panel WANTS to hang off the bar.
 */
export function NavMenu({
  who,
  premium,
  showPremium,
  onPremium,
}: {
  /** Display identity — email in email mode, short address in wallet mode. */
  who: string | null;
  /** Current premium state; null when billing is not applicable. */
  premium: "premium" | "free" | null;
  /** Whether the premium row should render at all (limits enabled). */
  showPremium: boolean;
  /** Open the status modal (premium) or the upgrade pitch (free). */
  onPremium: () => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Click-outside + Escape — a menu that won't leave is a trap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item =
    "flex items-center gap-2.5 w-full px-3.5 py-2.5 text-sm font-medium text-fg-muted hover:text-fg hover:bg-ink-800/60 transition text-left";

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="icon-btn !w-8 !h-8"
        aria-label="Menu"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Menu"
      >
        {open ? <X size={17} /> : <Menu size={17} />}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-10 w-60 panel !p-0 overflow-hidden shadow-xl shadow-black/40 animate-fade-in z-30"
        >
          {who && (
            <p
              className="px-3.5 py-2.5 text-[11px] text-fg-subtle border-b border-ink-800 truncate"
              title={who}
            >
              signed in as <span className="text-fg-muted font-medium">{who}</span>
            </p>
          )}
          <Link href="/identities" role="menuitem" className={item} onClick={() => setOpen(false)}>
            <BarChart3 size={15} className="text-accent-soft" />
            Identities & stats
          </Link>
          {/* Server route, not SPA — a hard link is correct. */}
          <a href="/discover" role="menuitem" className={item}>
            <Compass size={15} className="text-accent-soft" />
            Discover
          </a>
          <Link href="/" role="menuitem" className={item} onClick={() => setOpen(false)}>
            <Plus size={15} className="text-accent-soft" />
            Claim a handle
          </Link>
          {showPremium && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPremium();
              }}
              className={item}
            >
              <Crown size={15} className={premium === "premium" ? "text-signal-amber" : "text-accent-soft"} />
              {premium === "premium" ? "Premium — your perks" : "Go Premium"}
            </button>
          )}
          <button
            role="menuitem"
            onClick={signOut}
            className={`${item} border-t border-ink-800 !text-fg-subtle hover:!text-signal-red`}
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
