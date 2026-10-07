"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createProject, selectProject, useProjects } from "@/lib/project";
import { researchStatus } from "@/lib/research-client";
import { setTheme, useTheme, type ThemePref } from "@/lib/theme";
import {
  IconArrow,
  IconAudit,
  IconDashboard,
  IconGap,
  IconKey,
  IconLink,
  IconMenu,
  IconMonitor,
  IconMoon,
  IconPlug,
  IconRobot,
  IconSearch,
  IconSerp,
  IconSettings,
  IconSun,
  IconTrend,
  IconUsers,
} from "./icons";
import { Logo } from "./Logo";

type Item = { href: string; label: string; icon: (p: { size?: number }) => ReactNode };

const NAV: { label?: string; items: Item[] }[] = [
  { items: [{ href: "/", label: "Dashboard", icon: IconDashboard }] },
  {
    label: "Optimise",
    items: [
      { href: "/audit", label: "Site audit", icon: IconAudit },
      { href: "/ai-visibility", label: "AI visibility", icon: IconRobot },
    ],
  },
  {
    label: "Research",
    items: [
      { href: "/keywords", label: "Keywords", icon: IconKey },
      { href: "/keyword-gap", label: "Keyword gap", icon: IconGap },
      { href: "/competitors", label: "Competitors", icon: IconUsers },
      { href: "/serp", label: "SERP analysis", icon: IconSerp },
      { href: "/backlinks", label: "Backlinks", icon: IconLink },
    ],
  },
  { label: "Track", items: [{ href: "/rankings", label: "Rank tracking", icon: IconTrend }] },
];
const ALL = NAV.flatMap((g) => g.items);

function ProjectSwitch() {
  const { projects, activeId } = useProjects();
  const router = useRouter();
  if (!projects.length) {
    return (
      <Link className="btn btn-sm" style={{ width: "100%", marginBottom: 4 }} href="/settings#projects">
        Create a project
      </Link>
    );
  }
  return (
    <div className="project-switch">
      <select
        className="select"
        aria-label="Active project"
        value={activeId || projects[0].id}
        onChange={(e) => {
          if (e.target.value === "__new") router.push("/settings#projects");
          else selectProject(e.target.value);
        }}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} {p.domain && p.domain !== p.name.toLowerCase() ? `(${p.domain})` : ""}
          </option>
        ))}
        <option value="__new">+ New project</option>
      </select>
    </div>
  );
}

function ThemeSwitch() {
  const theme = useTheme();
  const opts: { id: ThemePref; icon: ReactNode; label: string }[] = [
    { id: "light", icon: <IconSun />, label: "Light" },
    { id: "dark", icon: <IconMoon />, label: "Dark" },
    { id: "system", icon: <IconMonitor />, label: "System" },
  ];
  return (
    <div className="segmented" role="group" aria-label="Theme" style={{ width: "100%" }}>
      {opts.map((o) => (
        <button key={o.id} aria-pressed={theme === o.id} aria-label={o.label} title={o.label} onClick={() => setTheme(o.id)} style={{ flex: 1, display: "grid", placeItems: "center", height: 26 }}>
          {o.icon}
        </button>
      ))}
    </div>
  );
}

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const path = usePathname();
  const [provider, setProvider] = useState<boolean | null>(null);
  useEffect(() => {
    researchStatus().then((s) => setProvider(s.dataforseo));
  }, []);
  return (
    <aside className="sidebar" data-open={open} aria-label="Main navigation">
      <Link href="/" className="sb-brand" onClick={onNavigate}>
        <Logo />
      </Link>
      <ProjectSwitch />
      {NAV.map((g, i) => (
        <div className="sb-group" key={i}>
          {g.label && <div className="sb-label">{g.label}</div>}
          {g.items.map((it) => (
            <Link key={it.href} href={it.href} className="sb-link" aria-current={path === it.href ? "page" : undefined} onClick={onNavigate}>
              <it.icon size={16} />
              {it.label}
            </Link>
          ))}
        </div>
      ))}
      <div className="sb-footer">
        <Link href="/settings" className="sb-link" aria-current={path === "/settings" ? "page" : undefined} onClick={onNavigate}>
          <IconSettings size={16} />
          Settings
        </Link>
        <Link href="/settings#data" className="sb-status" onClick={onNavigate}>
          <IconPlug size={14} />
          {provider == null ? "Checking data source" : provider ? "DataForSEO connected" : "Free mode: connect data"}
        </Link>
        <ThemeSwitch />
      </div>
    </aside>
  );
}

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { projects, activeId } = useProjects();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo(() => {
    const go = (href: string) => () => router.push(href);
    const query = q.trim();
    const looksLikeUrl = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(query);
    const out: Command[] = [];
    if (query) {
      if (looksLikeUrl) out.push({ id: "audit-q", group: "Run", label: `Audit ${query}`, icon: <IconAudit />, run: go(`/audit?url=${encodeURIComponent(query)}`) });
      out.push(
        { id: "kw-q", group: "Run", label: `Keyword ideas for “${query}”`, icon: <IconKey />, run: go(`/keywords?q=${encodeURIComponent(query)}`) },
        { id: "serp-q", group: "Run", label: `Analyse SERP for “${query}”`, icon: <IconSerp />, run: go(`/serp?q=${encodeURIComponent(query)}`) },
      );
    }
    for (const it of ALL) out.push({ id: it.href, group: "Go to", label: it.label, icon: <it.icon />, run: go(it.href) });
    out.push({ id: "settings", group: "Go to", label: "Settings", icon: <IconSettings />, run: go("/settings") });
    for (const p of projects) {
      if (p.id !== activeId) out.push({ id: `p-${p.id}`, group: "Switch project", label: p.name, hint: p.domain, icon: <IconArrow />, run: () => selectProject(p.id) });
    }
    if (looksLikeUrl) out.push({ id: "new-p", group: "Projects", label: `Create project for ${query}`, icon: <IconArrow />, run: () => createProject({ domain: query }) });
    out.push(
      { id: "t-light", group: "Theme", label: "Light theme", icon: <IconSun />, run: () => setTheme("light") },
      { id: "t-dark", group: "Theme", label: "Dark theme", icon: <IconMoon />, run: () => setTheme("dark") },
      { id: "t-system", group: "Theme", label: "Match system theme", icon: <IconMonitor />, run: () => setTheme("system") },
    );
    const needle = query.toLowerCase();
    return out.filter((c) => c.group === "Run" || !needle || c.label.toLowerCase().includes(needle) || c.hint?.toLowerCase().includes(needle));
  }, [q, projects, activeId, router]);

  const pick = (i: number) => {
    const c = commands[i];
    if (!c) return;
    c.run();
    onClose();
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  let lastGroup = "";
  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          autoFocus
          placeholder="Search pages, or type a URL or keyword"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, commands.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(sel);
            } else if (e.key === "Escape") onClose();
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={`cmd-${sel}`}
        />
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {commands.length === 0 && <div className="palette-empty">No matches</div>}
          {commands.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className="palette-group">{header}</div>}
                <button id={`cmd-${i}`} data-i={i} role="option" aria-selected={i === sel} className="palette-item" onMouseMove={() => setSel(i)} onClick={() => pick(i)}>
                  {c.icon}
                  {c.label}
                  {c.hint && <span className="hint">{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const current = ALL.find((i) => i.href === path)?.label ?? (path === "/settings" ? "Settings" : "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <Sidebar open={menu} onNavigate={() => setMenu(false)} />
      <div className="scrim" data-open={menu} onClick={() => setMenu(false)} />
      <div className="app-main">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Open navigation" onClick={() => setMenu(true)}>
            <IconMenu />
          </button>
          <span className="topbar-title">{current}</span>
          <button className="cmdk-trigger" onClick={() => setPalette(true)} aria-label="Open command palette">
            <IconSearch size={14} />
            <span className="cmdk-text">Search or jump to</span>
            <kbd>⌘K</kbd>
          </button>
        </header>
        {children}
      </div>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </div>
  );
}
