"use client";

// Keeps this browser's workspace (projects, scan history, rank tracking,
// crawls, AI-visibility runs) in step with the signed-in workspace: the active
// Clerk organisation, or the user's personal workspace. "orgId" below is that
// workspace's id (a Clerk organisation id, or the Clerk user id).
//
// - Anonymous: nothing happens; data stays in localStorage.
// - First sign-in from a browser: its local work is merged into the account
//   ("save your progress"), so nothing done before signing in is lost.
// - Switching workspace (or account): the local copy is replaced by that
//   workspace; the previous one was already pushed.
// - Afterwards: writes are pushed shortly after they happen, with per-key
//   versions; if another device changed the same key, the two copies are
//   merged and pushed again.

import { getToken } from "@clerk/nextjs";
import { isSyncedKey } from "@/lib/workspace-keys";
import { mergeValues } from "@/lib/merge";
import { LOCAL_WRITE } from "@/lib/store";

const STATE_KEY = "metainfo:sync:v1";
export const WORKSPACE_REPLACED = "metainfo:workspace-replaced";
export const SYNC_STATUS = "metainfo:sync-status";

interface State {
  orgId: string | null;
  userId: string | null;
  versions: Record<string, number>;
  dirty: string[];
  lastSync?: number;
}

interface Entry {
  value: string;
  version: number;
  updatedAt: number;
}

export type SyncStatus = { state: "idle" | "syncing" | "synced" | "error" | "offline"; at?: number; message?: string };

let status: SyncStatus = { state: "idle" };
export const syncStatus = () => status;
function setStatus(s: SyncStatus) {
  status = s;
  window.dispatchEvent(new Event(SYNC_STATUS));
}

function readState(): State {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null") as State | null;
    if (s && typeof s === "object") return { ...s, versions: s.versions ?? {}, dirty: s.dirty ?? [] };
  } catch {
    /* fall through */
  }
  return { orgId: null, userId: null, versions: {}, dirty: [] };
}

function writeState(s: State) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: sync still works for this page view */
  }
}

const localKeys = () => Object.keys(localStorage).filter(isSyncedKey);
const isDeleted = (v: string | null | undefined) => v == null || v === "null";

async function request<T>(method: string, body?: unknown): Promise<T> {
  // Clerk's session token for the active workspace (Clerk refreshes it as it nears expiry).
  const token = await getToken().catch(() => null);
  const res = await fetch("/api/workspace", {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(json.error ?? `Sync failed (HTTP ${res.status})`), { status: res.status });
  return json;
}

let session: { orgId: string; userId: string } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;

/** Pull the workspace into this browser. Returns whether anything local changed. */
async function pull(): Promise<boolean> {
  if (!session) return false;
  const { orgId, entries } = await request<{ orgId: string; entries: Record<string, Entry> }>("GET");
  if (orgId !== session.orgId) throw Object.assign(new Error("Organisation changed"), { status: 409 });
  const st = readState();
  let changed = false;
  const set = (k: string, v: string | null) => {
    if (localStorage.getItem(k) === v) return;
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
    changed = true;
  };

  if (st.orgId !== orgId || st.userId !== session.userId) {
    const firstSync = st.orgId == null;
    const dirty = new Set<string>();
    const versions: Record<string, number> = {};
    if (firstSync) {
      // This browser's anonymous work joins the account.
      for (const k of new Set([...localKeys(), ...Object.keys(entries)])) {
        const r = entries[k];
        const l = localStorage.getItem(k);
        if (r) versions[k] = r.version;
        if (r && !isDeleted(r.value) && l != null) {
          const merged = mergeValues(r.value, l);
          set(k, merged);
          if (merged !== r.value) dirty.add(k);
        } else if (r && !isDeleted(r.value)) set(k, r.value);
        else if (l != null) dirty.add(k);
      }
    } else {
      // Another workspace or account: show it instead.
      for (const k of localKeys()) if (!entries[k] || isDeleted(entries[k].value)) set(k, null);
      for (const [k, r] of Object.entries(entries)) {
        versions[k] = r.version;
        if (!isDeleted(r.value)) set(k, r.value);
      }
    }
    writeState({ orgId, userId: session.userId, versions, dirty: [...dirty], lastSync: Date.now() });
    return changed;
  }

  const dirty = new Set(st.dirty);
  for (const [k, r] of Object.entries(entries)) {
    const base = st.versions[k] ?? 0;
    if (r.version <= base) continue;
    const l = localStorage.getItem(k);
    if (dirty.has(k) && l != null && !isDeleted(r.value)) set(k, mergeValues(r.value, l));
    else if (!dirty.has(k)) set(k, isDeleted(r.value) ? null : r.value);
    st.versions[k] = r.version;
  }
  writeState({ ...st, dirty: [...dirty], lastSync: Date.now() });
  return changed;
}

/** Push every key changed locally since the last sync. */
async function push(): Promise<boolean> {
  if (!session) return false;
  let mergedSomething = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const st = readState();
    if (!st.dirty.length) return mergedSomething;
    const keys = st.dirty.slice(0, 50);
    const sent = keys.map((key) => ({ key, value: localStorage.getItem(key), baseVersion: st.versions[key] ?? 0 }));
    const res = await request<{ versions: Record<string, number>; conflicts: Record<string, Entry> }>("PUT", { orgId: session.orgId, changes: sent });
    const now = readState();
    const dirty = new Set(now.dirty);
    for (const c of sent) {
      if (res.versions[c.key] != null) {
        now.versions[c.key] = res.versions[c.key];
        // Still dirty only if it changed again while the request was in flight.
        if (localStorage.getItem(c.key) === c.value) dirty.delete(c.key);
      }
      const conflict = res.conflicts[c.key];
      if (conflict) {
        // Another device wrote this key: merge both copies, then push the merge.
        const l = localStorage.getItem(c.key);
        if (l != null && !isDeleted(conflict.value)) {
          const merged = mergeValues(conflict.value, l);
          if (merged !== l) {
            localStorage.setItem(c.key, merged);
            mergedSomething = true;
          }
        }
        now.versions[c.key] = conflict.version;
      }
    }
    writeState({ ...now, dirty: [...dirty], lastSync: Date.now() });
    if (!Object.keys(res.conflicts).length && st.dirty.length <= 50) return mergedSomething;
  }
  return mergedSomething;
}

function run(kind: "full" | "push"): Promise<void> {
  if (!session) return Promise.resolve();
  const go = async () => {
    setStatus({ state: "syncing" });
    try {
      const pulled = kind === "full" ? await pull() : false;
      const merged = await push();
      if (pulled || merged) window.dispatchEvent(new Event(WORKSPACE_REPLACED));
      setStatus({ state: "synced", at: Date.now() });
    } catch (e) {
      setStatus(navigator.onLine === false ? { state: "offline" } : { state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };
  // One sync at a time; a request made meanwhile runs after it.
  running = (running ?? Promise.resolve()).then(go);
  return running;
}

function onLocalWrite(e: Event) {
  const key = (e as CustomEvent<string>).detail;
  if (!session || !isSyncedKey(key)) return;
  const st = readState();
  if (!st.dirty.includes(key)) writeState({ ...st, dirty: [...st.dirty, key] });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void run("push"), 1500);
}

function onFocus() {
  const st = readState();
  if (session && Date.now() - (st.lastSync ?? 0) > 30_000) void run("full");
}

/** Start syncing workspace `orgId` for a signed-in user (idempotent). */
export function startSync(orgId: string, userId: string): Promise<void> {
  const same = session?.orgId === orgId && session.userId === userId;
  session = { orgId, userId };
  if (!same) {
    window.addEventListener(LOCAL_WRITE, onLocalWrite);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
  }
  return run("full");
}

export function stopSync() {
  session = null;
  window.removeEventListener(LOCAL_WRITE, onLocalWrite);
  window.removeEventListener("focus", onFocus);
  window.removeEventListener("online", onFocus);
  setStatus({ state: "idle" });
}

/** Push anything pending (before switching workspace or signing out). */
export async function flushSync() {
  if (timer) clearTimeout(timer);
  await run("push");
}

/** After signing out: the workspace lives in the account, so this browser starts clean. */
export function clearLocalWorkspace() {
  for (const k of localKeys()) localStorage.removeItem(k);
  localStorage.removeItem(STATE_KEY);
}

export const pendingChanges = () => readState().dirty.length;
