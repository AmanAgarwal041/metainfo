"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { COLLECTOR_REPO } from "@/lib/traffic-client";

// How Traffic works, in one screen. The setup itself happens on the Traffic page, where every value is filled in.

const STEPS = [
  { title: "Pick where your site runs", text: "Cloudflare, Vercel / Next.js, a Cloudflare Worker, or anything else." },
  { title: "Connect", text: "On Cloudflare it's two clicks: create a pre-filled API token, paste it, and MetaInfo deploys the collector and adds the routes. Elsewhere, copy two snippets with your values already in them." },
  { title: "Watch visits arrive", text: "Send a test visit, or open your site. Page loads show up within seconds." },
];

const PLATFORMS: { name: string; how: string; status: string }[] = [
  { name: "Cloudflare (DNS or Pages)", how: "A small worker on your domain's routes, in front of your site. Deployed for you. No change to your site.", status: "Every page, with its status" },
  { name: "Vercel / Next.js", how: "Two files in your app and three environment variables.", status: "Every page; statuses only for responses the proxy sends" },
  { name: "Cloudflare Worker site", how: "Wrap your worker's handler with one function.", status: "Every page, with its status" },
  { name: "Anything else", how: "Call the collector once per request from your server or edge function.", status: "Every page, with its status" },
];

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "What does the Cloudflare API token allow?",
    a: (
      <>
        Workers Scripts and Workers Routes (edit), and Zone (read): enough to upload the collector worker and add its routes. MetaInfo uses it once, during setup,
        and doesn&apos;t store it. You can delete it in Cloudflare afterwards.
      </>
    ),
  },
  {
    q: "Another worker already runs on my domain.",
    a: (
      <>
        A route runs one worker. MetaInfo tells you which worker holds it and changes nothing unless you choose to take the route over. To keep that worker, pick
        “Cloudflare Worker” and add the collector inside it.
      </>
    ),
  },
  {
    q: "Nothing shows up.",
    a: (
      <>
        On Cloudflare, the domain&apos;s DNS has to be proxied (orange cloud). Visits to <code>*.pages.dev</code>, <code>*.vercel.app</code> and other preview
        hosts aren&apos;t reported. Elsewhere, check the three variables are set and you redeployed. The worker&apos;s logs explain a refused token.
      </>
    ),
  },
  { q: "Does it slow my site down?", a: "No. Responses are never changed or delayed. Reports go out in the background after the response, and if the collector fails, the request goes through as normal." },
  {
    q: "What's collected?",
    a: (
      <>
        Path, status, user agent, the referring page and <code>utm_source</code>. Never IP addresses, cookies or other query parameters. MetaInfo keeps hourly
        counts for 120 days. The collector is <a href={`${COLLECTOR_REPO}/tree/main/collector`} target="_blank" rel="noreferrer">open source</a>.
      </>
    ),
  },
  { q: "How do I stop it?", a: "Disconnect on the Traffic page: the token stops working and the data is deleted. Remove the worker or the files whenever you like." },
];

export default function TrafficGuide() {
  return (
    <main className="shell">
      <div className="ol" style={{ display: "grid", gap: 16 }}>
        <section className="ol-card">
          <header className="ol-head">
            <div style={{ flex: 1 }}>
              <div className="ol-eyebrow">Traffic</div>
              <h1 className="ol-title" style={{ fontSize: 18 }}>See who really visits your site</h1>
              <p className="ol-desc">AI crawlers, search engines and people from AI answers, reported by a small collector at your site&apos;s edge.</p>
            </div>
            <Link className="ol-btn ol-btn-primary" href="/traffic">Connect a site</Link>
          </header>
          <ol className="ol-timeline">
            {STEPS.map((s, i) => (
              <li key={s.title} className="ol-step ol-step-idle" style={{ opacity: 1 }}>
                <div className="ol-rail">
                  <span className="ol-dot">{i + 1}</span>
                  {i < STEPS.length - 1 && <span className="ol-line" />}
                </div>
                <div className="ol-step-card" style={{ opacity: 1 }}>
                  <div className="ol-step-title">{s.title}</div>
                  <p className="ol-help" style={{ marginBottom: 0 }}>{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="ol-card">
          <header className="ol-head"><div className="ol-title">Platforms</div></header>
          <div className="ol-tiles" style={{ padding: 18, marginTop: 0 }}>
            {PLATFORMS.map((p) => (
              <div key={p.name} className="ol-tile" style={{ cursor: "default" }}>
                <span className="ol-tile-name">{p.name}</span>
                <span className="ol-tile-sub">{p.how}</span>
                <span className="ol-tile-sub" style={{ color: "var(--ol-muted)" }}>Sees: {p.status}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="ol-card">
          <header className="ol-head"><div className="ol-title">Questions</div></header>
          <div className="ol-faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <div className="ol-help">{f.a}</div>
              </details>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
