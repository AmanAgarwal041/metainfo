"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Site audit" },
  { href: "/keywords", label: "Keywords" },
  { href: "/keyword-gap", label: "Keyword gap" },
  { href: "/competitors", label: "Competitors" },
  { href: "/serp", label: "SERP" },
  { href: "/backlinks", label: "Backlinks" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" href="/">
          <span className="brand-mark">M</span> MetaInfo
        </Link>
        <nav className="nav" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="nav-link" aria-current={path === l.href ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
