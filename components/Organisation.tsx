"use client";

import Link from "next/link";
import { useEffect } from "react";
import { OrganizationList, OrganizationProfile, useClerk } from "@clerk/nextjs";
import { useAccount } from "@/lib/account";
import { flushSync } from "@/lib/sync";
import { EmptyState, PageHead } from "./kit";

/** Members, invites, roles and the name are Clerk's organisation profile; the shared workspace is MetaInfo's. */
export default function Organisation() {
  const account = useAccount();

  if (!account.loaded) return <main className="shell"><span className="spinner" /></main>;
  if (!account.authenticated) {
    return (
      <main className="shell">
        <PageHead title="Organisation" />
        <div className="card">
          <EmptyState
            title="Sign in to share a workspace"
            body="Organisations keep projects, history and tracking in one place for your team. Everything else works without an account."
            action={account.enabled ? { href: "/login?returnTo=/organisation", label: "Sign in" } : undefined}
          />
        </div>
      </main>
    );
  }
  return account.workspace?.personal ? <Personal /> : <Team />;
}

function Personal() {
  const clerk = useClerk();
  // Switching from the list below goes straight through Clerk, so save pending changes first.
  useEffect(() => {
    void flushSync();
  }, []);
  return (
    <main className="shell">
      <PageHead
        title="Personal workspace"
        sub="Only you can see this workspace. Create an organisation, or open one you've been invited to, to share projects, scan history, rank tracking, crawls and AI-visibility runs with your team."
        actions={
          <button className="btn btn-sm btn-primary" onClick={() => void flushSync().then(() => clerk.openCreateOrganization({ afterCreateOrganizationUrl: "/organisation" }))}>
            New organisation
          </button>
        }
      />
      <div style={{ display: "flex", justifyContent: "center" }}>
        <OrganizationList hidePersonal afterSelectOrganizationUrl="/organisation" afterCreateOrganizationUrl="/organisation" />
      </div>
    </main>
  );
}

function Team() {
  const account = useAccount();
  return (
    <main className="shell">
      <PageHead
        title={account.workspace?.name ?? "Organisation"}
        sub="Everyone here shares one workspace: projects, scan history, rank tracking, crawls and AI-visibility runs."
      />
      <div className="stack">
        <div style={{ overflowX: "auto" }}>
          <OrganizationProfile routing="hash" />
        </div>
        <span className="muted small">
          Admins invite and remove members and rename the organisation; members use and edit the shared workspace. Your DataForSEO keys stay in this browser and
          aren&apos;t shared. <Link href="/settings#data">Settings</Link>
        </span>
      </div>
    </main>
  );
}
