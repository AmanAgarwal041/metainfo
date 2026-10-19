"use client";

// Top-bar account control. Anonymous: a quiet "Sign in to save" (only when
// sign-in is set up). Signed in: avatar menu with the workspace switcher
// (personal, plus Clerk organisations), sync status and sign-out.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { useAccount, type Account } from "@/lib/account";
import { clearLocalWorkspace, flushSync, startSync, stopSync, SYNC_STATUS, syncStatus, WORKSPACE_REPLACED, type SyncStatus } from "@/lib/sync";

/** Starts/stops workspace sync with the account; returns a counter that changes when synced data replaced local data. */
export function useWorkspaceSync(): number {
  const account = useAccount();
  const [gen, setGen] = useState(0);
  const workspaceId = account.authenticated ? account.workspace?.id : undefined;
  const userId = account.user?.id;
  const loaded = account.loaded;
  useEffect(() => {
    if (workspaceId && userId) void startSync(workspaceId, userId);
    else if (loaded) stopSync();
  }, [workspaceId, userId, loaded]);
  useEffect(() => {
    const bump = () => setGen((g) => g + 1);
    window.addEventListener(WORKSPACE_REPLACED, bump);
    // Drop the one-shot ?signedIn=1 marker from the address bar.
    const u = new URL(window.location.href);
    if (u.searchParams.has("signedIn")) {
      u.searchParams.delete("signedIn");
      window.history.replaceState(null, "", u);
    }
    return () => {
      window.removeEventListener(WORKSPACE_REPLACED, bump);
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
  if (!account.enabled || !account.loaded) return null;
  return <ClerkAccountMenu account={account} />;
}

/** Rendered only when Clerk is set up, so its hooks always have a provider. */
function ClerkAccountMenu({ account }: { account: Account }) {
  const clerk = useClerk();
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

  if (!account.authenticated) {
    if (path === "/login") return null;
    return (
      <Link className="btn btn-sm" href={`/login?returnTo=${encodeURIComponent(path)}`} title="Optional: save projects and history to an account and share them with your team">
        Sign in to save
      </Link>
    );
  }

  // Push pending changes to the current workspace before Clerk makes another one active.
  const switchTo = async (id: string, personal: boolean) => {
    setBusy(true);
    try {
      await flushSync();
      await clerk.setActive({ organization: personal ? null : id });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const newOrg = async () => {
    setOpen(false);
    await flushSync();
    clerk.openCreateOrganization({ afterCreateOrganizationUrl: "/organisation" });
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await flushSync();
      stopSync();
      clearLocalWorkspace();
      await clerk.signOut();
      // A full load on purpose: every page still holds the cleared workspace in memory.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/dashboard";
    } finally {
      setBusy(false);
    }
  };

  const tone = sync.state === "error" ? "var(--fail)" : sync.state === "offline" ? "var(--warn)" : undefined;
  return (
    <div className="acct" ref={ref}>
      <button className="acct-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label="Account and workspace">
        <Avatar account={account} />
        <span className="acct-org">{account.workspace?.name}</span>
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
          <div className="acct-label">Workspaces</div>
          {account.workspaces?.map((w) => (
            <button key={w.id} role="menuitemradio" aria-checked={w.id === account.workspace?.id} className="acct-item" disabled={busy} onClick={() => w.id !== account.workspace?.id && void switchTo(w.id, w.personal)}>
              <span style={{ flex: 1, minWidth: 0 }} className="break">{w.name}</span>
              <span className="muted small">{w.personal ? "just you" : w.role}</span>
              {w.id === account.workspace?.id && <span aria-hidden>✓</span>}
            </button>
          ))}
          <button role="menuitem" className="acct-item" onClick={() => { setOpen(false); router.push("/organisation"); }}>
            Members and invites
          </button>
          <button role="menuitem" className="acct-item" onClick={() => void newOrg()}>
            New organisation
          </button>
          <div className="acct-sep" />
          <button role="menuitem" className="acct-item" onClick={() => { setOpen(false); clerk.openUserProfile(); }}>
            Account settings
          </button>
          <button role="menuitem" className="acct-item" disabled={busy} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
