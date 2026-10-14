"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, loadAccount, useAccount } from "@/lib/account";
import { flushSync } from "@/lib/sync";
import Login from "./Login";

interface Invite {
  email: string;
  role: string;
  orgName: string;
}

export default function InviteAccept({ token }: { token: string }) {
  const account = useAccount();
  const router = useRouter();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Invite>(`/api/invites?token=${encodeURIComponent(token)}`).then(setInvite, (e: Error) => setError(e.message));
  }, [token]);

  if (error) {
    return (
      <main className="shell" style={{ maxWidth: 560 }}>
        <div className="card card-pad">
          <h1 className="section-title">Invite unavailable</h1>
          <p className="muted">{error} Ask whoever invited you for a new link.</p>
          <Link href="/">Go to MetaInfo</Link>
        </div>
      </main>
    );
  }
  if (!invite || !account) return <main className="shell"><span className="spinner" /></main>;
  if (!account.authenticated) return <Login invite={{ token, ...invite }} />;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await flushSync();
      await api("/api/invites", { method: "POST", json: { token } });
      await loadAccount(true);
      router.push("/organisation");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <main className="shell" style={{ maxWidth: 560 }}>
      <div className="card card-pad stack">
        <h1 className="section-title">Join {invite.orgName}</h1>
        <p className="muted" style={{ margin: 0 }}>
          The invite is for {invite.email}, as {invite.role === "member" ? "a member" : `an ${invite.role}`}. You&apos;re signed in as {account.user?.email}.
        </p>
        <button className="btn btn-primary" disabled={busy} onClick={() => void accept()}>{busy ? "Joining" : `Join ${invite.orgName}`}</button>
      </div>
    </main>
  );
}
