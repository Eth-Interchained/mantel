import React from "react";

import { useAppConfig } from "../lib/useAppConfig";
import { AccountGate } from "./AccountGate";
import { EmailGate } from "./EmailGate";

/**
 * THE gate — one import for every page. The deployment's auth mode
 * decides which account surface renders: seed phrases on
 * interchained.org, email/password on ne-db.com. Pages never know the
 * difference; they just get onReady() when a session exists.
 */
export function Gate({ onReady }: { onReady: () => void }): React.ReactElement {
  const cfg = useAppConfig();
  if (!cfg) {
    return <p className="text-fg-subtle text-sm text-center py-16">Loading…</p>;
  }
  return cfg.authMode === "email" ? (
    <EmailGate onReady={onReady} />
  ) : (
    <AccountGate onReady={onReady} />
  );
}
