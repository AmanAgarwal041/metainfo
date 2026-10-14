"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PROVIDER_LABEL, signInUrl, useAccount } from "@/lib/account";
import { PageHead } from "./kit";

/** Sign-in is optional; this page says what it adds and what stays free. */
export default function Login({ invite }: { invite?: { token: string; email: string; orgName: string; role: string } }) {
  const account = useAccount();
  const [error, setError] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState("/");

  useEffect(() => {
    const sp = new URL(window.location.href).searchParams;
    /* eslint-disable react-hooks/set-state-in-effect -- read the query after mount */
    setError(sp.get("error"));
    const r = sp.get("returnTo");
    if (r && r.startsWith("/") && !r.startsWith("//")) setReturnTo(r);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  return (
    <main className="shell" style={{ maxWidth: 560 }}>
      <PageHead
        title={invite ? `Join ${invite.orgName}` : "Sign in to save your work"}
        sub={
          invite
            ? `You've been invited as ${invite.role === "member" ? "a member" : `an ${invite.role}`}. Sign in with ${invite.email} to accept.`
            : "Every tool works without an account. Sign in to keep projects, scan history, rank tracking and crawls in your account, use them on any device, and share them with your team."
        }
      />
      <div className="card card-pad stack">
        {error && <div className="error-box" style={{ marginTop: 0 }}>{error}</div>}
        {account && account.authenticated && !invite && (
          <div className="notice">
            You&apos;re signed in as {account.user?.email}. <Link href={returnTo}>Continue</Link>
          </div>
        )}
        {account && !account.providers.length && (
          <p className="muted small" style={{ margin: 0 }}>
            Sign-in isn&apos;t set up on this server. Set GOOGLE_AUTH_CLIENT_ID/SECRET or GITHUB_AUTH_CLIENT_ID/SECRET (and APP_URL); see the README.
          </p>
        )}
        {account?.providers.map((p) => (
          <a key={p} className={`btn ${p === account.providers[0] ? "btn-primary" : ""}`} style={{ justifyContent: "center", height: 42 }} href={signInUrl(p, { invite: invite?.token, returnTo: invite ? "/organisation" : returnTo })}>
            Continue with {PROVIDER_LABEL[p] ?? p}
          </a>
        ))}
        {!invite && (
          <ul className="plain-list muted small" style={{ marginTop: 4 }}>
            <li>Work you did before signing in on this browser is saved into your account.</li>
            <li>Your DataForSEO keys stay in this browser; they&apos;re never uploaded.</li>
            <li>You get your own organisation; invite teammates from Members and invites.</li>
          </ul>
        )}
      </div>
      {!invite && (
        <p className="muted small" style={{ marginTop: 14 }}>
          Or <Link href={returnTo}>keep using MetaInfo without an account</Link>.
        </p>
      )}
    </main>
  );
}
