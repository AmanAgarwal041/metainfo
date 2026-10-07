"use client";

// The site you're working on, its competitors and target market. Shared by
// every research page and remembered in this browser.

import { useCallback, useSyncExternalStore } from "react";
import { bareDomain } from "@/lib/research-types";

export interface Project {
  domain: string;
  competitors: string[];
  location: number;
}

const KEY = "metainfo:project:v1";
const EVENT = "metainfo:project";
const EMPTY: Project = { domain: "", competitors: [], location: 2840 };

let cachedRaw: string | null = null;
let cachedValue: Project = EMPTY;

function read(): Project {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    /* storage blocked */
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    cachedValue = raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    cachedValue = EMPTY;
  }
  return cachedValue;
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function saveProject(next: Project) {
  const clean: Project = {
    domain: bareDomain(next.domain),
    competitors: [...new Set(next.competitors.map(bareDomain).filter((c) => c && c !== bareDomain(next.domain)))].slice(0, 5),
    location: next.location,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useProject(): [Project, (patch: Partial<Project>) => void] {
  const project = useSyncExternalStore(subscribe, read, () => EMPTY);
  const update = useCallback((patch: Partial<Project>) => saveProject({ ...read(), ...patch }), []);
  return [project, update];
}
