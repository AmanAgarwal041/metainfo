"use client";

// Projects: a site you're working on, its competitors, market, tracked
// keywords and AI-visibility prompts. Stored in this browser; the active
// project scopes every page.

import { useCallback, useSyncExternalStore } from "react";
import { bareDomain } from "@/lib/research-types";

export interface Project {
  id: string;
  name: string;
  domain: string;
  /** Brand name used to detect mentions in AI answers (defaults from the domain). */
  brand: string;
  competitors: string[];
  location: number;
  keywords: string[];
  prompts: string[];
  createdAt: string;
}

interface Store {
  projects: Project[];
  activeId: string;
}

const KEY = "metainfo:projects:v2";
const LEGACY_KEY = "metainfo:project:v1";
const EVENT = "metainfo:project";

const newId = () => Math.random().toString(36).slice(2, 10);

export function brandFromDomain(domain: string): string {
  const label = bareDomain(domain).split(".")[0] ?? "";
  return label ? label[0].toUpperCase() + label.slice(1) : "";
}

export function blankProject(patch: Partial<Project> = {}): Project {
  const domain = bareDomain(patch.domain ?? "");
  return {
    id: newId(),
    name: patch.name || brandFromDomain(domain) || "My site",
    domain,
    brand: patch.brand || brandFromDomain(domain),
    competitors: patch.competitors ?? [],
    location: patch.location ?? 2840,
    keywords: patch.keywords ?? [],
    prompts: patch.prompts ?? [],
    createdAt: new Date().toISOString(),
  };
}

let cachedRaw: string | null | undefined;
let cached: Store = { projects: [], activeId: "" };

function readStore(): Store {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw == null) {
      // One-time migration from the single-project format.
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const p = JSON.parse(legacy);
        const proj = blankProject({ domain: p.domain, competitors: p.competitors, location: p.location });
        raw = JSON.stringify({ projects: [proj], activeId: proj.id });
        localStorage.setItem(KEY, raw);
      }
    }
  } catch {
    /* storage blocked */
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as Store) : null;
    cached = parsed?.projects?.length ? parsed : { projects: [], activeId: "" };
    cached.projects = cached.projects.map((p) => ({ ...blankProject(), ...p }));
  } catch {
    cached = { projects: [], activeId: "" };
  }
  return cached;
}

function writeStore(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

const EMPTY_STORE: Store = { projects: [], activeId: "" };
const EMPTY_PROJECT: Project = { ...blankProject(), id: "", name: "" };

function clean(p: Project): Project {
  const domain = bareDomain(p.domain);
  return {
    ...p,
    domain,
    brand: p.brand.trim() || brandFromDomain(domain),
    competitors: [...new Set(p.competitors.map(bareDomain).filter((c) => c && c !== domain))].slice(0, 5),
    keywords: [...new Set(p.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))].slice(0, 500),
    prompts: [...new Set(p.prompts.map((k) => k.trim()).filter(Boolean))].slice(0, 50),
  };
}

export function activeProject(s: Store = readStore()): Project | null {
  return s.projects.find((p) => p.id === s.activeId) ?? s.projects[0] ?? null;
}

/** Update the active project (creating one if there are none). */
export function saveProject(patch: Partial<Project>) {
  const s = readStore();
  const cur = activeProject(s);
  if (!cur) {
    const p = clean(blankProject(patch));
    writeStore({ projects: [p], activeId: p.id });
    return;
  }
  const next = clean({ ...cur, ...patch });
  writeStore({ projects: s.projects.map((p) => (p.id === cur.id ? next : p)), activeId: cur.id });
}

export function createProject(patch: Partial<Project>): Project {
  const s = readStore();
  const p = clean(blankProject(patch));
  writeStore({ projects: [...s.projects, p], activeId: p.id });
  return p;
}

export function selectProject(id: string) {
  writeStore({ ...readStore(), activeId: id });
}

export function deleteProject(id: string) {
  const s = readStore();
  const projects = s.projects.filter((p) => p.id !== id);
  writeStore({ projects, activeId: s.activeId === id ? projects[0]?.id ?? "" : s.activeId });
}

export function useProjects(): Store {
  return useSyncExternalStore(subscribe, readStore, () => EMPTY_STORE);
}

/** The active project (an empty placeholder when none exists yet) and an updater. */
export function useProject(): [Project, (patch: Partial<Project>) => void] {
  const store = useProjects();
  const project = activeProject(store) ?? EMPTY_PROJECT;
  const update = useCallback((patch: Partial<Project>) => saveProject(patch), []);
  return [project, update];
}
