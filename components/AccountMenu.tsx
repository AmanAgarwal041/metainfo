"use client";

// Top-bar account control. Anonymous: a quiet "Sign in to save" (only when a
// sign-in method is configured). Signed in: avatar menu with the organisation
// switcher, sync status and sign-out.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, loadAccount, useAccount, type Account } from "@/lib/account";
import { clearLocalWorkspace, flushSync, startSync, stopSync, SYNC_STATUS, syncStatus, WORKSPACE_REPLACED, type SyncStatus } from "@/lib/sync";

/** Starts/stops workspace sync with the account; returns a counter that changes when synced data replaced local data. */
export function useWorkspaceSync(): number {
  const account = useAccount();
  const [gen, setGen] = useState(0);
  const orgId = account?.authenticated ? account.org?.id : undefined;
  const userId = account?.user?.id;
  useEffect(() => {
    if (orgId && userId) void startSync(orgId, userId);
    else if (account) stopSync();
  }, [orgId, userId, account]);
  useEffect(() => {
    const bump = () => setGen((g) => g + 1);
    const stale = () => void loadAccount(true);
    window.addEventListener(WORKSPACE_REPLACED, bump);
    window.addEventListener("metainfo:account-stale", stale);
    // Drop the one-shot ?signedIn=1 marker from the address bar.
    const u = new URL(window.location.href);
    if (u.searchParams.has("signedIn")) {
      u.searchParams.delete("signedIn");
      window.history.replaceState(null, "", u);
    }
    return () => {
      window.removeEventListener(WORKSPACE_REPLACED, bump);
      window.removeEventListener("metainfo:account-stale", stale);
    };
  }, []);
  return gen;
}

function useSyncStatus(): SyncStatus {
  const [s, setS] = useState<SyncStatus>(syncStatus);
  useEffect(() => {
    const on = () => setS(syncStatus());
    window.addEventListener(SYNC_STATUS, on);
    return () => window.removeEventListener(SYNC_STATUS, on);
  }, []);
  return s;
}

function Avatar({ account, size = 26 }: { account: Account; size?: number }) {
  const u = account.user!;
  const initial = (u.name || u.email).trim()[0]?.toUpperCase() ?? "?";
  return u.picture ? (
    // eslint-disable-next-line @next/next/no-img-element -- provider avatars are arbitrary remote hosts
    <img src={u.picture} alt="" width={size} height={size} className="acct-avatar" referrerPolicy="no-referrer" />
  ) : (
    <span className="acct-avatar acct-initial" style={{ width: size, height: size }} aria-hidden>{initial}</span>
  );
}

function statusText(s: SyncStatus): string {
  if (s.state === "syncing") return "Saving…";
  if (s.state === "synced") return "All changes saved";
  if (s.state === "offline") return "Offline: changes will sync later";
  if (s.state === "error") return `Not synced: ${s.message ?? "error"}`;
  return "Saved to your account";
}

export default function AccountMenu() {
  const account = useAccount();
  const sync = useSyncStatus();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!account) return null;
  if (!account.authenticated) {
    if (!account.providers.length || path === "/login") return null;
    return (
      <Link className="btn btn-sm" href={`/login?returnTo=${encodeURIComponent(path)}`} title="Optional: save projects and history to an account and share them with your team">
        Sign in to save
      </Link>
    );
  }

  const switchOrg = async (orgId: string) => {
    setBusy(true);
    try {
      await flushSync();
      await api("/api/session/org", { method: "POST", json: { orgId } });
      await loadAccount(true);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await flushSync();
      await api("/auth/logout", { method: "POST" });
      stopSync();
      clearLocalWorkspace();
      // A full load on purpose: every page still holds the cleared workspace in memory.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    } finally {
      setBusy(false);
    }
  };

  const tone = sync.state === "error" ? "var(--fail)" : sync.state === "offline" ? "var(--warn)" : undefined;
  return (
    <div className="acct" ref={ref}>
      <button className="acct-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label="Account and organisation">
        <Avatar account={account} />
        <span className="acct-org">{account.org?.name}</span>
        {sync.state === "error" && <span className="dot" style={{ background: "var(--fail)" }} aria-label="Sync error" />}
      </button>
      {open && (
        <div className="acct-menu" role="menu">
          <div className="acct-who">
            <Avatar account={account} size={34} />
            <div style={{ minWidth: 0 }}>
              <div className="acct-name">{account.user!.name || account.user!.email}</div>
              <div className="muted small break">{account.user!.email}</div>
            </div>
          </div>
          <div className="small" style={{ color: tone ?? "var(--text-2)", padding: "0 12px 8px" }} aria-live="polite">{statusText(sync)}</div>
          <div className="acct-sep" />
          <div className="acct-label">Organisations</div>
          {account.orgs?.map((o) => (
            <button key={o.id} role="menuitemradio" aria-checked={o.id === account.org?.id} className="acct-item" disabled={busy} onClick={() => o.id !== account.org?.id && void switchOrg(o.id)}>
              <span style={{ flex: 1, minWidth: 0 }} className="break">{o.name}</span>
              <span className="muted small">{o.role}</span>
              {o.id === account.org?.id && <span aria-hidden>✓</span>}
            </button>
          ))}
          <button role="menuitem" className="acct-item" onClick={() => { setOpen(false); router.push("/organisation"); }}>
            Members and invites
          </button>
          <button role="menuitem" className="acct-item" onClick={() => { setOpen(false); router.push("/organisation?new=1"); }}>
            New organisation
          </button>
          <div className="acct-sep" />
          <button role="menuitem" className="acct-item" disabled={busy} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
