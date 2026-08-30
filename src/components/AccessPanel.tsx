import React, { useCallback, useEffect, useState } from "react";

import { adminHeaders, ApiError, getJson, postJson } from "../lib/api";
import { requestUpgrade } from "../lib/upgrade";
import { useAppConfig } from "../lib/useAppConfig";
import { isItcAddress } from "../lib/wallet";

/**
 * Share access by address — like sending to a wallet, because it is one.
 * Owners grant; editors edit and publish; viewers see analytics. Every
 * grant is recorded in the engine with who-granted-whom provenance.
 */

interface Grant {
  identityId: string;
  address: string;
  role: "owner" | "editor" | "viewer";
  grantedBy: string;
  createdAt: string;
  /** Email mode: the human identity behind the principal. */
  email?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function shortAddr(addr: string): string {
  return addr.length <= 16 ? addr : `${addr.slice(0, 10)}…${addr.slice(-5)}`;
}

export function AccessPanel({
  identityId,
  canManage = true,
  sharingWalled = false,
}: {
  identityId: string;
  /** Only owners grant and revoke — the server enforces it; the UI
   *  shows exactly those powers (viewers/editors see the list only). */
  canManage?: boolean;
  /** Sharing is a premium feature of the PAGE — when walled, the form
   *  becomes the pitch (revoking stays free: walls never trap). */
  sharingWalled?: boolean;
}): React.ReactElement {
  const cfg = useAppConfig();
  const emailMode = cfg?.authMode === "email";
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [address, setAddress] = useState("");
  const [role, setRole] = useState<"editor" | "viewer" | "owner">("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    try {
      const j = await getJson<{ grants: Grant[] }>(
        `/api/identities/${encodeURIComponent(identityId)}/grants`,
      );
      setGrants(j.grants);
      setForbidden(false);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
        setForbidden(true);
        return;
      }
      setError(err instanceof Error ? err.message : "failed to load access");
    }
  }, [identityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const grant = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await postJson(
        `/api/identities/${encodeURIComponent(identityId)}/grants`,
        emailMode
          ? { email: address.trim(), role }
          : { address: address.trim(), role },
      );
      setAddress("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "grant failed");
    } finally {
      setBusy(false);
    }
  }, [identityId, address, role, load, emailMode]);

  const revoke = useCallback(
    async (target: string) => {
      setError(null);
      try {
        const res = await fetch(
          `/api/identities/${encodeURIComponent(identityId)}/grants/${encodeURIComponent(target)}`,
          { method: "DELETE", headers: adminHeaders() },
        );
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setError(j.error ?? "revoke failed");
          return;
        }
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "revoke failed");
      }
    },
    [identityId, load],
  );

  if (forbidden || grants === null) return <></>;

  const addressValid = emailMode ? EMAIL_RE.test(address.trim()) : isItcAddress(address.trim());

  return (
    <div className="panel p-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="section-title">Access</span>
        <span className="text-[11px] text-fg-subtle">
          {emailMode
            ? "share by email — like a doc, with provenance"
            : "share by address — like sending to a wallet"}
        </span>
      </div>

      <div className="mt-3 grid gap-2">
        {grants.map((g) => (
          <div
            key={g.address}
            className="flex items-center gap-3 bg-ink-850 border border-ink-700 rounded-xl px-3.5 py-2.5"
          >
            <span
              className={`text-xs text-accent-soft truncate ${g.email ? "" : "font-mono"}`}
              title={g.email ?? g.address}
            >
              {g.email ?? shortAddr(g.address)}
            </span>
            <span
              className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 border ${
                g.role === "owner"
                  ? "text-accent border-accent/40 bg-accent/10"
                  : g.role === "editor"
                    ? "text-signal-green border-signal-green/40 bg-signal-green/10"
                    : "text-fg-muted border-ink-700"
              }`}
            >
              {g.role}
            </span>
            <span className="flex-1" />
            {canManage && (
              <button
                onClick={() => void revoke(g.address)}
                className="text-fg-subtle hover:text-signal-red transition text-xs"
                title="Revoke access"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {/* minmax(0,1fr): a bare 1fr is minmax(auto,1fr) — the input's
          intrinsic width sets a floor that stretches the page on phones.
          Found with a layout bisector; keep the 0. */}
      {canManage && sharingWalled && (
        <button
          onClick={() => requestUpgrade("access")}
          className="mt-3 w-full rounded-xl border border-dashed border-accent/40 text-accent-soft text-sm font-semibold py-3 hover:bg-accent/10 transition"
        >
          ✨ Invite your team — sharing is a premium unlock
        </button>
      )}
      {canManage && !sharingWalled && (
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={emailMode ? "email to share with" : "itc1q… address to share with"}
          className="min-w-0 bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent/60 text-fg placeholder:text-fg-faint"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "editor" | "viewer" | "owner")}
          className="bg-ink-850 border border-ink-700 rounded-lg px-2 py-2 text-sm text-fg outline-none focus:border-accent/60"
        >
          <option value="editor">editor</option>
          <option value="viewer">viewer</option>
          <option value="owner">owner</option>
        </select>
        <button
          onClick={() => void grant()}
          disabled={busy || !addressValid}
          className="rounded-lg bg-accent/10 border border-accent/40 text-accent-soft text-sm font-bold px-3.5 hover:bg-accent/20 transition disabled:opacity-40"
        >
          Grant
        </button>
      </div>
      )}
      {canManage && !sharingWalled && address.trim() && !addressValid && (
        <p className="mt-1.5 text-[11px] text-signal-amber font-mono">
          {emailMode ? "not a valid email yet" : "not a valid itc1 address yet"}
        </p>
      )}
      {error && <p className="mt-2 text-signal-red text-xs font-mono">{error}</p>}
    </div>
  );
}
