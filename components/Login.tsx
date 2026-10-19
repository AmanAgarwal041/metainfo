"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SignIn } from "@clerk/nextjs";
import { useAccount } from "@/lib/account";
import { PageHead } from "./kit";

/** Sign-in is optional; this page says what it adds and what stays free. */
export default function Login() {
  const account = useAccount();
  const [returnTo, setReturnTo] = useState("/dashboard");

  useEffect(() => {
    const r = new URL(window.location.href).searchParams.get("returnTo");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the query after mount
    if (r && r.startsWith("/") && !r.startsWith("//")) setReturnTo(r);
  }, []);

  return (
    <main className="shell" style={{ maxWidth: 560 }}>
      <PageHead
        title="Sign in to save your work"
        sub="Every tool works without an account. Sign in to keep projects, scan history, rank tracking and crawls in your account, use them on any device, and share them with your team."
      />
      <div className="stack">
        {account.loaded && !account.enabled && (
          <div className="card card-pad">
            <p className="muted small" style={{ margin: 0 }}>
              Sign-in isn&apos;t set up on this server. Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY, and bind the D1 database; see the README.
            </p>
          </div>
        )}
        {account.authenticated && (
          <div className="notice">
            You&apos;re signed in as {account.user?.email}. <Link href={returnTo}>Continue</Link>
          </div>
        )}
        {account.enabled && !account.authenticated && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <SignIn routing="hash" withSignUp fallbackRedirectUrl={returnTo} signUpFallbackRedirectUrl={returnTo} />
          </div>
        )}
        <ul className="plain-list muted small" style={{ marginTop: 4 }}>
          <li>Work you did before signing in on this browser is saved into your account.</li>
          <li>Your DataForSEO keys stay in this browser; they&apos;re never uploaded.</li>
          <li>You start in a personal workspace; create an organisation to share one with teammates.</li>
        </ul>
      </div>
      <p className="muted small" style={{ marginTop: 14 }}>
        Or <Link href={returnTo}>keep using MetaInfo without an account</Link>.
      </p>
    </main>
  );
}
