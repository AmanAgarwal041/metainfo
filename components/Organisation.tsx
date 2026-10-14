"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, loadAccount, useAccount, type Role } from "@/lib/account";
import { flushSync } from "@/lib/sync";
import { EmptyState, PageHead } from "./kit";
import { CopyButton } from "./ui";

interface Member {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  role: Role;
  joinedAt: number;
}
interface Invite {
  id: string;
  email: string;
  role: Role;
  createdAt: number;
  expiresAt: number;
}
interface Details {
  org: { id: string; name: string; createdAt: number };
  members: Member[];
  invites: Invite[];
  role: Role;
  me: string;
}

const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including managing owners",
  admin: "Invite and remove members, rename the organisation",
  member: "Use and edit the shared workspace",
};
const RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

export default function Organisation() {
  const account = useAccount();
  const [d, setD] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [link, setLink] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const det = await api<Details>("/api/org");
      setD(det);
      setName(det.org.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const orgId = account?.org?.id;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- (re)load when the active organisation changes
    if (orgId) void load();
    if (new URL(window.location.href).searchParams.get("new")) setCreating(true);
  }, [orgId, load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!account) return <main className="shell"><span className="spinner" /></main>;
  if (!account.authenticated) {
    return (
      <main className="shell">
        <PageHead title="Organisation" />
        <div className="card">
          <EmptyState
            title="Sign in to share a workspace"
            body="Organisations keep projects, history and tracking in one place for your team. Everything else works without an account."
            action={account.providers.length ? { href: "/login?returnTo=/organisation", label: "Sign in" } : undefined}
          />
        </div>
      </main>
    );
  }

  const canManage = d ? RANK[d.role] >= RANK.admin : false;

  const createOrg = async (e: FormEvent) => {
    e.preventDefault();
    await act(async () => {
      await flushSync();
      await api("/api/orgs", { method: "POST", json: { name: newName } });
      await loadAccount(true);
      setCreating(false);
      setNewName("");
    });
  };

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    await act(async () => {
      const r = await api<{ link: string }>("/api/org/invites", { method: "POST", json: { email, role } });
      setLink(r.link);
      setEmail("");
    });
  };

  const leave = async () => {
    if (!d || !confirm(`Leave ${d.org.name}? You'll lose access to its shared workspace.`)) return;
    await act(async () => {
      await flushSync();
      await api(`/api/org/members/${d.me}`, { method: "DELETE" });
      await loadAccount(true);
    });
  };

  return (
    <main className="shell">
      <PageHead
        title={d?.org.name ?? account.org?.name ?? "Organisation"}
        sub="Everyone here shares one workspace: projects, scan history, rank tracking, crawls and AI-visibility runs."
        actions={<button className="btn btn-sm" onClick={() => setCreating(!creating)}>New organisation</button>}
      />
      <div className="stack">
        {error && <div className="error-box" style={{ marginTop: 0 }}>{error}</div>}

        {creating && (
          <form className="card card-pad row" style={{ flexWrap: "wrap" }} onSubmit={createOrg}>
            <input className="input" style={{ flex: 1, minWidth: 200 }} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Organisation name" aria-label="New organisation name" maxLength={80} autoFocus />
            <button className="btn btn-primary" type="submit" disabled={!newName.trim()}>Create and switch</button>
            <button className="btn btn-ghost" type="button" onClick={() => setCreating(false)}>Cancel</button>
          </form>
        )}

        {d && canManage && (
          <form className="card card-pad row" style={{ flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); void act(() => api("/api/org", { method: "PATCH", json: { name } }).then(() => loadAccount(true))); }}>
            <label className="field-label" htmlFor="org-name" style={{ width: "100%" }}>Name</label>
            <input id="org-name" className="input" style={{ flex: 1, minWidth: 200 }} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            <button className="btn" type="submit" disabled={!name.trim() || name === d.org.name}>Rename</button>
          </form>
        )}

        {d && (
          <section className="card card-pad">
            <h2 className="section-title">Members ({d.members.length})</h2>
            <div className="list-rows" style={{ marginTop: 8 }}>
              {d.members.map((m) => {
                const canEdit = canManage && m.id !== d.me && (d.role === "owner" || m.role !== "owner");
                return (
                  <div className="list-row" key={m.id} style={{ flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontWeight: 600 }}>{m.name || m.email} {m.id === d.me && <span className="badge">you</span>}</div>
                      <div className="muted small">{m.email}</div>
                    </div>
                    {canEdit ? (
                      <select className="select" aria-label={`Role for ${m.email}`} value={m.role} onChange={(e) => void act(() => api(`/api/org/members/${m.id}`, { method: "PATCH", json: { role: e.target.value } }))}>
                        {(["member", "admin", "owner"] as Role[]).filter((r) => d.role === "owner" || r !== "owner").map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (
                      <span className="badge" title={ROLE_HELP[m.role]}>{m.role}</span>
                    )}
                    {canEdit && (
                      <button className="btn btn-ghost btn-sm" onClick={() => confirm(`Remove ${m.email}?`) && void act(() => api(`/api/org/members/${m.id}`, { method: "DELETE" }))}>Remove</button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="muted small" style={{ marginBottom: 0 }}>
              Owners: {ROLE_HELP.owner.toLowerCase()}. Admins: {ROLE_HELP.admin.toLowerCase()}. Members: {ROLE_HELP.member.toLowerCase()}.
            </p>
          </section>
        )}

        {d && canManage && (
          <section className="card card-pad">
            <h2 className="section-title">Invite someone</h2>
            <p className="section-sub">You&apos;ll get a link to send them. Only someone signed in with that email address can accept it; it expires in 14 days.</p>
            <form className="row" style={{ flexWrap: "wrap" }} onSubmit={invite}>
              <input className="input" type="email" style={{ flex: 1, minWidth: 220 }} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" aria-label="Email to invite" required />
              <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                {d.role === "owner" && <option value="owner">Owner</option>}
              </select>
              <button className="btn btn-primary" type="submit">Create invite link</button>
            </form>
            {link && (
              <div className="notice row" style={{ marginTop: 12, flexWrap: "wrap" }}>
                <span className="mono small break" style={{ flex: 1 }}>{link}</span>
                <CopyButton text={link} label="Copy link" />
              </div>
            )}
            {d.invites.length > 0 && (
              <>
                <div className="field-label" style={{ marginTop: 16 }}>Pending invites</div>
                <div className="list-rows">
                  {d.invites.map((i) => (
                    <div className="list-row" key={i.id}>
                      <span style={{ flex: 1 }} className="break">{i.email}</span>
                      <span className="badge">{i.role}</span>
                      <span className="muted small">expires {new Date(i.expiresAt).toLocaleDateString()}</span>
                      <button className="btn btn-ghost btn-sm" onClick={() => void act(() => api(`/api/org/invites/${i.id}`, { method: "DELETE" }))}>Revoke</button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {d && (
          <div className="row">
            <span className="muted small" style={{ flex: 1 }}>
              Your DataForSEO keys stay in this browser and aren&apos;t shared. <Link href="/settings#data">Settings</Link>
            </span>
            <button className="btn btn-ghost btn-sm" style={{ color: "var(--fail)" }} onClick={() => void leave()}>Leave organisation</button>
          </div>
        )}
      </div>
    </main>
  );
}
