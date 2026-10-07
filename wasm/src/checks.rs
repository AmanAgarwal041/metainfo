//! The rule set. Each check states which platforms it affects, how severe a
//! failure is, roughly how much effort a fix takes, and — where possible — a
//! fix generated from the page's own content.

use crate::crawlers::{CrawlerAccess, Purpose};
use crate::extract::{ld_types, nested_ld, PageData};
use crate::generate::{esc, Suggestions, DESC_MAX, DESC_MIN, TITLE_MAX, TITLE_MIN};
use crate::llms::LlmsReport;
use crate::model::{Category, Check, Effort, Platform, ScanInput, Severity, Status};
use crate::robots::RobotsReport;
use crate::sitemap::{normalize, SitemapReport};
use serde_json::Value;
use url::Url;

use Category as Cat;
use Effort as E;
use Platform::*;
use Severity as Sev;

const SEARCH: &[Platform] = &[Google, Bing];
const ALL_ENGINES: &[Platform] = &[Google, Bing, ChatGPT, Perplexity, Claude, Gemini];
const EVERYONE: &[Platform] = &[Google, Bing, ChatGPT, Perplexity, Claude, Gemini, Social];

pub struct Ctx<'a> {
    pub input: &'a ScanInput,
    pub page: &'a PageData,
    pub url: Option<&'a Url>,
    pub robots: Option<&'a RobotsReport>,
    pub sitemap: Option<&'a SitemapReport>,
    pub llms: Option<&'a LlmsReport>,
    pub crawlers: &'a [CrawlerAccess],
    pub sugg: &'a Suggestions,
    /// Pasted HTML: no HTTP response, robots, sitemap or probes to look at.
    pub html_only: bool,
}

fn new(
    id: &'static str,
    category: Category,
    title: &'static str,
    severity: Severity,
    effort: Effort,
    platforms: &[Platform],
    why: &'static str,
) -> Check {
    Check {
        id,
        category,
        title,
        status: Status::Info,
        severity,
        effort,
        platforms: platforms.to_vec(),
        finding: String::new(),
        why,
        recommendation: String::new(),
        snippet: None,
        snippet_lang: None,
    }
}

impl Check {
    fn pass(mut self, finding: impl Into<String>) -> Check {
        self.status = Status::Pass;
        self.finding = finding.into();
        self
    }
    fn warn(mut self, finding: impl Into<String>, rec: impl Into<String>) -> Check {
        self.status = Status::Warn;
        self.finding = finding.into();
        self.recommendation = rec.into();
        self
    }
    fn fail(mut self, finding: impl Into<String>, rec: impl Into<String>) -> Check {
        self.status = Status::Fail;
        self.finding = finding.into();
        self.recommendation = rec.into();
        self
    }
    fn info(mut self, finding: impl Into<String>) -> Check {
        self.status = Status::Info;
        self.finding = finding.into();
        self
    }
    fn code(mut self, lang: &'static str, snippet: impl Into<String>) -> Check {
        self.snippet = Some(snippet.into());
        self.snippet_lang = Some(lang);
        self
    }
}

fn clen(s: &str) -> usize {
    s.chars().count()
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

pub fn run(cx: &Ctx) -> Vec<Check> {
    let mut v = Vec::with_capacity(64);
    indexability(cx, &mut v);
    meta(cx, &mut v);
    social(cx, &mut v);
    content(cx, &mut v);
    structured(cx, &mut v);
    ai(cx, &mut v);
    performance(cx, &mut v);
    v
}

// ------------------------------------------------------------ indexability

fn robots_directives(cx: &Ctx) -> Vec<String> {
    let mut d: Vec<String> = Vec::new();
    for src in [&cx.page.meta_robots, &cx.page.googlebot, &cx.page.bingbot].into_iter().flatten() {
        d.extend(src.split(',').map(|s| s.trim().to_ascii_lowercase()));
    }
    if let Some(x) = cx.input.headers.get("x-robots-tag") {
        for part in x.split(',') {
            // "googlebot: noindex" style prefixes
            let p = part.rsplit(':').next().unwrap_or(part);
            d.push(p.trim().to_ascii_lowercase());
        }
    }
    d
}

fn indexability(cx: &Ctx, v: &mut Vec<Check>) {
    let p = cx.page;

    let c = new("http-status", Cat::Indexability, "Page returns HTTP 200", Sev::Critical, E::Medium, ALL_ENGINES,
        "Only pages that return 200 are indexed and cited. 4xx/5xx pages are dropped from Google, Bing and every AI index.");
    v.push(match cx.input.status {
        None => c.info("Pasted HTML — no HTTP response to check."),
        Some(200) => c.pass("The page responded 200 OK."),
        Some(s) if (200..300).contains(&s) => {
            c.warn(format!("The page responded {s}."), "Serve the canonical version of this page with a plain 200 OK.")
        }
        Some(s) => c.fail(
            format!("The page responded {s}."),
            "Fix the server/route so the page returns 200, or redirect (301) it to a live URL.",
        ),
    });

    let c = new(
        "https",
        Cat::Indexability,
        "Served over HTTPS",
        Sev::High,
        E::Medium,
        ALL_ENGINES,
        "HTTPS is a Google page-experience signal and browsers flag HTTP pages as “Not secure”.",
    );
    v.push(match cx.url {
        None => c.info("No URL to check."),
        Some(u) if u.scheme() == "https" => c.pass("The final URL uses HTTPS."),
        Some(u) => c.fail(
            format!("The final URL uses {}.", u.scheme()),
            "Install a TLS certificate and 301-redirect all HTTP URLs to HTTPS.",
        ),
    });

    let c = new("redirects", Cat::Indexability, "Short redirect chain", Sev::Low, E::Low, SEARCH,
        "Each hop costs crawl budget and delays rendering; Google follows up to 10 hops but recommends going directly to the destination.");
    let r = &cx.input.redirects;
    v.push(if cx.html_only {
        c.info("Pasted HTML — no redirects to check.")
    } else if r.is_empty() {
        c.pass("No redirects.")
    } else {
        let temp = r.iter().filter(|x| x.status == 302 || x.status == 307).count();
        let chain = r.iter().map(|x| format!("{} ({})", x.url, x.status)).collect::<Vec<_>>().join(" → ");
        if r.len() > 1 {
            c.warn(
                format!("{} before the final URL: {chain}", plural(r.len(), "redirect", "redirects")),
                "Link and redirect straight to the final URL so crawlers make one request.",
            )
        } else if temp > 0 {
            c.warn(
                format!("Temporary redirect: {chain}"),
                "Use a permanent 301/308 redirect so ranking signals move to the destination URL.",
            )
        } else {
            c.pass(format!("One permanent redirect: {chain}"))
        }
    });

    let d = robots_directives(cx);
    let c = new("noindex", Cat::Indexability, "Page is indexable", Sev::Critical, E::Low, ALL_ENGINES,
        "`noindex` (meta robots or X-Robots-Tag) removes the page from Google and Bing — and ChatGPT search is built on Bing’s index.");
    v.push(if d.iter().any(|x| x == "noindex" || x == "none") {
        c.fail(
            "A `noindex` directive is set on this page.",
            "Remove `noindex` from the robots meta tag and the X-Robots-Tag header if this page should rank.",
        )
        .code("html", r#"<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">"#)
    } else {
        c.pass("No noindex directive found.")
    });

    let c = new("snippet-controls", Cat::Indexability, "Snippets and AI answers allowed", Sev::High, E::Low, &[Google, Gemini, Bing, ChatGPT],
        "`nosnippet` and `max-snippet` limit what Google shows in results and AI Overviews; Bing applies the same limits to Copilot and ChatGPT search answers.");
    let restrict: Vec<&String> = d
        .iter()
        .filter(|x| {
            *x == "nosnippet"
                || *x == "noarchive"
                || *x == "nocache"
                || x.strip_prefix("max-snippet:")
                    .map(|n| n.trim().parse::<i64>().map(|n| (0..50).contains(&n)).unwrap_or(false))
                    .unwrap_or(false)
        })
        .collect();
    v.push(if !restrict.is_empty() {
        c.warn(format!("Restrictive directives: {}.", restrict.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")),
            "Remove these unless you deliberately want to stay out of AI answers. Use `max-snippet:-1` to allow full snippets.")
            .code("html", r#"<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">"#)
    } else if p.nosnippet_elements > 0 {
        c.pass(format!("No page-level restrictions; {} hidden from snippets with data-nosnippet.", plural(p.nosnippet_elements, "element is", "elements are")))
    } else {
        c.pass("No snippet restrictions.")
    });

    let c = new("canonical", Cat::Indexability, "Canonical URL", Sev::High, E::Low, &[Google, Bing, ChatGPT, Perplexity, Claude],
        "A canonical consolidates duplicate URLs (tracking params, http/https, trailing slashes) so ranking signals and AI citations land on one URL.");
    let canon_snippet = cx
        .sugg
        .canonical
        .as_ref()
        .map(|c| format!(r#"<link rel="canonical" href="{}">"#, esc(c)))
        .unwrap_or_else(|| r#"<link rel="canonical" href="https://example.com/this-page">"#.into());
    let mut uniq = p.canonicals.clone();
    uniq.sort();
    uniq.dedup();
    v.push(match uniq.as_slice() {
        [] => c.fail("No `<link rel=\"canonical\">` found.", "Add a self-referencing canonical with the absolute URL of this page.").code("html", canon_snippet),
        [one] => {
            if !one.starts_with("http") {
                c.warn(format!("Canonical is relative: `{one}`."), "Use an absolute URL including scheme and host.").code("html", canon_snippet)
            } else if let Some(u) = cx.url {
                if normalize(one) == normalize(u.as_str()) || cx.html_only {
                    c.pass(format!("Self-referencing canonical: {one}"))
                } else {
                    c.warn(format!("Canonical points elsewhere: {one}"), "This page asks to be indexed as another URL. That's correct for duplicates — otherwise make it self-referencing.")
                        .code("html", canon_snippet)
                }
            } else {
                c.pass(format!("Canonical: {one}"))
            }
        }
        many => c.fail(format!("{} different canonicals: {}", many.len(), many.join(", ")), "Keep exactly one canonical — Google ignores all of them when they conflict.").code("html", canon_snippet),
    });

    let c = new(
        "robots-txt",
        Cat::Indexability,
        "robots.txt is valid",
        Sev::Medium,
        E::Low,
        &[Google, Bing, ChatGPT, Perplexity, Claude],
        "Every crawler reads /robots.txt first. A 5xx response makes Google stop crawling the whole site.",
    );
    v.push(match cx.robots {
        _ if cx.html_only => c.info("Pasted HTML — robots.txt not fetched."),
        None => c.info("robots.txt was not fetched."),
        Some(r) if r.found && r.warnings.is_empty() => c.pass(format!("Found, with {} and {}.", plural(r.agents.len(), "user-agent group", "user-agent groups"), plural(r.sitemaps.len(), "sitemap", "sitemaps"))),
        Some(r) if r.found => c.warn(format!("Found, with {}: {}", plural(r.warnings.len(), "problem", "problems"), r.warnings.join("; ")), "Clean up the flagged lines — unknown directives are ignored silently."),
        Some(r) if matches!(r.status, Some(s) if s >= 500) => c.fail(format!("robots.txt returned {}.", r.status.unwrap_or(0)), "Google treats a 5xx robots.txt as “disallow everything”. Make it return 200 (or 404 if you have no rules)."),
        Some(_) => c.warn("No robots.txt (404).", "Crawlers will allow everything, but add one to declare your sitemap and AI-crawler policy explicitly — see Generated files."),
    });

    access(
        cx,
        v,
        "access-google",
        "Googlebot can crawl the page",
        Google,
        &["googlebot"],
        &[],
        &[],
        "If Googlebot is disallowed, the page can't be ranked or used in AI Overviews.",
    );
    access(
        cx,
        v,
        "access-bing",
        "Bingbot can crawl the page",
        Bing,
        &["bingbot"],
        &[],
        &[],
        "Bing's index powers Bing, Copilot, DuckDuckGo and ChatGPT search results.",
    );
    access(cx, v, "access-chatgpt", "ChatGPT crawlers can reach the page", ChatGPT, &["oai-searchbot"], &["chatgpt-user"], &["gptbot"],
        "OAI-SearchBot builds ChatGPT search's index; ChatGPT-User fetches pages live when users ask. GPTBot (training) is optional.");
    access(cx, v, "access-claude", "Claude crawlers can reach the page", Claude, &["claude-searchbot"], &["claude-user"], &["claudebot"],
        "Claude-SearchBot indexes pages for Claude's search; Claude-User fetches live on request. ClaudeBot (training) is optional.");
    access(
        cx,
        v,
        "access-perplexity",
        "Perplexity crawlers can reach the page",
        Perplexity,
        &["perplexitybot"],
        &["perplexity-user"],
        &[],
        "PerplexityBot builds Perplexity's index; Perplexity-User fetches pages live on request.",
    );
    access(cx, v, "access-gemini", "Gemini can use the page", Gemini, &["googlebot"], &[], &["google-extended"],
        "AI Overviews use Googlebot's crawl. The Google-Extended token controls Gemini apps' use of the content for grounding and training.");

    let c = new(
        "sitemap",
        Cat::Indexability,
        "XML sitemap",
        Sev::Medium,
        E::Medium,
        &[Google, Bing, Perplexity],
        "Sitemaps help crawlers find every page and, with <lastmod>, prioritise fresh content.",
    );
    v.push(match cx.sitemap {
        _ if cx.html_only => c.info("Pasted HTML — sitemap not fetched."),
        None => c.info("No sitemap fetched."),
        Some(s) if !s.found => c.fail("No valid XML sitemap at the robots.txt location or /sitemap.xml.", "Publish a sitemap listing your canonical URLs with <lastmod>, then submit it in Google Search Console and Bing Webmaster Tools.")
            .code("xml", format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n  <url>\n    <loc>{}</loc>\n    <lastmod>YYYY-MM-DD</lastmod>\n  </url>\n</urlset>", cx.sugg.canonical.clone().unwrap_or_default())),
        Some(s) if !s.issues.is_empty() => c.warn(format!("Found ({} URLs) with issues: {}", s.url_count, s.issues.join("; ")), "Fix the listed sitemap issues."),
        Some(s) => c.pass(format!("Found: {}, {}{}.", plural(s.url_count, "URL", "URLs"), plural(s.child_sitemaps.len(), "child sitemap", "child sitemaps"), s.latest_lastmod.as_ref().map(|l| format!(", latest lastmod {l}")).unwrap_or_default())),
    });

    let c = new("sitemap-robots", Cat::Indexability, "Sitemap declared in robots.txt", Sev::Low, E::Low, &[Google, Bing, Perplexity, ChatGPT],
        "A `Sitemap:` line lets every crawler — including AI ones that never see Search Console — discover your sitemap.");
    let sm_line = format!("Sitemap: {}/sitemap.xml", cx.sugg.origin.clone().unwrap_or_default());
    v.push(match (cx.robots, cx.html_only) {
        (_, true) | (None, _) => c.info("robots.txt not fetched."),
        (Some(r), _) if !r.sitemaps.is_empty() => c.pass(format!("Declared: {}", r.sitemaps.join(", "))),
        (Some(_), _) => c
            .warn("robots.txt has no `Sitemap:` line.", "Add your sitemap's absolute URL to robots.txt.")
            .code("text", sm_line),
    });

    let c = new(
        "sitemap-page",
        Cat::Indexability,
        "Page is listed in the sitemap",
        Sev::Low,
        E::Low,
        SEARCH,
        "Listing a URL in the sitemap marks it as canonical and worth crawling.",
    );
    v.push(match cx.sitemap {
        Some(s) if s.found => match s.contains_page {
            Some(true) => c.pass("This URL is in the sitemap."),
            Some(false) => c.warn(
                "This URL is not in the sitemap.",
                "Add this page's canonical URL to your sitemap (unless it shouldn't be indexed).",
            ),
            None => c.info("Sitemap index has more child sitemaps than we fetched — couldn't confirm."),
        },
        _ => c.info("No sitemap to check."),
    });

    let c = new("lang", Cat::Indexability, "Language declared", Sev::Medium, E::Low, ALL_ENGINES,
        "`<html lang>` tells search and AI engines which language/market to serve the page in, and screen readers how to pronounce it.");
    v.push(match &p.lang {
        Some(l) => c.pass(format!("lang=\"{l}\"")),
        None => {
            c.fail("`<html>` has no lang attribute.", "Declare the page language.").code("html", r#"<html lang="en">"#)
        }
    });

    let c = new("hreflang", Cat::Indexability, "hreflang alternates", Sev::Low, E::Medium, &[Google, Bing],
        "For multi-language sites, hreflang serves the right language version in each market. Annotations must include the page itself and be reciprocal.");
    v.push(if p.hreflang.is_empty() {
        c.info("No hreflang — fine for a single-language site.")
    } else {
        let mut problems = Vec::new();
        if !p.hreflang.iter().any(|h| h.lang.eq_ignore_ascii_case("x-default")) {
            problems.push("no x-default".to_string());
        }
        if p.hreflang.iter().any(|h| !h.href.starts_with("http")) {
            problems.push("relative hrefs".to_string());
        }
        if let Some(u) = cx.url {
            if !p.hreflang.iter().any(|h| normalize(&h.href) == normalize(u.as_str())) {
                problems.push("no self-reference".to_string());
            }
        }
        if problems.is_empty() {
            c.pass(format!("{} alternates, including x-default.", p.hreflang.len()))
        } else {
            c.warn(format!("{} alternates; {}.", p.hreflang.len(), problems.join(", ")), "Each language version should list every version (itself included) with absolute URLs, plus an x-default.")
        }
    });
}

#[allow(clippy::too_many_arguments)]
fn access(
    cx: &Ctx,
    v: &mut Vec<Check>,
    id: &'static str,
    title: &'static str,
    platform: Platform,
    primary: &[&str],
    secondary: &[&str],
    optional: &[&str],
    why: &'static str,
) {
    let c = new(id, Cat::Ai, title, Sev::Critical, E::Low, &[platform], why);
    let c = if matches!(platform, Google | Bing) { Check { category: Cat::Indexability, ..c } } else { c };
    let find = |ids: &[&str]| -> Vec<&CrawlerAccess> { cx.crawlers.iter().filter(|a| ids.contains(&a.id)).collect() };
    let describe = |a: &CrawlerAccess| -> String {
        if a.robots_allowed == Some(false) {
            format!("{} is disallowed by robots.txt ({})", a.name, a.robots_rule.clone().unwrap_or_default())
        } else {
            format!("{} got HTTP {} from the server/CDN", a.name, a.edge_status.unwrap_or(0))
        }
    };
    let blocked_primary: Vec<String> = find(primary).into_iter().filter(|a| !a.allowed).map(describe).collect();
    let blocked_secondary: Vec<String> = find(secondary).into_iter().filter(|a| !a.allowed).map(describe).collect();
    let blocked_optional: Vec<String> = find(optional).into_iter().filter(|a| !a.allowed).map(describe).collect();
    let names = |ids: &[&str]| -> String { find(ids).iter().map(|a| a.name).collect::<Vec<_>>().join(" and ") };

    let fix_rule = format!(
        "User-agent: {}\nAllow: /",
        find(primary).iter().chain(find(secondary).iter()).map(|a| a.name).collect::<Vec<_>>().join("\nUser-agent: ")
    );
    let check = if cx.html_only || cx.crawlers.is_empty() {
        c.info("Pasted HTML — crawler access not checked.")
    } else if !blocked_primary.is_empty() {
        c.fail(format!("{}.", blocked_primary.join("; ")),
            format!("Allow {} in robots.txt and make sure your CDN/WAF bot rules don't block it — otherwise {} can't index or cite this page.", names(primary), platform.label()))
            .code("text", fix_rule)
    } else if !blocked_secondary.is_empty() {
        c.warn(
            format!("{}.", blocked_secondary.join("; ")),
            format!(
                "{} fetches pages live when users ask about them — unblock it to be read in real time.",
                names(secondary)
            ),
        )
        .code("text", fix_rule)
    } else if !blocked_optional.is_empty() {
        let mut ok = c.pass(format!("{} allowed. Opted out: {}.", names(primary), blocked_optional.join("; ")));
        if platform == Gemini {
            ok.status = Status::Warn;
            ok.recommendation = "Google-Extended is blocked: AI Overviews still work, but Gemini apps won't use this content. Allow it if you want Gemini visibility.".into();
        }
        ok
    } else {
        let probed =
            find(primary).iter().chain(find(secondary).iter()).filter_map(|a| a.edge_status).collect::<Vec<_>>();
        c.pass(format!(
            "{} allowed by robots.txt{}.",
            names(&[primary, secondary].concat()),
            if probed.is_empty() {
                String::new()
            } else {
                format!(
                    " and the server answered {}",
                    probed.iter().map(|s| s.to_string()).collect::<Vec<_>>().join("/")
                )
            }
        ))
    };
    v.push(check);
}

// ------------------------------------------------------------ meta

fn meta(cx: &Ctx, v: &mut Vec<Check>) {
    let p = cx.page;
    let s = cx.sugg;
    let title_snip = format!("<title>{}</title>", esc(&s.title));
    let desc_snip = format!(r#"<meta name="description" content="{}">"#, esc(&s.description));

    let c = new("title", Cat::Meta, "Title tag", Sev::Critical, E::Low, EVERYONE,
        "The title is the clickable headline in Google/Bing results, the default share title, and the strongest on-page relevance signal.");
    v.push(match &p.title {
        Some(t) => c.pass(t.clone()),
        None => c
            .fail("No `<title>` found.", "Add a unique, descriptive title with the primary topic first.")
            .code("html", title_snip.clone()),
    });

    let c = new("title-length", Cat::Meta, "Title length (30–60 chars)", Sev::Medium, E::Low, &[Google, Bing, Social],
        "Google truncates titles at roughly 600px (~60 characters); very short titles waste the most visible spot on the results page.");
    v.push(match &p.title {
        None => c.info("No title."),
        Some(t) => {
            let n = clen(t);
            if n < TITLE_MIN {
                c.warn(
                    format!("{n} characters — too short."),
                    "Expand the title with the page's main topic and your brand.",
                )
                .code("html", title_snip.clone())
            } else if n > TITLE_MAX {
                c.warn(
                    format!("{n} characters — will likely be truncated."),
                    "Put the key words first and trim to about 60 characters.",
                )
                .code("html", title_snip.clone())
            } else {
                c.pass(format!("{n} characters."))
            }
        }
    });

    let c = new(
        "title-unique",
        Cat::Meta,
        "Single title tag",
        Sev::Low,
        E::Low,
        SEARCH,
        "Multiple <title> elements are invalid HTML; search engines pick one unpredictably.",
    );
    v.push(if p.title_count > 1 {
        c.warn(
            format!("{} <title> elements.", p.title_count),
            "Remove the duplicates — often a CMS plus an SEO plugin both emit one.",
        )
    } else {
        c.pass("One title element.")
    });

    let c = new("description", Cat::Meta, "Meta description", Sev::High, E::Low, &[Google, Bing, ChatGPT, Perplexity, Claude, Social],
        "The description is used for the search snippet, link previews, and as a summary AI assistants show next to citations.");
    v.push(match &p.description {
        None => c
            .fail(
                "No meta description.",
                "Write a unique 70–160 character summary that answers “what is this page and why read it?”.",
            )
            .code("html", desc_snip.clone()),
        Some(d) if d.is_empty() => {
            c.fail("Meta description is empty.", "Fill in the description.").code("html", desc_snip.clone())
        }
        Some(_) if p.description_count > 1 => c
            .warn(format!("{} description tags.", p.description_count), "Keep a single meta description.")
            .code("html", desc_snip.clone()),
        Some(d) => c.pass(d.clone()),
    });

    let c = new(
        "description-length",
        Cat::Meta,
        "Description length (70–160 chars)",
        Sev::Medium,
        E::Low,
        &[Google, Bing, Social],
        "Desktop snippets show ~155–160 characters; mobile is shorter, so lead with the important part.",
    );
    v.push(match &p.description {
        Some(d) if !d.is_empty() => {
            let n = clen(d);
            if n < DESC_MIN {
                c.warn(
                    format!("{n} characters — too short."),
                    "Add specifics: who it's for, what they get, a differentiator.",
                )
                .code("html", desc_snip.clone())
            } else if n > DESC_MAX {
                c.warn(
                    format!("{n} characters — will be truncated."),
                    "Trim to ~155 characters with the key message in the first 110.",
                )
                .code("html", desc_snip.clone())
            } else {
                c.pass(format!("{n} characters."))
            }
        }
        _ => c.info("No description."),
    });

    let c = new("viewport", Cat::Meta, "Mobile viewport", Sev::High, E::Low, SEARCH,
        "Google indexes the mobile version of pages (mobile-first indexing); without a viewport the page renders as a zoomed-out desktop page.");
    v.push(match &p.viewport {
        None => c
            .fail("No viewport meta tag.", "Add a responsive viewport.")
            .code("html", r#"<meta name="viewport" content="width=device-width, initial-scale=1">"#),
        Some(vp) => {
            let l = vp.to_ascii_lowercase().replace(' ', "");
            if l.contains("user-scalable=no")
                || l.contains("user-scalable=0")
                || l.contains("maximum-scale=1,")
                || l.ends_with("maximum-scale=1")
                || l.contains("maximum-scale=1.0")
            {
                c.warn(format!("`{vp}` disables zooming."), "Allow pinch-zoom for accessibility (WCAG 1.4.4).")
                    .code("html", r#"<meta name="viewport" content="width=device-width, initial-scale=1">"#)
            } else if !l.contains("width=device-width") {
                c.warn(format!("`{vp}` doesn't set width=device-width."), "Use the standard responsive viewport.")
                    .code("html", r#"<meta name="viewport" content="width=device-width, initial-scale=1">"#)
            } else {
                c.pass(vp.clone())
            }
        }
    });

    let c = new(
        "charset",
        Cat::Meta,
        "Character encoding",
        Sev::Medium,
        E::Low,
        SEARCH,
        "Declaring UTF-8 early prevents garbled text in snippets and AI answers.",
    );
    let header_cs = cx
        .input
        .headers
        .get("content-type")
        .and_then(|ct| ct.to_ascii_lowercase().split("charset=").nth(1).map(|s| s.trim().to_string()));
    let cs = p.charset.clone().or(header_cs);
    v.push(match cs {
        Some(cs) if cs.eq_ignore_ascii_case("utf-8") || cs.eq_ignore_ascii_case("utf8") => c.pass("UTF-8"),
        Some(cs) => c
            .warn(format!("Encoding is {cs}."), "Use UTF-8 unless you have a strong reason not to.")
            .code("html", r#"<meta charset="utf-8">"#),
        None => c
            .warn("No charset in the HTML or Content-Type header.", "Declare UTF-8 as the first element in <head>.")
            .code("html", r#"<meta charset="utf-8">"#),
    });

    let c = new(
        "favicon",
        Cat::Meta,
        "Favicon",
        Sev::Low,
        E::Low,
        &[Google, Bing, Social, Perplexity],
        "Google and Perplexity show your favicon next to results and citations — a missing one looks untrustworthy.",
    );
    v.push(if p.icons.is_empty() {
        c.warn("No <link rel=\"icon\"> found (browsers may still fall back to /favicon.ico).", "Declare a favicon at least 48×48px and an apple-touch-icon.")
            .code("html", "<link rel=\"icon\" href=\"/favicon.ico\" sizes=\"any\">\n<link rel=\"icon\" href=\"/icon.svg\" type=\"image/svg+xml\">\n<link rel=\"apple-touch-icon\" href=\"/apple-touch-icon.png\">")
    } else {
        c.pass(p.icons.iter().map(|i| i.href.clone()).collect::<Vec<_>>().join(", "))
    });

    if let Some(k) = &p.keywords {
        v.push(
            new(
                "meta-keywords",
                Cat::Meta,
                "Meta keywords",
                Sev::Low,
                E::Low,
                &[Bing],
                "Google ignores meta keywords; Bing has said stuffed keywords are a spam signal.",
            )
            .info(format!("Present: “{}”. Harmless if short; safe to remove.", crate::extract::truncate_chars(k, 120))),
        );
    }
}

// ------------------------------------------------------------ social

fn social(cx: &Ctx, v: &mut Vec<Check>) {
    let p = cx.page;
    let s = cx.sugg;
    let required = ["og:title", "og:description", "og:image", "og:url", "og:type"];
    let missing: Vec<&str> = required.iter().copied().filter(|k| p.og(k).is_none()).collect();
    let img = s.image.clone().unwrap_or_else(|| format!("{}/og-image.png", s.origin.clone().unwrap_or_default()));
    let og_val = |k: &str| -> String {
        match k {
            "og:title" => s.title.clone(),
            "og:description" => s.description.clone(),
            "og:image" => img.clone(),
            "og:url" => s.canonical.clone().unwrap_or_default(),
            "og:type" => {
                if s.is_article {
                    "article".into()
                } else {
                    "website".into()
                }
            }
            "og:site_name" => s.site_name.clone(),
            "og:locale" => s.locale.clone(),
            _ => String::new(),
        }
    };
    let snippet_for = |keys: &[&str]| -> String {
        keys.iter()
            .map(|k| format!(r#"<meta property="{k}" content="{}">"#, esc(&og_val(k))))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let c = new("og-core", Cat::Social, "Open Graph tags", Sev::High, E::Low, &[Social, ChatGPT, Perplexity, Claude],
        "Open Graph controls the title, image and text shown when the page is shared on LinkedIn, Facebook, Slack, WhatsApp and iMessage, and in AI assistants' link cards.");
    v.push(if missing.is_empty() {
        c.pass("og:title, og:description, og:image, og:url and og:type are all set.")
    } else if missing.len() >= 3 {
        c.fail(format!("Missing {}.", missing.join(", ")), "Add the core Open Graph tags.")
            .code("html", snippet_for(&missing))
    } else {
        c.warn(format!("Missing {}.", missing.join(", ")), "Add the missing Open Graph tags.")
            .code("html", snippet_for(&missing))
    });

    let c = new("og-image", Cat::Social, "Share image", Sev::Medium, E::Medium, &[Social, ChatGPT, Perplexity],
        "Posts with a large preview image get far more clicks. Crawlers need an absolute URL; 1200×630 renders well everywhere.");
    v.push(match p.og("og:image").or_else(|| p.tw("twitter:image")) {
        None => c.fail("No og:image or twitter:image.", "Create a 1200×630 share image and reference it with an absolute URL.")
            .code("html", format!("<meta property=\"og:image\" content=\"{}\">\n<meta property=\"og:image:width\" content=\"1200\">\n<meta property=\"og:image:height\" content=\"630\">\n<meta property=\"og:image:alt\" content=\"{}\">", esc(&img), esc(&s.title))),
        Some(i) if !i.starts_with("http") => c.fail(format!("og:image is relative: `{i}`."), "Social crawlers don't resolve relative URLs — use an absolute https:// URL.")
            .code("html", format!(r#"<meta property="og:image" content="{}">"#, esc(&crate::extract::resolve(cx.url, i)))),
        Some(i) => {
            let mut miss = vec![];
            if p.og("og:image:width").is_none() || p.og("og:image:height").is_none() {
                miss.push("og:image:width/height");
            }
            if p.og("og:image:alt").is_none() {
                miss.push("og:image:alt");
            }
            if miss.is_empty() {
                c.pass(i.to_string())
            } else {
                c.warn(format!("{i} — missing {}.", miss.join(", ")), "Declare dimensions so platforms render the card on first share, and alt text for accessibility.")
                    .code("html", format!("<meta property=\"og:image:width\" content=\"1200\">\n<meta property=\"og:image:height\" content=\"630\">\n<meta property=\"og:image:alt\" content=\"{}\">", esc(&s.title)))
            }
        }
    });

    let c = new(
        "twitter-card",
        Cat::Social,
        "X (Twitter) card",
        Sev::Medium,
        E::Low,
        &[Social],
        "X falls back to Open Graph for text and image, but needs `twitter:card` to show a large image card.",
    );
    v.push(match p.tw("twitter:card") {
        Some(card) => c.pass(format!("twitter:card = {card}")),
        None => c.warn("No twitter:card.", "Add a summary_large_image card.").code("html", format!(
            "<meta name=\"twitter:card\" content=\"summary_large_image\">\n<meta name=\"twitter:title\" content=\"{}\">\n<meta name=\"twitter:description\" content=\"{}\">\n<meta name=\"twitter:image\" content=\"{}\">",
            esc(&s.title), esc(&s.description), esc(&img))),
    });

    let c = new(
        "og-extras",
        Cat::Social,
        "Site name & locale",
        Sev::Low,
        E::Low,
        &[Social],
        "og:site_name shows your brand above the share title; og:locale helps platforms pick the right language.",
    );
    let extra_missing: Vec<&str> = ["og:site_name", "og:locale"].into_iter().filter(|k| p.og(k).is_none()).collect();
    v.push(if extra_missing.is_empty() {
        c.pass(format!("{} · {}", p.og("og:site_name").unwrap_or_default(), p.og("og:locale").unwrap_or_default()))
    } else {
        c.warn(format!("Missing {}.", extra_missing.join(", ")), "Add them alongside the other Open Graph tags.")
            .code("html", snippet_for(&extra_missing))
    });
}

// ------------------------------------------------------------ content

fn content(cx: &Ctx, v: &mut Vec<Check>) {
    let p = cx.page;
    let h1s: Vec<_> = p.h1s().collect();

    let c = new(
        "h1",
        Cat::Content,
        "One clear H1",
        Sev::High,
        E::Low,
        ALL_ENGINES,
        "The H1 states the page's main topic for readers, search engines and LLMs that chunk pages by headings.",
    );
    v.push(match h1s.len() {
        0 => c
            .fail("No <h1>.", "Add one H1 that states the page's main topic.")
            .code("html", format!("<h1>{}</h1>", esc(&cx.sugg.title))),
        1 if h1s[0].text.is_empty() => c.fail(
            "The <h1> is empty (image or icon without text?).",
            "Give the H1 real text; use visually-hidden text if the design needs a logo.",
        ),
        1 => c.pass(h1s[0].text.clone()),
        n => c.warn(
            format!(
                "{n} H1s: {}{}",
                h1s.iter()
                    .filter(|h| !h.text.is_empty())
                    .take(5)
                    .map(|h| format!("“{}”", h.text))
                    .collect::<Vec<_>>()
                    .join(", "),
                if n > 5 { ", …" } else { "" }
            ),
            "Use a single H1 and demote the rest to H2.",
        ),
    });

    let c = new("heading-order", Cat::Content, "Logical heading outline", Sev::Low, E::Medium, &[Google, ChatGPT, Perplexity, Claude],
        "AI engines split pages into passages by heading; a clean H1→H2→H3 outline makes each section quotable on its own.");
    let mut skips = Vec::new();
    let mut prev = 0u8;
    for h in &p.headings {
        if prev > 0 && h.level > prev + 1 {
            skips.push(format!("H{prev}→H{}", h.level));
        }
        prev = h.level;
    }
    skips.dedup();
    let h2 = p.headings.iter().filter(|h| h.level == 2).count();
    v.push(if !skips.is_empty() {
        c.warn(
            format!("Skipped levels: {}.", skips.join(", ")),
            "Don't skip levels — style headings with CSS rather than picking tags for their size.",
        )
    } else if h2 == 0 && p.word_count > 300 {
        c.warn(
            "No H2 sections.",
            "Break the content into H2 sections with descriptive (ideally question-style) headings.",
        )
    } else {
        c.pass(format!("{} headings, {} H2 sections.", p.headings.len(), h2))
    });

    let c = new("server-rendered", Cat::Ai, "Content is in the HTML (no JS needed)", Sev::Critical, E::High, &[ChatGPT, Perplexity, Claude, Bing],
        "AI crawlers (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot) don't run JavaScript. If content only appears after JS runs, they see an empty page. Google renders JS but with a delay.");
    v.push(if p.spa_shell {
        c.fail(format!("Only {} words in the raw HTML and an empty app mount point — this looks like a client-side-rendered app.", p.word_count),
            "Server-render or pre-render the page (Next.js SSR/SSG, Nuxt, Astro, prerender.io) so the main content is in the initial HTML.")
    } else {
        c.pass(format!("{} words present without JavaScript.", p.word_count))
    });

    let c = new("word-count", Cat::Content, "Substantial content", Sev::High, E::High, ALL_ENGINES,
        "Thin pages rarely rank or get cited. Answer engines prefer pages that cover a topic in depth with concrete facts.");
    v.push(if p.word_count >= 300 {
        c.pass(format!("{} words.", p.word_count))
    } else if p.word_count >= 100 {
        c.warn(
            format!("{} words — thin.", p.word_count),
            "Expand with specifics: definitions, steps, numbers, examples, FAQs.",
        )
    } else {
        c.fail(
            format!("{} words.", p.word_count),
            "Add substantive, server-rendered text content (aim for 300+ words on key pages).",
        )
    });

    let c = new(
        "intro",
        Cat::Content,
        "Answer-first intro paragraph",
        Sev::Low,
        E::Medium,
        &[ChatGPT, Perplexity, Claude, Gemini, Google],
        "LLMs favour pages that state the answer up front in a self-contained paragraph they can quote.",
    );
    v.push(match &p.first_paragraph {
        Some(fp) => c.pass(crate::extract::truncate_chars(fp, 200)),
        None => c.warn(
            "No substantial <p> paragraph found.",
            "Open with a 2–3 sentence paragraph that directly answers the page's main question.",
        ),
    });

    let c = new(
        "image-alt",
        Cat::Content,
        "Image alt text",
        Sev::Medium,
        E::Medium,
        &[Google, Bing, ChatGPT, Perplexity, Claude],
        "Alt text is how search engines and LLMs understand images, and it's required for accessibility (WCAG 1.1.1).",
    );
    v.push(if p.image_count == 0 {
        c.info("No images.")
    } else if p.images_missing_alt == 0 {
        c.pass(format!("All {} images have an alt attribute.", p.image_count))
    } else {
        let examples: Vec<String> =
            p.images.iter().filter(|i| i.alt.is_none()).take(3).map(|i| i.src.clone()).collect();
        let msg = format!(
            "{} of {} images have no alt attribute (e.g. {}).",
            p.images_missing_alt,
            p.image_count,
            examples.join(", ")
        );
        if p.images_missing_alt * 2 > p.image_count {
            c.fail(msg, "Describe each meaningful image in alt; use alt=\"\" for purely decorative ones.")
        } else {
            c.warn(msg, "Describe each meaningful image in alt; use alt=\"\" for purely decorative ones.")
        }
    });

    let c = new(
        "internal-links",
        Cat::Content,
        "Internal links",
        Sev::Low,
        E::Medium,
        SEARCH,
        "Internal links spread authority and help crawlers discover related pages.",
    );
    v.push(if p.link_stats.internal >= 3 {
        c.pass(format!("{} internal, {} external links.", p.link_stats.internal, p.link_stats.external))
    } else {
        c.warn(
            format!("Only {}.", plural(p.link_stats.internal, "internal link", "internal links")),
            "Link to related pages with descriptive anchor text.",
        )
    });

    let c = new(
        "anchor-text",
        Cat::Content,
        "Descriptive link text",
        Sev::Low,
        E::Low,
        &[Google, Bing],
        "Google uses anchor text to understand the linked page; “click here” or empty links carry no meaning.",
    );
    let bad = p.link_stats.empty_anchor + p.link_stats.generic_anchor;
    v.push(if bad == 0 {
        c.pass("All links have descriptive text.")
    } else {
        c.warn(
            format!(
                "{} empty, {} generic (“click here”, “read more”).",
                p.link_stats.empty_anchor, p.link_stats.generic_anchor
            ),
            "Use anchor text that describes the destination; add aria-label to icon-only links.",
        )
    });

    let c = new(
        "extractable",
        Cat::Ai,
        "Lists & tables",
        Sev::Low,
        E::Medium,
        &[ChatGPT, Perplexity, Claude, Gemini],
        "Structured fragments like steps, comparisons and specs are easy for AI engines to lift into answers.",
    );
    v.push(if p.lists + p.tables > 0 {
        c.pass(format!("{}, {}.", plural(p.lists, "list", "lists"), plural(p.tables, "table", "tables")))
    } else {
        c.warn(
            "No lists or tables.",
            "Present steps, features, comparisons or specs as lists/tables where it fits the content.",
        )
    });

    let c = new("qa-format", Cat::Ai, "Question-style headings", Sev::Low, E::Medium, &[ChatGPT, Perplexity, Claude, Gemini],
        "People ask AI assistants questions. Headings phrased as those questions, each followed by a direct answer, match how answers are retrieved.");
    v.push(if p.question_headings > 0 {
        c.pass(format!("{}.", plural(p.question_headings, "question heading", "question headings")))
    } else {
        c.warn("No headings phrased as questions.", "Add an FAQ section or rephrase key H2s as the questions your audience asks, with a 1–2 sentence answer right below.")
    });
}

// ------------------------------------------------------------ structured data

struct TypeRule {
    types: &'static [&'static str],
    required: &'static [&'static str],
}

const TYPE_RULES: &[TypeRule] = &[
    TypeRule {
        types: &["Article", "NewsArticle", "BlogPosting"],
        required: &["headline", "author", "datePublished", "image"],
    },
    TypeRule { types: &["Product"], required: &["name", "offers|review|aggregateRating"] },
    TypeRule { types: &["FAQPage"], required: &["mainEntity"] },
    TypeRule { types: &["BreadcrumbList"], required: &["itemListElement"] },
    TypeRule { types: &["Organization", "Corporation"], required: &["name", "url"] },
    TypeRule { types: &["LocalBusiness", "Restaurant", "Store"], required: &["name", "address"] },
    TypeRule { types: &["Event"], required: &["name", "startDate", "location"] },
    TypeRule { types: &["Recipe"], required: &["name", "image"] },
    TypeRule { types: &["VideoObject"], required: &["name", "thumbnailUrl", "uploadDate"] },
    TypeRule {
        types: &["SoftwareApplication", "WebApplication", "MobileApplication"],
        required: &["name", "offers|aggregateRating|review"],
    },
    TypeRule { types: &["JobPosting"], required: &["title", "description", "datePosted", "hiringOrganization"] },
    TypeRule { types: &["HowTo"], required: &["name", "step"] },
    TypeRule { types: &["Review"], required: &["itemReviewed", "author", "reviewRating"] },
];

fn structured(cx: &Ctx, v: &mut Vec<Check>) {
    let p = cx.page;
    let ents = p.ld_entities();
    let all_types: Vec<String> = ents.iter().flat_map(|e| ld_types(e)).collect();
    let generated = crate::generate::json_ld(p, cx.sugg);

    let c = new("jsonld", Cat::Structured, "Structured data (JSON-LD)", Sev::High, E::Medium, ALL_ENGINES,
        "Schema.org markup makes pages eligible for rich results and gives search and AI engines unambiguous facts: who you are, what the page is, dates, prices and authors.");
    v.push(if !p.json_ld.is_empty() {
        let mut t = all_types.clone();
        t.sort();
        t.dedup();
        c.pass(format!(
            "{}: {}.",
            plural(p.json_ld.len(), "JSON-LD block", "JSON-LD blocks"),
            if t.is_empty() { "no @type".into() } else { t.join(", ") }
        ))
    } else if !p.microdata_types.is_empty() {
        c.pass(format!("Microdata: {}. (JSON-LD is easier to maintain.)", p.microdata_types.join(", ")))
    } else {
        c.fail("No structured data.", "Add JSON-LD describing your organization, the website and this page.")
            .code("html", generated.clone())
    });

    let c = new(
        "jsonld-valid",
        Cat::Structured,
        "JSON-LD parses",
        Sev::High,
        E::Low,
        ALL_ENGINES,
        "A single syntax error makes the whole block invisible to every parser.",
    );
    let invalid: Vec<String> = p
        .json_ld
        .iter()
        .enumerate()
        .filter(|(_, b)| !b.valid)
        .map(|(i, b)| format!("block {}: {}", i + 1, b.error.clone().unwrap_or_default()))
        .collect();
    v.push(if p.json_ld.is_empty() {
        c.info("No JSON-LD.")
    } else if invalid.is_empty() {
        let no_ctx = p.json_ld.iter().filter_map(|b| b.data.as_ref()).any(|d| {
            let has = |x: &Value| x.get("@context").is_some();
            match d { Value::Array(a) => !a.iter().all(has), other => !has(other) }
        });
        if no_ctx {
            c.warn("Valid JSON, but a block has no @context.", "Add \"@context\": \"https://schema.org\" to each top-level object.")
        } else {
            c.pass("All blocks are valid JSON.")
        }
    } else {
        c.fail(format!("Invalid JSON — {}.", invalid.join("; ")), "Fix the syntax (trailing commas, unescaped quotes and stray HTML are common causes). Test with validator.schema.org.")
    });

    let c = new("entity", Cat::Structured, "Organization / brand entity", Sev::Medium, E::Low, &[Google, ChatGPT, Perplexity, Claude, Gemini],
        "An Organization entity with logo and sameAs profiles ties your site to your brand in knowledge graphs, which LLMs rely on to resolve who you are.");
    let mut nested = Vec::new();
    p.json_ld.iter().filter_map(|b| b.data.as_ref()).for_each(|d| nested_ld(d, &mut nested));
    let entity_keys = ["name", "url", "logo", "sameAs"];
    let org = nested
        .into_iter()
        .filter(|e| {
            ld_types(e).iter().any(|t| {
                matches!(
                    t.as_str(),
                    "Organization" | "Corporation" | "LocalBusiness" | "Person" | "NGO" | "EducationalOrganization"
                )
            })
        })
        .max_by_key(|e| entity_keys.iter().filter(|k| e.get(**k).is_some()).count());
    v.push(match org {
        None => c.warn("No Organization (or Person) entity.", "Describe your organization with name, url, logo and sameAs links to official profiles.").code("html", generated.clone()),
        Some(o) => {
            let miss: Vec<&str> = entity_keys.into_iter().filter(|k| o.get(*k).is_none()).collect();
            if miss.is_empty() {
                c.pass(format!("{} with logo and sameAs.", o.get("name").and_then(Value::as_str).unwrap_or("Organization")))
            } else {
                c.warn(format!("Organization is missing {}.", miss.join(", ")), "Complete the entity — sameAs (LinkedIn, X, Wikipedia, Crunchbase…) is the strongest disambiguation signal.").code("html", generated.clone())
            }
        }
    });

    let c = new(
        "schema-required",
        Cat::Structured,
        "Required schema properties",
        Sev::Medium,
        E::Medium,
        &[Google, Gemini, Bing],
        "Google only shows rich results when the type's required properties are present.",
    );
    let mut problems = Vec::new();
    for e in &ents {
        for t in ld_types(e) {
            if let Some(rule) = TYPE_RULES.iter().find(|r| r.types.contains(&t.as_str())) {
                let miss: Vec<&str> =
                    rule.required.iter().copied().filter(|req| !req.split('|').any(|k| e.get(k).is_some())).collect();
                if !miss.is_empty() {
                    problems.push(format!(
                        "{t} missing {}",
                        miss.iter().map(|m| m.replace('|', " or ")).collect::<Vec<_>>().join(", ")
                    ));
                }
            }
        }
    }
    v.push(if ents.is_empty() {
        c.info("No schema entities.")
    } else if problems.is_empty() {
        c.pass("Known types have their required properties.")
    } else {
        c.fail(
            format!("{}.", problems.join("; ")),
            "Add the missing properties (see Google's structured data docs per type).",
        )
    });

    let c = new(
        "breadcrumbs",
        Cat::Structured,
        "Breadcrumbs",
        Sev::Low,
        E::Low,
        &[Google],
        "BreadcrumbList replaces the raw URL in Google results with a readable path.",
    );
    let is_home = cx.url.map(|u| u.path() == "/" || u.path().is_empty()).unwrap_or(true);
    v.push(
        if all_types.iter().any(|t| t == "BreadcrumbList") || p.microdata_types.iter().any(|t| t == "BreadcrumbList") {
            c.pass("BreadcrumbList present.")
        } else if is_home {
            c.info("Homepage — breadcrumbs not needed.")
        } else {
            c.warn("No BreadcrumbList.", "Add BreadcrumbList markup matching your visible breadcrumb trail.")
                .code("html", generated)
        },
    );
}

// ------------------------------------------------------------ AI readiness

fn ai(cx: &Ctx, v: &mut Vec<Check>) {
    let p = cx.page;

    let c = new("llms-txt", Cat::Ai, "llms.txt", Sev::Medium, E::Low, &[ChatGPT, Perplexity, Claude],
        "/llms.txt is an emerging convention (llmstxt.org) giving AI agents a curated markdown map of your most important pages. It's cheap to add, but no engine has confirmed using it for ranking.");
    v.push(match cx.llms {
        _ if cx.html_only => c.info("Pasted HTML — llms.txt not fetched."),
        None => c.info("llms.txt not fetched."),
        Some(l) if l.found && l.issues.is_empty() => c.pass(format!(
            "{} — {} sections, {} links.",
            l.title.clone().unwrap_or_default(),
            l.sections.len(),
            l.link_count
        )),
        Some(l) if l.found => c.warn(
            format!("Found, with issues: {}", l.issues.join("; ")),
            "Follow the llmstxt.org format: # Title, > summary, ## sections with [links](url): notes.",
        ),
        Some(l) => c.warn(
            if l.issues.is_empty() {
                format!("No /llms.txt (HTTP {}).", l.status.map(|s| s.to_string()).unwrap_or_else(|| "error".into()))
            } else {
                l.issues.join("; ")
            },
            "Publish /llms.txt — a draft generated from this page is in Generated files.",
        ),
    });

    let c = new(
        "freshness",
        Cat::Ai,
        "Freshness signals",
        Sev::Medium,
        E::Low,
        &[Perplexity, ChatGPT, Claude, Google, Gemini],
        "Answer engines, Perplexity especially, favour recently updated sources. Publish machine-readable dates.",
    );
    let last_mod = cx.input.headers.get("last-modified").cloned();
    let sm = cx.sitemap.and_then(|s| s.latest_lastmod.clone());
    let signals: Vec<String> = [
        p.modified.clone().map(|d| format!("modified {d}")),
        p.published.clone().map(|d| format!("published {d}")),
        last_mod.map(|d| format!("Last-Modified header {d}")),
        sm.map(|d| format!("sitemap lastmod {d}")),
    ]
    .into_iter()
    .flatten()
    .collect();
    let date_snip = if cx.sugg.is_article {
        "<meta property=\"article:published_time\" content=\"2025-01-15T09:00:00Z\">\n<meta property=\"article:modified_time\" content=\"2025-06-01T09:00:00Z\">\n<!-- and in JSON-LD: \"datePublished\" / \"dateModified\" -->"
    } else {
        "<!-- In your WebPage JSON-LD: -->\n\"dateModified\": \"2025-06-01\"\n<!-- And show it to readers: -->\n<time datetime=\"2025-06-01\">Updated June 1, 2025</time>"
    };
    v.push(if p.modified.is_some() {
        c.pass(signals.join(" · "))
    } else if !signals.is_empty() {
        c.warn(
            format!("Only weak signals: {}.", signals.join(" · ")),
            "Add an explicit dateModified (JSON-LD + visible “Updated” date) and update it when content changes.",
        )
        .code("html", date_snip)
    } else {
        c.fail(
            "No published/modified dates found.",
            "Expose dateModified in JSON-LD and meta tags, show it on the page, and send Last-Modified headers.",
        )
        .code("html", date_snip)
    });

    let c = new(
        "authorship",
        Cat::Ai,
        "Author / E-E-A-T",
        Sev::Low,
        E::Low,
        &[Google, ChatGPT, Perplexity, Claude, Gemini],
        "Clear authorship backs Google's E-E-A-T guidelines and helps AI engines judge source credibility.",
    );
    v.push(match &p.author {
        Some(a) => c.pass(a.clone()),
        None => c.warn("No author found (meta, rel=author or JSON-LD).", "Name the author or organisation responsible and link to an about/bio page.")
            .code("html", "<meta name=\"author\" content=\"Jane Doe\">\n<!-- JSON-LD: \"author\": {\"@type\": \"Person\", \"name\": \"Jane Doe\", \"url\": \"https://example.com/about/jane\"} -->"),
    });

    // Bot fingerprint parity: did any crawler UA get a different answer than a browser?
    let c = new("bot-parity", Cat::Ai, "Crawlers get the same response as browsers", Sev::High, E::Medium, &[ChatGPT, Perplexity, Claude, Google, Bing],
        "CDNs and WAFs (Cloudflare, Akamai, Vercel) often block AI crawlers by default even when robots.txt allows them.");
    let blocked: Vec<&CrawlerAccess> = cx
        .crawlers
        .iter()
        .filter(|a| a.edge_blocked() && !a.edge_inconclusive && a.purpose != Purpose::Training)
        .collect();
    let probed = cx.crawlers.iter().filter(|a| a.edge_status.is_some()).count();
    let inconclusive = cx.crawlers.iter().any(|a| a.edge_inconclusive);
    v.push(if inconclusive {
        c.info("The server rejected even our Googlebot user agent, so it verifies crawlers by IP address. A user-agent probe can't tell whether the real AI crawlers get through. Check your CDN/WAF bot analytics or logs for OAI-SearchBot, Claude-SearchBot and PerplexityBot.")
    } else if probed == 0 {
        c.info("No crawler probes (pasted HTML, or probes skipped).")
    } else if blocked.is_empty() {
        c.pass(format!("{} crawler user agents received the page normally. (Probes use the UA string only — CDNs that verify bot IPs may still treat the real bots differently.)", probed))
    } else {
        let mut c = c.fail(
            format!("Blocked at the edge: {}.", blocked.iter().map(|a| format!("{} ({})", a.name, a.edge_status.unwrap_or(0))).collect::<Vec<_>>().join(", ")),
            "Allow these verified bots in your CDN/WAF bot-management rules (e.g. Cloudflare → Security → Bots → AI Crawl Control).",
        );
        let mut plats: Vec<Platform> = blocked.iter().filter_map(|a| a.platform).collect();
        plats.sort();
        plats.dedup();
        c.platforms = plats;
        c
    });
}

// ------------------------------------------------------------ performance & security

fn performance(cx: &Ctx, v: &mut Vec<Check>) {
    let p = cx.page;
    let h = &cx.input.headers;

    let c = new(
        "ttfb",
        Cat::Performance,
        "Server response time",
        Sev::Medium,
        E::High,
        &[Google, Bing, ChatGPT, Perplexity, Claude],
        "Slow servers hurt Core Web Vitals (LCP), and live-fetching AI agents time out quickly.",
    );
    v.push(match cx.input.ttfb_ms {
        None => c.info("Not measured."),
        Some(ms) if ms < 800 => c.pass(format!("{ms} ms to first byte.")),
        Some(ms) if ms < 1800 => c.warn(
            format!("{ms} ms to first byte."),
            "Aim for under 800 ms: cache HTML at the edge, optimise database queries, use a CDN.",
        ),
        Some(ms) => c.fail(
            format!("{ms} ms to first byte."),
            "Responses this slow risk crawler and AI-agent timeouts. Cache or statically generate the page.",
        ),
    });

    let c = new("html-size", Cat::Performance, "HTML size", Sev::Medium, E::Medium, &[Google, ChatGPT, Perplexity, Claude],
        "Googlebot stops reading HTML after 15 MB, and AI fetchers truncate far earlier. Bloated inline JSON or CSS pushes real content out of view.");
    let kb = p.html_bytes / 1024;
    v.push(if kb <= 500 {
        c.pass(format!("{kb} KB."))
    } else if kb <= 2048 {
        c.warn(
            format!("{kb} KB ({} KB inline script).", p.scripts.inline_bytes / 1024),
            "Move large inline scripts/styles and hydration data out of the HTML.",
        )
    } else {
        c.fail(
            format!("{kb} KB ({} KB inline script).", p.scripts.inline_bytes / 1024),
            "Reduce HTML weight — AI crawlers may never reach your content.",
        )
    });

    let c = new(
        "render-blocking",
        Cat::Performance,
        "No render-blocking scripts",
        Sev::Medium,
        E::Medium,
        &[Google],
        "Synchronous scripts in <head> delay first paint and LCP, which feed Google's page-experience signals.",
    );
    v.push(if p.scripts.head_blocking == 0 {
        c.pass(format!("{} scripts; none block rendering.", p.scripts.total))
    } else {
        c.warn(
            format!("{} in <head> without async/defer.", plural(p.scripts.head_blocking, "script", "scripts")),
            "Add `defer` (or `async` for independent scripts).",
        )
        .code("html", r#"<script src="/app.js" defer></script>"#)
    });

    let c = new(
        "compression",
        Cat::Performance,
        "Compression",
        Sev::Low,
        E::Low,
        &[Google, Bing],
        "gzip/Brotli cut HTML transfer size by 70–90%.",
    );
    v.push(if cx.html_only {
        c.info("Pasted HTML — no headers.")
    } else {
        match h.get("content-encoding") {
            Some(e) if ["br", "gzip", "zstd", "deflate"].iter().any(|x| e.contains(x)) => c.pass(e.clone()),
            _ => c.warn("No Content-Encoding on the HTML response.", "Enable Brotli or gzip at your server/CDN."),
        }
    });

    let c = new(
        "caching",
        Cat::Performance,
        "Cache headers",
        Sev::Low,
        E::Low,
        &[Google],
        "Cache-Control and validators (ETag/Last-Modified) let crawlers and CDNs revalidate cheaply.",
    );
    v.push(if cx.html_only {
        c.info("Pasted HTML — no headers.")
    } else {
        match (h.get("cache-control"), h.get("etag").or(h.get("last-modified"))) {
            (Some(cc), Some(_)) => c.pass(format!("{cc} + validator")),
            (Some(cc), None) => c.pass(cc.clone()),
            (None, Some(_)) => c.pass("Validator present (ETag/Last-Modified)."),
            (None, None) => c.warn(
                "No Cache-Control, ETag or Last-Modified.",
                "Send Cache-Control (e.g. `public, max-age=0, must-revalidate`) and an ETag.",
            ),
        }
    });

    let c = new(
        "image-dimensions",
        Cat::Performance,
        "Image dimensions set",
        Sev::Low,
        E::Medium,
        &[Google],
        "Images without width/height cause layout shift (CLS), a Core Web Vital.",
    );
    v.push(if p.image_count == 0 {
        c.info("No images.")
    } else if p.images_missing_size == 0 {
        c.pass("All images declare width and height.")
    } else {
        c.warn(
            format!("{} of {} images lack width/height.", p.images_missing_size, p.image_count),
            "Set width and height attributes (or CSS aspect-ratio) on every image.",
        )
    });

    let c = new(
        "lazy-images",
        Cat::Performance,
        "Lazy-loaded images",
        Sev::Low,
        E::Low,
        &[Google],
        "loading=\"lazy\" on below-the-fold images speeds up the initial load.",
    );
    v.push(if p.image_count < 6 {
        c.info(format!("{} — not needed.", plural(p.image_count, "image", "images")))
    } else if p.images_lazy > 0 {
        c.pass(format!("{} of {} images lazy-loaded.", p.images_lazy, p.image_count))
    } else {
        c.warn(
            format!("None of {} images are lazy-loaded.", p.image_count),
            "Add loading=\"lazy\" to images below the fold (never to the LCP hero image).",
        )
        .code("html", r#"<img src="/photo.jpg" alt="…" width="800" height="600" loading="lazy">"#)
    });

    let c = new(
        "mixed-content",
        Cat::Performance,
        "No mixed content",
        Sev::Medium,
        E::Low,
        SEARCH,
        "HTTP resources on an HTTPS page get blocked by browsers and break the page.",
    );
    v.push(if p.mixed_content == 0 {
        c.pass("No http:// resources.")
    } else {
        c.fail(
            format!("{} loaded over http://.", plural(p.mixed_content, "resource", "resources")),
            "Load every script, stylesheet and image over https://.",
        )
    });

    let c = new(
        "hsts",
        Cat::Performance,
        "HSTS header",
        Sev::Low,
        E::Low,
        &[Google],
        "Strict-Transport-Security makes browsers always use HTTPS, removing redirect hops.",
    );
    v.push(if cx.html_only || cx.url.map(|u| u.scheme() != "https").unwrap_or(true) {
        c.info("Not applicable.")
    } else if h.contains_key("strict-transport-security") {
        c.pass(h["strict-transport-security"].clone())
    } else {
        c.warn("No Strict-Transport-Security header.", "Send HSTS once all subdomains support HTTPS.")
            .code("text", "Strict-Transport-Security: max-age=31536000; includeSubDomains")
    });
}
