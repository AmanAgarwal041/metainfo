"use client";

// The signed-in account, if any. Signing in is optional: every tool works
// anonymously; an account (Clerk) saves the workspace and shares it with a team.
// Without Clerk keys or a database, sign-in simply isn't offered.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth, useOrganizationList, useUser } from "@clerk/nextjs";

export type Role = "owner" | "admin" | "member";

/** A workspace the user can open: their personal one, or a Clerk organisation. `id` is what sync calls it. */
export interface Workspace {
  id: string;
  name: string;
  role: Role;
  personal: boolean;
}

export interface Account {
  /** Sign-in is offered: Clerk is set up and this server can save workspaces. */
  enabled: boolean;
  /** Clerk and the server check have finished loading. */
  loaded: boolean;
  authenticated: boolean;
  user?: { id: string; email: string; name: string | null; picture: string | null };
  workspace?: Workspace;
  workspaces?: Workspace[];
}

const OFF: Account = { enabled: false, loaded: true, authenticated: false };
const AccountContext = createContext<Account>(OFF);

export const useAccount = () => useContext(AccountContext);

/** Used when this build has no Clerk publishable key. */
export function NoAccounts({ children }: { children: ReactNode }) {
  return <AccountContext.Provider value={OFF}>{children}</AccountContext.Provider>;
}

const role = (r: string | null | undefined): Role => {
  const name = (r ?? "").replace(/^org:/, "");
  return name === "owner" || name === "admin" ? name : "member";
};

/** Inside ClerkProvider: Clerk's session, organisations and the server's ability to save, as one Account. */
export function ClerkAccounts({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, orgId, orgRole } = useAuth();
  const { user } = useUser();
  const { userMemberships } = useOrganizationList({ userMemberships: { infinite: true, pageSize: 50 } });
  const [serverReady, setServerReady] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ available: boolean }>) : { available: false }))
      .then((s) => setServerReady(s.available), () => setServerReady(false));
  }, []);

  const memberships = userMemberships.data;
  const value = useMemo<Account>(() => {
    if (serverReady === false) return OFF;
    if (!isLoaded || serverReady == null) return { enabled: true, loaded: false, authenticated: false };
    if (!isSignedIn || !userId) return { enabled: true, loaded: true, authenticated: false };
    const email = user?.primaryEmailAddress?.emailAddress ?? "";
    const personal: Workspace = { id: userId, name: "Personal", role: "owner", personal: true };
    const orgs: Workspace[] = (memberships ?? []).map((m) => ({ id: m.organization.id, name: m.organization.name, role: role(m.role), personal: false }));
    const active = orgId ? (orgs.find((o) => o.id === orgId) ?? { id: orgId, name: "Organisation", role: role(orgRole), personal: false }) : personal;
    return {
      enabled: true,
      loaded: true,
      authenticated: true,
      user: { id: userId, email, name: user?.fullName || user?.username || null, picture: user?.imageUrl ?? null },
      workspace: active,
      workspaces: [personal, ...orgs],
    };
  }, [serverReady, isLoaded, isSignedIn, userId, orgId, orgRole, user, memberships]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
