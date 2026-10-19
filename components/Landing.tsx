// The public landing page at "/". It renders outside the app shell (see Shell.tsx)
// and stays a server component: no client JS beyond what the layout already ships.

import Link from "next/link";
import type { ReactNode } from "react";
import {
  IconAudit,
  IconBolt,
  IconCheck,
  IconDashboard,
  IconGap,
  IconKey,
  IconLink,
  IconPlug,
  IconRobot,
  IconSchema,
  IconSerp,
  IconSitemap,
  IconSpark,
  IconTrend,
  IconUsers,
} from "./icons";
import { Logo } from "./Logo";

const REPO = "https://github.com/AmanAgarwal041/metainfo";

/** Screenshots in public/landing are 1600×1111 JPEGs of the live app (dark theme). */
function Shot({ src, alt, eager = false }: { src: string; alt: string; eager?: boolean }) {
  return (
    <figure className="lp-shot">
      {/* Plain <img>: OpenNext on Workers serves public/ as-is, with no image optimiser. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/landing/${src}`}
        alt={alt}
        width={1600}
        height={1111}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={eager ? "high" : undefined}
      />
    </figure>
  );
}

type Feature = { icon: (p: { size?: number }) => ReactNode; title: string; body: string; href?: string; paid?: boolean };

const GROUPS: { label: string; blurb: string; items: Feature[] }[] = [
  {
    label: "Optimise",
    blurb: "Free, in your browser, no account.",
    items: [
      { icon: IconAudit, title: "Page audit", href: "/audit", body: "55+ checks scored separately for Google, Bing, ChatGPT, Perplexity, Claude, Gemini and social sharing, and per category." },
      { icon: IconBolt, title: "Fix plan", href: "/audit", body: "Failing checks grouped into blockers, quick wins, foundations and polish, ranked by score gain per unit of effort." },
      { icon: IconRobot, title: "AI & crawler access", href: "/audit", body: "robots.txt verdicts and live HTTP probes for 14 search, AI-search and training crawlers, so CDN blocks show up." },
      { icon: IconSpark, title: "AI citation readiness", href: "/audit", body: "GEO score, passage citability, answer-first structure, sourced claims and freshness, all deterministic." },
      { icon: IconSitemap, title: "JS rendering & site crawl", href: "/site-audit", body: "Flag content that only appears after JavaScript runs (measured with the optional rendering service), and crawl a whole site for broken links, duplicates and template-wide issues." },
      { icon: IconSchema, title: "Schema validator", href: "/schema", body: "JSON-LD, Microdata and RDFa against the full schema.org vocabulary, plus Google rich-result requirements." },
    ],
  },
  {
    label: "Research",
    blurb: "Free starting points; volumes and rankings need DataForSEO keys.",
    items: [
      { icon: IconKey, title: "Keyword research", href: "/keywords", body: "Long-tail ideas from autocomplete for free. With DataForSEO: volume, difficulty, CPC, intent and trend." },
      { icon: IconGap, title: "Keyword gap", href: "/keyword-gap", body: "Topics competitors cover that you don't, extracted from their pages. With DataForSEO: the ranking gap." },
      { icon: IconUsers, title: "Competitors", href: "/competitors", body: "Your audit side by side with each competitor's. With DataForSEO: organic competitors by keyword overlap." },
      { icon: IconSerp, title: "SERP analysis", href: "/serp", body: "Benchmark the pages that rank. With DataForSEO: live results, SERP features and AI Overview sources." },
      { icon: IconLink, title: "Backlinks", href: "/backlinks", body: "Profile comparison, link gap, referring domains and anchors.", paid: true },
    ],
  },
  {
    label: "Track",
    blurb: "Every scan is saved, so progress has a history.",
    items: [
      { icon: IconDashboard, title: "Dashboard", href: "/dashboard", body: "Scores per platform over time, AI readiness, next fixes and a setup checklist for each project." },
      { icon: IconTrend, title: "Rank tracking", href: "/rankings", body: "Desktop or mobile positions for your keywords and competitors, with a cost estimate before each run.", paid: true },
      { icon: IconRobot, title: "AI visibility", href: "/ai-visibility", body: "Ask ChatGPT, Claude, Gemini and Perplexity your prompts and see whether they mention or cite you.", paid: true },
    ],
  },
  {
    label: "Integrate",
    blurb: "Use it from your pipeline or your agent.",
    items: [
      { icon: IconPlug, title: "MCP server", body: "Streamable HTTP at /api/mcp: audit_page, validate_schema and keyword_ideas for any MCP client." },
      { icon: IconCheck, title: "CI-friendly report API", body: "GET /api/report runs the same engine server-side and answers 422 when the score is below your bar." },
      { icon: IconUsers, title: "Optional team workspaces", body: "Sign in to sync projects and history across devices and share them with your team." },
    ],
  },
];

const SHOWCASE = [
  {
    src: "ai-crawlers.jpg",
    alt: "The AI & crawlers tab: robots.txt verdict and live HTTP status for Googlebot, OAI-SearchBot, ClaudeBot, PerplexityBot and more",
    kicker: "AI & crawlers",
    title: "Know which bots can actually read the page",
    body: "Search, AI-search, live-fetch and training crawlers each get two answers: what robots.txt allows for this exact URL, and what the server or CDN really returned to that user agent. Blocking training bots is a choice; blocking the ones that cite you is a bug.",
  },
  {
    src: "fix-plan.jpg",
    alt: "The fix plan: tasks grouped into blockers and quick wins, with projected score gains per platform",
    kicker: "Fix plan",
    title: "A ranked to-do list, not a wall of warnings",
    body: "Failing checks become tasks with an effort level, the platforms they affect and the points they're worth. Projected scores show where you'll land, and the plan exports to Markdown for your tracker.",
  },
  {
    src: "ai-citations.jpg",
    alt: "The AI citations tab: GEO score, passage citability grade and the sections an answer engine is most likely to quote",
    kicker: "AI citation readiness",
    title: "Write passages answer engines want to quote",
    body: "Every section is scored for answer quality, self-containment, readability, sources and originality. You see the most quotable passages, the weakest ones and exactly why they're weak.",
  },
];

const GALLERY = [
  { src: "schema-validator.jpg", alt: "Schema validator results for a recipe page: detected items, Google rich results eligibility and visible-content check", caption: "Schema validator" },
  { src: "previews.jpg", alt: "Editable previews of a Google result, an AI answer citation and a Facebook card", caption: "Search, AI and social previews" },
  { src: "generated-files.jpg", alt: "Generated head tags, ready to copy or download", caption: "Generated head, JSON-LD, robots.txt and llms.txt" },
  { src: "dashboard.jpg", alt: "Project dashboard with audit score, AI search readiness, score trend and next fixes", caption: "Project dashboard" },
];

const FAMILY = [
  { name: "ProductRoot", href: "https://productroot.agarwal-aman041.workers.dev", body: "A launch readiness planner: what to ship, check and announce before you go live." },
  { name: "SocialBrewery", href: "https://socialbrewery.agarwal-aman041.workers.dev", body: "An AI posting studio for YouTube Shorts, LinkedIn, Instagram, X, Hashnode, Slack and Reddit." },
];

const CURL = `# Fail the build when the page scores below 80
curl -f "https://metainfo.agarwal-aman041.workers.dev/api/report\\
?url=example.com/pricing&format=summary&min=80"`;

const MCP = `claude mcp add --transport http metainfo \\
  https://metainfo.agarwal-aman041.workers.dev/api/mcp`;

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <Link href="/" className="lp-brand" aria-label="MetaInfo home">
            <Logo />
          </Link>
          <nav className="lp-nav-links" aria-label="Landing">
            <a href="#features">Features</a>
            <a href="#developers">Developers</a>
            <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
          </nav>
          <Link className="btn btn-sm" href="/dashboard">
            Open app
          </Link>
        </div>
      </header>

      <main>
        <section className="lp-hero lp-wrap">
          <p className="lp-eyebrow">SEO and AI visibility, free and open source</p>
          <h1>See your page the way Google and the AI engines see it</h1>
          <p className="lp-sub">
            MetaInfo audits any URL for Google, Bing, ChatGPT, Perplexity, Claude and Gemini, tells you which crawlers can reach it, and turns every
            failing check into a prioritised fix. No sign-up needed.
          </p>
          <form className="lp-try" action="/audit" method="get" role="search">
            <label className="sr-only" htmlFor="lp-url">
              Page URL
            </label>
            <input id="lp-url" className="input" name="url" type="text" inputMode="url" placeholder="yoursite.com/pricing" autoComplete="url" />
            <button className="btn btn-primary" type="submit">
              Audit a page
            </button>
          </form>
          <div className="lp-cta-row">
            <Link href="/dashboard">Open dashboard →</Link>
            <span className="lp-dot" aria-hidden>
              ·
            </span>
            <span className="muted">Works without an account</span>
          </div>
          <div className="lp-hero-shot">
            <Shot src="audit-overview.jpg" alt="A MetaInfo page audit of vercel.com: overall score 92, per-platform scores for Google, Bing, ChatGPT, Perplexity, Claude, Gemini and social, category scores and top fixes" eager />
          </div>
        </section>

        <section id="features" className="lp-section lp-wrap">
          <div className="lp-head">
            <h2>Everything between &ldquo;is it indexed?&rdquo; and &ldquo;does ChatGPT cite us?&rdquo;</h2>
            <p>The audit engine is Rust compiled to WebAssembly and runs in your browser, so the core tools are free and fast.</p>
          </div>
          <div className="lp-groups">
            {GROUPS.map((g) => (
              <div key={g.label} className="lp-group">
                <div className="lp-group-head">
                  <h3>{g.label}</h3>
                  <p>{g.blurb}</p>
                </div>
                <ul className="lp-grid">
                  {g.items.map((f) => (
                    <li key={f.title} className="lp-card">
                      <span className="lp-icon">
                        <f.icon size={18} />
                      </span>
                      <h4>
                        {f.href ? <Link href={f.href}>{f.title}</Link> : f.title}
                        {f.paid && <span className="lp-tag">DataForSEO</span>}
                      </h4>
                      <p>{f.body}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-section lp-wrap lp-showcase">
          {SHOWCASE.map((s, i) => (
            <div key={s.src} className="lp-row" data-flip={i % 2 === 1}>
              <div className="lp-row-copy">
                <p className="lp-eyebrow">{s.kicker}</p>
                <h2>{s.title}</h2>
                <p>{s.body}</p>
              </div>
              <Shot src={s.src} alt={s.alt} />
            </div>
          ))}
        </section>

        <section className="lp-section lp-wrap">
          <div className="lp-head">
            <h2>And the rest of the toolkit</h2>
          </div>
          <div className="lp-gallery">
            {GALLERY.map((g) => (
              <div key={g.src}>
                <Shot src={g.src} alt={g.alt} />
                <p className="lp-caption">{g.caption}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-section lp-wrap">
          <div className="lp-trust card">
            <div>
              <h2>Works without an account</h2>
              <p>
                Every tool runs anonymously. Projects, scan history and tracking live in your browser until you decide otherwise. Sign in only if you want
                your workspace synced across devices or shared with a team.
              </p>
            </div>
            <ul className="lp-checks">
              <li>
                <IconCheck size={16} /> No sign-up, no trial, no paywall on the audit
              </li>
              <li>
                <IconCheck size={16} /> Analysis runs in your browser with WebAssembly
              </li>
              <li>
                <IconCheck size={16} /> Bring your own DataForSEO keys, pay-as-you-go, never stored on the server
              </li>
              <li>
                <IconCheck size={16} /> Identifies itself honestly when it fetches pages: no stealth scraping
              </li>
            </ul>
          </div>
        </section>

        <section id="developers" className="lp-section lp-wrap lp-dev">
          <div className="lp-row-copy">
            <p className="lp-eyebrow">For developers</p>
            <h2>Put the audit in CI, or hand it to your agent</h2>
            <p>
              <code>/api/report</code> runs the same engine on the server. With <code>format=summary</code> you get a compact JSON score card, and with{" "}
              <code>min</code> the response is HTTP 422 when the score falls below your threshold, so <code>curl -f</code> fails the pipeline.
            </p>
            <p>
              The MCP server at <code>/api/mcp</code> gives Claude and other MCP clients <code>audit_page</code>, <code>validate_schema</code> and{" "}
              <code>keyword_ideas</code>, plus the research tools when DataForSEO is configured.
            </p>
            <p>
              <a href={REPO} target="_blank" rel="noreferrer">
                Read the docs on GitHub →
              </a>
            </p>
          </div>
          <div className="lp-code">
            <pre>
              <code>{CURL}</code>
            </pre>
            <pre>
              <code>{MCP}</code>
            </pre>
          </div>
        </section>

        <section className="lp-section lp-wrap">
          <div className="lp-head">
            <h2>Part of a product family</h2>
            <p>Small, focused tools for getting a product out the door and in front of people.</p>
          </div>
          <div className="lp-family">
            {FAMILY.map((f) => (
              <a key={f.name} className="lp-card lp-family-card" href={f.href} target="_blank" rel="noreferrer">
                <h4>{f.name} ↗</h4>
                <p>{f.body}</p>
              </a>
            ))}
          </div>
        </section>

        <section className="lp-section lp-wrap lp-final">
          <h2>Find out what the crawlers see</h2>
          <div className="lp-cta-row">
            <Link className="btn btn-primary" href="/audit">
              Audit a page
            </Link>
            <Link className="btn" href="/dashboard">
              Open dashboard
            </Link>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-in">
          <Link href="/" className="lp-brand" aria-label="MetaInfo home">
            <Logo />
          </Link>
          <nav aria-label="Footer">
            <Link href="/audit">Page audit</Link>
            <Link href="/schema">Schema validator</Link>
            <Link href="/dashboard">Dashboard</Link>
            <a href={REPO} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </nav>
          <p className="muted small">Open source. Built with Next.js, Rust/WebAssembly and Cloudflare Workers.</p>
        </div>
      </footer>
    </div>
  );
}
