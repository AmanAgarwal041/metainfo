"use client";

/* eslint-disable @next/next/no-img-element -- previews must render arbitrary remote favicons as-is */
import { useMemo, useState } from "react";
import type { Report } from "@/lib/types";
import { CodeBlock, hostOf } from "./ui";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(s: string, n: number) {
  return [...s].length > n ? [...s].slice(0, n - 1).join("").trimEnd() + "…" : s;
}

function Len({ value, min, max }: { value: string; min: number; max: number }) {
  const n = [...value].length;
  return <span className={n >= min && n <= max ? "len-ok" : "len-bad"}>{n} / {min}-{max}</span>;
}

export default function Previews({ report }: { report: Report }) {
  const p = report.page;
  const og = (k: string) => p.openGraph.find((x) => x.key === k)?.value;
  const tw = (k: string) => p.twitter.find((x) => x.key === k)?.value;
  const url = report.finalUrl || p.canonicals[0] || "https://example.com/";
  const icon = p.icons[0]?.href ? new URL(p.icons[0].href, url).toString() : `https://www.google.com/s2/favicons?domain=${hostOf(url)}&sz=64`;

  const initial = useMemo(
    () => ({
      title: p.title ?? "",
      description: p.description ?? "",
      ogTitle: og("og:title") ?? p.title ?? "",
      ogDescription: og("og:description") ?? p.description ?? "",
      image: og("og:image") ?? tw("twitter:image") ?? "",
      siteName: og("og:site_name") ?? hostOf(url),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [report],
  );
  const [f, setF] = useState(initial);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const host = hostOf(url);
  const crumbs = (() => {
    try {
      const u = new URL(url);
      return [u.host, ...u.pathname.split("/").filter(Boolean)].join(" › ");
    } catch {
      return url;
    }
  })();
  const imgStyle = f.image ? { backgroundImage: `url("${f.image.replace(/"/g, "%22")}")` } : undefined;
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);

  const exportCode = [
    `<title>${esc(f.title)}</title>`,
    `<meta name="description" content="${esc(f.description)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    ``,
    `<meta property="og:type" content="${og("og:type") ?? "website"}">`,
    `<meta property="og:site_name" content="${esc(f.siteName)}">`,
    `<meta property="og:title" content="${esc(f.ogTitle)}">`,
    `<meta property="og:description" content="${esc(f.ogDescription)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    f.image ? `<meta property="og:image" content="${esc(f.image)}">` : null,
    ``,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(f.ogTitle)}">`,
    `<meta name="twitter:description" content="${esc(f.ogDescription)}">`,
    f.image ? `<meta name="twitter:image" content="${esc(f.image)}">` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");

  return (
    <div className="preview-layout">
      <div className="card card-pad" style={{ position: "sticky", top: 70 }}>
        <h3 className="section-title">Edit &amp; preview</h3>
        <p className="section-sub">Changes update every preview live. Copy the tags when they look right.</p>
        <div className="field">
          <label>
            Title <Len value={f.title} min={30} max={60} />
          </label>
          <input className="input" value={f.title} onChange={set("title")} />
        </div>
        <div className="field">
          <label>
            Meta description <Len value={f.description} min={70} max={160} />
          </label>
          <textarea className="textarea" value={f.description} onChange={set("description")} />
        </div>
        <div className="field">
          <label>
            Share title (og:title) <Len value={f.ogTitle} min={20} max={90} />
          </label>
          <input className="input" value={f.ogTitle} onChange={set("ogTitle")} />
        </div>
        <div className="field">
          <label>
            Share description <Len value={f.ogDescription} min={50} max={200} />
          </label>
          <textarea className="textarea" value={f.ogDescription} onChange={set("ogDescription")} />
        </div>
        <div className="field">
          <label>Share image URL (1200×630)</label>
          <input className="input" value={f.image} onChange={set("image")} placeholder="https://…/og.png" />
        </div>
        <div className="field">
          <label>Site name</label>
          <input className="input" value={f.siteName} onChange={set("siteName")} />
        </div>
        {dirty && (
          <button className="btn btn-sm" onClick={() => setF(initial)}>
            Reset to page values
          </button>
        )}
      </div>

      <div className="preview-col">
        <div>
          <div className="preview-label">Google search result</div>
          <div className="serp">
            <div className="serp-site">
              <div className="serp-fav">
                <img src={icon} alt="" />
              </div>
              <div>
                <div className="serp-name">{f.siteName}</div>
                <div className="serp-url">{truncate(crumbs, 60)}</div>
              </div>
            </div>
            <div className="serp-title">{f.title || <i>No title, so Google will generate one</i>}</div>
            <div className="serp-desc">{truncate(f.description || p.excerpt, 160)}</div>
          </div>
        </div>

        <div>
          <div className="preview-label">AI answer citation (ChatGPT / Perplexity style)</div>
          <div className="ai-cite">
            <div className="q">What is {f.siteName}?</div>
            <div className="a">
              {truncate(f.ogDescription || f.description || p.firstParagraph || p.excerpt || "No description available.", 220)}
              <sup>1</sup>
            </div>
            <div className="ai-src">
              <img src={icon} alt="" />
              <div style={{ minWidth: 0 }}>
                <div className="t">{f.ogTitle || f.title}</div>
                <div className="d">{host}</div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="preview-label">Facebook · WhatsApp · iMessage</div>
          <div className="social-card">
            <div className="social-img" style={imgStyle}>
              {!f.image && "No og:image, so the card has no picture"}
            </div>
            <div className="social-body">
              <div className="social-domain">{host}</div>
              <div className="social-title">{f.ogTitle}</div>
              <div className="social-desc">{f.ogDescription}</div>
            </div>
          </div>
        </div>

        <div>
          <div className="preview-label">X (Twitter)</div>
          <div className="social-card x-card">
            <div className="social-img" style={imgStyle}>
              {!f.image && "No image"}
              <span className="x-overlay">{f.ogTitle}</span>
            </div>
          </div>
          <div className="x-domain">From {host}</div>
        </div>

        <div>
          <div className="preview-label">LinkedIn</div>
          <div className="social-card li-card">
            <div className="social-img" style={imgStyle}>
              {!f.image && "No image"}
            </div>
            <div className="social-body">
              <div className="social-title">{f.ogTitle}</div>
              <div className="social-domain" style={{ textTransform: "none", marginTop: 4 }}>{host}</div>
            </div>
          </div>
        </div>

        <div>
          <div className="preview-label">Slack</div>
          <div className="preview-surface">
            <div className="slack">
              <div className="slack-site">
                <img src={icon} alt="" width={16} height={16} />
                {f.siteName}
              </div>
              <div className="slack-title">{f.ogTitle}</div>
              <div className="slack-desc">{truncate(f.ogDescription, 200)}</div>
              {f.image && <div className="slack-img" style={imgStyle} />}
            </div>
          </div>
        </div>

        <div>
          <div className="preview-label">Export tags</div>
          <CodeBlock code={exportCode} />
        </div>
      </div>
    </div>
  );
}
